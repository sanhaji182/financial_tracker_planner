package handler

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/middleware"
	"github.com/user/financial-os/internal/service"
)

type ChannelLink struct {
	ID               string    `json:"id"`
	HouseholdOwnerID string    `json:"household_owner_id"`
	UserID           string    `json:"user_id"`
	ChannelType      string    `json:"channel_type"` // telegram | email_forward
	ExternalID       string    `json:"external_id"`
	SecretToken      string    `json:"secret_token,omitempty"`
	DefaultAccountID *string   `json:"default_account_id,omitempty"`
	IsActive         bool      `json:"is_active"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

type InboundTransactionCreator func(
	ctx context.Context,
	ownerID string,
	amount float64,
	txType string,
	description string,
	accountHint string,
	dateStr string,
	source string,
) (string, error)

type ChannelStore interface {
	GetHouseholdChannels(ctx context.Context, ownerID string) ([]ChannelLink, error)
	EnsureInboundEmailToken(ctx context.Context, ownerID, userID string, rotate bool) (*ChannelLink, error)
	UpsertTelegramLink(ctx context.Context, ownerID, userID, chatID string) (*ChannelLink, error)
	FindByTelegramChatID(ctx context.Context, chatID string) (*ChannelLink, error)
	FindByEmailToken(ctx context.Context, token string) (*ChannelLink, error)
}

type PgChannelStore struct {
	db *pgxpool.Pool
}

func NewPgChannelStore(db *pgxpool.Pool) *PgChannelStore {
	return &PgChannelStore{db: db}
}

func randomHexToken(byteLen int) string {
	b := make([]byte, byteLen)
	_, _ = rand.Read(b)
	const hexChars = "0123456789abcdef"
	out := make([]byte, len(b)*2)
	for i, c := range b {
		out[i*2] = hexChars[c>>4]
		out[i*2+1] = hexChars[c&0x0f]
	}
	return string(out)
}

func (s *PgChannelStore) GetHouseholdChannels(ctx context.Context, ownerID string) ([]ChannelLink, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id::text, household_owner_id::text, user_id::text, channel_type, external_id,
		       secret_token, default_account_id::text, is_active, created_at, updated_at
		FROM channel_links
		WHERE household_owner_id = $1 AND is_active = true
		ORDER BY created_at DESC
	`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]ChannelLink, 0)
	for rows.Next() {
		var l ChannelLink
		if err := rows.Scan(&l.ID, &l.HouseholdOwnerID, &l.UserID, &l.ChannelType, &l.ExternalID, &l.SecretToken, &l.DefaultAccountID, &l.IsActive, &l.CreatedAt, &l.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

func (s *PgChannelStore) EnsureInboundEmailToken(ctx context.Context, ownerID, userID string, rotate bool) (*ChannelLink, error) {
	if !rotate {
		var existing ChannelLink
		err := s.db.QueryRow(ctx, `
			SELECT id::text, household_owner_id::text, user_id::text, channel_type, external_id,
			       secret_token, default_account_id::text, is_active, created_at, updated_at
			FROM channel_links
			WHERE household_owner_id = $1 AND channel_type = 'email_forward' AND is_active = true
			LIMIT 1
		`, ownerID).Scan(&existing.ID, &existing.HouseholdOwnerID, &existing.UserID, &existing.ChannelType, &existing.ExternalID, &existing.SecretToken, &existing.DefaultAccountID, &existing.IsActive, &existing.CreatedAt, &existing.UpdatedAt)
		if err == nil {
			return &existing, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
	}

	token := randomHexToken(8)
	_, _ = s.db.Exec(ctx, `UPDATE channel_links SET is_active = false, updated_at = NOW() WHERE household_owner_id = $1 AND channel_type = 'email_forward'`, ownerID)

	var saved ChannelLink
	err := s.db.QueryRow(ctx, `
		INSERT INTO channel_links (household_owner_id, user_id, channel_type, external_id, secret_token, is_active)
		VALUES ($1, $2, 'email_forward', $3, $3, true)
		RETURNING id::text, household_owner_id::text, user_id::text, channel_type, external_id,
		          secret_token, default_account_id::text, is_active, created_at, updated_at
	`, ownerID, userID, token).Scan(&saved.ID, &saved.HouseholdOwnerID, &saved.UserID, &saved.ChannelType, &saved.ExternalID, &saved.SecretToken, &saved.DefaultAccountID, &saved.IsActive, &saved.CreatedAt, &saved.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &saved, nil
}

func (s *PgChannelStore) UpsertTelegramLink(ctx context.Context, ownerID, userID, chatID string) (*ChannelLink, error) {
	var saved ChannelLink
	err := s.db.QueryRow(ctx, `
		INSERT INTO channel_links (household_owner_id, user_id, channel_type, external_id, secret_token, is_active)
		VALUES ($1, $2, 'telegram', $3, '', true)
		ON CONFLICT (channel_type, external_id) DO UPDATE
		SET household_owner_id = EXCLUDED.household_owner_id,
		    user_id = EXCLUDED.user_id,
		    is_active = true,
		    updated_at = NOW()
		RETURNING id::text, household_owner_id::text, user_id::text, channel_type, external_id,
		          secret_token, default_account_id::text, is_active, created_at, updated_at
	`, ownerID, userID, strings.TrimSpace(chatID)).Scan(&saved.ID, &saved.HouseholdOwnerID, &saved.UserID, &saved.ChannelType, &saved.ExternalID, &saved.SecretToken, &saved.DefaultAccountID, &saved.IsActive, &saved.CreatedAt, &saved.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &saved, nil
}

func (s *PgChannelStore) FindByTelegramChatID(ctx context.Context, chatID string) (*ChannelLink, error) {
	var l ChannelLink
	err := s.db.QueryRow(ctx, `
		SELECT id::text, household_owner_id::text, user_id::text, channel_type, external_id,
		       secret_token, default_account_id::text, is_active, created_at, updated_at
		FROM channel_links
		WHERE channel_type = 'telegram' AND external_id = $1 AND is_active = true
	`, strings.TrimSpace(chatID)).Scan(&l.ID, &l.HouseholdOwnerID, &l.UserID, &l.ChannelType, &l.ExternalID, &l.SecretToken, &l.DefaultAccountID, &l.IsActive, &l.CreatedAt, &l.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &l, nil
}

func (s *PgChannelStore) FindByEmailToken(ctx context.Context, token string) (*ChannelLink, error) {
	var l ChannelLink
	err := s.db.QueryRow(ctx, `
		SELECT id::text, household_owner_id::text, user_id::text, channel_type, external_id,
		       secret_token, default_account_id::text, is_active, created_at, updated_at
		FROM channel_links
		WHERE channel_type = 'email_forward' AND secret_token = $1 AND is_active = true
	`, strings.TrimSpace(token)).Scan(&l.ID, &l.HouseholdOwnerID, &l.UserID, &l.ChannelType, &l.ExternalID, &l.SecretToken, &l.DefaultAccountID, &l.IsActive, &l.CreatedAt, &l.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &l, nil
}

// MemoryChannelStore implements ChannelStore cleanly in memory for unit tests.
type MemoryChannelStore struct {
	mu    sync.RWMutex
	links map[string]*ChannelLink
}

func NewMemoryChannelStore() *MemoryChannelStore {
	return &MemoryChannelStore{links: make(map[string]*ChannelLink)}
}

func (m *MemoryChannelStore) GetHouseholdChannels(_ context.Context, ownerID string) ([]ChannelLink, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]ChannelLink, 0)
	for _, l := range m.links {
		if l.HouseholdOwnerID == ownerID && l.IsActive {
			out = append(out, *l)
		}
	}
	return out, nil
}

func (m *MemoryChannelStore) EnsureInboundEmailToken(_ context.Context, ownerID, userID string, rotate bool) (*ChannelLink, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !rotate {
		for _, l := range m.links {
			if l.HouseholdOwnerID == ownerID && l.ChannelType == "email_forward" && l.IsActive {
				cp := *l
				return &cp, nil
			}
		}
	} else {
		for _, l := range m.links {
			if l.HouseholdOwnerID == ownerID && l.ChannelType == "email_forward" {
				l.IsActive = false
			}
		}
	}
	tok := randomHexToken(8)
	now := time.Now()
	l := &ChannelLink{
		ID:               uuid.NewString(),
		HouseholdOwnerID: ownerID,
		UserID:           userID,
		ChannelType:      "email_forward",
		ExternalID:       tok,
		SecretToken:      tok,
		IsActive:         true,
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	m.links["email:"+tok] = l
	cp := *l
	return &cp, nil
}

func (m *MemoryChannelStore) UpsertTelegramLink(_ context.Context, ownerID, userID, chatID string) (*ChannelLink, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now()
	l := &ChannelLink{
		ID:               uuid.NewString(),
		HouseholdOwnerID: ownerID,
		UserID:           userID,
		ChannelType:      "telegram",
		ExternalID:       strings.TrimSpace(chatID),
		IsActive:         true,
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	m.links["tg:"+l.ExternalID] = l
	cp := *l
	return &cp, nil
}

func (m *MemoryChannelStore) FindByTelegramChatID(_ context.Context, chatID string) (*ChannelLink, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if l, ok := m.links["tg:"+strings.TrimSpace(chatID)]; ok && l.IsActive {
		cp := *l
		return &cp, nil
	}
	return nil, errors.New("telegram chat belum terhubung")
}

func (m *MemoryChannelStore) FindByEmailToken(_ context.Context, token string) (*ChannelLink, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if l, ok := m.links["email:"+strings.TrimSpace(token)]; ok && l.IsActive {
		cp := *l
		return &cp, nil
	}
	return nil, errors.New("token email tidak ditemukan")
}

type ParsedQuickChatCommand struct {
	Amount      float64
	TxType      string
	Description string
	AccountHint string
}

var (
	reShorthandAmt = regexp.MustCompile(`(?i)(?:rp\.?\s*)?(\d+(?:[.,]\d+)?)\s*(jt|juta|m|rb|ribu|k)\b`)
	rePlainAmt     = regexp.MustCompile(`(?i)(?:rp\.?\s*)?(\d[\d.,]{2,})`)
	reTokenCleanup = regexp.MustCompile(`(?i)\b(catat|catatkan|beli|bayar|jajan|terima|gaji|masuk|keluar|pakai|via|dengan|sebesar|rp)\b`)
)

// ParseQuickChatCommand parses natural Indonesian chat messages like "kopi kenangan 32rb gopay" or "gaji bonus 5jt bca".
func ParseQuickChatCommand(raw string) (ParsedQuickChatCommand, bool) {
	clean := strings.TrimSpace(raw)
	if clean == "" {
		return ParsedQuickChatCommand{}, false
	}
	low := strings.ToLower(clean)

	amount := 0.0
	descWork := clean
	if m := reShorthandAmt.FindStringSubmatch(low); len(m) == 3 {
		numStr := strings.ReplaceAll(m[1], ",", ".")
		base, err := strconv.ParseFloat(numStr, 64)
		if err == nil {
			switch strings.ToLower(m[2]) {
			case "jt", "juta":
				amount = base * 1_000_000
			case "m":
				amount = base * 1_000_000_000
			case "rb", "ribu", "k":
				amount = base * 1_000
			}
			descWork = reShorthandAmt.ReplaceAllString(descWork, " ")
		}
	} else if m := rePlainAmt.FindStringSubmatch(low); len(m) == 2 {
		numStr := strings.ReplaceAll(m[1], ".", "")
		numStr = strings.ReplaceAll(numStr, ",", ".")
		if val, err := strconv.ParseFloat(numStr, 64); err == nil && val > 0 {
			amount = val
			descWork = rePlainAmt.ReplaceAllString(descWork, " ")
		}
	}

	if amount <= 0 {
		return ParsedQuickChatCommand{}, false
	}

	txType := "expense"
	if regexp.MustCompile(`(?i)\b(gaji|pemasukan|terima|dana masuk|bonus|thr|pendapatan|transfer masuk|cashback)\b`).MatchString(low) {
		txType = "income"
	}

	accountHint := ""
	for _, kw := range []string{"gopay", "ovo", "dana", "shopeepay", "seabank", "jago", "blu", "jenius", "bca", "mandiri", "bni", "bri", "bsi", "tunai", "cash"} {
		if strings.Contains(low, kw) {
			accountHint = kw
			descWork = regexp.MustCompile(`(?i)\b`+kw+`\b`).ReplaceAllString(descWork, " ")
			break
		}
	}

	descWork = reTokenCleanup.ReplaceAllString(descWork, " ")
	desc := strings.Join(strings.Fields(descWork), " ")
	desc = strings.Trim(desc, " :-.,")
	if desc == "" {
		if txType == "income" {
			desc = "Pemasukan via Bot"
		} else {
			desc = "Pengeluaran via Bot"
		}
	}

	return ParsedQuickChatCommand{
		Amount:      amount,
		TxType:      txType,
		Description: desc,
		AccountHint: accountHint,
	}, true
}

type telegramLinkCodeEntry struct {
	HouseholdOwnerID string    `json:"household_owner_id"`
	UserID           string    `json:"user_id"`
	ExpiresAt        time.Time `json:"expires_at"`
}

type ReceiptOCRFunc func(ctx context.Context, imageBytes []byte, fileName string) (merchant string, total float64, dateStr string, err error)
type LegacyCheckInFunc func(ctx context.Context, ownerID string) (nextDueLabel string, err error)

type ChannelInboundHandler struct {
	store                 ChannelStore
	householdResolver     HouseholdOwnerResolver
	telegram              service.TelegramService
	aiService             service.AISettingsService
	txCreator             InboundTransactionCreator
	ocrFn                 ReceiptOCRFunc
	legacyCheckInFn       LegacyCheckInFunc
	telegramWebhookSecret string
	emailWebhookSecret    string
	rdb                   *redis.Client
	mu                    sync.Mutex
	linkCodes             map[string]telegramLinkCodeEntry
}

func NewChannelInboundHandler(
	store ChannelStore,
	resolver HouseholdOwnerResolver,
	telegram service.TelegramService,
	txCreator InboundTransactionCreator,
	rdb *redis.Client,
) *ChannelInboundHandler {
	return &ChannelInboundHandler{
		store:             store,
		householdResolver: resolver,
		telegram:          telegram,
		txCreator:         txCreator,
		rdb:               rdb,
		linkCodes:         make(map[string]telegramLinkCodeEntry),
	}
}

func (h *ChannelInboundHandler) WithAIService(aiService service.AISettingsService) *ChannelInboundHandler {
	h.aiService = aiService
	return h
}

func (h *ChannelInboundHandler) WithReceiptOCR(fn ReceiptOCRFunc) *ChannelInboundHandler {
	h.ocrFn = fn
	return h
}

func (h *ChannelInboundHandler) WithLegacyCheckIn(fn LegacyCheckInFunc) *ChannelInboundHandler {
	h.legacyCheckInFn = fn
	return h
}

func (h *ChannelInboundHandler) WithWebhookSecrets(telegramSecret, emailSecret string) *ChannelInboundHandler {
	h.telegramWebhookSecret = strings.TrimSpace(telegramSecret)
	h.emailWebhookSecret = strings.TrimSpace(emailSecret)
	return h
}

func (h *ChannelInboundHandler) resolveTelegramWebhookSecret() string {
	if h.telegramWebhookSecret != "" {
		return h.telegramWebhookSecret
	}
	return strings.TrimSpace(os.Getenv("TELEGRAM_WEBHOOK_SECRET"))
}

func (h *ChannelInboundHandler) resolveEmailWebhookSecret() string {
	if h.emailWebhookSecret != "" {
		return h.emailWebhookSecret
	}
	return strings.TrimSpace(os.Getenv("EMAIL_WEBHOOK_SECRET"))
}

// VerifyEmailWebhookSignature validates HMAC-SHA256 signatures over "<unix_ts>.<raw_body>" with a 5-minute replay window.
func VerifyEmailWebhookSignature(secret, sigHeader, tsHeader string, rawBody []byte, now time.Time) error {
	cleanSig := strings.TrimSpace(sigHeader)
	cleanTS := strings.TrimSpace(tsHeader)
	if cleanSig == "" || cleanTS == "" {
		return errors.New("header signature dan timestamp email webhook wajib disertakan")
	}
	ts, err := strconv.ParseInt(cleanTS, 10, 64)
	if err != nil {
		return errors.New("timestamp email webhook tidak valid")
	}
	if math.Abs(float64(now.Unix()-ts)) > 300 {
		return errors.New("timestamp email webhook kedaluwarsa (> 5 menit)")
	}

	if len(cleanSig) >= 7 && strings.EqualFold(cleanSig[:7], "sha256=") {
		cleanSig = cleanSig[7:]
	}
	providedMAC, err := hex.DecodeString(cleanSig)
	if err != nil || len(providedMAC) != sha256.Size {
		return errors.New("format signature HMAC email webhook tidak valid")
	}

	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(strconv.FormatInt(ts, 10)))
	_, _ = mac.Write([]byte("."))
	_, _ = mac.Write(rawBody)
	expectedMAC := mac.Sum(nil)

	if !hmac.Equal(providedMAC, expectedMAC) {
		return errors.New("signature HMAC email webhook tidak cocok")
	}
	return nil
}

func (h *ChannelInboundHandler) RegisterRoutes(rg *gin.RouterGroup) {
	ch := rg.Group("/channels")
	ch.Use(middleware.AuthMiddleware())
	{
		ch.GET("", middleware.RoleMiddleware("owner", "spouse_co_owner"), h.GetStatus)
		ch.POST("/telegram/link-code", middleware.RoleMiddleware("owner", "spouse_co_owner"), h.CreateTelegramLinkCode)
		ch.POST("/email/rotate", middleware.RoleMiddleware("owner"), h.RotateEmailToken)
		ch.POST("/simulate-inbound", middleware.RoleMiddleware("owner", "spouse_co_owner"), h.SimulateInbound)
	}

	wh := rg.Group("/webhooks")
	wh.Use(middleware.RateLimitWithRedis(h.rdb, 60))
	{
		wh.POST("/telegram", h.TelegramWebhook)
		wh.POST("/telegram/:secret", h.TelegramWebhook) // legacy alias; auth strictly checks X-Telegram-Bot-Api-Secret-Token header
		wh.POST("/email/:token", h.EmailInboundWebhook)
	}
}

func (h *ChannelInboundHandler) resolveOwner(c *gin.Context) (string, string, bool) {
	userID := c.GetString("user_id")
	role := c.GetString("role")
	if role != "spouse_co_owner" && role != "spouse_viewer" {
		return userID, userID, true
	}
	if h.householdResolver == nil {
		return userID, userID, true
	}
	ownerID, err := h.householdResolver(c.Request.Context(), userID, role)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": gin.H{"code": "FORBIDDEN", "message": err.Error()}})
		return "", userID, false
	}
	return ownerID, userID, true
}

func formatInboundEmailAddress(token string) string {
	domain := strings.TrimSpace(os.Getenv("INBOUND_EMAIL_DOMAIN"))
	if domain == "" {
		domain = "inbound.keuanganbersama.app"
	}
	return fmt.Sprintf("stmt-%s@%s", token, domain)
}

func (h *ChannelInboundHandler) saveLinkCode(ctx context.Context, code string, entry telegramLinkCodeEntry) {
	if h.rdb != nil {
		if raw, err := json.Marshal(entry); err == nil {
			_ = h.rdb.Set(ctx, "tg:link:"+code, string(raw), 15*time.Minute).Err()
			return
		}
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	h.linkCodes[code] = entry
}

func (h *ChannelInboundHandler) consumeLinkCode(ctx context.Context, code string) (*telegramLinkCodeEntry, bool) {
	clean := strings.ToUpper(strings.TrimSpace(code))
	if h.rdb != nil {
		if val, err := h.rdb.GetDel(ctx, "tg:link:"+clean).Result(); err == nil && val != "" {
			var e telegramLinkCodeEntry
			if json.Unmarshal([]byte(val), &e) == nil {
				return &e, true
			}
		}
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	e, ok := h.linkCodes[clean]
	if !ok {
		return nil, false
	}
	delete(h.linkCodes, clean)
	if time.Now().After(e.ExpiresAt) {
		return nil, false
	}
	return &e, true
}

func (h *ChannelInboundHandler) GetStatus(c *gin.Context) {
	ownerID, userID, ok := h.resolveOwner(c)
	if !ok {
		return
	}
	ctx := c.Request.Context()
	emailLink, err := h.store.EnsureInboundEmailToken(ctx, ownerID, userID, false)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()}})
		return
	}
	links, _ := h.store.GetHouseholdChannels(ctx, ownerID)

	telegramChats := make([]string, 0)
	for _, l := range links {
		if l.ChannelType == "telegram" {
			telegramChats = append(telegramChats, l.ExternalID)
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"telegram_linked":       len(telegramChats) > 0,
			"telegram_chat_ids":     telegramChats,
			"telegram_bot_ready":    os.Getenv("TELEGRAM_BOT_TOKEN") != "",
			"inbound_email_token":   emailLink.SecretToken,
			"inbound_email_address": formatInboundEmailAddress(emailLink.SecretToken),
			"email_webhook_path":    "/api/v1/webhooks/email/" + emailLink.SecretToken,
		},
	})
}

func (h *ChannelInboundHandler) CreateTelegramLinkCode(c *gin.Context) {
	ownerID, userID, ok := h.resolveOwner(c)
	if !ok {
		return
	}
	code := "KB-" + strings.ToUpper(randomHexToken(3))
	exp := time.Now().Add(15 * time.Minute)
	h.saveLinkCode(c.Request.Context(), code, telegramLinkCodeEntry{
		HouseholdOwnerID: ownerID,
		UserID:           userID,
		ExpiresAt:        exp,
	})
	c.JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"code":        code,
			"instruction": fmt.Sprintf("Kirim pesan `/link %s` ke bot Telegram Keuangan Bersama.", code),
			"expires_at":  exp,
		},
	})
}

func (h *ChannelInboundHandler) RotateEmailToken(c *gin.Context) {
	ownerID := c.GetString("user_id")
	link, err := h.store.EnsureInboundEmailToken(c.Request.Context(), ownerID, ownerID, true)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()}})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"inbound_email_token":   link.SecretToken,
			"inbound_email_address": formatInboundEmailAddress(link.SecretToken),
			"email_webhook_path":    "/api/v1/webhooks/email/" + link.SecretToken,
		},
	})
}

func (h *ChannelInboundHandler) callWorkerEmailParser(
	ctx context.Context,
	subject, sender, bodyText, bodyHTML string,
) ([]map[string]interface{}, string, error) {
	workerURL := os.Getenv("WORKER_URL")
	if workerURL == "" {
		workerURL = "http://localhost:8081"
	}
	payload, _ := json.Marshal(map[string]interface{}{
		"subject":   subject,
		"sender":    sender,
		"body_text": bodyText,
		"body_html": bodyHTML,
	})
	req, err := http.NewRequestWithContext(ctx, "POST", workerURL+"/parse/email-statement", bytes.NewReader(payload))
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("Content-Type", "application/json")
	if secret := os.Getenv("WORKER_SECRET"); secret != "" {
		req.Header.Set("X-Worker-Secret", secret)
	}
	client := &http.Client{Timeout: 8 * time.Second}
	resp, err := client.Do(req)
	if err != nil || resp.StatusCode != http.StatusOK {
		if resp != nil {
			resp.Body.Close()
		}
		return nil, "", errors.New("worker email parser unavailable")
	}
	defer resp.Body.Close()

	var parsed struct {
		Bank         string                   `json:"bank"`
		Transactions []map[string]interface{} `json:"transactions"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return nil, "", err
	}
	return parsed.Transactions, parsed.Bank, nil
}

func (h *ChannelInboundHandler) processInboundEmailPayload(
	ctx context.Context,
	ownerID, subject, sender, bodyText, bodyHTML string,
) (int, []string, error) {
	workerTxs, bank, err := h.callWorkerEmailParser(ctx, subject, sender, bodyText, bodyHTML)
	createdIDs := make([]string, 0)

	if err == nil && len(workerTxs) > 0 {
		for _, item := range workerTxs {
			debit, _ := item["debit"].(float64)
			credit, _ := item["credit"].(float64)
			amount := debit
			txType := "expense"
			if credit > 0 && debit == 0 {
				amount = credit
				txType = "income"
			}
			if amount <= 0 {
				continue
			}
			desc, _ := item["description"].(string)
			dateStr, _ := item["date"].(string)
			if h.txCreator != nil {
				txID, txErr := h.txCreator(ctx, ownerID, amount, txType, desc, bank, dateStr, "pdf_parse")
				if txErr == nil && txID != "" {
					createdIDs = append(createdIDs, txID)
				}
			}
		}
		return len(createdIDs), createdIDs, nil
	}

	// Deterministic local fallback if worker isn't running
	combined := strings.TrimSpace(subject + " " + bodyText + " " + bodyHTML)
	if cmd, ok := ParseQuickChatCommand(combined); ok {
		if h.txCreator != nil {
			txID, txErr := h.txCreator(ctx, ownerID, cmd.Amount, cmd.TxType, cmd.Description, cmd.AccountHint, time.Now().Format("2006-01-02"), "pdf_parse")
			if txErr != nil {
				return 0, nil, txErr
			}
			if txID != "" {
				createdIDs = append(createdIDs, txID)
			}
		}
		return 1, createdIDs, nil
	}

	return 0, createdIDs, nil
}

func (h *ChannelInboundHandler) SimulateInbound(c *gin.Context) {
	ownerID, _, ok := h.resolveOwner(c)
	if !ok {
		return
	}
	var req struct {
		Channel string `json:"channel" binding:"required,oneof=telegram_text email_forward"`
		Subject string `json:"subject"`
		Sender  string `json:"sender"`
		Text    string `json:"text" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": gin.H{"code": "BAD_REQUEST", "message": err.Error()}})
		return
	}

	ctx := c.Request.Context()
	if req.Channel == "telegram_text" {
		cmd, parsed := ParseQuickChatCommand(req.Text)
		if !parsed {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": gin.H{"code": "UNRECOGNIZED_COMMAND", "message": "Format belum dikenali. Contoh: 'Kopi Kenangan 32rb pakai GoPay'"},
			})
			return
		}
		txID := ""
		if h.txCreator != nil {
			var err error
			txID, err = h.txCreator(ctx, ownerID, cmd.Amount, cmd.TxType, cmd.Description, cmd.AccountHint, time.Now().Format("2006-01-02"), "ai_suggested")
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": gin.H{"code": "CREATE_FAILED", "message": err.Error()}})
				return
			}
		}
		c.JSON(http.StatusOK, gin.H{
			"data": gin.H{
				"channel":        "telegram_text",
				"parsed_count":   1,
				"transaction_id": txID,
				"amount":         cmd.Amount,
				"type":           cmd.TxType,
				"description":    cmd.Description,
				"reply":          fmt.Sprintf("✅ Tercatat %s sebesar %s (%s)", cmd.Description, dto.FormatRupiah(cmd.Amount), cmd.TxType),
			},
		})
		return
	}

	count, txIDs, err := h.processInboundEmailPayload(ctx, ownerID, req.Subject, req.Sender, req.Text, "")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": gin.H{"code": "EMAIL_PARSE_FAILED", "message": err.Error()}})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"channel":         "email_forward",
			"parsed_count":    count,
			"transaction_ids": txIDs,
			"reply":           fmt.Sprintf("📧 %d transaksi dari email berhasil diekstrak", count),
		},
	})
}

type telegramWebhookUpdate struct {
	UpdateID int64 `json:"update_id"`
	Message  *struct {
		Chat struct {
			ID int64 `json:"id"`
		} `json:"chat"`
		Text    string `json:"text"`
		Caption string `json:"caption"`
		Voice   *struct {
			FileID   string `json:"file_id"`
			MimeType string `json:"mime_type"`
		} `json:"voice"`
		Photo []struct {
			FileID string `json:"file_id"`
		} `json:"photo"`
	} `json:"message"`
}

func (h *ChannelInboundHandler) TelegramWebhook(c *gin.Context) {
	expectedSecret := h.resolveTelegramWebhookSecret()
	if expectedSecret == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error": gin.H{
				"code":    "WEBHOOK_NOT_CONFIGURED",
				"message": "TELEGRAM_WEBHOOK_SECRET belum dikonfigurasi di server",
			},
		})
		return
	}
	providedSecret := strings.TrimSpace(c.GetHeader("X-Telegram-Bot-Api-Secret-Token"))
	if providedSecret == "" || !hmac.Equal([]byte(providedSecret), []byte(expectedSecret)) {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": gin.H{
				"code":    "UNAUTHORIZED",
				"message": "Header X-Telegram-Bot-Api-Secret-Token tidak valid",
			},
		})
		return
	}

	var update telegramWebhookUpdate
	if err := c.ShouldBindJSON(&update); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": gin.H{"code": "BAD_REQUEST", "message": err.Error()}})
		return
	}
	if update.Message == nil {
		c.JSON(http.StatusOK, gin.H{"ok": true})
		return
	}

	ctx := c.Request.Context()
	chatID := strconv.FormatInt(update.Message.Chat.ID, 10)
	text := strings.TrimSpace(update.Message.Text)
	if text == "" {
		text = strings.TrimSpace(update.Message.Caption)
	}

	// Handle /start & /link KB-XXXXXX pairing
	if strings.HasPrefix(strings.ToLower(text), "/start") {
		if h.telegram != nil {
			_ = h.telegram.SendReplyToChat(chatID, "Halo! Hubungkan akun Anda dengan mengetik `/link KODE` dari Pengaturan Akun Keuangan Bersama.")
		}
		c.JSON(http.StatusOK, gin.H{"ok": true, "action": "start"})
		return
	}

	if strings.HasPrefix(strings.ToLower(text), "/link") {
		parts := strings.Fields(text)
		if len(parts) < 2 {
			if h.telegram != nil {
				_ = h.telegram.SendReplyToChat(chatID, "Format: `/link KB-XXXXXX`")
			}
			c.JSON(http.StatusBadRequest, gin.H{"ok": false, "message": "Kode link diperlukan"})
			return
		}
		entry, ok := h.consumeLinkCode(ctx, parts[1])
		if !ok {
			if h.telegram != nil {
				_ = h.telegram.SendReplyToChat(chatID, "❌ Kode pairing tidak valid atau sudah kedaluwarsa.")
			}
			c.JSON(http.StatusBadRequest, gin.H{"ok": false, "message": "Kode tidak valid"})
			return
		}
		if _, err := h.store.UpsertTelegramLink(ctx, entry.HouseholdOwnerID, entry.UserID, chatID); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"ok": false, "message": err.Error()})
			return
		}
		if h.telegram != nil {
			_ = h.telegram.SendReplyToChat(chatID, "✅ Bot Telegram terhubung! Kirim teks (`kopi 28rb gopay`) atau voice note untuk mencatat transaksi langsung.")
		}
		c.JSON(http.StatusOK, gin.H{"ok": true, "linked": true})
		return
	}

	link, err := h.store.FindByTelegramChatID(ctx, chatID)
	if err != nil {
		if h.telegram != nil {
			_ = h.telegram.SendReplyToChat(chatID, "Akun Telegram ini belum terhubung. Buat kode di Pengaturan -> Integrasi Bot, lalu kirim `/link KODE`.")
		}
		c.JSON(http.StatusOK, gin.H{"ok": true, "linked": false})
		return
	}

	if strings.HasPrefix(strings.ToLower(text), "/checkin") {
		if h.legacyCheckInFn == nil {
			if h.telegram != nil {
				_ = h.telegram.SendReplyToChat(chatID, "Fitur Check-In Wasiat Digital belum aktif di server.")
			}
			c.JSON(http.StatusOK, gin.H{"ok": true, "action": "legacy_checkin", "configured": false})
			return
		}
		nextDueLabel, ciErr := h.legacyCheckInFn(ctx, link.HouseholdOwnerID)
		if ciErr != nil {
			if h.telegram != nil {
				_ = h.telegram.SendReplyToChat(chatID, "⚠️ Check-In gagal: "+ciErr.Error())
			}
			c.JSON(http.StatusOK, gin.H{"ok": false, "action": "legacy_checkin", "error": ciErr.Error()})
			return
		}
		if h.telegram != nil {
			_ = h.telegram.SendReplyToChat(chatID, fmt.Sprintf("✅ *Check-In Darurat Berhasil!*\nTimer Wasiat Digital telah direset.\nJadwal jatuh tempo berikutnya: *%s*", nextDueLabel))
		}
		c.JSON(http.StatusOK, gin.H{"ok": true, "action": "legacy_checkin", "next_due": nextDueLabel})
		return
	}

	// Voice note handling via Worker transcription if available
	voiceTranscript := ""
	if update.Message.Voice != nil && update.Message.Voice.FileID != "" && h.telegram != nil {
		audioBytes, filePath, dlErr := h.telegram.DownloadFile(update.Message.Voice.FileID)
		if dlErr == nil && len(audioBytes) > 0 && h.aiService != nil {
			mimeType := strings.TrimSpace(update.Message.Voice.MimeType)
			if mimeType == "" {
				mimeType = "audio/ogg"
			}
			fileName := filepath.Base(strings.TrimSpace(filePath))
			if fileName == "" || fileName == "." || fileName == "/" {
				fileName = "voice-note.ogg"
			}
			res, tErr := h.aiService.TranscribeVoiceWorker(ctx, link.HouseholdOwnerID, audioBytes, fileName, mimeType, "{}")
			if tErr == nil && res != nil && strings.TrimSpace(res.Transcript) != "" {
				voiceTranscript = strings.TrimSpace(res.Transcript)
				text = voiceTranscript
			}
		}
		if voiceTranscript == "" && text == "" {
			_ = h.telegram.SendReplyToChat(chatID, "🎙️ Voice note diterima. Pastikan AI Key (OpenAI/Gemini) aktif di Pengaturan AI agar transkripsi otomatis berjalan.")
			c.JSON(http.StatusOK, gin.H{"ok": true, "parsed": false})
			return
		}
	}

	// Photo receipt handling: auto-download & parse via Worker /ocr/receipt (or injected OCR fn)
	if len(update.Message.Photo) > 0 && text == "" && h.telegram != nil {
		largestPhoto := update.Message.Photo[len(update.Message.Photo)-1]
		if largestPhoto.FileID != "" {
			if imgBytes, filePath, dlErr := h.telegram.DownloadFile(largestPhoto.FileID); dlErr == nil && len(imgBytes) > 0 {
				fileName := filepath.Base(strings.TrimSpace(filePath))
				if fileName == "" || fileName == "." || fileName == "/" {
					fileName = "telegram-receipt.jpg"
				}
				ocrRunner := h.ocrFn
				if ocrRunner == nil {
					ocrRunner = h.callWorkerOcrReceipt
				}
				if merchant, total, dateStr, ocrErr := ocrRunner(ctx, imgBytes, fileName); ocrErr == nil && total > 0 {
					if merchant == "" {
						merchant = "Struk Foto Telegram"
					}
					if dateStr == "" {
						dateStr = time.Now().Format("2006-01-02")
					}
					txID := ""
					if h.txCreator != nil {
						txID, err = h.txCreator(ctx, link.HouseholdOwnerID, total, "expense", merchant, "", dateStr, "ocr")
						if err != nil {
							_ = h.telegram.SendReplyToChat(chatID, "⚠️ Gagal menyimpan hasil OCR struk: "+err.Error())
							c.JSON(http.StatusOK, gin.H{"ok": false, "error": err.Error()})
							return
						}
					}
					_ = h.telegram.SendReplyToChat(
						chatID,
						fmt.Sprintf("🧾 Struk terbaca otomatis!\nMerchant: *%s*\nTotal: *%s*\nTanggal: %s", merchant, dto.FormatRupiah(total), dateStr),
					)
					c.JSON(http.StatusOK, gin.H{
						"ok":             true,
						"action":         "photo_ocr",
						"transaction_id": txID,
						"amount":         total,
						"merchant":       merchant,
					})
					return
				}
			}
		}

		_ = h.telegram.SendReplyToChat(chatID, "📷 Foto struk diterima. Tambahkan nominal di caption (mis. `belanja 75rb gopay`) atau scan via aplikasi untuk hasil OCR penuh.")
		c.JSON(http.StatusOK, gin.H{"ok": true, "action": "photo_ack"})
		return
	}

	cmd, parsed := ParseQuickChatCommand(text)
	if !parsed {
		if h.telegram != nil {
			_ = h.telegram.SendReplyToChat(chatID, "Contoh format: `Kopi Kenangan 32rb pakai GoPay` atau `Gaji masuk 5jt BCA`.")
		}
		c.JSON(http.StatusOK, gin.H{"ok": true, "parsed": false})
		return
	}

	txID := ""
	if h.txCreator != nil {
		txID, err = h.txCreator(ctx, link.HouseholdOwnerID, cmd.Amount, cmd.TxType, cmd.Description, cmd.AccountHint, time.Now().Format("2006-01-02"), "ai_suggested")
		if err != nil {
			if h.telegram != nil {
				_ = h.telegram.SendReplyToChat(chatID, "⚠️ Gagal mencatat transaksi: "+err.Error())
			}
			c.JSON(http.StatusOK, gin.H{"ok": false, "error": err.Error()})
			return
		}
	}

	replyPrefix := ""
	if voiceTranscript != "" {
		replyPrefix = fmt.Sprintf("🎙️ Transkrip: \"%s\"\n", voiceTranscript)
	}
	replyText := fmt.Sprintf("%s✅ Tercatat *%s*\nNominal: *%s*\nTipe: `%s`", replyPrefix, cmd.Description, dto.FormatRupiah(cmd.Amount), cmd.TxType)
	if h.telegram != nil {
		_ = h.telegram.SendReplyToChat(chatID, replyText)
	}
	respPayload := gin.H{
		"ok":             true,
		"parsed":         true,
		"transaction_id": txID,
		"amount":         cmd.Amount,
		"description":    cmd.Description,
	}
	if voiceTranscript != "" {
		respPayload["transcript"] = voiceTranscript
	}
	c.JSON(http.StatusOK, respPayload)
}

func (h *ChannelInboundHandler) callWorkerOcrReceipt(
	ctx context.Context, imageBytes []byte, fileName string,
) (string, float64, string, error) {
	workerURL := os.Getenv("WORKER_URL")
	if workerURL == "" {
		workerURL = "http://localhost:8081"
	}
	var formBuf bytes.Buffer
	mw := multipart.NewWriter(&formBuf)
	fw, err := mw.CreateFormFile("file", fileName)
	if err != nil {
		return "", 0, "", err
	}
	if _, err := fw.Write(imageBytes); err != nil {
		return "", 0, "", err
	}
	if err := mw.Close(); err != nil {
		return "", 0, "", err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, workerURL+"/ocr/receipt", &formBuf)
	if err != nil {
		return "", 0, "", err
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	if secret := os.Getenv("WORKER_SECRET"); secret != "" {
		req.Header.Set("X-Worker-Secret", secret)
	}
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil || resp.StatusCode != http.StatusOK {
		if resp != nil {
			resp.Body.Close()
		}
		return "", 0, "", errors.New("worker OCR unavailable")
	}
	defer resp.Body.Close()

	var parsed struct {
		ParsedData struct {
			MerchantName string  `json:"merchant_name"`
			Date         string  `json:"date"`
			Total        float64 `json:"total"`
		} `json:"parsed_data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return "", 0, "", err
	}
	return parsed.ParsedData.MerchantName, parsed.ParsedData.Total, parsed.ParsedData.Date, nil
}

func (h *ChannelInboundHandler) EmailInboundWebhook(c *gin.Context) {
	expectedSecret := h.resolveEmailWebhookSecret()
	if expectedSecret == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error": gin.H{
				"code":    "WEBHOOK_NOT_CONFIGURED",
				"message": "EMAIL_WEBHOOK_SECRET belum dikonfigurasi di server",
			},
		})
		return
	}

	rawBody, err := io.ReadAll(io.LimitReader(c.Request.Body, 5<<20))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": gin.H{"code": "BAD_REQUEST", "message": "Gagal membaca payload email webhook"}})
		return
	}

	sigHeader := c.GetHeader("X-Email-Webhook-Signature")
	if sigHeader == "" {
		sigHeader = c.GetHeader("X-Webhook-Signature")
	}
	tsHeader := c.GetHeader("X-Email-Webhook-Timestamp")
	if tsHeader == "" {
		tsHeader = c.GetHeader("X-Webhook-Timestamp")
	}
	if err := VerifyEmailWebhookSignature(expectedSecret, sigHeader, tsHeader, rawBody, time.Now()); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": gin.H{
				"code":    "INVALID_WEBHOOK_SIGNATURE",
				"message": err.Error(),
			},
		})
		return
	}

	token := c.Param("token")
	link, err := h.store.FindByEmailToken(c.Request.Context(), token)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": gin.H{"code": "NOT_FOUND", "message": "Token email forward tidak valid"}})
		return
	}

	var req struct {
		Subject    string `json:"subject"`
		From       string `json:"from"`
		Sender     string `json:"sender"`
		Text       string `json:"text"`
		BodyText   string `json:"body_text"`
		HTML       string `json:"html"`
		BodyHTML   string `json:"body_html"`
		Attachment *struct {
			Filename      string `json:"filename"`
			ContentBase64 string `json:"content_base64"`
		} `json:"attachment"`
	}
	if err := json.Unmarshal(rawBody, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": gin.H{"code": "BAD_REQUEST", "message": err.Error()}})
		return
	}
	sender := req.Sender
	if sender == "" {
		sender = req.From
	}
	bodyText := req.BodyText
	if bodyText == "" {
		bodyText = req.Text
	}
	bodyHTML := req.BodyHTML
	if bodyHTML == "" {
		bodyHTML = req.HTML
	}

	// Ignore binary invalid base64 gracefully
	if req.Attachment != nil && req.Attachment.ContentBase64 != "" {
		_, _ = base64.StdEncoding.DecodeString(req.Attachment.ContentBase64)
	}

	count, txIDs, err := h.processInboundEmailPayload(c.Request.Context(), link.HouseholdOwnerID, req.Subject, sender, bodyText, bodyHTML)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": gin.H{"code": "PARSE_FAILED", "message": err.Error()}})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"parsed_count":    count,
			"transaction_ids": txIDs,
		},
	})
}
