package service

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/kernel"
	"github.com/user/financial-os/internal/model"
)

// ScenarioService handles what-if financial simulation planners
type ScenarioService interface {
	SimulateScenario(ctx context.Context, userID string, changes []dto.ScenarioChange) (*dto.ScenarioResult, error)
	SaveScenario(ctx context.Context, userID string, req dto.SaveScenarioRequest) (*dto.ScenarioResponse, error)
	GetScenarios(ctx context.Context, userID string) ([]dto.ScenarioResponse, error)
	DeleteScenario(ctx context.Context, userID string, id string) error
}

type scenarioService struct {
	dbPool *pgxpool.Pool
}

// NewScenarioService creates a new ScenarioService
func NewScenarioService(dbPool *pgxpool.Pool) ScenarioService {
	return &scenarioService{dbPool: dbPool}
}

func (s *scenarioService) resolveOwnerID(ctx context.Context, userID string) (string, error) {
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

// SimulateScenario calculates side-by-side what-if metrics via scenario-v1 kernel.
func (s *scenarioService) SimulateScenario(ctx context.Context, userID string, changes []dto.ScenarioChange) (*dto.ScenarioResult, error) {
	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	var startingCash float64
	err = s.dbPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(a.balance * COALESCE(c.exchange_rate_to_idr,1)), 0)
		FROM accounts a LEFT JOIN currencies c ON c.code=a.currency
		WHERE a.user_id = $1 AND a.type IN ('bank', 'e_wallet', 'cash') AND a.is_active = true AND a.deleted_at IS NULL
	`, ownerID).Scan(&startingCash)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch starting balance: %w", err)
	}

	now := time.Now()
	startOfCurrentMonth := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
	threeMonthsAgo := startOfCurrentMonth.AddDate(0, -3, 0)

	var totalIncomeLast3Months float64
	_ = s.dbPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(t.amount * COALESCE(c.exchange_rate_to_idr,t.exchange_rate,1)), 0)
		FROM transactions t LEFT JOIN currencies c ON c.code=t.currency
		WHERE t.user_id = $1 AND t.type = 'income' AND t.status = 'confirmed' AND t.date >= $2 AND t.date < $3 AND t.deleted_at IS NULL
	`, ownerID, threeMonthsAgo, startOfCurrentMonth).Scan(&totalIncomeLast3Months)
	avgMonthlyIncome := totalIncomeLast3Months / 3.0

	var totalExpenseLast3Months float64
	_ = s.dbPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(t.amount * COALESCE(c.exchange_rate_to_idr,t.exchange_rate,1)), 0)
		FROM transactions t LEFT JOIN currencies c ON c.code=t.currency
		WHERE t.user_id = $1 AND t.type = 'expense' AND t.status = 'confirmed' AND t.date >= $2 AND t.date < $3 AND t.deleted_at IS NULL
	`, ownerID, threeMonthsAgo, startOfCurrentMonth).Scan(&totalExpenseLast3Months)
	avgMonthlyExpense := totalExpenseLast3Months / 3.0

	var outstandingDebts float64
	_ = s.dbPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(d.outstanding_balance * COALESCE(c.exchange_rate_to_idr,1)), 0)
		FROM debts d LEFT JOIN currencies c ON c.code=d.currency
		WHERE d.user_id = $1 AND d.status = 'active' AND d.deleted_at IS NULL
	`, ownerID).Scan(&outstandingDebts)

	// Blended APR weighted by outstanding (interest_rate stored as percent)
	var blendedAPR float64
	_ = s.dbPool.QueryRow(ctx, `
		SELECT CASE WHEN SUM(outstanding_balance) > 0
			THEN SUM(outstanding_balance * interest_rate) / SUM(outstanding_balance) / 100.0
			ELSE 0 END
		FROM debts
		WHERE user_id = $1 AND status = 'active' AND deleted_at IS NULL AND outstanding_balance > 0
	`, ownerID).Scan(&blendedAPR)

	// Active goals monthly need (time-bound within 12 months)
	var goalsMonthlyNeed float64
	rows, gerr := s.dbPool.Query(ctx, `
		SELECT target_amount, current_amount, target_date
		FROM goals
		WHERE user_id = $1 AND status = 'active' AND target_date IS NOT NULL
		AND target_date <= (CURRENT_DATE + INTERVAL '12 months')
	`, ownerID)
	if gerr == nil {
		defer rows.Close()
		for rows.Next() {
			var target, current float64
			var td time.Time
			if rows.Scan(&target, &current, &td) != nil {
				continue
			}
			rem := target - current
			if rem <= 0 {
				continue
			}
			months := td.Sub(now).Hours() / 24 / 30
			if months <= 0 {
				goalsMonthlyNeed += rem
			} else {
				goalsMonthlyNeed += rem / months
			}
		}
	}

	kChanges := make([]kernel.ScenarioChangeInput, 0, len(changes))
	for _, c := range changes {
		kChanges = append(kChanges, kernel.ScenarioChangeInput{
			Type:               c.Type,
			MonthlyExtraAmount: c.Params.MonthlyExtraAmount,
			Percentage:         c.Params.Percentage,
			Amount:             c.Params.Amount,
			MonthlyAmount:      c.Params.MonthlyAmount,
		})
	}

	kr := kernel.ComputeScenarioCompare(kernel.ScenarioCompareInputs{
		AsOf:                   now.UTC(),
		StartingCash:           startingCash,
		AvgMonthlyIncome:       avgMonthlyIncome,
		AvgMonthlyExpense:      avgMonthlyExpense,
		OutstandingDebts:       outstandingDebts,
		BlendedDebtAPR:         blendedAPR,
		ActiveGoalsMonthlyNeed: goalsMonthlyNeed,
		HorizonMonths:          12,
		Changes:                kChanges,
	})

	mapMetric := func(m kernel.ScenarioMetric) dto.MetricState {
		return dto.MetricState{
			Base: m.Base, Scenario: m.Scenario, Impact: m.Impact, Severity: m.Severity, Unit: m.Unit,
		}
	}

	return &dto.ScenarioResult{
		EndingBalance:   mapMetric(kr.EndingBalance),
		TotalDebts:      mapMetric(kr.TotalDebts),
		EFCoverage:      mapMetric(kr.EFCoverage),
		CashRunway:      mapMetric(kr.CashRunway),
		DebtInterest:    mapMetric(kr.DebtInterest),
		GoalFundingGap:  mapMetric(kr.GoalFundingGap),
		GoalDelayMonths: mapMetric(kr.GoalDelayMonths),
		DownsideRunway:  mapMetric(kr.DownsideRunway),
		AsOf:            kr.AsOf.Format(time.RFC3339),
		FormulaVersion:  kr.FormulaVersion,
		HorizonMonths:   kr.HorizonMonths,
		Assumptions:     kr.Assumptions,
		Notes:           kr.Notes,
	}, nil
}

// SaveScenario persists the scenario parameters and its calculated results
func (s *scenarioService) SaveScenario(ctx context.Context, userID string, req dto.SaveScenarioRequest) (*dto.ScenarioResponse, error) {
	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	changesBytes, err := json.Marshal(req.Changes)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal changes: %w", err)
	}

	resultBytes, err := json.Marshal(req.Result)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal result: %w", err)
	}

	var saved model.Scenario
	err = s.dbPool.QueryRow(ctx, `
		INSERT INTO scenarios (user_id, name, changes, result)
		VALUES ($1, $2, $3, $4)
		RETURNING id, user_id, name, changes, result, created_at
	`, ownerID, req.Name, changesBytes, resultBytes).Scan(
		&saved.ID, &saved.UserID, &saved.Name, &saved.Changes, &saved.Result, &saved.CreatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to save scenario: %w", err)
	}

	return &dto.ScenarioResponse{
		ID:        saved.ID,
		UserID:    saved.UserID,
		Name:      saved.Name,
		Changes:   req.Changes,
		Result:    req.Result,
		CreatedAt: saved.CreatedAt,
	}, nil
}

// GetScenarios lists all saved scenarios for the user's household
func (s *scenarioService) GetScenarios(ctx context.Context, userID string) ([]dto.ScenarioResponse, error) {
	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	rows, err := s.dbPool.Query(ctx, `
		SELECT id, user_id, name, changes, result, created_at
		FROM scenarios
		WHERE user_id = $1
		ORDER BY created_at DESC
	`, ownerID)
	if err != nil {
		return nil, fmt.Errorf("failed to list scenarios: %w", err)
	}
	defer rows.Close()

	var list []dto.ScenarioResponse
	for rows.Next() {
		var r model.Scenario
		if err := rows.Scan(&r.ID, &r.UserID, &r.Name, &r.Changes, &r.Result, &r.CreatedAt); err != nil {
			continue
		}

		var changes []dto.ScenarioChange
		_ = json.Unmarshal(r.Changes, &changes)

		var result dto.ScenarioResult
		_ = json.Unmarshal(r.Result, &result)

		list = append(list, dto.ScenarioResponse{
			ID:        r.ID,
			UserID:    r.UserID,
			Name:      r.Name,
			Changes:   changes,
			Result:    result,
			CreatedAt: r.CreatedAt,
		})
	}

	return list, nil
}

// DeleteScenario deletes a saved scenario by ID
func (s *scenarioService) DeleteScenario(ctx context.Context, userID string, id string) error {
	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	tag, err := s.dbPool.Exec(ctx, `
		DELETE FROM scenarios WHERE id = $1 AND user_id = $2
	`, id, ownerID)
	if err != nil {
		return fmt.Errorf("failed to delete scenario: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("scenario not found")
	}
	return nil
}
