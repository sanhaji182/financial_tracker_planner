package service

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/kernel"
)

type EFService interface {
	GetEFSummary(ctx context.Context, userID string) (*dto.EFSummaryResponse, error)
	UpdateEFConfig(ctx context.Context, userID string, req *dto.UpdateEFConfigRequest) error
}

type efService struct {
	dbPool *pgxpool.Pool
}

func NewEFService(dbPool *pgxpool.Pool) EFService {
	return &efService{dbPool: dbPool}
}

func (s *efService) resolveOwnerID(ctx context.Context, userID string) (string, error) {
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

func (s *efService) GetEFSummary(ctx context.Context, userID string) (*dto.EFSummaryResponse, error) {
	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	// 1. Get/Create config
	var targetMonths int = 6
	var monthlyOverride *float64

	err = s.dbPool.QueryRow(ctx, `
		SELECT target_months, monthly_living_cost_override
		FROM emergency_fund_configs
		WHERE user_id = $1
	`, ownerID).Scan(&targetMonths, &monthlyOverride)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Insert default config
			_, _ = s.dbPool.Exec(ctx, `
				INSERT INTO emergency_fund_configs (user_id, target_months)
				VALUES ($1, 6)
				ON CONFLICT (user_id) DO NOTHING
			`, ownerID)
		} else {
			return nil, fmt.Errorf("failed to get config: %w", err)
		}
	}

	// 2. Sum accounts where is_emergency_fund = true
	var totalEmergencyFund float64
	err = s.dbPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(a.balance * COALESCE(c.exchange_rate_to_idr, 1)), 0)
		FROM accounts a LEFT JOIN currencies c ON c.code = a.currency
		WHERE a.user_id = $1 AND a.is_emergency_fund = true AND a.is_active = true AND a.deleted_at IS NULL
	`, ownerID).Scan(&totalEmergencyFund)
	if err != nil {
		return nil, fmt.Errorf("failed to get emergency fund total: %w", err)
	}

	// 3. Determine monthly living cost
	var monthlyLivingCost float64
	if monthlyOverride != nil && *monthlyOverride > 0 {
		monthlyLivingCost = *monthlyOverride
	} else {
		// Calculate last 3 months average living cost
		now := time.Now()
		startOfCurrentMonth := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
		threeMonthsAgo := startOfCurrentMonth.AddDate(0, -3, 0)

		var totalLivingCost float64
		err = s.dbPool.QueryRow(ctx, `
			SELECT COALESCE(SUM(t.amount * COALESCE(c.exchange_rate_to_idr, t.exchange_rate, 1)), 0)
			FROM transactions t LEFT JOIN currencies c ON c.code = t.currency
			WHERE t.user_id = $1 AND t.type = 'expense' AND t.status = 'confirmed'
			  AND COALESCE(t.notes, '') NOT LIKE 'Pembayaran Cicilan:% (Ekstra)%'
			  AND t.date >= $2 AND t.date < $3 AND t.deleted_at IS NULL
		`, ownerID, threeMonthsAgo, startOfCurrentMonth).Scan(&totalLivingCost)
		if err != nil {
			return nil, fmt.Errorf("failed to calculate avg living cost: %w", err)
		}

		monthlyLivingCost = totalLivingCost / 3.0
		// Do not use hard-coded fallback - let caller handle zero value
		// if monthlyLivingCost <= 0, data is insufficient
	}

	// 4. Income stability signals for adaptive target (kernel ef-v1).
	assessmentMonth := time.Date(time.Now().Year(), time.Now().Month(), 1, 0, 0, 0, 0, time.Local)
	assessmentStart := assessmentMonth.AddDate(0, -3, 0)
	var minIncome, maxIncome float64
	_ = s.dbPool.QueryRow(ctx, `SELECT COALESCE(MIN(monthly),0), COALESCE(MAX(monthly),0) FROM (
		SELECT SUM(t.amount * COALESCE(c.exchange_rate_to_idr,t.exchange_rate,1)) monthly
		FROM transactions t LEFT JOIN currencies c ON c.code=t.currency
		WHERE t.user_id=$1 AND t.type='income' AND t.status='confirmed' AND t.date >= $2 AND t.date < $3 AND t.deleted_at IS NULL
		GROUP BY DATE_TRUNC('month',t.date)) x`, ownerID, assessmentStart, assessmentMonth).Scan(&minIncome, &maxIncome)

	// Adaptive only when user kept the default 6-month config and did not set a living-cost override
	// as a "manual plan" signal. Explicit non-default target_months always wins inside the kernel.
	useAdaptive := monthlyOverride == nil

	ef := kernel.ComputeEF(kernel.EFInputs{
		AsOf:                   time.Now(),
		EFBalance:              totalEmergencyFund,
		MonthlyLivingCost:      monthlyLivingCost,
		ConfiguredTargetMonths: targetMonths,
		UseAdaptive:            useAdaptive,
		MinMonthlyIncome:       minIncome,
		MaxMonthlyIncome:       maxIncome,
	})

	return &dto.EFSummaryResponse{
		TotalEmergencyFund: dto.MoneyValue{
			Value:          totalEmergencyFund,
			FormattedValue: formatRupiah(totalEmergencyFund),
		},
		MonthlyLivingCost: dto.MoneyValue{
			Value:          monthlyLivingCost,
			FormattedValue: formatRupiah(monthlyLivingCost),
		},
		TargetMonths: ef.TargetMonths,
		TargetAmount: dto.MoneyValue{
			Value:          ef.TargetAmount,
			FormattedValue: formatRupiah(ef.TargetAmount),
		},
		CoverageMonths:     ef.CoverageMonths,
		ProgressPercentage: ef.ProgressPercentage,
		Status:             ef.Status,
		TargetRationale:    ef.TargetRationale,
		DataSufficiency: &dto.DataSufficiency{
			IsSufficient:       ef.DataQuality.IsSufficient,
			MissingFields:      ef.DataQuality.MissingFields,
			UsesFallbackValues: ef.DataQuality.UsesFallbackValues,
			Confidence:         ef.DataQuality.Confidence,
		},
		AsOf:           ef.AsOf.Format(time.RFC3339),
		FormulaVersion: ef.FormulaVersion,
		Assumptions:    ef.Assumptions,
	}, nil
}

func (s *efService) UpdateEFConfig(ctx context.Context, userID string, req *dto.UpdateEFConfigRequest) error {
	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	// Check user role: only owner can edit config
	var role string
	err = s.dbPool.QueryRow(ctx, "SELECT role FROM users WHERE id = $1", userID).Scan(&role)
	if err != nil {
		return err
	}
	if role == "spouse_viewer" {
		return errors.New("unauthorized: spouse cannot update emergency fund config")
	}

	var exists bool
	err = s.dbPool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM emergency_fund_configs WHERE user_id = $1)", ownerID).Scan(&exists)
	if err != nil {
		return err
	}

	var overrideVal sql.NullFloat64
	if req.MonthlyLivingCostOverride != nil {
		overrideVal.Float64 = *req.MonthlyLivingCostOverride
		overrideVal.Valid = true
	}

	if exists {
		_, err = s.dbPool.Exec(ctx, `
			UPDATE emergency_fund_configs
			SET target_months = $1, monthly_living_cost_override = $2, updated_at = NOW()
			WHERE user_id = $3
		`, req.TargetMonths, overrideVal, ownerID)
	} else {
		_, err = s.dbPool.Exec(ctx, `
			INSERT INTO emergency_fund_configs (user_id, target_months, monthly_living_cost_override)
			VALUES ($1, $2, $3)
		`, ownerID, req.TargetMonths, overrideVal)
	}

	return err
}
