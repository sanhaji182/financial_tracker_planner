package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/model"
)

// AutomationRuleService handles automated trigger-action processes
type AutomationRuleService interface {
	CreateRule(ctx context.Context, userID string, req dto.CreateAutomationRuleRequest) (*dto.AutomationRuleResponse, error)
	GetRules(ctx context.Context, userID string) ([]dto.AutomationRuleResponse, error)
	UpdateRule(ctx context.Context, userID string, id string, req dto.UpdateAutomationRuleRequest) (*dto.AutomationRuleResponse, error)
	DeleteRule(ctx context.Context, userID string, id string) error
	EvaluateRules(ctx context.Context) error
}

type automationRuleService struct {
	dbPool           *pgxpool.Pool
	telegramService  TelegramService
}

// NewAutomationRuleService creates a new AutomationRuleService
func NewAutomationRuleService(dbPool *pgxpool.Pool, telegramService TelegramService) AutomationRuleService {
	return &automationRuleService{
		dbPool:          dbPool,
		telegramService: telegramService,
	}
}

func (s *automationRuleService) resolveOwnerID(ctx context.Context, userID string) (string, error) {
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

func (s *automationRuleService) CreateRule(ctx context.Context, userID string, req dto.CreateAutomationRuleRequest) (*dto.AutomationRuleResponse, error) {
	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	condBytes, err := json.Marshal(req.Condition)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal condition: %w", err)
	}

	actBytes, err := json.Marshal(req.ActionConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal action config: %w", err)
	}

	var m model.AutomationRule
	err = s.dbPool.QueryRow(ctx, `
		INSERT INTO automation_rules (user_id, name, trigger_type, condition, action_type, action_config)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, user_id, name, trigger_type, condition, action_type, action_config, is_active, last_triggered_at, trigger_count, created_at, updated_at
	`, ownerID, req.Name, req.TriggerType, condBytes, req.ActionType, actBytes).Scan(
		&m.ID, &m.UserID, &m.Name, &m.TriggerType, &m.Condition, &m.ActionType, &m.ActionConfig, &m.IsActive, &m.LastTriggeredAt, &m.TriggerCount, &m.CreatedAt, &m.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to insert rule: %w", err)
	}

	return s.toResponse(&m), nil
}

func (s *automationRuleService) GetRules(ctx context.Context, userID string) ([]dto.AutomationRuleResponse, error) {
	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	rows, err := s.dbPool.Query(ctx, `
		SELECT id, user_id, name, trigger_type, condition, action_type, action_config, is_active, last_triggered_at, trigger_count, created_at, updated_at
		FROM automation_rules
		WHERE user_id = $1
		ORDER BY created_at DESC
	`, ownerID)
	if err != nil {
		return nil, fmt.Errorf("failed to list rules: %w", err)
	}
	defer rows.Close()

	var list []dto.AutomationRuleResponse
	for rows.Next() {
		var m model.AutomationRule
		if err := rows.Scan(&m.ID, &m.UserID, &m.Name, &m.TriggerType, &m.Condition, &m.ActionType, &m.ActionConfig, &m.IsActive, &m.LastTriggeredAt, &m.TriggerCount, &m.CreatedAt, &m.UpdatedAt); err != nil {
			continue
		}
		list = append(list, *s.toResponse(&m))
	}

	return list, nil
}

func (s *automationRuleService) UpdateRule(ctx context.Context, userID string, id string, req dto.UpdateAutomationRuleRequest) (*dto.AutomationRuleResponse, error) {
	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	tx, err := s.dbPool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var m model.AutomationRule
	err = tx.QueryRow(ctx, `
		SELECT id, user_id, name, trigger_type, condition, action_type, action_config, is_active, last_triggered_at, trigger_count, created_at, updated_at
		FROM automation_rules
		WHERE id = $1 AND user_id = $2
	`, id, ownerID).Scan(
		&m.ID, &m.UserID, &m.Name, &m.TriggerType, &m.Condition, &m.ActionType, &m.ActionConfig, &m.IsActive, &m.LastTriggeredAt, &m.TriggerCount, &m.CreatedAt, &m.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, errors.New("rule not found")
		}
		return nil, err
	}

	// Apply updates
	if req.Name != nil {
		m.Name = *req.Name
	}
	if req.TriggerType != nil {
		m.TriggerType = *req.TriggerType
	}
	if req.Condition != nil {
		m.Condition, _ = json.Marshal(req.Condition)
	}
	if req.ActionType != nil {
		m.ActionType = *req.ActionType
	}
	if req.ActionConfig != nil {
		m.ActionConfig, _ = json.Marshal(req.ActionConfig)
	}
	if req.IsActive != nil {
		m.IsActive = *req.IsActive
	}

	err = tx.QueryRow(ctx, `
		UPDATE automation_rules
		SET name = $1, trigger_type = $2, condition = $3, action_type = $4, action_config = $5, is_active = $6, updated_at = NOW()
		WHERE id = $7
		RETURNING last_triggered_at, trigger_count, updated_at
	`, m.Name, m.TriggerType, m.Condition, m.ActionType, m.ActionConfig, m.IsActive, id).Scan(
		&m.LastTriggeredAt, &m.TriggerCount, &m.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to update rule: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	return s.toResponse(&m), nil
}

func (s *automationRuleService) DeleteRule(ctx context.Context, userID string, id string) error {
	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	tag, err := s.dbPool.Exec(ctx, `
		DELETE FROM automation_rules WHERE id = $1 AND user_id = $2
	`, id, ownerID)
	if err != nil {
		return fmt.Errorf("failed to delete rule: %w", err)
	}

	if tag.RowsAffected() == 0 {
		return errors.New("rule not found")
	}

	return nil
}

// EvaluateRules scans and triggers active automation rules
func (s *automationRuleService) EvaluateRules(ctx context.Context) error {
	rows, err := s.dbPool.Query(ctx, `
		SELECT id, user_id, name, trigger_type, condition, action_type, action_config, is_active, last_triggered_at, trigger_count
		FROM automation_rules
		WHERE is_active = true
	`)
	if err != nil {
		return fmt.Errorf("failed to load active rules: %w", err)
	}
	defer rows.Close()

	var rules []model.AutomationRule
	for rows.Next() {
		var r model.AutomationRule
		if err := rows.Scan(&r.ID, &r.UserID, &r.Name, &r.TriggerType, &r.Condition, &r.ActionType, &r.ActionConfig, &r.IsActive, &r.LastTriggeredAt, &r.TriggerCount); err == nil {
			rules = append(rules, r)
		}
	}
	rows.Close()

	now := time.Now()

	for _, rule := range rules {
		// Prevent rapid duplicate execution (only trigger once per day max for sanity, unless recurring_transaction specifies period)
		if rule.LastTriggeredAt != nil {
			lastDate := *rule.LastTriggeredAt
			if lastDate.Year() == now.Year() && lastDate.Month() == now.Month() && lastDate.Day() == now.Day() {
				// Already triggered today, skip
				continue
			}
		}

		var cond dto.RuleCondition
		_ = json.Unmarshal(rule.Condition, &cond)

		var act dto.RuleActionConfig
		_ = json.Unmarshal(rule.ActionConfig, &act)

		triggered := false
		var triggerMsg string

		switch rule.TriggerType {
		case "balance_below":
			var balance float64
			err := s.dbPool.QueryRow(ctx, `
				SELECT balance FROM accounts WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
			`, cond.AccountID, rule.UserID).Scan(&balance)
			if err == nil && balance < cond.Threshold {
				triggered = true
				triggerMsg = fmt.Sprintf("Saldo rekening Anda turun di bawah batas aman: Rp %.0f (Batas: Rp %.0f)", balance, cond.Threshold)
			}

		case "bill_due_soon":
			targetDate := now.AddDate(0, 0, cond.DaysBefore).Format("2006-01-02")
			var billCount int
			_ = s.dbPool.QueryRow(ctx, `
				SELECT COUNT(*) FROM bills
				WHERE user_id = $1 AND is_active = true AND next_due_date = $2 AND status = 'unpaid' AND deleted_at IS NULL
			`, rule.UserID, targetDate).Scan(&billCount)
			if billCount > 0 {
				triggered = true
				triggerMsg = fmt.Sprintf("Ada %d tagihan yang akan jatuh tempo dalam %d hari (%s).", billCount, cond.DaysBefore, targetDate)
			}

		case "budget_exceeded":
			// Find budget & expenses for current month
			monthStr := now.Format("2006-01")
			var budgetAmt float64
			_ = s.dbPool.QueryRow(ctx, `
				SELECT amount FROM budgets
				WHERE user_id = $1 AND category_id = $2 AND month = $3
			`, rule.UserID, cond.CategoryID, monthStr).Scan(&budgetAmt)

			if budgetAmt > 0 {
				var spentAmt float64
				monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
				monthEnd := monthStart.AddDate(0, 1, 0).Add(-time.Nanosecond)

				_ = s.dbPool.QueryRow(ctx, `
					SELECT COALESCE(SUM(amount), 0) FROM transactions
					WHERE user_id = $1 AND category_id = $2 AND type = 'expense'
					  AND status = 'confirmed' AND deleted_at IS NULL
					  AND date >= $3 AND date <= $4
				`, rule.UserID, cond.CategoryID, monthStart.Format("2006-01-02"), monthEnd.Format("2006-01-02")).Scan(&spentAmt)

				percentageUsed := (spentAmt / budgetAmt) * 100.0
				if percentageUsed >= cond.Percentage {
					triggered = true
					triggerMsg = fmt.Sprintf("Pengeluaran kategori Anda telah melebihi %.0f%% dari anggaran bulanan (Terpakai: Rp %.0f / Rp %.0f)", cond.Percentage, spentAmt, budgetAmt)
				}
			}

		case "recurring_transaction":
			// Trigger based on day of month or day of week
			isMatchingDay := false
			if cond.Frequency == "monthly" && now.Day() == cond.DayOfMonth {
				isMatchingDay = true
			} else if cond.Frequency == "weekly" && int(now.Weekday()) == cond.DayOfWeek {
				isMatchingDay = true
			}

			if isMatchingDay {
				triggered = true
				triggerMsg = "Pemicu transaksi berulang dijadwalkan."
			}
		}

		if triggered {
			// Execute action
			executionSucceeded := false
			switch rule.ActionType {
			case "send_alert":
				severity := "warning"
				if rule.TriggerType == "balance_below" {
					severity = "danger"
				}
				_, err := s.dbPool.Exec(ctx, `
					INSERT INTO alerts (user_id, type, severity, title, message, expires_at)
					VALUES ($1, $2, $3, $4, $5, $6)
				`, rule.UserID, "budget_warning", severity, rule.Name, triggerMsg, now.AddDate(0, 0, 7))
				executionSucceeded = (err == nil)

			case "send_telegram":
				hint := "Silakan periksa dashboard keuangan Anda."
				if act.Template != "" {
					triggerMsg = act.Template
				}
				err := s.telegramService.SendMessage(rule.Name, triggerMsg, hint)
				executionSucceeded = (err == nil)

			case "create_transaction":
				// Create transaction inside a DB transaction
				err := s.executeAutoCreateTransaction(ctx, rule.UserID, act)
				executionSucceeded = (err == nil)
			}

			if executionSucceeded {
				// Update statistics
				_, _ = s.dbPool.Exec(ctx, `
					UPDATE automation_rules
					SET last_triggered_at = NOW(), trigger_count = trigger_count + 1, updated_at = NOW()
					WHERE id = $1
				`, rule.ID)
			}
		}
	}

	return nil
}

func (s *automationRuleService) executeAutoCreateTransaction(ctx context.Context, userID string, act dto.RuleActionConfig) error {
	tx, err := s.dbPool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// Validate account
	var exists bool
	err = tx.QueryRow(ctx, `
		SELECT EXISTS(SELECT 1 FROM accounts WHERE id = $1 AND user_id = $2 AND is_active = true AND deleted_at IS NULL)
	`, act.AccountID, userID).Scan(&exists)
	if err != nil || !exists {
		return errors.New("invalid account source")
	}

	desc := "Auto-created transaction"
	if act.Description != "" {
		desc = act.Description
	}

	txType := "expense"
	if act.Type != "" {
		txType = act.Type
	}

	var categoryPtr *string
	if act.CategoryID != "" {
		categoryPtr = &act.CategoryID
	}

	// Insert transaction
	var txID string
	err = tx.QueryRow(ctx, `
		INSERT INTO transactions (user_id, account_id, category_id, type, amount, date, description, source, status)
		VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, $6, 'recurring', 'confirmed')
		RETURNING id
	`, userID, act.AccountID, categoryPtr, txType, act.Amount, desc).Scan(&txID)
	if err != nil {
		return fmt.Errorf("failed to insert transaction: %w", err)
	}

	// Update account balance
	var balanceUpdateQuery string
	if txType == "income" {
		balanceUpdateQuery = `UPDATE accounts SET balance = balance + $1 WHERE id = $2`
	} else {
		balanceUpdateQuery = `UPDATE accounts SET balance = balance - $1 WHERE id = $2`
	}

	_, err = tx.Exec(ctx, balanceUpdateQuery, act.Amount, act.AccountID)
	if err != nil {
		return fmt.Errorf("failed to update account balance: %w", err)
	}

	return tx.Commit(ctx)
}

func (s *automationRuleService) toResponse(m *model.AutomationRule) *dto.AutomationRuleResponse {
	var cond dto.RuleCondition
	_ = json.Unmarshal(m.Condition, &cond)

	var act dto.RuleActionConfig
	_ = json.Unmarshal(m.ActionConfig, &act)

	return &dto.AutomationRuleResponse{
		ID:              m.ID,
		UserID:          m.UserID,
		Name:            m.Name,
		TriggerType:     m.TriggerType,
		Condition:       cond,
		ActionType:      m.ActionType,
		ActionConfig:    act,
		IsActive:        m.IsActive,
		LastTriggeredAt: m.LastTriggeredAt,
		TriggerCount:    m.TriggerCount,
		CreatedAt:       m.CreatedAt,
		UpdatedAt:       m.UpdatedAt,
	}
}
