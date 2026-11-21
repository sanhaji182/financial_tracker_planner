package service

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/kernel"
)

type PrivacyService interface {
	GetPolicy(ctx context.Context, userID string) (*dto.PrivacyPolicyResponse, error)
	SetAIConsent(ctx context.Context, userID string, granted bool) error
	Redact(ctx context.Context, userID string, text string) (*dto.RedactResponse, error)
	ExportHousehold(ctx context.Context, userID string) ([]byte, error)
	DeleteHousehold(ctx context.Context, userID string, phrase string) (map[string]any, error)
}

type privacyService struct {
	dbPool   *pgxpool.Pool
	filePath string
	mu       sync.RWMutex
}

func NewPrivacyService(dbPool *pgxpool.Pool, dataDir string) PrivacyService {
	return &privacyService{
		dbPool:   dbPool,
		filePath: filepath.Join(dataDir, "privacy_state.json"),
	}
}

type privacyState struct {
	AIConsent map[string]bool `json:"ai_consent"` // ownerID -> granted
	Deleted   map[string]string `json:"deleted"`  // ownerID -> RFC3339
}

func (s *privacyService) resolveOwnerID(ctx context.Context, userID string) (string, error) {
	var role string
	var invitedBy *string
	err := s.dbPool.QueryRow(ctx, `
		SELECT role, invited_by FROM users WHERE id = $1 AND is_active = true
	`, userID).Scan(&role, &invitedBy)
	if err != nil {
		return "", err
	}
	if role == "spouse_viewer" && invitedBy != nil && *invitedBy != "" {
		return *invitedBy, nil
	}
	return userID, nil
}

func (s *privacyService) load() (privacyState, error) {
	st := privacyState{AIConsent: map[string]bool{}, Deleted: map[string]string{}}
	if _, err := os.Stat(s.filePath); os.IsNotExist(err) {
		return st, nil
	}
	data, err := os.ReadFile(s.filePath)
	if err != nil {
		return st, err
	}
	if err := json.Unmarshal(data, &st); err != nil {
		return st, err
	}
	if st.AIConsent == nil {
		st.AIConsent = map[string]bool{}
	}
	if st.Deleted == nil {
		st.Deleted = map[string]string{}
	}
	return st, nil
}

func (s *privacyService) save(st privacyState) error {
	data, err := json.MarshalIndent(st, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.filePath), 0755); err != nil {
		return err
	}
	return os.WriteFile(s.filePath, data, 0600)
}

func (s *privacyService) GetPolicy(ctx context.Context, userID string) (*dto.PrivacyPolicyResponse, error) {
	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		return nil, err
	}
	s.mu.RLock()
	st, err := s.load()
	s.mu.RUnlock()
	if err != nil {
		return nil, err
	}
	res := kernel.ComputePrivacyPolicy(kernel.PrivacyPolicyInputs{
		AsOf:             time.Now(),
		AIConsentGranted: st.AIConsent[ownerID],
	})
	rules := make([]dto.RetentionRuleDTO, 0, len(res.RetentionRules))
	for _, r := range res.RetentionRules {
		rules = append(rules, dto.RetentionRuleDTO{
			DataClass: r.DataClass, RetentionDays: r.RetentionDays,
			Rationale: r.Rationale, UserDeletable: r.UserDeletable,
		})
	}
	return &dto.PrivacyPolicyResponse{
		AsOf: res.AsOf.Format(time.RFC3339), FormulaVersion: res.FormulaVersion,
		RetentionRules: rules, AIConsentGranted: res.AIConsentGranted,
		AIConsentRequired: res.AIConsentRequired, ExportAvailable: res.ExportAvailable,
		DeleteAvailable: res.DeleteAvailable, RedactionEnabled: res.RedactionEnabled,
		Rights: res.Rights, Assumptions: res.Assumptions, Disclaimer: res.Disclaimer,
	}, nil
}

func (s *privacyService) SetAIConsent(ctx context.Context, userID string, granted bool) error {
	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	st, err := s.load()
	if err != nil {
		return err
	}
	st.AIConsent[ownerID] = granted
	return s.save(st)
}

func (s *privacyService) Redact(ctx context.Context, userID string, text string) (*dto.RedactResponse, error) {
	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		return nil, err
	}
	s.mu.RLock()
	st, err := s.load()
	s.mu.RUnlock()
	if err != nil {
		return nil, err
	}
	r := kernel.RedactForAI(text, st.AIConsent[ownerID])
	return &dto.RedactResponse{
		OriginalLen: r.OriginalLen, RedactedText: r.RedactedText,
		RedactedCount: r.RedactedCount, Categories: r.Categories,
		FormulaVersion: r.FormulaVersion, SafeForAI: r.SafeForAI, BlockedReason: r.BlockedReason,
	}, nil
}

func (s *privacyService) ExportHousehold(ctx context.Context, userID string) ([]byte, error) {
	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		return nil, err
	}
	manifest := kernel.BuildHouseholdExportManifest(time.Now())

	// Collect non-secret household slices
	bundle := map[string]any{
		"manifest": manifest,
		"owner_id": ownerID,
	}

	// accounts
	accRows, err := s.dbPool.Query(ctx, `
		SELECT id::text, name, type, currency, balance, is_emergency_fund, is_active
		FROM accounts WHERE user_id=$1 AND deleted_at IS NULL
	`, ownerID)
	if err == nil {
		defer accRows.Close()
		var accounts []map[string]any
		for accRows.Next() {
			var id, name, typ, cur string
			var bal float64
			var ef, active bool
			if accRows.Scan(&id, &name, &typ, &cur, &bal, &ef, &active) == nil {
				accounts = append(accounts, map[string]any{
					"id": id, "name": name, "type": typ, "currency": cur,
					"balance": bal, "is_emergency_fund": ef, "is_active": active,
				})
			}
		}
		bundle["accounts"] = accounts
	}

	// transactions (capped)
	txRows, err := s.dbPool.Query(ctx, `
		SELECT id::text, date::text, type, amount, currency, description, status
		FROM transactions WHERE user_id=$1 AND deleted_at IS NULL
		ORDER BY date DESC LIMIT 5000
	`, ownerID)
	if err == nil {
		defer txRows.Close()
		var txs []map[string]any
		for txRows.Next() {
			var id, date, typ, cur, desc, status string
			var amt float64
			if txRows.Scan(&id, &date, &typ, &amt, &cur, &desc, &status) == nil {
				txs = append(txs, map[string]any{
					"id": id, "date": date, "type": typ, "amount": amt,
					"currency": cur, "description": desc, "status": status,
				})
			}
		}
		bundle["transactions"] = txs
	}

	// goals
	gRows, err := s.dbPool.Query(ctx, `
		SELECT id::text, name, type, target_amount, current_amount, status
		FROM goals WHERE user_id=$1 AND deleted_at IS NULL
	`, ownerID)
	if err == nil {
		defer gRows.Close()
		var goals []map[string]any
		for gRows.Next() {
			var id, name, typ, status string
			var target, cur float64
			if gRows.Scan(&id, &name, &typ, &target, &cur, &status) == nil {
				goals = append(goals, map[string]any{
					"id": id, "name": name, "type": typ,
					"target_amount": target, "current_amount": cur, "status": status,
				})
			}
		}
		bundle["goals"] = goals
	}

	return json.MarshalIndent(bundle, "", "  ")
}

func (s *privacyService) DeleteHousehold(ctx context.Context, userID string, phrase string) (map[string]any, error) {
	if err := kernel.ValidateDeleteConfirmation(phrase); err != nil {
		return nil, err
	}
	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		return nil, err
	}
	// Soft-disable owner + spouse accounts under owner
	_, err = s.dbPool.Exec(ctx, `
		UPDATE users SET is_active = false
		WHERE id = $1 OR invited_by = $1
	`, ownerID)
	if err != nil {
		return nil, fmt.Errorf("soft-disable users: %w", err)
	}

	s.mu.Lock()
	st, err := s.load()
	if err == nil {
		st.Deleted[ownerID] = time.Now().UTC().Format(time.RFC3339)
		st.AIConsent[ownerID] = false
		_ = s.save(st)
	}
	s.mu.Unlock()

	plan := kernel.DeleteHouseholdPlan(ownerID, time.Now())
	plan["status"] = "soft_disabled"
	plan["message"] = "Akun dinonaktifkan; purge terjadwal sesuai grace period. Export dulu jika belum."
	return plan, nil
}
