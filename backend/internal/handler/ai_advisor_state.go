package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog/log"
	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/service"
)

// BriefingRecipient describes a household owner eligible for proactive daily briefings.
type BriefingRecipient struct {
	OwnerID        string
	Email          string
	Name           string
	TelegramChatID string
}

// AIAdvisorStateStore persists cross-device chat history, learned memory, and daily briefings.
type AIAdvisorStateStore interface {
	ListHistory(ctx context.Context, ownerID string, limit int) ([]dto.AIChatMessageRecord, error)
	AppendMessage(ctx context.Context, ownerID string, msg dto.AIChatMessageRecord) (dto.AIChatMessageRecord, error)
	ClearHistory(ctx context.Context, ownerID string) error
	GetMemory(ctx context.Context, ownerID string) (dto.AIAdvisorMemoryDTO, error)
	SaveMemory(ctx context.Context, ownerID string, mem dto.AIAdvisorMemoryDTO) (dto.AIAdvisorMemoryDTO, error)
	ClearMemory(ctx context.Context, ownerID string) error
	GetLatestBriefing(ctx context.Context, ownerID string) (*dto.AIDailyBriefingDTO, error)
	HasBriefingForDate(ctx context.Context, ownerID string, dateStr string) (bool, error)
	SaveBriefingRun(ctx context.Context, briefing dto.AIDailyBriefingDTO, insertAlert bool) (*dto.AIDailyBriefingDTO, error)
	ListBriefingRecipients(ctx context.Context) ([]BriefingRecipient, error)
}

// PgAIAdvisorStateStore implements AIAdvisorStateStore using PostgreSQL.
type PgAIAdvisorStateStore struct {
	pool *pgxpool.Pool
}

// NewPgAIAdvisorStateStore constructs a PostgreSQL-backed AI advisor state store.
func NewPgAIAdvisorStateStore(pool *pgxpool.Pool) *PgAIAdvisorStateStore {
	return &PgAIAdvisorStateStore{pool: pool}
}

func (s *PgAIAdvisorStateStore) ListHistory(ctx context.Context, ownerID string, limit int) ([]dto.AIChatMessageRecord, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	rows, err := s.pool.Query(ctx, `
		SELECT id::text, COALESCE(client_message_id, ''), role, content,
		       COALESCE(actions, '[]'::jsonb),
		       COALESCE(suggested_replies, '[]'::jsonb),
		       COALESCE(image_preview, ''),
		       COALESCE(attachments_meta, '[]'::jsonb),
		       created_at, updated_at
		FROM ai_chat_messages
		WHERE owner_id = $1
		ORDER BY created_at DESC
		LIMIT $2
	`, ownerID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var desc []dto.AIChatMessageRecord
	for rows.Next() {
		var rec dto.AIChatMessageRecord
		var actionsJSON, repliesJSON, attJSON []byte
		if scanErr := rows.Scan(
			&rec.ID,
			&rec.ClientMessageID,
			&rec.Role,
			&rec.Content,
			&actionsJSON,
			&repliesJSON,
			&rec.ImagePreview,
			&attJSON,
			&rec.CreatedAt,
			&rec.UpdatedAt,
		); scanErr != nil {
			return nil, scanErr
		}
		_ = json.Unmarshal(actionsJSON, &rec.Actions)
		_ = json.Unmarshal(repliesJSON, &rec.SuggestedReplies)
		_ = json.Unmarshal(attJSON, &rec.AttachmentsMeta)
		desc = append(desc, rec)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Reverse descending DB rows back to chronological order for rendering & LLM turn ordering.
	out := make([]dto.AIChatMessageRecord, len(desc))
	for i := range desc {
		out[len(desc)-1-i] = desc[i]
	}
	return out, nil
}

func (s *PgAIAdvisorStateStore) AppendMessage(ctx context.Context, ownerID string, msg dto.AIChatMessageRecord) (dto.AIChatMessageRecord, error) {
	if msg.Role != "user" && msg.Role != "assistant" && msg.Role != "system" {
		msg.Role = "assistant"
	}
	if len(msg.Actions) == 0 {
		msg.Actions = []dto.AgenticActionDTO{}
	}
	if len(msg.SuggestedReplies) == 0 {
		msg.SuggestedReplies = []string{}
	}
	if len(msg.AttachmentsMeta) == 0 {
		msg.AttachmentsMeta = []map[string]string{}
	}
	actionsJSON, _ := json.Marshal(msg.Actions)
	repliesJSON, _ := json.Marshal(msg.SuggestedReplies)
	attJSON, _ := json.Marshal(msg.AttachmentsMeta)

	clientID := strings.TrimSpace(msg.ClientMessageID)
	var row pgx.Row
	if clientID != "" {
		row = s.pool.QueryRow(ctx, `
			INSERT INTO ai_chat_messages (owner_id, client_message_id, role, content, actions, suggested_replies, image_preview, attachments_meta)
			VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8::jsonb)
			ON CONFLICT (owner_id, client_message_id)
			WHERE client_message_id IS NOT NULL AND client_message_id <> ''
			DO UPDATE SET
				content = EXCLUDED.content,
				actions = EXCLUDED.actions,
				suggested_replies = EXCLUDED.suggested_replies,
				image_preview = COALESCE(NULLIF(EXCLUDED.image_preview, ''), ai_chat_messages.image_preview),
				attachments_meta = EXCLUDED.attachments_meta,
				updated_at = NOW()
			RETURNING id::text, created_at, updated_at
		`, ownerID, clientID, msg.Role, msg.Content, string(actionsJSON), string(repliesJSON), msg.ImagePreview, string(attJSON))
	} else {
		row = s.pool.QueryRow(ctx, `
			INSERT INTO ai_chat_messages (owner_id, role, content, actions, suggested_replies, image_preview, attachments_meta)
			VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7::jsonb)
			RETURNING id::text, created_at, updated_at
		`, ownerID, msg.Role, msg.Content, string(actionsJSON), string(repliesJSON), msg.ImagePreview, string(attJSON))
	}

	if err := row.Scan(&msg.ID, &msg.CreatedAt, &msg.UpdatedAt); err != nil {
		return msg, err
	}
	return msg, nil
}

func (s *PgAIAdvisorStateStore) ClearHistory(ctx context.Context, ownerID string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM ai_chat_messages WHERE owner_id = $1`, ownerID)
	return err
}

func (s *PgAIAdvisorStateStore) GetMemory(ctx context.Context, ownerID string) (dto.AIAdvisorMemoryDTO, error) {
	out := dto.AIAdvisorMemoryDTO{
		LearnedRules: []dto.AILearnedRuleDTO{},
		CustomNotes:  []string{},
	}
	var rulesJSON, notesJSON []byte
	var updated time.Time
	err := s.pool.QueryRow(ctx, `
		SELECT COALESCE(learned_rules, '[]'::jsonb),
		       COALESCE(custom_notes, '[]'::jsonb),
		       COALESCE(preferred_payment_account, ''),
		       updated_at
		FROM ai_advisor_memories
		WHERE owner_id = $1
	`, ownerID).Scan(&rulesJSON, &notesJSON, &out.PreferredPaymentAccount, &updated)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return out, nil
		}
		return out, err
	}
	_ = json.Unmarshal(rulesJSON, &out.LearnedRules)
	_ = json.Unmarshal(notesJSON, &out.CustomNotes)
	out.UpdatedAt = updated.UTC().Format(time.RFC3339)
	return normalizeAdvisorMemoryDTO(out), nil
}

func (s *PgAIAdvisorStateStore) SaveMemory(ctx context.Context, ownerID string, mem dto.AIAdvisorMemoryDTO) (dto.AIAdvisorMemoryDTO, error) {
	norm := normalizeAdvisorMemoryDTO(mem)
	rulesJSON, _ := json.Marshal(norm.LearnedRules)
	notesJSON, _ := json.Marshal(norm.CustomNotes)
	var updated time.Time
	err := s.pool.QueryRow(ctx, `
		INSERT INTO ai_advisor_memories (owner_id, learned_rules, custom_notes, preferred_payment_account, updated_at)
		VALUES ($1, $2::jsonb, $3::jsonb, $4, NOW())
		ON CONFLICT (owner_id) DO UPDATE SET
			learned_rules = EXCLUDED.learned_rules,
			custom_notes = EXCLUDED.custom_notes,
			preferred_payment_account = EXCLUDED.preferred_payment_account,
			updated_at = NOW()
		RETURNING updated_at
	`, ownerID, string(rulesJSON), string(notesJSON), norm.PreferredPaymentAccount).Scan(&updated)
	if err != nil {
		return norm, err
	}
	norm.UpdatedAt = updated.UTC().Format(time.RFC3339)
	return norm, nil
}

func (s *PgAIAdvisorStateStore) ClearMemory(ctx context.Context, ownerID string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM ai_advisor_memories WHERE owner_id = $1`, ownerID)
	return err
}

func (s *PgAIAdvisorStateStore) GetLatestBriefing(ctx context.Context, ownerID string) (*dto.AIDailyBriefingDTO, error) {
	var b dto.AIDailyBriefingDTO
	var briefingDate time.Time
	var highlightsJSON []byte
	err := s.pool.QueryRow(ctx, `
		SELECT id::text, owner_id::text, briefing_date, severity, title, summary,
		       COALESCE(highlights, '[]'::jsonb), notified_email, notified_telegram, created_at
		FROM ai_briefing_runs
		WHERE owner_id = $1
		ORDER BY briefing_date DESC, created_at DESC
		LIMIT 1
	`, ownerID).Scan(
		&b.ID,
		&b.OwnerID,
		&briefingDate,
		&b.Severity,
		&b.Title,
		&b.Summary,
		&highlightsJSON,
		&b.NotifiedEmail,
		&b.NotifiedTelegram,
		&b.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	b.BriefingDate = briefingDate.Format("2006-01-02")
	_ = json.Unmarshal(highlightsJSON, &b.Highlights)
	return &b, nil
}

func (s *PgAIAdvisorStateStore) HasBriefingForDate(ctx context.Context, ownerID string, dateStr string) (bool, error) {
	var exists bool
	err := s.pool.QueryRow(ctx, `
		SELECT EXISTS(SELECT 1 FROM ai_briefing_runs WHERE owner_id = $1 AND briefing_date = $2::date)
	`, ownerID, dateStr).Scan(&exists)
	return exists, err
}

func (s *PgAIAdvisorStateStore) SaveBriefingRun(ctx context.Context, briefing dto.AIDailyBriefingDTO, insertAlert bool) (*dto.AIDailyBriefingDTO, error) {
	if len(briefing.Highlights) == 0 {
		briefing.Highlights = []string{}
	}
	highlightsJSON, _ := json.Marshal(briefing.Highlights)
	err := s.pool.QueryRow(ctx, `
		INSERT INTO ai_briefing_runs (owner_id, briefing_date, severity, title, summary, highlights, notified_email, notified_telegram)
		VALUES ($1, $2::date, $3, $4, $5, $6::jsonb, $7, $8)
		ON CONFLICT (owner_id, briefing_date) DO UPDATE SET
			severity = EXCLUDED.severity,
			title = EXCLUDED.title,
			summary = EXCLUDED.summary,
			highlights = EXCLUDED.highlights,
			notified_email = EXCLUDED.notified_email OR ai_briefing_runs.notified_email,
			notified_telegram = EXCLUDED.notified_telegram OR ai_briefing_runs.notified_telegram
		RETURNING id::text, created_at
	`, briefing.OwnerID, briefing.BriefingDate, briefing.Severity, briefing.Title, briefing.Summary,
		string(highlightsJSON), briefing.NotifiedEmail, briefing.NotifiedTelegram).Scan(&briefing.ID, &briefing.CreatedAt)
	if err != nil {
		return nil, err
	}

	if insertAlert {
		var count int
		_ = s.pool.QueryRow(ctx, `
			SELECT COUNT(*) FROM alerts
			WHERE user_id = $1 AND type = 'ai_daily_briefing' AND created_at::date = $2::date AND is_dismissed = false
		`, briefing.OwnerID, briefing.BriefingDate).Scan(&count)
		if count == 0 {
			sev := briefing.Severity
			if sev != "danger" && sev != "warning" {
				sev = "info"
			}
			_, _ = s.pool.Exec(ctx, `
				INSERT INTO alerts (user_id, type, severity, title, message, action_url, action_label)
				VALUES ($1, 'ai_daily_briefing', $2, $3, $4, '/?openAdvisor=1', 'Tanya AI Advisor')
			`, briefing.OwnerID, sev, briefing.Title, briefing.Summary)
		}
	}

	return &briefing, nil
}

func (s *PgAIAdvisorStateStore) ListBriefingRecipients(ctx context.Context) ([]BriefingRecipient, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT u.id::text, COALESCE(u.email, ''), COALESCE(u.name, ''),
		       COALESCE((
		         SELECT cl.external_id FROM channel_links cl
		         WHERE cl.household_owner_id = u.id
		           AND cl.channel_type = 'telegram'
		           AND cl.is_active = true
		         ORDER BY cl.updated_at DESC
		         LIMIT 1
		       ), '') AS telegram_chat_id
		FROM users u
		WHERE u.role = 'owner' AND u.is_active = true AND u.deleted_at IS NULL
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var recipients []BriefingRecipient
	for rows.Next() {
		var r BriefingRecipient
		if err := rows.Scan(&r.OwnerID, &r.Email, &r.Name, &r.TelegramChatID); err != nil {
			return nil, err
		}
		recipients = append(recipients, r)
	}
	return recipients, rows.Err()
}

// MemoryAIAdvisorStateStore provides a deterministic in-memory store for unit tests.
type MemoryAIAdvisorStateStore struct {
	mu         sync.RWMutex
	history    map[string][]dto.AIChatMessageRecord
	memory     map[string]dto.AIAdvisorMemoryDTO
	briefings  map[string][]dto.AIDailyBriefingDTO
	alerts     map[string][]dto.AIDailyBriefingDTO
	recipients []BriefingRecipient
	seq        int
}

// NewMemoryAIAdvisorStateStore constructs an isolated in-memory AI advisor state store.
func NewMemoryAIAdvisorStateStore(recipients ...BriefingRecipient) *MemoryAIAdvisorStateStore {
	return &MemoryAIAdvisorStateStore{
		history:    make(map[string][]dto.AIChatMessageRecord),
		memory:     make(map[string]dto.AIAdvisorMemoryDTO),
		briefings:  make(map[string][]dto.AIDailyBriefingDTO),
		alerts:     make(map[string][]dto.AIDailyBriefingDTO),
		recipients: recipients,
	}
}

func (m *MemoryAIAdvisorStateStore) ListHistory(_ context.Context, ownerID string, limit int) ([]dto.AIChatMessageRecord, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	rows := m.history[ownerID]
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	start := 0
	if len(rows) > limit {
		start = len(rows) - limit
	}
	out := make([]dto.AIChatMessageRecord, len(rows[start:]))
	copy(out, rows[start:])
	return out, nil
}

func (m *MemoryAIAdvisorStateStore) AppendMessage(_ context.Context, ownerID string, msg dto.AIChatMessageRecord) (dto.AIChatMessageRecord, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now().UTC()
	m.seq++
	if msg.ID == "" {
		msg.ID = fmt.Sprintf("msg-mem-%d", m.seq)
	}
	if msg.CreatedAt.IsZero() {
		msg.CreatedAt = now
	}
	msg.UpdatedAt = now
	existing := m.history[ownerID]
	if msg.ClientMessageID != "" {
		for i := range existing {
			if existing[i].ClientMessageID == msg.ClientMessageID {
				existing[i].Content = msg.Content
				existing[i].Actions = msg.Actions
				existing[i].SuggestedReplies = msg.SuggestedReplies
				existing[i].UpdatedAt = now
				m.history[ownerID] = existing
				return existing[i], nil
			}
		}
	}
	m.history[ownerID] = append(existing, msg)
	return msg, nil
}

func (m *MemoryAIAdvisorStateStore) ClearHistory(_ context.Context, ownerID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.history, ownerID)
	return nil
}

func (m *MemoryAIAdvisorStateStore) GetMemory(_ context.Context, ownerID string) (dto.AIAdvisorMemoryDTO, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	mem, ok := m.memory[ownerID]
	if !ok {
		return dto.AIAdvisorMemoryDTO{LearnedRules: []dto.AILearnedRuleDTO{}, CustomNotes: []string{}}, nil
	}
	return normalizeAdvisorMemoryDTO(mem), nil
}

func (m *MemoryAIAdvisorStateStore) SaveMemory(_ context.Context, ownerID string, mem dto.AIAdvisorMemoryDTO) (dto.AIAdvisorMemoryDTO, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	norm := normalizeAdvisorMemoryDTO(mem)
	norm.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	m.memory[ownerID] = norm
	return norm, nil
}

func (m *MemoryAIAdvisorStateStore) ClearMemory(_ context.Context, ownerID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.memory, ownerID)
	return nil
}

func (m *MemoryAIAdvisorStateStore) GetLatestBriefing(_ context.Context, ownerID string) (*dto.AIDailyBriefingDTO, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	list := m.briefings[ownerID]
	if len(list) == 0 {
		return nil, nil
	}
	cp := list[len(list)-1]
	return &cp, nil
}

func (m *MemoryAIAdvisorStateStore) HasBriefingForDate(_ context.Context, ownerID string, dateStr string) (bool, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for _, b := range m.briefings[ownerID] {
		if b.BriefingDate == dateStr {
			return true, nil
		}
	}
	return false, nil
}

func (m *MemoryAIAdvisorStateStore) SaveBriefingRun(_ context.Context, briefing dto.AIDailyBriefingDTO, insertAlert bool) (*dto.AIDailyBriefingDTO, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.seq++
	if briefing.ID == "" {
		briefing.ID = fmt.Sprintf("brief-%d", m.seq)
	}
	if briefing.CreatedAt.IsZero() {
		briefing.CreatedAt = time.Now().UTC()
	}
	list := m.briefings[briefing.OwnerID]
	updated := false
	for i := range list {
		if list[i].BriefingDate == briefing.BriefingDate {
			briefing.ID = list[i].ID
			briefing.NotifiedEmail = briefing.NotifiedEmail || list[i].NotifiedEmail
			briefing.NotifiedTelegram = briefing.NotifiedTelegram || list[i].NotifiedTelegram
			list[i] = briefing
			updated = true
			break
		}
	}
	if !updated {
		list = append(list, briefing)
	}
	m.briefings[briefing.OwnerID] = list

	if insertAlert {
		exists := false
		for _, a := range m.alerts[briefing.OwnerID] {
			if a.BriefingDate == briefing.BriefingDate {
				exists = true
				break
			}
		}
		if !exists {
			m.alerts[briefing.OwnerID] = append(m.alerts[briefing.OwnerID], briefing)
		}
	}
	return &briefing, nil
}

func (m *MemoryAIAdvisorStateStore) ListBriefingRecipients(_ context.Context) ([]BriefingRecipient, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]BriefingRecipient, len(m.recipients))
	copy(out, m.recipients)
	return out, nil
}

// AlertsCount returns stored daily briefing alerts for testing assertions.
func (m *MemoryAIAdvisorStateStore) AlertsCount(ownerID string) int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.alerts[ownerID])
}

func normalizeAdvisorMemoryDTO(in dto.AIAdvisorMemoryDTO) dto.AIAdvisorMemoryDTO {
	seenRule := make(map[string]dto.AILearnedRuleDTO)
	var ruleOrder []string
	for _, r := range in.LearnedRules {
		kw := strings.ToLower(strings.TrimSpace(r.Keyword))
		if len(kw) < 2 {
			continue
		}
		r.Keyword = kw
		if r.UseCount <= 0 {
			r.UseCount = 1
		}
		if r.ID == "" {
			r.ID = "rule:" + strings.ReplaceAll(kw, " ", "_")
		}
		if prev, exists := seenRule[kw]; exists {
			if r.CategoryName != "" {
				prev.CategoryName = r.CategoryName
			}
			if r.AccountName != "" {
				prev.AccountName = r.AccountName
			}
			if r.Type != "" {
				prev.Type = r.Type
			}
			if r.UseCount > prev.UseCount {
				prev.UseCount = r.UseCount
			}
			if r.UpdatedAt != "" {
				prev.UpdatedAt = r.UpdatedAt
			}
			seenRule[kw] = prev
			continue
		}
		ruleOrder = append(ruleOrder, kw)
		seenRule[kw] = r
	}
	rules := make([]dto.AILearnedRuleDTO, 0, len(ruleOrder))
	for _, kw := range ruleOrder {
		rules = append(rules, seenRule[kw])
	}
	if len(rules) > 40 {
		rules = rules[len(rules)-40:]
	}

	seenNotes := make(map[string]bool)
	notes := make([]string, 0, len(in.CustomNotes))
	for _, n := range in.CustomNotes {
		trimmed := strings.TrimSpace(n)
		if trimmed == "" {
			continue
		}
		key := strings.ToLower(trimmed)
		if seenNotes[key] {
			continue
		}
		seenNotes[key] = true
		notes = append(notes, trimmed)
	}
	if len(notes) > 25 {
		notes = notes[len(notes)-25:]
	}

	return dto.AIAdvisorMemoryDTO{
		LearnedRules:            rules,
		CustomNotes:             notes,
		PreferredPaymentAccount: strings.TrimSpace(in.PreferredPaymentAccount),
		UpdatedAt:               in.UpdatedAt,
	}
}

var explicitNoteRegex = regexp.MustCompile(`(?i)(?:tolong\s+)?(?:ingat|catat\s+preferensi|biasakan)\s+(.+)$`)

func extractExplicitNoteFromPrompt(message string) string {
	m := explicitNoteRegex.FindStringSubmatch(strings.TrimSpace(message))
	if len(m) < 2 {
		return ""
	}
	note := strings.Trim(strings.TrimSpace(m[1]), ".!\"'")
	if len(note) < 5 || len(note) > 180 {
		return ""
	}
	return note
}

func (h *AISettingsHandler) hydrateRequestWithServerState(ctx context.Context, ownerID string, req *dto.AIChatRequest, workerContext map[string]interface{}) {
	if h.stateStore == nil {
		return
	}
	mem, err := h.stateStore.GetMemory(ctx, ownerID)
	if err == nil {
		if req.Preferences == nil {
			req.Preferences = map[string]interface{}{}
		}
		if _, has := req.Preferences["learned_rules"]; !has && len(mem.LearnedRules) > 0 {
			req.Preferences["learned_rules"] = mem.LearnedRules
		}
		if _, has := req.Preferences["custom_notes"]; !has && len(mem.CustomNotes) > 0 {
			req.Preferences["custom_notes"] = mem.CustomNotes
		}
		if _, has := req.Preferences["preferred_payment_account"]; !has && mem.PreferredPaymentAccount != "" {
			req.Preferences["preferred_payment_account"] = mem.PreferredPaymentAccount
		}
		workerContext["learned_preferences"] = req.Preferences
	}

	if len(req.History) == 0 {
		if past, histErr := h.stateStore.ListHistory(ctx, ownerID, 12); histErr == nil && len(past) > 0 {
			turns := make([]dto.AIChatTurn, 0, len(past))
			for _, item := range past {
				turns = append(turns, dto.AIChatTurn{Role: item.Role, Content: item.Content})
			}
			req.History = turns
		}
	}
}

func (h *AISettingsHandler) recordChatExchange(ctx context.Context, ownerID string, req dto.AIChatRequest, resp dto.AIChatResponse) {
	if h.stateStore == nil {
		return
	}
	if strings.TrimSpace(req.Message) != "" {
		var attMeta []map[string]string
		for _, a := range req.Attachments {
			attMeta = append(attMeta, map[string]string{
				"name":      a.Name,
				"mime_type": a.MimeType,
			})
		}
		_, _ = h.stateStore.AppendMessage(ctx, ownerID, dto.AIChatMessageRecord{
			Role:            "user",
			Content:         req.Message,
			AttachmentsMeta: attMeta,
		})
	}
	if strings.TrimSpace(resp.Response) != "" || len(resp.ProposedActions) > 0 {
		_, _ = h.stateStore.AppendMessage(ctx, ownerID, dto.AIChatMessageRecord{
			Role:             "assistant",
			Content:          resp.Response,
			Actions:          resp.ProposedActions,
			SuggestedReplies: resp.SuggestedReplies,
		})
	}

	// Capture any explicit "ingat ..." / "biasakan ..." instruction into synced memory.
	if note := extractExplicitNoteFromPrompt(req.Message); note != "" {
		mem, err := h.stateStore.GetMemory(ctx, ownerID)
		if err == nil {
			mem.CustomNotes = append(mem.CustomNotes, note)
			_, _ = h.stateStore.SaveMemory(ctx, ownerID, mem)
		}
	}
}

type sseCaptureWriter struct {
	gin.ResponseWriter
	buf              bytes.Buffer
	assistantText    strings.Builder
	actions          []dto.AgenticActionDTO
	suggestedReplies []string
}

func (w *sseCaptureWriter) Write(p []byte) (int, error) {
	w.parseChunk(p)
	return w.ResponseWriter.Write(p)
}

func (w *sseCaptureWriter) WriteString(s string) (int, error) {
	w.parseChunk([]byte(s))
	return w.ResponseWriter.WriteString(s)
}

func (w *sseCaptureWriter) parseChunk(p []byte) {
	w.buf.Write(p)
	for {
		data := w.buf.Bytes()
		idx := bytes.IndexByte(data, '\n')
		if idx < 0 {
			break
		}
		line := strings.TrimSpace(string(data[:idx]))
		w.buf.Next(idx + 1)
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		raw := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if raw == "" || raw == "[DONE]" {
			continue
		}
		var evt struct {
			Type             string                 `json:"type"`
			Content          string                 `json:"content"`
			ProposedActions  []dto.AgenticActionDTO `json:"proposed_actions"`
			SuggestedReplies []string               `json:"suggested_replies"`
		}
		if err := json.Unmarshal([]byte(raw), &evt); err == nil {
			switch evt.Type {
			case "delta":
				w.assistantText.WriteString(evt.Content)
			case "meta":
				if len(evt.ProposedActions) > 0 {
					w.actions = evt.ProposedActions
				}
				if len(evt.SuggestedReplies) > 0 {
					w.suggestedReplies = evt.SuggestedReplies
				}
			}
		}
	}
}

// GetChatHistory returns cross-device persisted AI Advisor chat history & learned memory.
func (h *AISettingsHandler) GetChatHistory(c *gin.Context) {
	ownerID, _, ok := h.resolveHouseholdOwner(c)
	if !ok {
		return
	}
	if h.stateStore == nil {
		c.JSON(http.StatusOK, gin.H{"data": dto.AIChatHistoryResponse{
			Messages: []dto.AIChatMessageRecord{},
			Memory:   dto.AIAdvisorMemoryDTO{LearnedRules: []dto.AILearnedRuleDTO{}, CustomNotes: []string{}},
		}})
		return
	}

	ctx := c.Request.Context()
	messages, err := h.stateStore.ListHistory(ctx, ownerID, 60)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()}})
		return
	}
	if messages == nil {
		messages = []dto.AIChatMessageRecord{}
	}
	mem, err := h.stateStore.GetMemory(ctx, ownerID)
	if err != nil {
		mem = dto.AIAdvisorMemoryDTO{LearnedRules: []dto.AILearnedRuleDTO{}, CustomNotes: []string{}}
	}
	c.JSON(http.StatusOK, gin.H{"data": dto.AIChatHistoryResponse{
		Messages: messages,
		Memory:   mem,
	}})
}

// ClearChatHistory removes synchronized AI chat messages for the household owner.
func (h *AISettingsHandler) ClearChatHistory(c *gin.Context) {
	ownerID, _, ok := h.resolveHouseholdOwner(c)
	if !ok {
		return
	}
	if h.stateStore != nil {
		if err := h.stateStore.ClearHistory(c.Request.Context(), ownerID); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()}})
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"cleared": true}})
}

// GetAdvisorMemory returns cross-device learned categorization rules & user notes.
func (h *AISettingsHandler) GetAdvisorMemory(c *gin.Context) {
	ownerID, _, ok := h.resolveHouseholdOwner(c)
	if !ok {
		return
	}
	if h.stateStore == nil {
		c.JSON(http.StatusOK, gin.H{"data": dto.AIAdvisorMemoryDTO{LearnedRules: []dto.AILearnedRuleDTO{}, CustomNotes: []string{}}})
		return
	}
	mem, err := h.stateStore.GetMemory(c.Request.Context(), ownerID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()}})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": mem})
}

// UpdateAdvisorMemory persists cross-device learned categorization rules & user notes.
func (h *AISettingsHandler) UpdateAdvisorMemory(c *gin.Context) {
	ownerID, _, ok := h.resolveHouseholdOwner(c)
	if !ok {
		return
	}
	var req dto.AIAdvisorMemoryDTO
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": gin.H{"code": "BAD_REQUEST", "message": err.Error()}})
		return
	}
	if h.stateStore == nil {
		c.JSON(http.StatusOK, gin.H{"data": normalizeAdvisorMemoryDTO(req)})
		return
	}
	saved, err := h.stateStore.SaveMemory(c.Request.Context(), ownerID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()}})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": saved})
}

// ClearAdvisorMemory resets learned rules & notes for the household owner.
func (h *AISettingsHandler) ClearAdvisorMemory(c *gin.Context) {
	ownerID, _, ok := h.resolveHouseholdOwner(c)
	if !ok {
		return
	}
	if h.stateStore != nil {
		if err := h.stateStore.ClearMemory(c.Request.Context(), ownerID); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()}})
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"cleared": true}})
}

// GetDailyBriefing fetches today's proactive AI briefing (computing one on demand if absent).
func (h *AISettingsHandler) GetDailyBriefing(c *gin.Context) {
	ownerID, _, ok := h.resolveHouseholdOwner(c)
	if !ok {
		return
	}
	ctx := c.Request.Context()
	if h.stateStore != nil {
		if existing, err := h.stateStore.GetLatestBriefing(ctx, ownerID); err == nil && existing != nil {
			c.JSON(http.StatusOK, gin.H{"data": existing})
			return
		}
	}
	briefing, err := h.BuildDailyBriefingForOwner(ctx, ownerID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()}})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": briefing})
}

// RunDailyBriefing triggers immediate proactive briefing generation & notification delivery for the owner.
func (h *AISettingsHandler) RunDailyBriefing(c *gin.Context) {
	ownerID := c.GetString("user_id")
	rec := BriefingRecipient{OwnerID: ownerID}
	if h.stateStore != nil {
		if list, err := h.stateStore.ListBriefingRecipients(c.Request.Context()); err == nil {
			for _, item := range list {
				if item.OwnerID == ownerID {
					rec = item
					break
				}
			}
		}
	}
	briefing, err := h.RunDailyBriefingForRecipient(c.Request.Context(), rec, true)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()}})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": briefing})
}

func formatIDRBriefing(v float64) string {
	neg := v < 0
	if neg {
		v = -v
	}
	n := int64(v + 0.5)
	s := fmt.Sprintf("%d", n)
	var out []byte
	for i, c := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			out = append(out, '.')
		}
		out = append(out, byte(c))
	}
	if neg {
		return "-Rp " + string(out)
	}
	return "Rp " + string(out)
}

// BuildDailyBriefingForOwner computes actionable financial insights from live household services.
func (h *AISettingsHandler) BuildDailyBriefingForOwner(ctx context.Context, ownerID string) (*dto.AIDailyBriefingDTO, error) {
	dashboard, err := h.dashboardService.GetDashboardData(ctx, ownerID)
	if err != nil {
		return nil, err
	}
	efSummary, _ := h.efService.GetEFSummary(ctx, ownerID)
	currentMonth := time.Now().Format("2006-01")
	budgetSummary, _ := h.budgetService.GetBudgetSummary(ctx, ownerID, currentMonth)

	severity := "info"
	var highlights []string

	if dashboard.ForecastEndMonth.Value < 0 {
		severity = "danger"
		highlights = append(highlights, fmt.Sprintf("Proyeksi saldo akhir bulan defisit %s — tahan belanja non-prioritas.", formatIDRBriefing(dashboard.ForecastEndMonth.Value)))
	}

	var dueSoonCount int
	var dueSoonTotal float64
	for _, b := range dashboard.UpcomingBills {
		if b.DaysRemaining <= 3 {
			dueSoonCount++
			dueSoonTotal += b.Amount
		}
	}
	if dueSoonCount > 0 {
		if dashboard.CashAvailable.Value < dueSoonTotal {
			severity = "danger"
		} else if severity == "info" {
			severity = "warning"
		}
		highlights = append(highlights, fmt.Sprintf("%d tagihan jatuh tempo ≤ 3 hari senilai %s.", dueSoonCount, formatIDRBriefing(dueSoonTotal)))
	}

	if budgetSummary != nil && budgetSummary.CategoriesOver > 0 {
		if severity == "info" {
			severity = "warning"
		}
		highlights = append(highlights, fmt.Sprintf("%d kategori anggaran telah melampaui batas bulan ini (%s terpakai).", budgetSummary.CategoriesOver, formatIDRBriefing(budgetSummary.TotalSpent.Value)))
	}

	if efSummary != nil && efSummary.TargetAmount.Value > 0 && efSummary.CoverageMonths < 3 {
		if severity == "info" {
			severity = "warning"
		}
		highlights = append(highlights, fmt.Sprintf("Dana darurat mencukupi %.1f bulan (target ideal minimal 3 bulan).", efSummary.CoverageMonths))
	}

	if dashboard.DTIRatio > 35 {
		if severity == "info" {
			severity = "warning"
		}
		highlights = append(highlights, fmt.Sprintf("Rasio cicilan (DTI) %.1f%% melampaui ambang aman 35%%.", dashboard.DTIRatio))
	}

	highlights = append(highlights, fmt.Sprintf("Safe-to-Spend tersedia %s • Skor Kesehatan %d/100.", formatIDRBriefing(dashboard.SafeToSpend.Value), dashboard.HealthScore.Score))

	title := "Ringkasan Harian AI Advisor: Keuangan Terkendali"
	if severity == "danger" {
		title = "Peringatan Harian AI Advisor: Perlu Tindakan Kas"
	} else if severity == "warning" {
		title = "Catatan Proaktif AI Advisor Hari Ini"
	}

	summary := strings.Join(highlights, " ")
	if len(highlights) > 2 {
		summary = strings.Join(highlights[:2], " ") + fmt.Sprintf(" (%d sorotan aktif.)", len(highlights))
	}

	return &dto.AIDailyBriefingDTO{
		OwnerID:      ownerID,
		BriefingDate: time.Now().UTC().Format("2006-01-02"),
		Severity:     severity,
		Title:        title,
		Summary:      summary,
		Highlights:   highlights,
		CreatedAt:    time.Now().UTC(),
	}, nil
}

// RunDailyBriefingForRecipient generates today's briefing, dispatches optional email/Telegram, and stores idempotent alerts.
func (h *AISettingsHandler) RunDailyBriefingForRecipient(ctx context.Context, rec BriefingRecipient, force bool) (*dto.AIDailyBriefingDTO, error) {
	today := time.Now().UTC().Format("2006-01-02")
	if h.stateStore != nil && !force {
		exists, err := h.stateStore.HasBriefingForDate(ctx, rec.OwnerID, today)
		if err == nil && exists {
			return nil, nil
		}
	}

	briefing, err := h.BuildDailyBriefingForOwner(ctx, rec.OwnerID)
	if err != nil {
		return nil, err
	}

	if h.telegramService != nil {
		msgText := fmt.Sprintf("*%s*\n%s", briefing.Title, strings.Join(briefing.Highlights, "\n• "))
		if rec.TelegramChatID != "" {
			if sendErr := h.telegramService.SendReplyToChat(rec.TelegramChatID, msgText); sendErr == nil {
				briefing.NotifiedTelegram = true
			}
		} else if briefing.Severity != "info" {
			if sendErr := h.telegramService.SendMessage(briefing.Title, briefing.Summary, "Buka AI Advisor di Keuangan Bersama"); sendErr == nil {
				briefing.NotifiedTelegram = true
			}
		}
	}

	if h.emailService != nil && h.emailService.IsConfigured() && strings.TrimSpace(rec.Email) != "" {
		greetingName := strings.TrimSpace(rec.Name)
		if greetingName == "" {
			greetingName = "Sahabat Keuangan Bersama"
		}
		var htmlBullets strings.Builder
		var textBullets strings.Builder
		for _, item := range briefing.Highlights {
			htmlBullets.WriteString("<li>" + html.EscapeString(item) + "</li>")
			textBullets.WriteString("- " + item + "\n")
		}
		emailErr := h.emailService.SendEmail(ctx, service.EmailMessage{
			To:      strings.TrimSpace(rec.Email),
			Subject: "[Keuangan Bersama] " + briefing.Title,
			TextBody: fmt.Sprintf("Halo %s,\n\n%s\n\nRincian:\n%s\nBuka aplikasi Keuangan Bersama dan klik tombol Tanya AI Advisor untuk menindaklanjuti.",
				greetingName, briefing.Summary, textBullets.String()),
			HTMLBody: fmt.Sprintf("<p>Halo <strong>%s</strong>,</p><p>%s</p><ul>%s</ul><p>Buka aplikasi Keuangan Bersama untuk meninjau bersama AI Advisor.</p>",
				html.EscapeString(greetingName), html.EscapeString(briefing.Summary), htmlBullets.String()),
		})
		if emailErr == nil {
			briefing.NotifiedEmail = true
		} else {
			log.Warn().Err(emailErr).Str("owner_id", rec.OwnerID).Msg("Failed to send daily AI briefing email")
		}
	}

	if h.stateStore != nil {
		saved, saveErr := h.stateStore.SaveBriefingRun(ctx, *briefing, true)
		if saveErr != nil {
			return nil, saveErr
		}
		return saved, nil
	}
	return briefing, nil
}

// EvaluateDueDailyBriefings scans active household owners and emits once-per-day proactive briefings.
func (h *AISettingsHandler) EvaluateDueDailyBriefings(ctx context.Context) error {
	if h.stateStore == nil {
		return nil
	}
	recipients, err := h.stateStore.ListBriefingRecipients(ctx)
	if err != nil {
		return err
	}
	for _, rec := range recipients {
		if rec.OwnerID == "" {
			continue
		}
		if _, err := h.RunDailyBriefingForRecipient(ctx, rec, false); err != nil {
			log.Warn().Err(err).Str("owner_id", rec.OwnerID).Msg("Failed evaluating daily AI briefing")
		}
	}
	return nil
}
