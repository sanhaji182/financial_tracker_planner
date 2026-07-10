package service

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/user/financial-os/internal/dto"
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

// SimulateScenario calculates side-by-side what-if metrics
func (s *scenarioService) SimulateScenario(ctx context.Context, userID string, changes []dto.ScenarioChange) (*dto.ScenarioResult, error) {
	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	// 1. Fetch current cash balance
	var startingCash float64
	err = s.dbPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(balance), 0)
		FROM accounts
		WHERE user_id = $1 AND type IN ('bank', 'e_wallet', 'cash') AND is_active = true AND deleted_at IS NULL
	`, ownerID).Scan(&startingCash)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch starting balance: %w", err)
	}

	// 2. Query average income & expenses (lookback 3 months)
	now := time.Now()
	startOfCurrentMonth := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
	threeMonthsAgo := startOfCurrentMonth.AddDate(0, -3, 0)

	var totalIncomeLast3Months float64
	_ = s.dbPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount), 0)
		FROM transactions
		WHERE user_id = $1 AND type = 'income' AND status = 'confirmed' AND date >= $2 AND date < $3 AND deleted_at IS NULL
	`, ownerID, threeMonthsAgo, startOfCurrentMonth).Scan(&totalIncomeLast3Months)

	avgMonthlyIncome := totalIncomeLast3Months / 3.0
	if avgMonthlyIncome <= 0 {
		avgMonthlyIncome = 25000000.0 // Default salary fallback
	}

	var totalExpenseLast3Months float64
	_ = s.dbPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount), 0)
		FROM transactions
		WHERE user_id = $1 AND type = 'expense' AND status = 'confirmed' AND date >= $2 AND date < $3 AND deleted_at IS NULL
	`, ownerID, threeMonthsAgo, startOfCurrentMonth).Scan(&totalExpenseLast3Months)

	avgMonthlyExpense := totalExpenseLast3Months / 3.0
	if avgMonthlyExpense <= 0 {
		avgMonthlyExpense = 12000000.0 // Default safety threshold
	}

	// 3. Query current outstanding debts
	var outstandingDebts float64
	_ = s.dbPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(outstanding_balance), 0)
		FROM debts
		WHERE user_id = $1 AND status = 'active' AND deleted_at IS NULL
	`, ownerID).Scan(&outstandingDebts)

	// BASE STATE METRICS
	baseEndingBalance := startingCash + avgMonthlyIncome - avgMonthlyExpense
	baseTotalDebts := outstandingDebts
	baseEFCoverage := 0.0
	if avgMonthlyExpense > 0 {
		baseEFCoverage = startingCash / avgMonthlyExpense
	}
	baseCashRunway := baseEFCoverage

	// SCENARIO STATE METRICS (Initial states copied from base states)
	scenarioEndingBalance := baseEndingBalance
	scenarioTotalDebts := baseTotalDebts
	scenarioMonthlyExpense := avgMonthlyExpense
	scenarioMonthlyIncome := avgMonthlyIncome
	scenarioCashPool := startingCash

	// Apply simulated changes
	for _, c := range changes {
		switch c.Type {
		case "extra_debt_payment":
			scenarioTotalDebts -= c.Params.MonthlyExtraAmount
			if scenarioTotalDebts < 0 {
				scenarioTotalDebts = 0
			}
			// Paying extra debt reduces ending balance & cash pool
			scenarioEndingBalance -= c.Params.MonthlyExtraAmount
			scenarioCashPool -= c.Params.MonthlyExtraAmount

		case "income_change":
			changeAmt := avgMonthlyIncome * (c.Params.Percentage / 100.0)
			scenarioMonthlyIncome += changeAmt
			scenarioEndingBalance += changeAmt

		case "large_purchase":
			scenarioEndingBalance -= c.Params.Amount
			scenarioCashPool -= c.Params.Amount

		case "investment_increase":
			// Shifting cash to investment reduces ending liquid balance
			scenarioEndingBalance -= c.Params.MonthlyAmount
			scenarioCashPool -= c.Params.MonthlyAmount

		case "add_subscription":
			scenarioMonthlyExpense += c.Params.MonthlyAmount
			scenarioEndingBalance -= c.Params.MonthlyAmount

		case "remove_expense":
			scenarioMonthlyExpense -= c.Params.MonthlyAmount
			if scenarioMonthlyExpense < 0 {
				scenarioMonthlyExpense = 0
			}
			scenarioEndingBalance += c.Params.MonthlyAmount
		}
	}

	// Recalculate dynamic runway ratios
	scenarioEFCoverage := 0.0
	if scenarioMonthlyExpense > 0 {
		// Cash pool after any immediate cash outlays divided by monthly expenses
		if scenarioCashPool < 0 {
			scenarioCashPool = 0
		}
		scenarioEFCoverage = scenarioCashPool / scenarioMonthlyExpense
	}
	scenarioCashRunway := scenarioEFCoverage

	// Compute Impacts
	endingBalanceImpact := scenarioEndingBalance - baseEndingBalance
	totalDebtsImpact := scenarioTotalDebts - baseTotalDebts
	efCoverageImpact := scenarioEFCoverage - baseEFCoverage
	cashRunwayImpact := scenarioCashRunway - baseCashRunway

	// Get Severity Helper
	getSeverity := func(val float64, inverse bool) string {
		if val == 0 {
			return "neutral"
		}
		if inverse {
			if val < 0 {
				return "positive"
			}
			return "negative"
		}
		if val > 0 {
			return "positive"
		}
		return "negative"
	}

	return &dto.ScenarioResult{
		EndingBalance: dto.MetricState{
			Base:     baseEndingBalance,
			Scenario: scenarioEndingBalance,
			Impact:   endingBalanceImpact,
			Severity: getSeverity(endingBalanceImpact, false),
		},
		TotalDebts: dto.MetricState{
			Base:     baseTotalDebts,
			Scenario: scenarioTotalDebts,
			Impact:   totalDebtsImpact,
			Severity: getSeverity(totalDebtsImpact, true), // less debt is good (positive)
		},
		EFCoverage: dto.MetricState{
			Base:     baseEFCoverage,
			Scenario: scenarioEFCoverage,
			Impact:   efCoverageImpact,
			Severity: getSeverity(efCoverageImpact, false),
		},
		CashRunway: dto.MetricState{
			Base:     baseCashRunway,
			Scenario: scenarioCashRunway,
			Impact:   cashRunwayImpact,
			Severity: getSeverity(cashRunwayImpact, false),
		},
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
		return pgx.ErrNoRows
	}

	return nil
}
