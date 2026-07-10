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
		SELECT COALESCE(SUM(balance), 0)
		FROM accounts
		WHERE user_id = $1 AND is_emergency_fund = true AND is_active = true AND deleted_at IS NULL
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
			SELECT COALESCE(SUM(amount), 0)
			FROM transactions
			WHERE user_id = $1 AND type = 'expense' AND status = 'confirmed'
			  AND notes NOT LIKE 'Pembayaran Cicilan:% (Ekstra)%'
			  AND date >= $2 AND date < $3 AND deleted_at IS NULL
		`, ownerID, threeMonthsAgo, startOfCurrentMonth).Scan(&totalLivingCost)
		if err != nil {
			return nil, fmt.Errorf("failed to calculate avg living cost: %w", err)
		}

		monthlyLivingCost = totalLivingCost / 3.0
		if monthlyLivingCost <= 0 {
			monthlyLivingCost = 12000000.0 // default fallback living cost
		}
	}

	// 4. Calculate metrics
	targetAmount := monthlyLivingCost * float64(targetMonths)
	
	var coverageMonths float64
	if monthlyLivingCost > 0 {
		coverageMonths = totalEmergencyFund / monthlyLivingCost
	}

	var progressPercentage float64
	if targetAmount > 0 {
		progressPercentage = (totalEmergencyFund / targetAmount) * 100.0
	}

	// 5. Determine status
	var status string
	if coverageMonths >= float64(targetMonths) {
		status = "Aman"
	} else if coverageMonths >= 3.0 {
		status = "Kurang"
	} else {
		status = "Kritis"
	}

	return &dto.EFSummaryResponse{
		TotalEmergencyFund: dto.MoneyValue{
			Value:          totalEmergencyFund,
			FormattedValue: formatRupiah(totalEmergencyFund),
		},
		MonthlyLivingCost: dto.MoneyValue{
			Value:          monthlyLivingCost,
			FormattedValue: formatRupiah(monthlyLivingCost),
		},
		TargetMonths: targetMonths,
		TargetAmount: dto.MoneyValue{
			Value:          targetAmount,
			FormattedValue: formatRupiah(targetAmount),
		},
		CoverageMonths:     coverageMonths,
		ProgressPercentage: progressPercentage,
		Status:             status,
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
