package service

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/user/financial-os/internal/dto"
)

type AllocationService interface {
	GetAllocationAdvice(ctx context.Context, userID string) (*dto.AllocationAdviceResponse, error)
}

type allocationService struct {
	dbPool          *pgxpool.Pool
	forecastService ForecastService
	efService       EFService
}

func NewAllocationService(dbPool *pgxpool.Pool, forecastService ForecastService, efService EFService) AllocationService {
	return &allocationService{
		dbPool:          dbPool,
		forecastService: forecastService,
		efService:       efService,
	}
}

func (s *allocationService) resolveOwnerID(ctx context.Context, userID string) (string, error) {
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

func (s *allocationService) GetAllocationAdvice(ctx context.Context, userID string) (*dto.AllocationAdviceResponse, error) {
	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	// 1. Get EF Summary to check Priority 1
	efSummary, err := s.efService.GetEFSummary(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("failed to get ef summary: %w", err)
	}

	// 2. Get Forecast Summary to check Priority 3 & calculate surplus
	monthStr := time.Now().Format("2006-01")
	fc, err := s.forecastService.CalculateMonthlyForecast(ctx, ownerID, monthStr)
	if err != nil {
		return nil, fmt.Errorf("failed to calculate monthly forecast: %w", err)
	}

	// 3. Calculate Available Surplus
	// Surplus = Income - Variable - Bills - MinDebtPayments - Buffer(10% of Income)
	income := fc.EstimatedIncome.Value
	fixed := fc.EstimatedFixedExpenses.Value
	variable := fc.EstimatedVariableExpenses.Value
	buffer := 0.10 * income

	surplus := income - fixed - variable - buffer
	if surplus < 0 {
		surplus = 0
	}

	surplusRemaining := surplus
	var advices []dto.AdviceDto

	// Evaluate Priority 1: Top up Emergency Fund
	// target_months * monthly_living_cost
	if efSummary.CoverageMonths < float64(efSummary.TargetMonths) {
		efNeeded := efSummary.TargetAmount.Value - efSummary.TotalEmergencyFund.Value
		if efNeeded > 0 && surplusRemaining > 0 {
			suggested := minFloat(surplusRemaining, efNeeded)
			advices = append(advices, dto.AdviceDto{
				Priority: 1,
				Title:    "Top Up Dana Darurat",
				AmountSuggested: dto.MoneyValue{
					Value:          suggested,
					FormattedValue: formatRupiah(suggested),
				},
				Reason:     fmt.Sprintf("Dana darurat saat ini baru mencakup %.1f bulan, dari target %d bulan.", efSummary.CoverageMonths, efSummary.TargetMonths),
				ActionType: "top_up",
				ActionUrl:  "/emergency-fund",
			})
			surplusRemaining -= suggested
		}
	}

	// Evaluate Priority 2: Pay Extra High-Interest Debt (>12%)
	// Fetch active debts with interest rate > 12% ordered by interest_rate DESC
	type dbDebt struct {
		ID                 string
		Name               string
		InterestRate       float64
		OutstandingBalance float64
	}
	var debts []dbDebt
	rows, err := s.dbPool.Query(ctx, `
		SELECT id, name, interest_rate, COALESCE(balance, 0)
		FROM debts
		WHERE user_id = $1 AND status = 'active' AND interest_rate > 12.0 AND deleted_at IS NULL
		ORDER BY interest_rate DESC
	`, ownerID)
	if err == nil {
		for rows.Next() {
			var d dbDebt
			if scanErr := rows.Scan(&d.ID, &d.Name, &d.InterestRate, &d.OutstandingBalance); scanErr == nil {
				debts = append(debts, d)
			}
		}
		rows.Close()
	}

	for _, debt := range debts {
		if surplusRemaining <= 0 {
			break
		}
		if debt.OutstandingBalance > 0 {
			suggested := minFloat(surplusRemaining, debt.OutstandingBalance)
			advices = append(advices, dto.AdviceDto{
				Priority: 2,
				Title:    fmt.Sprintf("Bayar Ekstra Utang %s", debt.Name),
				AmountSuggested: dto.MoneyValue{
					Value:          suggested,
					FormattedValue: formatRupiah(suggested),
				},
				Reason:     fmt.Sprintf("Utang %s memiliki bunga tinggi (%.1f%%). Pembayaran ekstra akan meminimalkan beban bunga jangka panjang.", debt.Name, debt.InterestRate),
				ActionType: "pay_extra",
				ActionUrl:  fmt.Sprintf("/debts/%s", debt.ID),
			})
			surplusRemaining -= suggested
		}
	}

	// Evaluate Priority 3: Hold Cash Buffer (if forecast is tight)
	if fc.IsTight && surplusRemaining > 0 {
		suggested := surplusRemaining
		advices = append(advices, dto.AdviceDto{
			Priority: 3,
			Title:    "Tahan Kas Sebagai Buffer",
			AmountSuggested: dto.MoneyValue{
				Value:          suggested,
				FormattedValue: formatRupiah(suggested),
			},
			Reason:     "Proyeksi saldo kas Anda akan turun di bawah batas aman bulan ini. Tahan sisa dana sebagai buffer darurat jangka pendek.",
			ActionType: "hold_buffer",
			ActionUrl:  "/forecast",
		})
		surplusRemaining -= suggested
	}

	// Evaluate Priority 4: Allocate to Investment
	if surplusRemaining > 0 {
		suggested := surplusRemaining
		advices = append(advices, dto.AdviceDto{
			Priority: 4,
			Title:    "Alokasikan Ke Investasi",
			AmountSuggested: dto.MoneyValue{
				Value:          suggested,
				FormattedValue: formatRupiah(suggested),
			},
			Reason:     "Seluruh pos keuangan utama (Dana Darurat, Utang bunga tinggi, dan Forecast) dalam kondisi aman. Alokasikan sisa kas untuk investasi produktif.",
			ActionType: "invest",
			ActionUrl:  "/emergency-fund",
		})
		surplusRemaining -= suggested
	}

	return &dto.AllocationAdviceResponse{
		Surplus: dto.MoneyValue{
			Value:          surplus,
			FormattedValue: formatRupiah(surplus),
		},
		Advices: advices,
	}, nil
}

func minFloat(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}
