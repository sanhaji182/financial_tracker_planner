package service

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/user/financial-os/internal/dto"
)

type InvestmentService interface {
	GetInvestmentSummary(ctx context.Context, userID string) (*dto.InvestmentSummaryResponse, error)
}

type investmentService struct {
	dbPool *pgxpool.Pool
}

func NewInvestmentService(dbPool *pgxpool.Pool) InvestmentService {
	return &investmentService{dbPool: dbPool}
}

func (s *investmentService) resolveOwnerID(ctx context.Context, userID string) (string, error) {
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

func (s *investmentService) GetInvestmentSummary(ctx context.Context, userID string) (*dto.InvestmentSummaryResponse, error) {
	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	// 1. Calculate Total Investment (assets of type 'investment' or 'deposit')
	var totalInvestment float64
	err = s.dbPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(current_value), 0)
		FROM assets
		WHERE user_id = $1 AND type IN ('investment', 'deposit') AND deleted_at IS NULL
	`, ownerID).Scan(&totalInvestment)
	if err != nil {
		return nil, fmt.Errorf("failed to get total investment: %w", err)
	}

	// 2. Calculate Liquid Cash (accounts of type bank/cash/e_wallet where is_emergency_fund = false)
	var liquidCash float64
	err = s.dbPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(balance), 0)
		FROM accounts
		WHERE user_id = $1 AND type IN ('bank', 'cash', 'e_wallet') AND is_emergency_fund = false AND is_active = true AND deleted_at IS NULL
	`, ownerID).Scan(&liquidCash)
	if err != nil {
		return nil, fmt.Errorf("failed to get liquid cash: %w", err)
	}

	// 3. Ratios
	totalAsset := totalInvestment + liquidCash
	var liquidRatio float64 = 100.0
	var investedRatio float64 = 0.0
	if totalAsset > 0 {
		liquidRatio = (liquidCash / totalAsset) * 100.0
		investedRatio = (totalInvestment / totalAsset) * 100.0
	}

	// 4. Asset Breakdown per Category (Saham, Reksadana, Deposito, Logam Mulia/Lainnya)
	breakdownMap := map[string]float64{
		"Saham":     0,
		"Reksadana": 0,
		"Deposito":  0,
		"Lainnya":   0,
	}

	rows, err := s.dbPool.Query(ctx, `
		SELECT name, type, COALESCE(current_value, 0)
		FROM assets
		WHERE user_id = $1 AND type IN ('investment', 'deposit') AND deleted_at IS NULL
	`, ownerID)
	if err == nil {
		for rows.Next() {
			var name, aType string
			var val float64
			if scanErr := rows.Scan(&name, &aType, &val); scanErr == nil {
				nameLower := strings.ToLower(name)
				if strings.Contains(nameLower, "saham") || strings.Contains(nameLower, "stock") || strings.Contains(nameLower, "equity") {
					breakdownMap["Saham"] += val
				} else if strings.Contains(nameLower, "reksa") || strings.Contains(nameLower, "mutual") || strings.Contains(nameLower, "fund") {
					breakdownMap["Reksadana"] += val
				} else if strings.Contains(nameLower, "deposito") || aType == "deposit" {
					breakdownMap["Deposito"] += val
				} else {
					breakdownMap["Lainnya"] += val
				}
			}
		}
		rows.Close()
	}

	var breakdown []dto.InvestmentBreakdownDto
	for cat, val := range breakdownMap {
		var pct float64
		if totalInvestment > 0 {
			pct = (val / totalInvestment) * 100.0
		}
		breakdown = append(breakdown, dto.InvestmentBreakdownDto{
			AssetType:       cat,
			Amount:          val,
			FormattedAmount: formatRupiah(val),
			Percentage:      pct,
		})
	}

	// 5. Trend for the last 6 months
	var trend []dto.MonthlyTrendDto
	now := time.Now()
	sixMonthsAgo := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location()).AddDate(0, -5, 0)

	// Fetch historical valuations
	type valHistory struct {
		Month string
		Value float64
	}
	historyRows, err := s.dbPool.Query(ctx, `
		SELECT TO_CHAR(valuation_date, 'YYYY-MM') as val_month, COALESCE(SUM(value), 0)
		FROM asset_valuations
		WHERE asset_id IN (
			SELECT id FROM assets WHERE user_id = $1 AND type IN ('investment', 'deposit') AND deleted_at IS NULL
		) AND valuation_date >= $2
		GROUP BY val_month
		ORDER BY val_month
	`, ownerID, sixMonthsAgo)

	historyMap := make(map[string]float64)
	if err == nil {
		for historyRows.Next() {
			var m string
			var v float64
			if scanErr := historyRows.Scan(&m, &v); scanErr == nil {
				historyMap[m] = v
			}
		}
		historyRows.Close()
	}

	// Populate exactly 6 months
	for i := 0; i < 6; i++ {
		mDate := sixMonthsAgo.AddDate(0, i, 0)
		mStr := mDate.Format("2006-01")
		
		val := historyMap[mStr]
		// If no historical value, fallback to totalInvestment as static projection
		if val <= 0 {
			val = totalInvestment
		}

		trend = append(trend, dto.MonthlyTrendDto{
			Month:          mStr,
			Value:          val,
			FormattedValue: formatRupiah(val),
		})
	}

	return &dto.InvestmentSummaryResponse{
		TotalInvestment: dto.MoneyValue{
			Value:          totalInvestment,
			FormattedValue: formatRupiah(totalInvestment),
		},
		LiquidCash: dto.MoneyValue{
			Value:          liquidCash,
			FormattedValue: formatRupiah(liquidCash),
		},
		LiquidRatio:   liquidRatio,
		InvestedRatio: investedRatio,
		Breakdown:     breakdown,
		Trend:         trend,
	}, nil
}
