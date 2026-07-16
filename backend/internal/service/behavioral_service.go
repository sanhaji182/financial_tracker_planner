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

type BehavioralService interface {
	GetMonthlyReview(ctx context.Context, userID string, month string) (*dto.MonthlyReviewResponse, error)
	UpdateItemStatus(ctx context.Context, userID string, month, itemID, status string) error
}

type behavioralService struct {
	dbPool   *pgxpool.Pool
	filePath string
	mu       sync.RWMutex
}

func NewBehavioralService(dbPool *pgxpool.Pool, dataDir string) BehavioralService {
	return &behavioralService{
		dbPool:   dbPool,
		filePath: filepath.Join(dataDir, "behavioral_review_state.json"),
	}
}

type reviewStateFile map[string]map[string]map[string]string // owner -> month -> itemID -> status

func (s *behavioralService) resolveOwnerID(ctx context.Context, userID string) (string, error) {
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

func (s *behavioralService) loadState() (reviewStateFile, error) {
	if _, err := os.Stat(s.filePath); os.IsNotExist(err) {
		return reviewStateFile{}, nil
	}
	data, err := os.ReadFile(s.filePath)
	if err != nil {
		return nil, err
	}
	var st reviewStateFile
	if err := json.Unmarshal(data, &st); err != nil {
		return nil, err
	}
	if st == nil {
		st = reviewStateFile{}
	}
	return st, nil
}

func (s *behavioralService) saveState(st reviewStateFile) error {
	data, err := json.MarshalIndent(st, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.filePath), 0755); err != nil {
		return err
	}
	return os.WriteFile(s.filePath, data, 0600)
}

func (s *behavioralService) GetMonthlyReview(ctx context.Context, userID string, month string) (*dto.MonthlyReviewResponse, error) {
	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	if month == "" {
		month = now.Format("2006-01")
	}

	var unrecon, unconf int
	_ = s.dbPool.QueryRow(ctx, `
		SELECT COUNT(*) FROM transactions
		WHERE user_id=$1 AND deleted_at IS NULL AND status='confirmed'
		AND COALESCE(reconciled, false) = false
	`, ownerID).Scan(&unrecon)
	_ = s.dbPool.QueryRow(ctx, `
		SELECT COUNT(*) FROM transactions
		WHERE user_id=$1 AND deleted_at IS NULL AND status != 'confirmed'
	`, ownerID).Scan(&unconf)

	var openAnomalies int
	var anomalyIDs, anomalyLabels []string
	rows, err := s.dbPool.Query(ctx, `
		SELECT id::text, COALESCE(title, 'Anomali')
		FROM alerts
		WHERE user_id=$1
		  AND COALESCE(is_dismissed, false) = false
		  AND COALESCE(is_read, false) = false
		  AND (
		    type ILIKE '%anomal%'
		    OR severity IN ('warning', 'danger')
		  )
		ORDER BY created_at DESC
		LIMIT 10
	`, ownerID)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var id, label string
			if rows.Scan(&id, &label) == nil {
				anomalyIDs = append(anomalyIDs, id)
				anomalyLabels = append(anomalyLabels, label)
				openAnomalies++
			}
		}
	}

	var unusedCount int
	var unusedIDs, unusedNames []string
	var waste float64
	_ = s.dbPool.QueryRow(ctx, `
		SELECT COUNT(*), COALESCE(SUM(
			CASE frequency
				WHEN 'yearly' THEN amount / 12.0
				WHEN 'weekly' THEN amount * 4.33
				ELSE amount
			END
		), 0)
		FROM subscriptions
		WHERE user_id=$1 AND is_active=true AND deleted_at IS NULL
		  AND last_used_date IS NOT NULL
		  AND last_used_date < (CURRENT_DATE - INTERVAL '60 days')
	`, ownerID).Scan(&unusedCount, &waste)
	if unusedCount > 0 {
		ur, qerr := s.dbPool.Query(ctx, `
			SELECT id::text, name FROM subscriptions
			WHERE user_id=$1 AND is_active=true AND deleted_at IS NULL
			  AND last_used_date IS NOT NULL
			  AND last_used_date < (CURRENT_DATE - INTERVAL '60 days')
			ORDER BY amount DESC
			LIMIT 10
		`, ownerID)
		if qerr == nil {
			defer ur.Close()
			for ur.Next() {
				var id, name string
				if ur.Scan(&id, &name) == nil {
					unusedIDs = append(unusedIDs, id)
					unusedNames = append(unusedNames, name)
				}
			}
		}
	}

	var overdueBills int
	_ = s.dbPool.QueryRow(ctx, `
		SELECT COUNT(*) FROM bills
		WHERE user_id=$1 AND deleted_at IS NULL AND status='overdue'
	`, ownerID).Scan(&overdueBills)

	var budgetOver int
	_ = s.dbPool.QueryRow(ctx, `
		SELECT COUNT(*) FROM (
			SELECT b.id
			FROM budgets b
			LEFT JOIN (
				SELECT category_id,
				       SUM(amount * COALESCE(exchange_rate, 1)) AS spent
				FROM transactions
				WHERE user_id=$1 AND type='expense' AND status='confirmed' AND deleted_at IS NULL
				  AND to_char(date, 'YYYY-MM') = $2
				GROUP BY category_id
			) t ON t.category_id = b.category_id
			WHERE b.user_id=$1 AND b.month=$2
			  AND COALESCE(t.spent, 0) > b.amount
		) x
	`, ownerID, month).Scan(&budgetOver)

	var efBal, monthlyExp float64
	_ = s.dbPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(a.balance * COALESCE(c.exchange_rate_to_idr,1)),0)
		FROM accounts a LEFT JOIN currencies c ON c.code=a.currency
		WHERE a.user_id=$1 AND a.is_emergency_fund=true AND a.is_active=true AND a.deleted_at IS NULL
	`, ownerID).Scan(&efBal)
	start := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
	_ = s.dbPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(t.amount * COALESCE(c.exchange_rate_to_idr,t.exchange_rate,1)),0)/3.0
		FROM transactions t LEFT JOIN currencies c ON c.code=t.currency
		WHERE t.user_id=$1 AND t.type='expense' AND t.status='confirmed' AND t.deleted_at IS NULL
		  AND t.date >= $2 AND t.date < $3
	`, ownerID, start.AddDate(0, -3, 0), start).Scan(&monthlyExp)
	efCov := 0.0
	if monthlyExp > 0 {
		efCov = efBal / monthlyExp
	}

	var closed bool
	_ = s.dbPool.QueryRow(ctx, `
		SELECT EXISTS(SELECT 1 FROM monthly_closings WHERE user_id=$1 AND month=$2)
	`, ownerID, month).Scan(&closed)

	s.mu.RLock()
	st, _ := s.loadState()
	s.mu.RUnlock()
	prior := map[string]string{}
	if st != nil && st[ownerID] != nil && st[ownerID][month] != nil {
		prior = st[ownerID][month]
	}

	res := kernel.ComputeMonthlyReview(kernel.BehavioralInputs{
		AsOf: now, Month: month,
		UnreconciledTxCount: unrecon, UnconfirmedTxCount: unconf,
		OpenAnomalyCount: openAnomalies, AnomalyIDs: anomalyIDs, AnomalyLabels: anomalyLabels,
		UnusedSubscriptionCount: unusedCount, UnusedSubscriptionIDs: unusedIDs,
		UnusedSubscriptionNames: unusedNames, MonthlySubWaste: waste,
		EFCoverageMonths: efCov, EFTargetMonths: 6,
		OverdueBillCount: overdueBills, BudgetOverCount: budgetOver,
		MonthAlreadyClosed: closed, PriorItemStatus: prior,
	})

	items := make([]dto.ReviewChecklistItemDTO, 0, len(res.Checklist))
	for _, it := range res.Checklist {
		items = append(items, dto.ReviewChecklistItemDTO{
			ID: it.ID, Title: it.Title, Description: it.Description, Category: it.Category,
			Status: it.Status, Priority: it.Priority, ActionURL: it.ActionURL, Required: it.Required,
		})
	}
	actions := make([]dto.SuggestedActionDTO, 0, len(res.Actions))
	for _, a := range res.Actions {
		actions = append(actions, dto.SuggestedActionDTO{
			ID: a.ID, Kind: a.Kind, Title: a.Title, Rationale: a.Rationale,
			TargetID: a.TargetID, TargetLabel: a.TargetLabel, Amount: a.Amount,
			IsReversible: a.IsReversible, ConfirmLabel: a.ConfirmLabel, DismissLabel: a.DismissLabel,
			ActionURL: a.ActionURL, Severity: a.Severity,
		})
	}

	return &dto.MonthlyReviewResponse{
		AsOf: res.AsOf.Format(time.RFC3339), Month: res.Month, FormulaVersion: res.FormulaVersion,
		Checklist: items, Actions: actions, CompletedCount: res.CompletedCount,
		TotalRequired: res.TotalRequired, ProgressPct: res.ProgressPct,
		Summary: res.Summary, Assumptions: res.Assumptions, Disclaimer: res.Disclaimer,
	}, nil
}

func (s *behavioralService) UpdateItemStatus(ctx context.Context, userID string, month, itemID, status string) error {
	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		return err
	}
	switch status {
	case kernel.ReviewPending, kernel.ReviewDone, kernel.ReviewSkipped, kernel.ReviewBlocked:
	default:
		return fmt.Errorf("invalid status %q", status)
	}
	if month == "" {
		month = time.Now().Format("2006-01")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	st, err := s.loadState()
	if err != nil {
		return err
	}
	if st[ownerID] == nil {
		st[ownerID] = map[string]map[string]string{}
	}
	if st[ownerID][month] == nil {
		st[ownerID][month] = map[string]string{}
	}
	st[ownerID][month][itemID] = status
	return s.saveState(st)
}
