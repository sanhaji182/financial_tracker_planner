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

// Priority hierarchy for surplus allocation:
//  1. Emergency fund to adaptive target
//  2. High-interest debt (>12% p.a.) avalanche
//  3. Time-bound sinking-fund / near-term goals
//  4. Hold cash buffer when forecast is tight
//  5. Productive investment
var allocationHierarchy = []string{
	"emergency_fund",
	"high_interest_debt",
	"time_bound_goals",
	"cash_buffer",
	"investment",
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

	efSummary, err := s.efService.GetEFSummary(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("failed to get ef summary: %w", err)
	}

	monthStr := time.Now().Format("2006-01")
	fc, err := s.forecastService.CalculateMonthlyForecast(ctx, ownerID, monthStr)
	if err != nil {
		return nil, fmt.Errorf("failed to calculate monthly forecast: %w", err)
	}

	income := fc.EstimatedIncome.Value
	fixed := fc.EstimatedFixedExpenses.Value
	variable := fc.EstimatedVariableExpenses.Value
	buffer := 0.10 * income

	// Data sufficiency gate — refuse advice when core inputs are missing.
	var missing []string
	if income <= 0 {
		missing = append(missing, "income")
	}
	if variable <= 0 && fixed <= 0 {
		missing = append(missing, "expense_history")
	}
	ds := &dto.DataSufficiency{
		IsSufficient:       len(missing) == 0,
		MissingFields:      missing,
		UsesFallbackValues: false,
	}

	empty := &dto.AllocationAdviceResponse{
		Surplus: dto.MoneyValue{
			Value:          0,
			FormattedValue: formatRupiah(0),
		},
		Advices:         []dto.AdviceDto{},
		DataSufficiency: ds,
		Hierarchy:       allocationHierarchy,
	}
	if !ds.IsSufficient {
		return empty, nil
	}

	// Surplus = Income - Fixed - Variable - 10% buffer. Floor at 0.
	surplus := income - fixed - variable - buffer
	if surplus < 0 {
		surplus = 0
	}
	surplusRemaining := surplus
	var advices []dto.AdviceDto

	// Priority 1: Top up Emergency Fund to adaptive target.
	if efSummary.CoverageMonths < float64(efSummary.TargetMonths) {
		efNeeded := efSummary.TargetAmount.Value - efSummary.TotalEmergencyFund.Value
		if efNeeded > 0 && surplusRemaining > 0 {
			suggested := minFloat(surplusRemaining, efNeeded)
			// Cap first-month EF top-up at 50% of surplus so debt/goals still get airtime.
			suggested = minFloat(suggested, surplus*0.5)
			if suggested > 0 {
				advices = append(advices, dto.AdviceDto{
					Priority: 1,
					Title:    "Top Up Dana Darurat",
					AmountSuggested: dto.MoneyValue{
						Value:          suggested,
						FormattedValue: formatRupiah(suggested),
					},
					Reason: fmt.Sprintf(
						"Dana darurat saat ini mencakup %.1f bulan, target adaptif %d bulan. Prioritas tertinggi sebelum surplus lain.",
						efSummary.CoverageMonths, efSummary.TargetMonths,
					),
					ActionType: "top_up",
					ActionUrl:  "/emergency-fund",
				})
				surplusRemaining -= suggested
			}
		}
	}

	// Priority 2: Avalanche high-interest debt (>12%).
	type dbDebt struct {
		ID                 string
		Name               string
		InterestRate       float64
		OutstandingBalance float64
	}
	var debts []dbDebt
	rows, err := s.dbPool.Query(ctx, `
		SELECT id, name, interest_rate, COALESCE(outstanding_balance, 0)
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
		if debt.OutstandingBalance <= 0 {
			continue
		}
		// Cap per-debt extra payment at remaining surplus (full avalanche on highest rate first).
		suggested := minFloat(surplusRemaining, debt.OutstandingBalance)
		advices = append(advices, dto.AdviceDto{
			Priority: 2,
			Title:    fmt.Sprintf("Bayar Ekstra Utang %s", debt.Name),
			AmountSuggested: dto.MoneyValue{
				Value:          suggested,
				FormattedValue: formatRupiah(suggested),
			},
			Reason: fmt.Sprintf(
				"Utang %s berbunga tinggi (%.1f%% p.a.). Strategi avalanche: bayar ekstra ke bunga tertinggi dulu.",
				debt.Name, debt.InterestRate,
			),
			ActionType: "pay_extra",
			ActionUrl:  fmt.Sprintf("/debts/%s", debt.ID),
		})
		surplusRemaining -= suggested
	}

	// Priority 3: Time-bound goals / sinking funds due within 12 months.
	if surplusRemaining > 0 {
		type nearGoal struct {
			ID            string
			Name          string
			Type          string
			TargetAmount  float64
			CurrentAmount float64
			TargetDate    time.Time
			MonthsLeft    float64
		}
		var goals []nearGoal
		goalRows, gerr := s.dbPool.Query(ctx, `
			SELECT id, name, type, target_amount, current_amount, target_date
			FROM goals
			WHERE user_id = $1
			  AND status = 'active'
			  AND deleted_at IS NULL
			  AND target_date IS NOT NULL
			  AND target_date > CURRENT_DATE
			  AND target_date <= CURRENT_DATE + INTERVAL '12 months'
			ORDER BY target_date ASC
		`, ownerID)
		if gerr == nil {
			for goalRows.Next() {
				var g nearGoal
				if scanErr := goalRows.Scan(&g.ID, &g.Name, &g.Type, &g.TargetAmount, &g.CurrentAmount, &g.TargetDate); scanErr == nil {
					g.MonthsLeft = time.Until(g.TargetDate).Hours() / 24 / 30
					if g.MonthsLeft < 0.5 {
						g.MonthsLeft = 0.5
					}
					goals = append(goals, g)
				}
			}
			goalRows.Close()
		}

		// Share remaining surplus across near-term goals proportional to monthly need.
		type goalNeed struct {
			goal    nearGoal
			monthly float64
		}
		var needs []goalNeed
		var totalMonthlyNeed float64
		for _, g := range goals {
			remaining := g.TargetAmount - g.CurrentAmount
			if remaining <= 0 {
				continue
			}
			monthly := remaining / g.MonthsLeft
			needs = append(needs, goalNeed{goal: g, monthly: monthly})
			totalMonthlyNeed += monthly
		}

		for _, n := range needs {
			if surplusRemaining <= 0 {
				break
			}
			// Suggest this month's required contribution, capped by remaining surplus.
			// If multiple goals compete, weight by share of total monthly need.
			share := n.monthly
			if totalMonthlyNeed > surplusRemaining && totalMonthlyNeed > 0 {
				share = surplusRemaining * (n.monthly / totalMonthlyNeed)
			}
			suggested := minFloat(surplusRemaining, share)
			if suggested < 1 {
				continue
			}
			label := "Target"
			if n.goal.Type == "sinking_fund" {
				label = "Sinking Fund"
			}
			advices = append(advices, dto.AdviceDto{
				Priority: 3,
				Title:    fmt.Sprintf("Danai %s: %s", label, n.goal.Name),
				AmountSuggested: dto.MoneyValue{
					Value:          suggested,
					FormattedValue: formatRupiah(suggested),
				},
				Reason: fmt.Sprintf(
					"Target jatuh tempo %s (%.1f bulan lagi). Kontribusi bulanan yang dibutuhkan ~%s agar on-track.",
					n.goal.TargetDate.Format("2006-01-02"), n.goal.MonthsLeft, formatRupiah(n.monthly),
				),
				ActionType: "fund_goal",
				ActionUrl:  fmt.Sprintf("/goals/%s", n.goal.ID),
			})
			surplusRemaining -= suggested
		}
	}

	// Priority 4: Hold cash buffer when forecast is tight.
	if fc.IsTight && surplusRemaining > 0 {
		suggested := surplusRemaining
		advices = append(advices, dto.AdviceDto{
			Priority: 4,
			Title:    "Tahan Kas Sebagai Buffer",
			AmountSuggested: dto.MoneyValue{
				Value:          suggested,
				FormattedValue: formatRupiah(suggested),
			},
			Reason:     "Proyeksi saldo kas akan turun di bawah batas aman bulan ini. Tahan sisa dana sebagai buffer jangka pendek sebelum investasi.",
			ActionType: "hold_buffer",
			ActionUrl:  "/forecast",
		})
		surplusRemaining -= suggested
	}

	// Priority 5: Educational long-term allocation guidance (not product advice).
	if surplusRemaining > 0 {
		suggested := surplusRemaining
		advices = append(advices, dto.AdviceDto{
			Priority: 5,
			Title:    "Sisihkan Untuk Tujuan Jangka Panjang",
			AmountSuggested: dto.MoneyValue{
				Value:          suggested,
				FormattedValue: formatRupiah(suggested),
			},
			Reason:     "Pos utama (dana darurat, utang bunga tinggi, target jangka dekat, buffer) sudah terpenuhi. Surplus berpotensi tersedia untuk tujuan jangka panjang — tinjau opsi sendiri; ini bukan rekomendasi produk/sekuritas.",
			ActionType: "long_term_allocation",
			ActionUrl:  "/goals",
		})
	}

	return &dto.AllocationAdviceResponse{
		Surplus: dto.MoneyValue{
			Value:          surplus,
			FormattedValue: formatRupiah(surplus),
		},
		Advices:         advices,
		DataSufficiency: ds,
		Hierarchy:       allocationHierarchy,
	}, nil
}

func minFloat(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}
