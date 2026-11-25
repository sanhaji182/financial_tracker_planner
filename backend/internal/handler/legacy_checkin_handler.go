package handler

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"net/http"
	"net/mail"
	"os"
	"sort"
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

type LegacyEncryptedPackage struct {
	Version       int    `json:"v"`
	CiphertextB64 string `json:"ciphertext_b64"`
	IVB64         string `json:"iv_b64"`
	SaltB64       string `json:"salt_b64"`
	KDFIterations int    `json:"kdf_iterations"`
	UpdatedAt     string `json:"updated_at"`
}

type LegacyBeneficiary struct {
	ID             string    `json:"id"`
	UserID         string    `json:"user_id,omitempty"`
	Name           string    `json:"name"`
	Relationship   string    `json:"relationship"`
	Email          string    `json:"email"`
	TelegramChatID string    `json:"telegram_chat_id,omitempty"`
	CreatedAt      time.Time `json:"created_at"`
}

type LegacyCheckInEvent struct {
	ID        string    `json:"id"`
	UserID    string    `json:"user_id,omitempty"`
	EventType string    `json:"event_type"`
	Note      string    `json:"note"`
	CreatedAt time.Time `json:"created_at"`
}

type LegacyCheckInConfig struct {
	UserID                 string                  `json:"user_id"`
	Enabled                bool                    `json:"enabled"`
	IsPaused               bool                    `json:"is_paused"`
	PausedUntil            *time.Time              `json:"paused_until,omitempty"`
	IntervalDays           int                     `json:"interval_days"`
	GracePeriodDays        int                     `json:"grace_period_days"`
	ReminderHour           int                     `json:"reminder_hour"`
	Timezone               string                  `json:"timezone"`
	AutoResetOnActivity    bool                    `json:"auto_reset_on_activity"`
	DeliveryMode           string                  `json:"delivery_mode"` // e2ee_portal | email_summary
	OwnerNotifyEmail       bool                    `json:"owner_notify_email"`
	OwnerNotifyTelegram    bool                    `json:"owner_notify_telegram"`
	Status                 string                  `json:"status"` // inactive | active | paused | grace_period | triggered
	LastCheckinAt          *time.Time              `json:"last_checkin_at,omitempty"`
	NextDueAt              *time.Time              `json:"next_due_at,omitempty"`
	GraceStartedAt         *time.Time              `json:"grace_started_at,omitempty"`
	TriggerDeadlineAt      *time.Time              `json:"trigger_deadline_at,omitempty"`
	TriggeredAt            *time.Time              `json:"triggered_at,omitempty"`
	LastReminderSentDate   *string                 `json:"last_reminder_sent_date,omitempty"`
	LastGraceAlertSentDate *string                 `json:"last_grace_alert_sent_date,omitempty"`
	EncryptedPackage       *LegacyEncryptedPackage `json:"encrypted_package_json,omitempty"`
	PlaintextSummaryNote   string                  `json:"plaintext_summary_note,omitempty"`
	UpdatedAt              time.Time               `json:"updated_at"`
}

type LegacyClaimTokenRecord struct {
	TokenHash        string     `json:"-"`
	UserID           string     `json:"user_id"`
	BeneficiaryID    string     `json:"beneficiary_id"`
	BeneficiaryName  string     `json:"beneficiary_name"`
	BeneficiaryEmail string     `json:"beneficiary_email"`
	ExpiresAt        time.Time  `json:"expires_at"`
	ClaimedAt        *time.Time `json:"claimed_at,omitempty"`
	CreatedAt        time.Time  `json:"created_at"`
}

type LegacyCheckInUserMeta struct {
	UserID         string
	Email          string
	Name           string
	TelegramChatID string
}

type LegacyCheckInStore interface {
	GetConfig(ctx context.Context, userID string) (*LegacyCheckInConfig, error)
	UpsertConfig(ctx context.Context, cfg *LegacyCheckInConfig) (*LegacyCheckInConfig, error)
	ListBeneficiaries(ctx context.Context, userID string) ([]LegacyBeneficiary, error)
	ReplaceBeneficiaries(ctx context.Context, userID string, list []LegacyBeneficiary) ([]LegacyBeneficiary, error)
	ListEvents(ctx context.Context, userID string, limit int) ([]LegacyCheckInEvent, error)
	AppendEvent(ctx context.Context, userID, eventType, note string) error
	ListActiveConfigs(ctx context.Context) ([]LegacyCheckInConfig, error)
	GetUserMeta(ctx context.Context, userID string) (*LegacyCheckInUserMeta, error)
	InsertClaimToken(ctx context.Context, rec *LegacyClaimTokenRecord) error
	ClaimByTokenHash(ctx context.Context, tokenHash string, now time.Time) (*LegacyClaimTokenRecord, *LegacyCheckInConfig, *LegacyCheckInUserMeta, error)
	RecordInAppAlert(ctx context.Context, userID, alertType, title, message, severity, actionURL string) error
	BuildReadableInventorySummary(ctx context.Context, userID string) (string, error)
}

func defaultLegacyConfig(userID string) *LegacyCheckInConfig {
	return &LegacyCheckInConfig{
		UserID:              userID,
		Enabled:             false,
		IsPaused:            false,
		IntervalDays:        7,
		GracePeriodDays:     3,
		ReminderHour:        20,
		Timezone:            "Asia/Jakarta",
		AutoResetOnActivity: false,
		DeliveryMode:        "e2ee_portal",
		OwnerNotifyEmail:    true,
		OwnerNotifyTelegram: true,
		Status:              "inactive",
		UpdatedAt:           time.Now(),
	}
}

type PgLegacyCheckInStore struct {
	db *pgxpool.Pool
}

func NewPgLegacyCheckInStore(db *pgxpool.Pool) *PgLegacyCheckInStore {
	return &PgLegacyCheckInStore{db: db}
}

func scanLegacyConfigRow(row pgx.Row) (*LegacyCheckInConfig, error) {
	var cfg LegacyCheckInConfig
	var pkgRaw []byte
	err := row.Scan(
		&cfg.UserID,
		&cfg.Enabled,
		&cfg.IsPaused,
		&cfg.PausedUntil,
		&cfg.IntervalDays,
		&cfg.GracePeriodDays,
		&cfg.ReminderHour,
		&cfg.Timezone,
		&cfg.AutoResetOnActivity,
		&cfg.DeliveryMode,
		&cfg.OwnerNotifyEmail,
		&cfg.OwnerNotifyTelegram,
		&cfg.Status,
		&cfg.LastCheckinAt,
		&cfg.NextDueAt,
		&cfg.GraceStartedAt,
		&cfg.TriggerDeadlineAt,
		&cfg.TriggeredAt,
		&cfg.LastReminderSentDate,
		&cfg.LastGraceAlertSentDate,
		&pkgRaw,
		&cfg.PlaintextSummaryNote,
		&cfg.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	if len(pkgRaw) > 0 && string(pkgRaw) != "null" {
		var pkg LegacyEncryptedPackage
		if json.Unmarshal(pkgRaw, &pkg) == nil && pkg.CiphertextB64 != "" {
			cfg.EncryptedPackage = &pkg
		}
	}
	return &cfg, nil
}

const legacyConfigColumns = `
	user_id::text, enabled, is_paused, paused_until, interval_days, grace_period_days,
	reminder_hour, timezone, auto_reset_on_activity, delivery_mode, owner_notify_email,
	owner_notify_telegram, status, last_checkin_at, next_due_at, grace_started_at,
	trigger_deadline_at, triggered_at,
	TO_CHAR(last_reminder_sent_date, 'YYYY-MM-DD'),
	TO_CHAR(last_grace_alert_sent_date, 'YYYY-MM-DD'),
	encrypted_package_json, plaintext_summary_note, updated_at
`

func (s *PgLegacyCheckInStore) GetConfig(ctx context.Context, userID string) (*LegacyCheckInConfig, error) {
	cfg, err := scanLegacyConfigRow(s.db.QueryRow(ctx, `SELECT `+legacyConfigColumns+` FROM legacy_checkin_configs WHERE user_id = $1`, userID))
	if errors.Is(err, pgx.ErrNoRows) {
		return defaultLegacyConfig(userID), nil
	}
	if err != nil {
		return nil, err
	}
	return cfg, nil
}

func (s *PgLegacyCheckInStore) UpsertConfig(ctx context.Context, cfg *LegacyCheckInConfig) (*LegacyCheckInConfig, error) {
	var pkgJSON interface{}
	if cfg.EncryptedPackage != nil && cfg.EncryptedPackage.CiphertextB64 != "" {
		raw, _ := json.Marshal(cfg.EncryptedPackage)
		pkgJSON = string(raw)
	}
	saved, err := scanLegacyConfigRow(s.db.QueryRow(ctx, `
		INSERT INTO legacy_checkin_configs (
			user_id, enabled, is_paused, paused_until, interval_days, grace_period_days,
			reminder_hour, timezone, auto_reset_on_activity, delivery_mode,
			owner_notify_email, owner_notify_telegram, status,
			last_checkin_at, next_due_at, grace_started_at, trigger_deadline_at, triggered_at,
			last_reminder_sent_date, last_grace_alert_sent_date,
			encrypted_package_json, plaintext_summary_note, updated_at
		) VALUES (
			$1, $2, $3, $4, $5, $6,
			$7, $8, $9, $10,
			$11, $12, $13,
			$14, $15, $16, $17, $18,
			$19::date, $20::date,
			$21::jsonb, $22, NOW()
		)
		ON CONFLICT (user_id) DO UPDATE SET
			enabled = EXCLUDED.enabled,
			is_paused = EXCLUDED.is_paused,
			paused_until = EXCLUDED.paused_until,
			interval_days = EXCLUDED.interval_days,
			grace_period_days = EXCLUDED.grace_period_days,
			reminder_hour = EXCLUDED.reminder_hour,
			timezone = EXCLUDED.timezone,
			auto_reset_on_activity = EXCLUDED.auto_reset_on_activity,
			delivery_mode = EXCLUDED.delivery_mode,
			owner_notify_email = EXCLUDED.owner_notify_email,
			owner_notify_telegram = EXCLUDED.owner_notify_telegram,
			status = EXCLUDED.status,
			last_checkin_at = EXCLUDED.last_checkin_at,
			next_due_at = EXCLUDED.next_due_at,
			grace_started_at = EXCLUDED.grace_started_at,
			trigger_deadline_at = EXCLUDED.trigger_deadline_at,
			triggered_at = EXCLUDED.triggered_at,
			last_reminder_sent_date = EXCLUDED.last_reminder_sent_date,
			last_grace_alert_sent_date = EXCLUDED.last_grace_alert_sent_date,
			encrypted_package_json = EXCLUDED.encrypted_package_json,
			plaintext_summary_note = EXCLUDED.plaintext_summary_note,
			updated_at = NOW()
		RETURNING `+legacyConfigColumns,
		cfg.UserID, cfg.Enabled, cfg.IsPaused, cfg.PausedUntil, cfg.IntervalDays, cfg.GracePeriodDays,
		cfg.ReminderHour, cfg.Timezone, cfg.AutoResetOnActivity, cfg.DeliveryMode,
		cfg.OwnerNotifyEmail, cfg.OwnerNotifyTelegram, cfg.Status,
		cfg.LastCheckinAt, cfg.NextDueAt, cfg.GraceStartedAt, cfg.TriggerDeadlineAt, cfg.TriggeredAt,
		cfg.LastReminderSentDate, cfg.LastGraceAlertSentDate,
		pkgJSON, cfg.PlaintextSummaryNote,
	))
	if err != nil {
		return nil, err
	}
	return saved, nil
}

func (s *PgLegacyCheckInStore) ListBeneficiaries(ctx context.Context, userID string) ([]LegacyBeneficiary, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id::text, user_id::text, name, relationship, email, COALESCE(telegram_chat_id, ''), created_at
		FROM legacy_beneficiaries
		WHERE user_id = $1
		ORDER BY created_at ASC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]LegacyBeneficiary, 0)
	for rows.Next() {
		var b LegacyBeneficiary
		if err := rows.Scan(&b.ID, &b.UserID, &b.Name, &b.Relationship, &b.Email, &b.TelegramChatID, &b.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

func (s *PgLegacyCheckInStore) ReplaceBeneficiaries(ctx context.Context, userID string, list []LegacyBeneficiary) ([]LegacyBeneficiary, error) {
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `DELETE FROM legacy_beneficiaries WHERE user_id = $1`, userID); err != nil {
		return nil, err
	}

	out := make([]LegacyBeneficiary, 0, len(list))
	for _, b := range list {
		var saved LegacyBeneficiary
		err := tx.QueryRow(ctx, `
			INSERT INTO legacy_beneficiaries (user_id, name, relationship, email, telegram_chat_id)
			VALUES ($1, $2, $3, $4, $5)
			RETURNING id::text, user_id::text, name, relationship, email, COALESCE(telegram_chat_id, ''), created_at
		`, userID, b.Name, b.Relationship, b.Email, b.TelegramChatID).Scan(
			&saved.ID, &saved.UserID, &saved.Name, &saved.Relationship, &saved.Email, &saved.TelegramChatID, &saved.CreatedAt,
		)
		if err != nil {
			return nil, err
		}
		out = append(out, saved)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return out, nil
}

func (s *PgLegacyCheckInStore) ListEvents(ctx context.Context, userID string, limit int) ([]LegacyCheckInEvent, error) {
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	rows, err := s.db.Query(ctx, `
		SELECT id::text, user_id::text, event_type, note, created_at
		FROM legacy_checkin_events
		WHERE user_id = $1
		ORDER BY created_at DESC
		LIMIT $2
	`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]LegacyCheckInEvent, 0)
	for rows.Next() {
		var ev LegacyCheckInEvent
		if err := rows.Scan(&ev.ID, &ev.UserID, &ev.EventType, &ev.Note, &ev.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, ev)
	}
	return out, rows.Err()
}

func (s *PgLegacyCheckInStore) AppendEvent(ctx context.Context, userID, eventType, note string) error {
	_, err := s.db.Exec(ctx, `
		INSERT INTO legacy_checkin_events (user_id, event_type, note)
		VALUES ($1, $2, $3)
	`, userID, eventType, note)
	return err
}

func (s *PgLegacyCheckInStore) ListActiveConfigs(ctx context.Context) ([]LegacyCheckInConfig, error) {
	rows, err := s.db.Query(ctx, `
		SELECT `+legacyConfigColumns+`
		FROM legacy_checkin_configs
		WHERE enabled = true AND status IN ('active', 'paused', 'grace_period')
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]LegacyCheckInConfig, 0)
	for rows.Next() {
		var cfg LegacyCheckInConfig
		var pkgRaw []byte
		if err := rows.Scan(
			&cfg.UserID,
			&cfg.Enabled,
			&cfg.IsPaused,
			&cfg.PausedUntil,
			&cfg.IntervalDays,
			&cfg.GracePeriodDays,
			&cfg.ReminderHour,
			&cfg.Timezone,
			&cfg.AutoResetOnActivity,
			&cfg.DeliveryMode,
			&cfg.OwnerNotifyEmail,
			&cfg.OwnerNotifyTelegram,
			&cfg.Status,
			&cfg.LastCheckinAt,
			&cfg.NextDueAt,
			&cfg.GraceStartedAt,
			&cfg.TriggerDeadlineAt,
			&cfg.TriggeredAt,
			&cfg.LastReminderSentDate,
			&cfg.LastGraceAlertSentDate,
			&pkgRaw,
			&cfg.PlaintextSummaryNote,
			&cfg.UpdatedAt,
		); err != nil {
			return nil, err
		}
		if len(pkgRaw) > 0 && string(pkgRaw) != "null" {
			var pkg LegacyEncryptedPackage
			if json.Unmarshal(pkgRaw, &pkg) == nil && pkg.CiphertextB64 != "" {
				cfg.EncryptedPackage = &pkg
			}
		}
		out = append(out, cfg)
	}
	return out, rows.Err()
}

func (s *PgLegacyCheckInStore) GetUserMeta(ctx context.Context, userID string) (*LegacyCheckInUserMeta, error) {
	var meta LegacyCheckInUserMeta
	err := s.db.QueryRow(ctx, `
		SELECT id::text, email, name FROM users WHERE id = $1 AND deleted_at IS NULL
	`, userID).Scan(&meta.UserID, &meta.Email, &meta.Name)
	if err != nil {
		return nil, err
	}
	var chatID string
	_ = s.db.QueryRow(ctx, `
		SELECT external_id FROM channel_links
		WHERE household_owner_id = $1 AND channel_type = 'telegram' AND is_active = true
		ORDER BY updated_at DESC LIMIT 1
	`, userID).Scan(&chatID)
	meta.TelegramChatID = strings.TrimSpace(chatID)
	return &meta, nil
}

func (s *PgLegacyCheckInStore) InsertClaimToken(ctx context.Context, rec *LegacyClaimTokenRecord) error {
	var benPtr *string
	if strings.TrimSpace(rec.BeneficiaryID) != "" {
		benPtr = &rec.BeneficiaryID
	}
	_, err := s.db.Exec(ctx, `
		INSERT INTO legacy_claim_tokens (token_hash, user_id, beneficiary_id, beneficiary_name, beneficiary_email, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, rec.TokenHash, rec.UserID, benPtr, rec.BeneficiaryName, rec.BeneficiaryEmail, rec.ExpiresAt)
	return err
}

func (s *PgLegacyCheckInStore) ClaimByTokenHash(ctx context.Context, tokenHash string, now time.Time) (*LegacyClaimTokenRecord, *LegacyCheckInConfig, *LegacyCheckInUserMeta, error) {
	var rec LegacyClaimTokenRecord
	var benPtr *string
	err := s.db.QueryRow(ctx, `
		SELECT token_hash, user_id::text, beneficiary_id::text, beneficiary_name, beneficiary_email, expires_at, claimed_at, created_at
		FROM legacy_claim_tokens
		WHERE token_hash = $1
	`, tokenHash).Scan(
		&rec.TokenHash, &rec.UserID, &benPtr, &rec.BeneficiaryName, &rec.BeneficiaryEmail, &rec.ExpiresAt, &rec.ClaimedAt, &rec.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, nil, errors.New("tautan klaim wasiat tidak ditemukan")
	}
	if err != nil {
		return nil, nil, nil, err
	}
	if benPtr != nil {
		rec.BeneficiaryID = *benPtr
	}
	if now.After(rec.ExpiresAt) {
		return nil, nil, nil, errors.New("tautan klaim wasiat sudah kedaluwarsa")
	}
	if rec.ClaimedAt == nil {
		_, _ = s.db.Exec(ctx, `UPDATE legacy_claim_tokens SET claimed_at = $2 WHERE token_hash = $1 AND claimed_at IS NULL`, tokenHash, now)
		rec.ClaimedAt = &now
	}
	cfg, err := s.GetConfig(ctx, rec.UserID)
	if err != nil {
		return nil, nil, nil, err
	}
	if cfg.Status != "triggered" {
		return nil, nil, nil, errors.New("paket wasiat belum berstatus rilis")
	}
	meta, _ := s.GetUserMeta(ctx, rec.UserID)
	return &rec, cfg, meta, nil
}

func (s *PgLegacyCheckInStore) RecordInAppAlert(ctx context.Context, userID, alertType, title, message, severity, actionURL string) error {
	_, err := s.db.Exec(ctx, `
		INSERT INTO alerts (user_id, type, severity, title, message, action_url, action_label)
		VALUES ($1, $2, $3, $4, $5, $6, 'Check-In')
	`, userID, alertType, severity, title, message, actionURL)
	return err
}

func (s *PgLegacyCheckInStore) BuildReadableInventorySummary(ctx context.Context, userID string) (string, error) {
	var b strings.Builder
	b.WriteString("RINGKASAN INVENTARIS KELUARGA (NON-KREDENSIAL)\n")
	b.WriteString("Catatan keamanan: Tidak menyertakan PIN ATM, password, atau OTP.\n\n")

	if accRows, err := s.db.Query(ctx, `
		SELECT name, type, COALESCE(bank_provider, ''), COALESCE(account_number_masked, ''), balance, currency
		FROM accounts WHERE user_id = $1 AND is_active = true AND deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC
	`, userID); err == nil {
		b.WriteString("[REKENING & DOMPET]\n")
		count := 0
		for accRows.Next() {
			var name, tp, prov, masked, curr string
			var bal float64
			if accRows.Scan(&name, &tp, &prov, &masked, &bal, &curr) == nil {
				count++
				info := name
				if prov != "" {
					info += " (" + prov + ")"
				}
				if masked != "" {
					info += " No: " + masked
				}
				b.WriteString(fmt.Sprintf("- %s [%s]: %s\n", info, tp, dto.FormatRupiah(bal)))
			}
		}
		if count == 0 {
			b.WriteString("- Belum ada rekening tercatat\n")
		}
		accRows.Close()
		b.WriteString("\n")
	}

	if assetRows, err := s.db.Query(ctx, `
		SELECT name, type, current_value FROM assets WHERE user_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC
	`, userID); err == nil {
		b.WriteString("[ASET]\n")
		count := 0
		for assetRows.Next() {
			var name, tp string
			var val float64
			if assetRows.Scan(&name, &tp, &val) == nil {
				count++
				b.WriteString(fmt.Sprintf("- %s (%s): %s\n", name, tp, dto.FormatRupiah(val)))
			}
		}
		if count == 0 {
			b.WriteString("- Belum ada aset tercatat\n")
		}
		assetRows.Close()
		b.WriteString("\n")
	}

	if debtRows, err := s.db.Query(ctx, `
		SELECT name, COALESCE(creditor, ''), outstanding_balance FROM debts WHERE user_id = $1 AND status = 'active' AND deleted_at IS NULL ORDER BY created_at ASC
	`, userID); err == nil {
		b.WriteString("[KEWAJIBAN / CICILAN AKTIF]\n")
		count := 0
		for debtRows.Next() {
			var name, creditor string
			var bal float64
			if debtRows.Scan(&name, &creditor, &bal) == nil {
				count++
				b.WriteString(fmt.Sprintf("- %s (%s): sisa %s\n", name, creditor, dto.FormatRupiah(bal)))
			}
		}
		if count == 0 {
			b.WriteString("- Tidak ada cicilan aktif\n")
		}
		debtRows.Close()
	}

	return b.String(), nil
}

// MemoryLegacyCheckInStore implements LegacyCheckInStore in memory for deterministic unit tests.
type MemoryLegacyCheckInStore struct {
	mu            sync.RWMutex
	configs       map[string]*LegacyCheckInConfig
	beneficiaries map[string][]LegacyBeneficiary
	events        map[string][]LegacyCheckInEvent
	users         map[string]*LegacyCheckInUserMeta
	claimTokens   map[string]*LegacyClaimTokenRecord
	alerts        []string
	inventories   map[string]string
}

func NewMemoryLegacyCheckInStore() *MemoryLegacyCheckInStore {
	return &MemoryLegacyCheckInStore{
		configs:       make(map[string]*LegacyCheckInConfig),
		beneficiaries: make(map[string][]LegacyBeneficiary),
		events:        make(map[string][]LegacyCheckInEvent),
		users:         make(map[string]*LegacyCheckInUserMeta),
		claimTokens:   make(map[string]*LegacyClaimTokenRecord),
		inventories:   make(map[string]string),
	}
}

func (m *MemoryLegacyCheckInStore) SeedUser(userID, email, name, tgChatID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.users[userID] = &LegacyCheckInUserMeta{
		UserID: userID, Email: email, Name: name, TelegramChatID: tgChatID,
	}
}

func (m *MemoryLegacyCheckInStore) SeedInventory(userID, summary string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.inventories[userID] = summary
}

func (m *MemoryLegacyCheckInStore) GetConfig(_ context.Context, userID string) (*LegacyCheckInConfig, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if cfg, ok := m.configs[userID]; ok {
		cp := *cfg
		return &cp, nil
	}
	return defaultLegacyConfig(userID), nil
}

func (m *MemoryLegacyCheckInStore) UpsertConfig(_ context.Context, cfg *LegacyCheckInConfig) (*LegacyCheckInConfig, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	cp := *cfg
	cp.UpdatedAt = time.Now().UTC()
	m.configs[cfg.UserID] = &cp
	out := cp
	return &out, nil
}

func (m *MemoryLegacyCheckInStore) ListBeneficiaries(_ context.Context, userID string) ([]LegacyBeneficiary, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	list := m.beneficiaries[userID]
	out := make([]LegacyBeneficiary, len(list))
	copy(out, list)
	return out, nil
}

func (m *MemoryLegacyCheckInStore) ReplaceBeneficiaries(_ context.Context, userID string, list []LegacyBeneficiary) ([]LegacyBeneficiary, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]LegacyBeneficiary, 0, len(list))
	now := time.Now().UTC()
	for _, b := range list {
		item := b
		item.ID = uuid.NewString()
		item.UserID = userID
		item.CreatedAt = now
		out = append(out, item)
	}
	m.beneficiaries[userID] = out
	cp := make([]LegacyBeneficiary, len(out))
	copy(cp, out)
	return cp, nil
}

func (m *MemoryLegacyCheckInStore) ListEvents(_ context.Context, userID string, limit int) ([]LegacyCheckInEvent, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	src := m.events[userID]
	if limit <= 0 || limit > len(src) {
		limit = len(src)
	}
	out := make([]LegacyCheckInEvent, limit)
	copy(out, src[:limit])
	return out, nil
}

func (m *MemoryLegacyCheckInStore) AppendEvent(_ context.Context, userID, eventType, note string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	ev := LegacyCheckInEvent{
		ID: uuid.NewString(), UserID: userID, EventType: eventType, Note: note, CreatedAt: time.Now().UTC(),
	}
	m.events[userID] = append([]LegacyCheckInEvent{ev}, m.events[userID]...)
	return nil
}

func (m *MemoryLegacyCheckInStore) ListActiveConfigs(_ context.Context) ([]LegacyCheckInConfig, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]LegacyCheckInConfig, 0)
	for _, cfg := range m.configs {
		if cfg.Enabled && (cfg.Status == "active" || cfg.Status == "paused" || cfg.Status == "grace_period") {
			out = append(out, *cfg)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].UserID < out[j].UserID })
	return out, nil
}

func (m *MemoryLegacyCheckInStore) GetUserMeta(_ context.Context, userID string) (*LegacyCheckInUserMeta, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if u, ok := m.users[userID]; ok {
		cp := *u
		return &cp, nil
	}
	return &LegacyCheckInUserMeta{UserID: userID, Email: "owner@keluarga.id", Name: "Owner"}, nil
}

func (m *MemoryLegacyCheckInStore) InsertClaimToken(_ context.Context, rec *LegacyClaimTokenRecord) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	cp := *rec
	cp.CreatedAt = time.Now().UTC()
	m.claimTokens[rec.TokenHash] = &cp
	return nil
}

func (m *MemoryLegacyCheckInStore) ClaimByTokenHash(_ context.Context, tokenHash string, now time.Time) (*LegacyClaimTokenRecord, *LegacyCheckInConfig, *LegacyCheckInUserMeta, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	rec, ok := m.claimTokens[tokenHash]
	if !ok {
		return nil, nil, nil, errors.New("tautan klaim wasiat tidak ditemukan")
	}
	if now.After(rec.ExpiresAt) {
		return nil, nil, nil, errors.New("tautan klaim wasiat sudah kedaluwarsa")
	}
	if rec.ClaimedAt == nil {
		rec.ClaimedAt = &now
	}
	cfg, ok := m.configs[rec.UserID]
	if !ok || cfg.Status != "triggered" {
		return nil, nil, nil, errors.New("paket wasiat belum berstatus rilis")
	}
	recCp := *rec
	cfgCp := *cfg
	var meta LegacyCheckInUserMeta
	if u, exists := m.users[rec.UserID]; exists {
		meta = *u
	}
	return &recCp, &cfgCp, &meta, nil
}

func (m *MemoryLegacyCheckInStore) RecordInAppAlert(_ context.Context, userID, alertType, title, _, _, _ string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.alerts = append(m.alerts, userID+":"+alertType+":"+title)
	return nil
}

func (m *MemoryLegacyCheckInStore) BuildReadableInventorySummary(_ context.Context, userID string) (string, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if s, ok := m.inventories[userID]; ok && s != "" {
		return s, nil
	}
	return "RINGKASAN INVENTARIS KELUARGA (NON-KREDENSIAL)\n- BCA Utama: Rp 5.000.000\n", nil
}

type LegacyCheckInHandler struct {
	store          LegacyCheckInStore
	email          service.EmailService
	telegram       service.TelegramService
	rdb            *redis.Client
	nowFn          func() time.Time
	mu             sync.Mutex
	activityTouch  map[string]time.Time
}

func NewLegacyCheckInHandler(
	store LegacyCheckInStore,
	email service.EmailService,
	telegram service.TelegramService,
	rdb *redis.Client,
) *LegacyCheckInHandler {
	return &LegacyCheckInHandler{
		store:         store,
		email:         email,
		telegram:      telegram,
		rdb:           rdb,
		nowFn:         time.Now,
		activityTouch: make(map[string]time.Time),
	}
}

func (h *LegacyCheckInHandler) RegisterRoutes(rg *gin.RouterGroup) {
	grp := rg.Group("/legacy-checkin")
	grp.Use(middleware.AuthMiddleware(), middleware.RoleMiddleware("owner"))
	{
		grp.GET("", h.GetStatus)
		grp.PUT("/config", h.UpdateConfig)
		grp.POST("/checkin", h.CheckInNow)
		grp.POST("/pause", h.TogglePause)
		grp.PUT("/beneficiaries", h.SaveBeneficiaries)
		grp.POST("/test-alert", h.SendTestAlert)
	}

	claim := rg.Group("/legacy-claim")
	claim.Use(middleware.RateLimitWithRedis(h.rdb, 20))
	{
		claim.GET("/:token", h.ClaimLegacyPackage)
	}
}

// ActivityResetMiddleware resets the owner's Check-In timer (at most once per 10 min) if auto_reset_on_activity is enabled.
func (h *LegacyCheckInHandler) ActivityResetMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Next()
		userID := c.GetString("user_id")
		role := c.GetString("role")
		if userID == "" || role != "owner" || c.Writer.Status() >= 500 {
			return
		}
		if strings.HasPrefix(c.Request.URL.Path, "/api/v1/legacy-checkin") {
			return
		}
		now := h.nowFn()
		h.mu.Lock()
		lastTouch, ok := h.activityTouch[userID]
		if ok && now.Sub(lastTouch) < 10*time.Minute {
			h.mu.Unlock()
			return
		}
		h.activityTouch[userID] = now
		h.mu.Unlock()

		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		go func(uid string, ts time.Time) {
			defer cancel()
			cfg, err := h.store.GetConfig(ctx, uid)
			if err != nil || !cfg.Enabled || !cfg.AutoResetOnActivity || cfg.IsPaused || cfg.Status == "triggered" {
				return
			}
			_, _ = h.applyCheckIn(ctx, cfg, ts, "checkin_auto_activity", "Timer direset otomatis dari aktivitas aplikasi")
		}(userID, now)
	}
}

func loadUserLocation(tz string) *time.Location {
	clean := strings.TrimSpace(tz)
	if clean == "" {
		clean = "Asia/Jakarta"
	}
	loc, err := time.LoadLocation(clean)
	if err != nil {
		loc, _ = time.LoadLocation("Asia/Jakarta")
	}
	if loc == nil {
		return time.FixedZone("WIB", 7*3600)
	}
	return loc
}

func hashClaimToken(rawToken string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(rawToken)))
	return hex.EncodeToString(sum[:])
}

func generateRawClaimToken() (string, string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", "", err
	}
	raw := base64.RawURLEncoding.EncodeToString(buf)
	return raw, hashClaimToken(raw), nil
}

func (h *LegacyCheckInHandler) applyCheckIn(
	ctx context.Context,
	cfg *LegacyCheckInConfig,
	now time.Time,
	eventType, note string,
) (*LegacyCheckInConfig, error) {
	if !cfg.Enabled {
		return cfg, errors.New("fitur Check-In Darurat belum diaktifkan")
	}
	nextDue := now.Add(time.Duration(cfg.IntervalDays) * 24 * time.Hour)
	wasGrace := cfg.Status == "grace_period"

	cfg.IsPaused = false
	cfg.PausedUntil = nil
	cfg.Status = "active"
	cfg.LastCheckinAt = &now
	cfg.NextDueAt = &nextDue
	cfg.GraceStartedAt = nil
	cfg.TriggerDeadlineAt = nil
	cfg.TriggeredAt = nil
	cfg.LastReminderSentDate = nil
	cfg.LastGraceAlertSentDate = nil

	saved, err := h.store.UpsertConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	if wasGrace {
		_ = h.store.AppendEvent(ctx, cfg.UserID, "grace_cancelled", "Masa tenggang dibatalkan via Check-In ("+note+")")
	} else {
		_ = h.store.AppendEvent(ctx, cfg.UserID, eventType, note)
	}
	return saved, nil
}

func (h *LegacyCheckInHandler) RecordTelegramCheckIn(ctx context.Context, ownerID string) (string, error) {
	cfg, err := h.store.GetConfig(ctx, ownerID)
	if err != nil {
		return "", err
	}
	saved, err := h.applyCheckIn(ctx, cfg, h.nowFn(), "checkin_telegram", "Check-In via perintah Bot Telegram /checkin")
	if err != nil {
		return "", err
	}
	loc := loadUserLocation(saved.Timezone)
	if saved.NextDueAt != nil {
		return saved.NextDueAt.In(loc).Format("02 Jan 2006 15:04 MST"), nil
	}
	return "", nil
}

func (h *LegacyCheckInHandler) buildStatusPayload(ctx context.Context, userID string) (gin.H, error) {
	cfg, err := h.store.GetConfig(ctx, userID)
	if err != nil {
		return nil, err
	}
	beneficiaries, err := h.store.ListBeneficiaries(ctx, userID)
	if err != nil {
		return nil, err
	}
	events, err := h.store.ListEvents(ctx, userID, 20)
	if err != nil {
		return nil, err
	}
	meta, _ := h.store.GetUserMeta(ctx, userID)

	emailReady := h.email != nil && h.email.IsConfigured()
	emailProvider := "unconfigured"
	if h.email != nil {
		emailProvider = h.email.ProviderName()
	}
	tgReady := meta != nil && meta.TelegramChatID != "" && os.Getenv("TELEGRAM_BOT_TOKEN") != ""

	return gin.H{
		"config":              cfg,
		"beneficiaries":       beneficiaries,
		"events":              events,
		"email_ready":         emailReady,
		"email_provider":      emailProvider,
		"telegram_linked":     meta != nil && meta.TelegramChatID != "",
		"telegram_ready":      tgReady,
		"server_now":          h.nowFn().UTC(),
		"checked_in_today":    cfg.LastCheckinAt != nil && cfg.LastCheckinAt.In(loadUserLocation(cfg.Timezone)).Format("2006-01-02") == h.nowFn().In(loadUserLocation(cfg.Timezone)).Format("2006-01-02"),
	}, nil
}

func (h *LegacyCheckInHandler) GetStatus(c *gin.Context) {
	userID := c.GetString("user_id")
	payload, err := h.buildStatusPayload(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()}})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": payload})
}

func (h *LegacyCheckInHandler) UpdateConfig(c *gin.Context) {
	userID := c.GetString("user_id")
	var req struct {
		Enabled              bool                    `json:"enabled"`
		IntervalDays         int                     `json:"interval_days" binding:"required,min=1,max=90"`
		GracePeriodDays      int                     `json:"grace_period_days" binding:"required,min=1,max=14"`
		ReminderHour         int                     `json:"reminder_hour" binding:"min=0,max=23"`
		Timezone             string                  `json:"timezone"`
		AutoResetOnActivity  bool                    `json:"auto_reset_on_activity"`
		DeliveryMode         string                  `json:"delivery_mode" binding:"omitempty,oneof=e2ee_portal email_summary"`
		OwnerNotifyEmail     bool                    `json:"owner_notify_email"`
		OwnerNotifyTelegram  bool                    `json:"owner_notify_telegram"`
		EncryptedPackage     *LegacyEncryptedPackage `json:"encrypted_package_json"`
		PlaintextSummaryNote string                  `json:"plaintext_summary_note"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": gin.H{"code": "BAD_REQUEST", "message": err.Error()}})
		return
	}

	ctx := c.Request.Context()
	existing, err := h.store.GetConfig(ctx, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()}})
		return
	}

	if req.EncryptedPackage != nil && len(req.EncryptedPackage.CiphertextB64) > 2*1024*1024 {
		c.JSON(http.StatusBadRequest, gin.H{"error": gin.H{"code": "PAYLOAD_TOO_LARGE", "message": "Ukuran paket wasiat terenkripsi maksimal 2MB"}})
		return
	}

	now := h.nowFn()
	existing.IntervalDays = req.IntervalDays
	existing.GracePeriodDays = req.GracePeriodDays
	existing.ReminderHour = req.ReminderHour
	if strings.TrimSpace(req.Timezone) != "" {
		existing.Timezone = strings.TrimSpace(req.Timezone)
	}
	existing.AutoResetOnActivity = req.AutoResetOnActivity
	if req.DeliveryMode != "" {
		existing.DeliveryMode = req.DeliveryMode
	}
	existing.OwnerNotifyEmail = req.OwnerNotifyEmail
	existing.OwnerNotifyTelegram = req.OwnerNotifyTelegram
	if req.EncryptedPackage != nil && req.EncryptedPackage.CiphertextB64 != "" {
		existing.EncryptedPackage = req.EncryptedPackage
	}
	existing.PlaintextSummaryNote = strings.TrimSpace(req.PlaintextSummaryNote)

	if req.Enabled {
		beneficiaries, _ := h.store.ListBeneficiaries(ctx, userID)
		if len(beneficiaries) == 0 {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": gin.H{"code": "BENEFICIARY_REQUIRED", "message": "Tambahkan minimal 1 ahli waris / kontak darurat sebelum mengaktifkan fitur Wasiat & Check-In"},
			})
			return
		}
		if existing.DeliveryMode == "e2ee_portal" && (existing.EncryptedPackage == nil || existing.EncryptedPackage.CiphertextB64 == "") {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": gin.H{"code": "ENCRYPTED_PACKAGE_REQUIRED", "message": "Simpan paket wasiat terenkripsi dengan Kunci Wasiat terlebih dahulu"},
			})
			return
		}
		existing.Enabled = true
		existing.IsPaused = false
		existing.PausedUntil = nil
		existing.Status = "active"
		existing.LastCheckinAt = &now
		nextDue := now.Add(time.Duration(req.IntervalDays) * 24 * time.Hour)
		existing.NextDueAt = &nextDue
		existing.GraceStartedAt = nil
		existing.TriggerDeadlineAt = nil
		existing.TriggeredAt = nil
		existing.LastReminderSentDate = nil
		existing.LastGraceAlertSentDate = nil
	} else {
		existing.Enabled = false
		existing.IsPaused = false
		existing.PausedUntil = nil
		existing.Status = "inactive"
		existing.GraceStartedAt = nil
		existing.TriggerDeadlineAt = nil
	}

	if _, err := h.store.UpsertConfig(ctx, existing); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()}})
		return
	}
	eventType := "config_updated"
	note := fmt.Sprintf("Interval %d hari, masa tenggang %d hari", req.IntervalDays, req.GracePeriodDays)
	if !req.Enabled {
		eventType = "disabled"
		note = "Check-In Darurat dinonaktifkan"
	}
	_ = h.store.AppendEvent(ctx, userID, eventType, note)

	payload, _ := h.buildStatusPayload(ctx, userID)
	c.JSON(http.StatusOK, gin.H{"data": payload})
}

func (h *LegacyCheckInHandler) CheckInNow(c *gin.Context) {
	userID := c.GetString("user_id")
	ctx := c.Request.Context()
	cfg, err := h.store.GetConfig(ctx, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()}})
		return
	}
	if _, err := h.applyCheckIn(ctx, cfg, h.nowFn(), "checkin_manual", "Check-In manual dari aplikasi"); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": gin.H{"code": "CHECKIN_FAILED", "message": err.Error()}})
		return
	}
	payload, _ := h.buildStatusPayload(ctx, userID)
	c.JSON(http.StatusOK, gin.H{"message": "Check-In berhasil dicatat", "data": payload})
}

func (h *LegacyCheckInHandler) TogglePause(c *gin.Context) {
	userID := c.GetString("user_id")
	var req struct {
		Paused    bool   `json:"paused"`
		PauseDays int    `json:"pause_days"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": gin.H{"code": "BAD_REQUEST", "message": err.Error()}})
		return
	}

	ctx := c.Request.Context()
	cfg, err := h.store.GetConfig(ctx, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()}})
		return
	}
	if !cfg.Enabled {
		c.JSON(http.StatusBadRequest, gin.H{"error": gin.H{"code": "NOT_ENABLED", "message": "Aktifkan Check-In Darurat terlebih dahulu"}})
		return
	}

	now := h.nowFn()
	if req.Paused {
		cfg.IsPaused = true
		cfg.Status = "paused"
		cfg.GraceStartedAt = nil
		cfg.TriggerDeadlineAt = nil
		if req.PauseDays > 0 {
			until := now.Add(time.Duration(req.PauseDays) * 24 * time.Hour)
			cfg.PausedUntil = &until
		} else {
			cfg.PausedUntil = nil
		}
		if _, err := h.store.UpsertConfig(ctx, cfg); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()}})
			return
		}
		_ = h.store.AppendEvent(ctx, userID, "paused", "Mode jeda diaktifkan (timer dibekukan sementara)")
	} else {
		if _, err := h.applyCheckIn(ctx, cfg, now, "resumed", "Timer dilanjutkan & direset setelah mode jeda"); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()}})
			return
		}
	}

	payload, _ := h.buildStatusPayload(ctx, userID)
	c.JSON(http.StatusOK, gin.H{"data": payload})
}

func (h *LegacyCheckInHandler) SaveBeneficiaries(c *gin.Context) {
	userID := c.GetString("user_id")
	var req struct {
		Beneficiaries []struct {
			Name           string `json:"name" binding:"required"`
			Relationship   string `json:"relationship"`
			Email          string `json:"email" binding:"required"`
			TelegramChatID string `json:"telegram_chat_id"`
		} `json:"beneficiaries" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": gin.H{"code": "BAD_REQUEST", "message": err.Error()}})
		return
	}
	if len(req.Beneficiaries) > 5 {
		c.JSON(http.StatusBadRequest, gin.H{"error": gin.H{"code": "TOO_MANY_BENEFICIARIES", "message": "Maksimal 5 kontak ahli waris"}})
		return
	}

	cleaned := make([]LegacyBeneficiary, 0, len(req.Beneficiaries))
	for _, item := range req.Beneficiaries {
		addr, err := mail.ParseAddress(strings.TrimSpace(item.Email))
		if err != nil || addr.Address == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": gin.H{"code": "INVALID_EMAIL", "message": "Email ahli waris tidak valid: " + item.Email}})
			return
		}
		rel := strings.TrimSpace(item.Relationship)
		if rel == "" {
			rel = "Pasangan / Keluarga"
		}
		cleaned = append(cleaned, LegacyBeneficiary{
			Name:           strings.TrimSpace(item.Name),
			Relationship:   rel,
			Email:          strings.ToLower(addr.Address),
			TelegramChatID: strings.TrimSpace(item.TelegramChatID),
		})
	}

	saved, err := h.store.ReplaceBeneficiaries(c.Request.Context(), userID, cleaned)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()}})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": saved})
}

func (h *LegacyCheckInHandler) dispatchOwnerChannels(
	ctx context.Context,
	cfg *LegacyCheckInConfig,
	meta *LegacyCheckInUserMeta,
	subject, textMsg, tgMsg string,
) (bool, bool, []string) {
	var emailSent, tgSent bool
	var errs []string

	if cfg.OwnerNotifyEmail && meta != nil && meta.Email != "" && h.email != nil && h.email.IsConfigured() {
		htmlBody := "<div style=\"font-family:sans-serif;line-height:1.5\"><h3>" + html.EscapeString(subject) +
			"</h3><p>" + strings.ReplaceAll(html.EscapeString(textMsg), "\n", "<br/>") + "</p></div>"
		if err := h.email.SendEmail(ctx, service.EmailMessage{
			To:       meta.Email,
			Subject:  subject,
			TextBody: textMsg,
			HTMLBody: htmlBody,
		}); err != nil {
			errs = append(errs, "Email: "+err.Error())
		} else {
			emailSent = true
		}
	}

	if cfg.OwnerNotifyTelegram && h.telegram != nil {
		if meta != nil && meta.TelegramChatID != "" {
			if err := h.telegram.SendReplyToChat(meta.TelegramChatID, tgMsg); err != nil {
				errs = append(errs, "Telegram: "+err.Error())
			} else {
				tgSent = true
			}
		} else if os.Getenv("TELEGRAM_CHAT_ID") != "" {
			if err := h.telegram.SendMessage(subject, textMsg, "Ketik /checkin atau buka Keuangan Bersama"); err != nil {
				errs = append(errs, "Telegram: "+err.Error())
			} else {
				tgSent = true
			}
		}
	}
	return emailSent, tgSent, errs
}

func (h *LegacyCheckInHandler) SendTestAlert(c *gin.Context) {
	userID := c.GetString("user_id")
	ctx := c.Request.Context()
	cfg, err := h.store.GetConfig(ctx, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()}})
		return
	}
	meta, _ := h.store.GetUserMeta(ctx, userID)
	appURL := strings.TrimRight(os.Getenv("PUBLIC_APP_URL"), "/")
	if appURL == "" {
		appURL = "http://localhost:5173"
	}

	subject := "[Uji Coba] Pengingat Check-In Darurat — Keuangan Bersama"
	textMsg := fmt.Sprintf(
		"Halo %s,\n\nIni adalah simulasi pengingat Check-In Darurat. Data wasiat asli Anda TIDAK dilepas pada uji coba ini.\nBuka %s/legacy-checkin atau kirim /checkin ke Bot Telegram Anda.",
		meta.Name, appURL,
	)
	tgMsg := "🔔 *[Uji Coba] Check-In Darurat*\nNotifikasi pengingat Telegram berfungsi normal. Anda dapat mengetik `/checkin` untuk mereset timer kapan saja."

	emailSent, tgSent, sendErrs := h.dispatchOwnerChannels(ctx, cfg, meta, subject, textMsg, tgMsg)
	_ = h.store.AppendEvent(ctx, userID, "test_alert_sent", fmt.Sprintf("Uji notif (email=%v, telegram=%v)", emailSent, tgSent))

	c.JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"email_sent":    emailSent,
			"telegram_sent": tgSent,
			"warnings":      sendErrs,
			"message":       "Uji pengingat selesai dikirim sesuai kanal aktif",
		},
	})
}

func (h *LegacyCheckInHandler) EvaluateDueSchedules(ctx context.Context) error {
	configs, err := h.store.ListActiveConfigs(ctx)
	if err != nil {
		return err
	}
	now := h.nowFn()
	appURL := strings.TrimRight(os.Getenv("PUBLIC_APP_URL"), "/")
	if appURL == "" {
		appURL = "http://localhost:5173"
	}

	for i := range configs {
		cfg := configs[i]
		loc := loadUserLocation(cfg.Timezone)
		nowLocal := now.In(loc)
		todayStr := nowLocal.Format("2006-01-02")

		// 1. Auto-resume paused configs whose pause deadline elapsed
		if cfg.IsPaused && cfg.Status == "paused" {
			if cfg.PausedUntil != nil && !now.Before(*cfg.PausedUntil) {
				_, _ = h.applyCheckIn(ctx, &cfg, now, "resumed", "Mode jeda selesai otomatis")
			}
			continue
		}

		meta, _ := h.store.GetUserMeta(ctx, cfg.UserID)

		// 2. Active state -> check missed due date or today's reminder hour
		if cfg.Status == "active" && cfg.NextDueAt != nil {
			if !now.Before(*cfg.NextDueAt) {
				graceDeadline := now.Add(time.Duration(cfg.GracePeriodDays) * 24 * time.Hour)
				cfg.Status = "grace_period"
				cfg.GraceStartedAt = &now
				cfg.TriggerDeadlineAt = &graceDeadline
				cfg.LastGraceAlertSentDate = &todayStr
				_, _ = h.store.UpsertConfig(ctx, &cfg)
				_ = h.store.AppendEvent(ctx, cfg.UserID, "grace_started", fmt.Sprintf("Jatuh tempo terlewati; masuk masa tenggang %d hari", cfg.GracePeriodDays))

				subj := "⚠️ PERINGATAN DARURAT: Check-In Terlewati — Masa Tenggang Aktif"
				msg := fmt.Sprintf(
					"Halo %s,\n\nJadwal Check-In Anda sudah terlewat. Paket Wasiat Digital akan dikirim otomatis ke ahli waris pada %s jika Anda tidak melakukan Check-In.\n\nKlik untuk Check-In: %s/legacy-checkin\nAtau balas /checkin di Bot Telegram.",
					meta.Name, graceDeadline.In(loc).Format("02 Jan 2006 15:04 MST"), appURL,
				)
				tgMsg := fmt.Sprintf("⚠️ *PERINGATAN DARURAT*\nJadwal Check-In terlewati! Wasiat akan dilepas pada *%s*.\nKetik `/checkin` sekarang untuk membatalkan.", graceDeadline.In(loc).Format("02 Jan 2006 15:04 MST"))
				_, _, _ = h.dispatchOwnerChannels(ctx, &cfg, meta, subj, msg, tgMsg)
				_ = h.store.RecordInAppAlert(ctx, cfg.UserID, "legacy_grace_warning", "Check-In Wasiat Terlewati!", msg, "danger", "/legacy-checkin")
				continue
			}

			// Same-day reminder when user has not checked in today & deadline is within 24h
			dueLocalDay := cfg.NextDueAt.In(loc).Format("2006-01-02")
			checkedToday := cfg.LastCheckinAt != nil && cfg.LastCheckinAt.In(loc).Format("2006-01-02") == todayStr
			alreadyReminded := cfg.LastReminderSentDate != nil && *cfg.LastReminderSentDate == todayStr

			if !checkedToday && !alreadyReminded && dueLocalDay == todayStr && nowLocal.Hour() >= cfg.ReminderHour {
				cfg.LastReminderSentDate = &todayStr
				_, _ = h.store.UpsertConfig(ctx, &cfg)
				_ = h.store.AppendEvent(ctx, cfg.UserID, "reminder_sent", "Notifikasi pengingat Check-In hari jatuh tempo dikirim")

				subj := "⏰ Pengingat Check-In Hari Ini — Keuangan Bersama"
				msg := fmt.Sprintf(
					"Halo %s,\n\nAnda belum melakukan Check-In hari ini sebelum batas waktu %s.\nSilakan buka %s/legacy-checkin atau kirim /checkin ke Bot Telegram agar timer kembali direset.",
					meta.Name, cfg.NextDueAt.In(loc).Format("02 Jan 2006 15:04 MST"), appURL,
				)
				tgMsg := fmt.Sprintf("⏰ *Pengingat Check-In Hari Ini*\nBatas Check-In: *%s*.\nKetik `/checkin` atau ketuk aplikasi untuk reset timer.", cfg.NextDueAt.In(loc).Format("02 Jan 2006 15:04 MST"))
				_, _, _ = h.dispatchOwnerChannels(ctx, &cfg, meta, subj, msg, tgMsg)
				_ = h.store.RecordInAppAlert(ctx, cfg.UserID, "legacy_checkin_reminder", "Belum Check-In Hari Ini", "Ketuk untuk Check-In darurat & reset timer Wasiat Digital Anda.", "warning", "/legacy-checkin")
			}
			continue
		}

		// 3. Grace Period state -> trigger or send daily urgent escalation
		if cfg.Status == "grace_period" && cfg.TriggerDeadlineAt != nil {
			if !now.Before(*cfg.TriggerDeadlineAt) {
				if err := h.executeTriggerRelease(ctx, &cfg, meta, appURL, now); err != nil {
					_ = h.store.AppendEvent(ctx, cfg.UserID, "trigger_error", "Sebagian pengiriman gagal: "+err.Error())
				}
				continue
			}

			alreadyGraceAlerted := cfg.LastGraceAlertSentDate != nil && *cfg.LastGraceAlertSentDate == todayStr
			if !alreadyGraceAlerted && nowLocal.Hour() >= cfg.ReminderHour {
				cfg.LastGraceAlertSentDate = &todayStr
				_, _ = h.store.UpsertConfig(ctx, &cfg)
				remHours := int(cfg.TriggerDeadlineAt.Sub(now).Hours())
				if remHours < 1 {
					remHours = 1
				}
				subj := fmt.Sprintf("🚨 URGENT: Sisa %d Jam Sebelum Wasiat Digital Dikirim", remHours)
				msg := fmt.Sprintf(
					"Halo %s,\n\nSisa waktu masa tenggang tinggal ~%d jam (rilis otomatis: %s).\nLakukan Check-In segera di %s/legacy-checkin atau kirim /checkin di Bot Telegram jika Anda baik-baik saja.",
					meta.Name, remHours, cfg.TriggerDeadlineAt.In(loc).Format("02 Jan 2006 15:04 MST"), appURL,
				)
				tgMsg := fmt.Sprintf("🚨 *URGENT MASA TENGGANG*: Sisa ~%d jam sebelum wasiat dikirim! Ketik `/checkin` untuk membatalkan.", remHours)
				_, _, _ = h.dispatchOwnerChannels(ctx, &cfg, meta, subj, msg, tgMsg)
			}
		}
	}
	return nil
}

func (h *LegacyCheckInHandler) executeTriggerRelease(
	ctx context.Context,
	cfg *LegacyCheckInConfig,
	meta *LegacyCheckInUserMeta,
	appURL string,
	now time.Time,
) error {
	cfg.Status = "triggered"
	cfg.TriggeredAt = &now
	if _, err := h.store.UpsertConfig(ctx, cfg); err != nil {
		return err
	}

	beneficiaries, err := h.store.ListBeneficiaries(ctx, cfg.UserID)
	if err != nil {
		return err
	}

	readableSummary := ""
	if cfg.DeliveryMode == "email_summary" {
		readableSummary, _ = h.store.BuildReadableInventorySummary(ctx, cfg.UserID)
		if cfg.PlaintextSummaryNote != "" {
			readableSummary += "\n[PESAN WASIAT PEMILIK]\n" + cfg.PlaintextSummaryNote + "\n"
		}
	}

	ownerName := "Pemilik Akun"
	if meta != nil && strings.TrimSpace(meta.Name) != "" {
		ownerName = meta.Name
	}

	var firstErr error
	sentCount := 0
	for _, b := range beneficiaries {
		rawToken, tokenHash, tokErr := generateRawClaimToken()
		if tokErr != nil {
			continue
		}
		if insErr := h.store.InsertClaimToken(ctx, &LegacyClaimTokenRecord{
			TokenHash:        tokenHash,
			UserID:           cfg.UserID,
			BeneficiaryID:    b.ID,
			BeneficiaryName:  b.Name,
			BeneficiaryEmail: b.Email,
			ExpiresAt:        now.Add(30 * 24 * time.Hour),
		}); insErr != nil {
			if firstErr == nil {
				firstErr = insErr
			}
			continue
		}

		claimLink := fmt.Sprintf("%s/legacy-claim/%s", appURL, rawToken)
		subj := fmt.Sprintf("[Keuangan Bersama] Amanat & Wasiat Digital dari %s", ownerName)
		var textBuf strings.Builder
		textBuf.WriteString(fmt.Sprintf("Halo %s (%s),\n\n", b.Name, b.Relationship))
		textBuf.WriteString(fmt.Sprintf("Pesan otomatis ini dikirim karena %s melewati jadwal Check-In Darurat beserta masa tenggangnya di aplikasi Keuangan Bersama.\n\n", ownerName))
		textBuf.WriteString("Silakan buka Portal Klaim Wasiat berikut (berlaku 30 hari) memakai Kunci Wasiat yang telah dititipkan kepada Anda:\n")
		textBuf.WriteString(claimLink + "\n\n")
		if readableSummary != "" {
			textBuf.WriteString("----------------------------------------\n")
			textBuf.WriteString(readableSummary)
			textBuf.WriteString("----------------------------------------\n")
		}

		if h.email != nil && h.email.IsConfigured() {
			htmlBody := "<div style=\"font-family:sans-serif;line-height:1.6\">" +
				"<h2>Amanat &amp; Wasiat Digital — Keuangan Bersama</h2>" +
				"<p>Halo <b>" + html.EscapeString(b.Name) + "</b> (" + html.EscapeString(b.Relationship) + "),</p>" +
				"<p>Sistem mengirim pesan ini karena <b>" + html.EscapeString(ownerName) + "</b> melewati jadwal Check-In Darurat dan masa tenggangnya.</p>" +
				"<p><a href=\"" + html.EscapeString(claimLink) + "\" style=\"display:inline-block;padding:10px 16px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:8px\">Buka Portal Klaim Wasiat</a></p>" +
				"<p><small>Tautan: " + html.EscapeString(claimLink) + "</small></p>"
			if readableSummary != "" {
				htmlBody += "<pre style=\"background:#f8fafc;padding:12px;border-radius:8px;white-space:pre-wrap\">" + html.EscapeString(readableSummary) + "</pre>"
			}
			htmlBody += "</div>"

			if err := h.email.SendEmail(ctx, service.EmailMessage{
				To: b.Email, Subject: subj, TextBody: textBuf.String(), HTMLBody: htmlBody,
			}); err != nil && firstErr == nil {
				firstErr = err
			}
		}

		if b.TelegramChatID != "" && h.telegram != nil {
			tgText := fmt.Sprintf("📜 *Amanat Wasiat Digital dari %s*\n%s telah melewati batas Check-In Darurat.\nBuka Portal Klaim (masukkan Kunci Wasiat Anda):\n%s", ownerName, ownerName, claimLink)
			_ = h.telegram.SendReplyToChat(b.TelegramChatID, tgText)
		}
		sentCount++
	}

	_ = h.store.AppendEvent(ctx, cfg.UserID, "triggered_released", fmt.Sprintf("Wasiat dirilis ke %d ahli waris", sentCount))
	return firstErr
}

func (h *LegacyCheckInHandler) ClaimLegacyPackage(c *gin.Context) {
	rawToken := strings.TrimSpace(c.Param("token"))
	if rawToken == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": gin.H{"code": "BAD_REQUEST", "message": "Token klaim diperlukan"}})
		return
	}

	rec, cfg, meta, err := h.store.ClaimByTokenHash(c.Request.Context(), hashClaimToken(rawToken), h.nowFn())
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": gin.H{"code": "CLAIM_UNAVAILABLE", "message": err.Error()}})
		return
	}

	ownerName := "Pemilik Akun"
	if meta != nil && strings.TrimSpace(meta.Name) != "" {
		ownerName = meta.Name
	}

	readableSummary := ""
	if cfg.DeliveryMode == "email_summary" {
		readableSummary, _ = h.store.BuildReadableInventorySummary(c.Request.Context(), cfg.UserID)
		if cfg.PlaintextSummaryNote != "" {
			readableSummary += "\n[PESAN WASIAT]\n" + cfg.PlaintextSummaryNote + "\n"
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"owner_name":             ownerName,
			"beneficiary_name":       rec.BeneficiaryName,
			"beneficiary_email":      rec.BeneficiaryEmail,
			"triggered_at":           cfg.TriggeredAt,
			"expires_at":             rec.ExpiresAt,
			"delivery_mode":          cfg.DeliveryMode,
			"encrypted_package_json": cfg.EncryptedPackage,
			"readable_summary":       readableSummary,
		},
	})
}
