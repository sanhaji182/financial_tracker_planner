package service

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/kernel"
)

type DashboardService interface {
	GetDashboardData(ctx context.Context, userID string) (*dto.DashboardResponse, error)
	InvalidateCache(ctx context.Context, userID string) error
}

type dashboardService struct {
	dbPool *pgxpool.Pool
	rdb    *redis.Client
}

func NewDashboardService(dbPool *pgxpool.Pool, rdb *redis.Client) DashboardService {
	return &dashboardService{
		dbPool: dbPool,
		rdb:    rdb,
	}
}

func (s *dashboardService) InvalidateCache(ctx context.Context, userID string) error {
	redisKey := fmt.Sprintf("dashboard:%s", userID)
	return s.rdb.Del(ctx, redisKey).Err()
}

func (s *dashboardService) GetDashboardData(ctx context.Context, userID string) (*dto.DashboardResponse, error) {
	redisKey := fmt.Sprintf("dashboard:%s", userID)

	// Try reading from cache
	cachedVal, err := s.rdb.Get(ctx, redisKey).Result()
	if err == nil {
		var cachedResp dto.DashboardResponse
		if err := json.Unmarshal([]byte(cachedVal), &cachedResp); err == nil {
			return &cachedResp, nil
		}
	}

	// 1. Calculate dates for current month, past 3 months (for living cost), and past 6 months (for trends)
	now := time.Now()
	startOfMonth := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
	endOfMonth := startOfMonth.AddDate(0, 1, 0).Add(-time.Nanosecond)

	threeMonthsAgo := startOfMonth.AddDate(0, -3, 0)

	// 2. Fetch Assets Total & Breakdown (Liquid, Invested, Property)
	// We dynamically sum current_value, syncing with linked accounts balance where applicable
	var totalAssets, liquidAssets, investedAssets, propertyAssets float64
	assetQuery := `
		SELECT
			COALESCE(SUM(
				CASE
					WHEN a.linked_account_id IS NOT NULL THEN ac.balance * COALESCE(curr_ac.exchange_rate_to_idr, 1.0)
					ELSE a.current_value * COALESCE(curr_a.exchange_rate_to_idr, 1.0)
				END
			), 0) AS total,
			COALESCE(SUM(
				CASE
					WHEN (a.type IN ('savings', 'cash', 'e_wallet') OR a.is_liquid = true) THEN
						CASE
							WHEN a.linked_account_id IS NOT NULL THEN ac.balance * COALESCE(curr_ac.exchange_rate_to_idr, 1.0)
							ELSE a.current_value * COALESCE(curr_a.exchange_rate_to_idr, 1.0)
						END
					ELSE 0
				END
			), 0) AS liquid,
			COALESCE(SUM(
				CASE
					WHEN a.type IN ('investment', 'deposit') THEN
						CASE
							WHEN a.linked_account_id IS NOT NULL THEN ac.balance * COALESCE(curr_ac.exchange_rate_to_idr, 1.0)
							ELSE a.current_value * COALESCE(curr_a.exchange_rate_to_idr, 1.0)
						END
					ELSE 0
				END
			), 0) AS invested,
			COALESCE(SUM(
				CASE
					WHEN a.type IN ('property', 'vehicle', 'other') AND a.is_liquid = false THEN
						CASE
							WHEN a.linked_account_id IS NOT NULL THEN ac.balance * COALESCE(curr_ac.exchange_rate_to_idr, 1.0)
							ELSE a.current_value * COALESCE(curr_a.exchange_rate_to_idr, 1.0)
						END
					ELSE 0
				END
			), 0) AS property
		FROM assets a
		LEFT JOIN accounts ac ON a.linked_account_id = ac.id
		LEFT JOIN currencies curr_ac ON ac.currency = curr_ac.code
		LEFT JOIN currencies curr_a ON a.currency = curr_a.code
		WHERE a.user_id = $1 AND a.deleted_at IS NULL
	`
	err = s.dbPool.QueryRow(ctx, assetQuery, userID).Scan(&totalAssets, &liquidAssets, &investedAssets, &propertyAssets)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch assets: %w", err)
	}

	// 3. Fetch Active Debts Total Outstanding & Counts
	var totalDebts float64
	var activeDebtsCount int
	var totalMinDebtPayments float64
	var maxDebtInterestRate float64
	var maxDebtName string

	debtQuery := `
		SELECT
			COALESCE(SUM(d.outstanding_balance * COALESCE(curr.exchange_rate_to_idr, 1.0)), 0),
			COUNT(*),
			COALESCE(SUM(d.minimum_payment * COALESCE(curr.exchange_rate_to_idr, 1.0)), 0),
			COALESCE(MAX(d.interest_rate), 0)
		FROM debts d
		LEFT JOIN currencies curr ON d.currency = curr.code
		WHERE d.user_id = $1 AND d.status = 'active' AND d.deleted_at IS NULL
	`
	err = s.dbPool.QueryRow(ctx, debtQuery, userID).Scan(&totalDebts, &activeDebtsCount, &totalMinDebtPayments, &maxDebtInterestRate)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch debts: %w", err)
	}

	if maxDebtInterestRate > 0 {
		_ = s.dbPool.QueryRow(ctx, `
			SELECT name FROM debts
			WHERE user_id = $1 AND status = 'active' AND interest_rate = $2 AND deleted_at IS NULL
			LIMIT 1
		`, userID, maxDebtInterestRate).Scan(&maxDebtName)
	}

	// 4. Fetch Cash Available (accounts table bank, e_wallet, cash)
	var cashAvailable float64
	cashQuery := `
		SELECT COALESCE(SUM(a.balance * COALESCE(curr.exchange_rate_to_idr, 1.0)), 0)
		FROM accounts a
		LEFT JOIN currencies curr ON a.currency = curr.code
		WHERE a.user_id = $1 AND a.type IN ('bank', 'e_wallet', 'cash') AND a.is_active = true AND a.deleted_at IS NULL
	`
	err = s.dbPool.QueryRow(ctx, cashQuery, userID).Scan(&cashAvailable)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch cash available: %w", err)
	}

	// 5. Fetch Income & Expenses for Current Month
	var incomeThisMonth, expenseThisMonth float64
	txQuery := `
		SELECT
			COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount * COALESCE(curr.exchange_rate_to_idr, 1.0) ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount * COALESCE(curr.exchange_rate_to_idr, 1.0) ELSE 0 END), 0)
		FROM transactions t
		LEFT JOIN currencies curr ON t.currency = curr.code
		WHERE t.user_id = $1 AND t.date >= $2 AND t.date <= $3 AND t.status = 'confirmed' AND t.deleted_at IS NULL
	`
	err = s.dbPool.QueryRow(ctx, txQuery, userID, startOfMonth, endOfMonth).Scan(&incomeThisMonth, &expenseThisMonth)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch current month cashflow: %w", err)
	}

	// 6. Calculate Average Monthly Living Cost (past 3 months of expenses)
	var totalExpensesLast3Months float64
	err = s.dbPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(t.amount * COALESCE(curr.exchange_rate_to_idr, 1.0)), 0)
		FROM transactions t
		LEFT JOIN currencies curr ON t.currency = curr.code
		WHERE t.user_id = $1 AND t.type = 'expense' AND t.date >= $2 AND t.date < $3 AND t.status = 'confirmed' AND t.deleted_at IS NULL
	`, userID, threeMonthsAgo, startOfMonth).Scan(&totalExpensesLast3Months)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch past expenses: %w", err)
	}

	monthlyLivingCost := totalExpensesLast3Months / 3.0

	// 7. Calculate Emergency Fund Total
	var efTotal float64
	err = s.dbPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(a.balance * COALESCE(curr.exchange_rate_to_idr, 1.0)), 0)
		FROM accounts a
		LEFT JOIN currencies curr ON a.currency = curr.code
		WHERE a.user_id = $1 AND a.is_emergency_fund = true AND a.is_active = true AND a.deleted_at IS NULL
	`, userID).Scan(&efTotal)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch emergency fund: %w", err)
	}

	// 8. Calculations: DTI, EF Coverage, Health Score components
	var dtiRatio float64
	if incomeThisMonth > 0 {
		dtiRatio = (totalMinDebtPayments / incomeThisMonth) * 100
	}

	var dtiStatus string
	if dtiRatio < 20 {
		dtiStatus = "healthy"
	} else if dtiRatio <= 50 {
		dtiStatus = "warning"
	} else {
		dtiStatus = "danger"
	}

	// DTI Score (Weight 30%)
	dtiScore := 0.0
	if dtiRatio < 20 {
		dtiScore = 100
	} else if dtiRatio <= 60 {
		dtiScore = 100 - (dtiRatio-20)*(100.0/40.0)
	}

	// EF Score (Weight 30%) — use adaptive target from kernel ef-v1, not hard-coded 6.
	// Income stability lookback for adaptive months (same window as EF service).
	var minIncome, maxIncome float64
	_ = s.dbPool.QueryRow(ctx, `SELECT COALESCE(MIN(monthly),0), COALESCE(MAX(monthly),0) FROM (
		SELECT SUM(t.amount * COALESCE(curr.exchange_rate_to_idr,t.exchange_rate,1)) monthly
		FROM transactions t LEFT JOIN currencies curr ON curr.code=t.currency
		WHERE t.user_id=$1 AND t.type='income' AND t.status='confirmed' AND t.date >= $2 AND t.date < $3 AND t.deleted_at IS NULL
		GROUP BY DATE_TRUNC('month',t.date)) x`, userID, threeMonthsAgo, startOfMonth).Scan(&minIncome, &maxIncome)

	var configuredTargetMonths int
	var livingCostOverride float64
	_ = s.dbPool.QueryRow(ctx, `
		SELECT COALESCE(target_months, 6), COALESCE(monthly_living_cost_override, 0)
		FROM emergency_fund_configs WHERE user_id = $1
	`, userID).Scan(&configuredTargetMonths, &livingCostOverride)
	if configuredTargetMonths <= 0 {
		configuredTargetMonths = kernel.EFDefaultTargetMonths
	}
	efLivingCost := monthlyLivingCost
	if livingCostOverride > 0 {
		efLivingCost = livingCostOverride
	}
	efRes := kernel.ComputeEF(kernel.EFInputs{
		AsOf:                   now,
		EFBalance:              efTotal,
		MonthlyLivingCost:      efLivingCost,
		ConfiguredTargetMonths: configuredTargetMonths,
		UseAdaptive:            livingCostOverride <= 0,
		MinMonthlyIncome:       minIncome,
		MaxMonthlyIncome:       maxIncome,
	})
	efCoverageMonths := efRes.CoverageMonths
	efTargetMonths := float64(efRes.TargetMonths)
	if efTargetMonths <= 0 {
		efTargetMonths = float64(kernel.EFDefaultTargetMonths)
	}
	efScore := math.Min(100, (efCoverageMonths/efTargetMonths)*100)

	// Cash Score (Weight 20%)
	cashScore := 0.0
	if monthlyLivingCost > 0 {
		cashScore = math.Min(100, (cashAvailable/monthlyLivingCost)*50.0)
	}

	// Savings Rate Score (Weight 20%)
	savingsThisMonth := incomeThisMonth - expenseThisMonth
	if savingsThisMonth < 0 {
		savingsThisMonth = 0
	}
	savingsRateScore := 0.0
	if incomeThisMonth > 0 {
		savingsRateScore = math.Min(100, (savingsThisMonth/incomeThisMonth)*200)
	}

	// Reconciliation confidence (last 90 days).
	// Unreconciled books lower the final health grade so users can't look "Excellent"
	// while half their ledger is unconfirmed against bank statements.
	var totalTx90, reconciledTx90 float64
	_ = s.dbPool.QueryRow(ctx, `
		SELECT
			COUNT(*)::float,
			COUNT(*) FILTER (WHERE reconciled = true)::float
		FROM transactions
		WHERE user_id = $1
		  AND status = 'confirmed'
		  AND deleted_at IS NULL
		  AND date >= CURRENT_DATE - INTERVAL '90 days'
	`, userID).Scan(&totalTx90, &reconciledTx90)

	reconciliationRate := 1.0
	if totalTx90 > 0 {
		reconciliationRate = reconciledTx90 / totalTx90
	}
	// Confidence multiplies raw score. Floor at 0.70 so sparse books don't nuke the grade.
	// Fully reconciled → 1.0; 0% reconciled → 0.70.
	reconciliationConfidence := 0.70 + 0.30*reconciliationRate

	rawHealth := (0.3 * dtiScore) + (0.3 * efScore) + (0.2 * cashScore) + (0.2 * savingsRateScore)
	healthScoreVal := int(math.Round(rawHealth * reconciliationConfidence))
	if healthScoreVal > 100 {
		healthScoreVal = 100
	}
	var healthRating, healthColor string
	if healthScoreVal >= 80 {
		healthRating = "Excellent"
		healthColor = "Green"
	} else if healthScoreVal >= 60 {
		healthRating = "Good"
		healthColor = "Green"
	} else if healthScoreVal >= 40 {
		healthRating = "Fair"
		healthColor = "Yellow"
	} else if healthScoreVal >= 20 {
		healthRating = "Poor"
		healthColor = "Orange"
	} else {
		healthRating = "Critical"
		healthColor = "Red"
	}

	// 9. Forecast & Safe to Spend — shared calculation kernel.
	daysInMonth := time.Date(now.Year(), now.Month()+1, 0, 0, 0, 0, 0, now.Location()).Day()
	daysRemaining := daysInMonth - now.Day()
	if daysRemaining < 0 {
		daysRemaining = 0
	}
	cf := kernel.ComputeCashflow(kernel.CashflowInputs{
		AsOf:                      now,
		CashAvailable:             cashAvailable,
		IncomeMTD:                 incomeThisMonth,
		ExpenseMTD:                expenseThisMonth,
		EstimatedIncome:           incomeThisMonth, // dashboard has MTD only; treat as current-month signal
		EstimatedFixedExpenses:    totalMinDebtPayments,
		EstimatedVariableExpenses: monthlyLivingCost,
		MonthlyLivingCost:         monthlyLivingCost,
		MinDebtPayments:           totalMinDebtPayments,
		IsCurrentMonth:            true,
		DaysRemaining:             daysRemaining,
		DaysInMonth:               daysInMonth,
	})
	conservativeSTS := cf.SafeToSpendScenarios.Conservative
	expectedSTS := cf.SafeToSpendScenarios.Expected
	optimisticSTS := cf.SafeToSpendScenarios.Optimistic
	safeToSpend := cf.SafeToSpend
	forecastEndMonth := cf.ProjectedEndBalance
	if forecastEndMonth < 0 {
		forecastEndMonth = 0
	}
	dataSufficient := cf.DataQuality.IsSufficient

	// 10. Next Action Advice Rule Engine
	var nextAction dto.NextActionDto
	if !dataSufficient {
		nextAction = dto.NextActionDto{Title: "Lengkapi Data Keuangan", Description: "Belum cukup histori pendapatan dan pengeluaran untuk memberi rekomendasi yang aman.", ActionLabel: "Catat Transaksi", ActionUrl: "/transactions", Priority: 0}
	} else if efCoverageMonths < efTargetMonths {
		needed := (efTargetMonths * monthlyLivingCost) - efTotal
		if needed < 0 {
			needed = 0
		}
		nextAction = dto.NextActionDto{
			Title:       "Top Up Dana Darurat",
			Description: fmt.Sprintf("Dana darurat Anda saat ini baru mencakup %.1f bulan pengeluaran hidup. Segera top up Rp %s lagi untuk mencapai target aman %.0f bulan (%s).", efCoverageMonths, formatNumber(needed), efTargetMonths, efRes.TargetRationale),
			ActionLabel: "Top Up Sekarang",
			ActionUrl:   "/accounts",
			Priority:    1,
		}
	} else if maxDebtInterestRate > 12.0 {
		nextAction = dto.NextActionDto{
			Title:       "Bayar Ekstra Utang",
			Description: fmt.Sprintf("Kontrak utang '%s' memiliki tingkat bunga tinggi (%.1f%% p.a.). Prioritaskan pembayaran ekstra guna menghemat biaya bunga menggunakan strategi Avalanche.", maxDebtName, maxDebtInterestRate),
			ActionLabel: "Simulasi Avalanche",
			ActionUrl:   "/debts/avalanche",
			Priority:    2,
		}
	} else if forecastEndMonth < monthlyLivingCost {
		nextAction = dto.NextActionDto{
			Title:       "Tahan Kas (Buffer)",
			Description: "Estimasi saldo akhir bulan Anda cukup tipis. Batasi pengeluaran non-primer agar likuiditas kas tetap aman.",
			ActionLabel: "Catat Pengeluaran",
			ActionUrl:   "/transactions",
			Priority:    3,
		}
	} else {
		surplus := cf.Surplus
		nextAction = dto.NextActionDto{
			Title: "Tinjau Alokasi Surplus",
			Description: fmt.Sprintf(
				"Estimasi surplus ~Rp %s tersedia setelah kewajiban. Tinjau opsi: tambah buffer kas, percepat target, atau sisihkan untuk tujuan jangka panjang. Bukan rekomendasi produk investasi.",
				formatNumber(surplus),
			),
			ActionLabel: "Lihat Opsi Alokasi",
			ActionUrl:   "/allocation",
			Priority:    4,
		}
	}

	// 11. Net Worth Trend (Past 6 Months)
	netWorthTrend := []dto.TrendPoint{}
	for i := 5; i >= 0; i-- {
		t := startOfMonth.AddDate(0, -i, 0)
		monthEnd := t.AddDate(0, 1, 0).Add(-time.Nanosecond)

		// 11a. Fetch total asset values up to that month end
		var assetsAtMonth float64
		assetTrendQuery := `
			SELECT COALESCE(SUM(
				CASE
					WHEN a.linked_account_id IS NOT NULL THEN ac.balance * COALESCE(curr_ac.exchange_rate_to_idr, 1.0)
					ELSE COALESCE((SELECT value FROM asset_valuations WHERE asset_id = a.id AND valuation_date <= $2 ORDER BY valuation_date DESC, created_at DESC LIMIT 1), a.current_value) * COALESCE(curr_a.exchange_rate_to_idr, 1.0)
				END
			), 0)
			FROM assets a
			LEFT JOIN accounts ac ON a.linked_account_id = ac.id
			LEFT JOIN currencies curr_ac ON ac.currency = curr_ac.code
			LEFT JOIN currencies curr_a ON a.currency = curr_a.code
			WHERE a.user_id = $1 AND a.created_at <= $2 AND (a.deleted_at IS NULL OR a.deleted_at > $2)
		`
		_ = s.dbPool.QueryRow(ctx, assetTrendQuery, userID, monthEnd).Scan(&assetsAtMonth)

		// 11b. Account cash balances rolling back transactions occurred after that month end
		var currentAccountsTotal float64
		_ = s.dbPool.QueryRow(ctx, `
			SELECT COALESCE(SUM(a.balance * COALESCE(curr.exchange_rate_to_idr, 1.0)), 0)
			FROM accounts a
			LEFT JOIN currencies curr ON a.currency = curr.code
			WHERE a.user_id = $1 AND a.created_at <= $2 AND (a.deleted_at IS NULL OR a.deleted_at > $2)
			  AND NOT EXISTS (SELECT 1 FROM assets linked WHERE linked.linked_account_id = a.id AND linked.deleted_at IS NULL)
		`, userID, monthEnd).Scan(&currentAccountsTotal)

		var netTxAfterMonth float64
		_ = s.dbPool.QueryRow(ctx, `
			SELECT COALESCE(SUM(
				(CASE WHEN t.type = 'income' THEN -t.amount ELSE t.amount END) * COALESCE(curr.exchange_rate_to_idr, 1.0)
			), 0)
			FROM transactions t
			LEFT JOIN accounts ac ON t.account_id = ac.id
			LEFT JOIN currencies curr ON ac.currency = curr.code
			WHERE t.user_id = $1 AND t.date > $2 AND t.status = 'confirmed' AND t.deleted_at IS NULL
		`, userID, monthEnd).Scan(&netTxAfterMonth)

		accountsAtMonth := currentAccountsTotal + netTxAfterMonth

		// 11c. Debts rolling back payments occurred after that month end
		var currentDebtsTotal float64
		_ = s.dbPool.QueryRow(ctx, `
			SELECT COALESCE(SUM(d.outstanding_balance * COALESCE(curr.exchange_rate_to_idr, 1.0)), 0)
			FROM debts d
			LEFT JOIN currencies curr ON d.currency = curr.code
			WHERE d.user_id = $1 AND d.created_at <= $2 AND (d.deleted_at IS NULL OR d.deleted_at > $2)
		`, userID, monthEnd).Scan(&currentDebtsTotal)

		var paymentsAfterMonth float64
		_ = s.dbPool.QueryRow(ctx, `
			SELECT COALESCE(SUM(dp.amount * COALESCE(curr.exchange_rate_to_idr, 1.0)), 0)
			FROM debt_payments dp
			JOIN debts d ON dp.debt_id = d.id
			LEFT JOIN currencies curr ON d.currency = curr.code
			WHERE d.user_id = $1 AND dp.payment_date > $2
		`, userID, monthEnd).Scan(&paymentsAfterMonth)

		debtsAtMonth := currentDebtsTotal + paymentsAfterMonth

		netWorthAtMonth := assetsAtMonth + accountsAtMonth - debtsAtMonth
		netWorthTrend = append(netWorthTrend, dto.TrendPoint{
			Month: t.Format("Jan"),
			Value: netWorthAtMonth,
		})
	}

	// 12. Fetch Real Bills for Beautiful Visual Presentation (Fase 1.6 & 2.1 Dashboard Requirement)
	var dbBills []dto.UpcomingBillDto
	rows, err := s.dbPool.Query(ctx, `
		SELECT id, name, amount, next_due_date
		FROM bills
		WHERE user_id = $1 AND deleted_at IS NULL AND status IN ('unpaid', 'overdue')
		  AND next_due_date >= CURRENT_DATE AND next_due_date <= CURRENT_DATE + 7 * INTERVAL '1 day'
		ORDER BY next_due_date ASC, name ASC
	`, userID)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var b dto.UpcomingBillDto
			var nextDue time.Time
			if errScan := rows.Scan(&b.ID, &b.Name, &b.Amount, &nextDue); errScan == nil {
				b.FormattedAmount = formatRupiah(b.Amount)
				b.DueDate = nextDue
				days := int(nextDue.Sub(time.Now().Truncate(24*time.Hour)).Hours() / 24)
				if days < 0 {
					days = 0
				}
				b.DaysRemaining = days
				dbBills = append(dbBills, b)
			}
		}
	}

	// 13. Fetch Real Alerts from database (top 5 most important, not dismissed)
	recentAlerts := make([]dto.AlertDto, 0)
	alertRows, err := s.dbPool.Query(ctx, `
		SELECT id, title, severity, message, created_at
		FROM alerts
		WHERE user_id = $1 AND is_dismissed = false
		ORDER BY CASE severity WHEN 'danger' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END, created_at DESC
		LIMIT 5
	`, userID)
	if err == nil {
		defer alertRows.Close()
		for alertRows.Next() {
			var a dto.AlertDto
			if errScan := alertRows.Scan(&a.ID, &a.Title, &a.Severity, &a.Message, &a.CreatedAt); errScan == nil {
				recentAlerts = append(recentAlerts, a)
			}
		}
	}

	// 14. Insight Summary
	insightSummary := "Arus kas bersih keluarga Anda bulan ini positif. "
	if savingsThisMonth > 0 {
		insightSummary += fmt.Sprintf("Anda telah menyisihkan surplus sebesar Rp %s (%d%% dari income) bulan ini.", formatNumber(savingsThisMonth), int(savingsThisMonth/incomeThisMonth*100))
	} else {
		insightSummary += "Pengeluaran Anda bulan ini sama atau lebih besar dari pendapatan. Batasi pengeluaran non-primer."
	}

	// Canonical net worth includes independently valued assets plus account
	// balances, less liabilities. Assets linked to an account already source their
	// value from that account, so exclude the linked account from the second sum.
	var netWorthAccounts float64
	err = s.dbPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(ac.balance * COALESCE(curr.exchange_rate_to_idr, 1.0)), 0)
		FROM accounts ac
		LEFT JOIN currencies curr ON ac.currency = curr.code
		WHERE ac.user_id = $1 AND ac.is_active = true AND ac.deleted_at IS NULL
		  AND NOT EXISTS (
			SELECT 1 FROM assets a
			WHERE a.linked_account_id = ac.id AND a.deleted_at IS NULL
		  )
	`, userID).Scan(&netWorthAccounts)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch net-worth accounts: %w", err)
	}
	netWorth := totalAssets + netWorthAccounts - totalDebts

	resp := dto.DashboardResponse{
		NetWorth: dto.MoneyValue{
			Value:          netWorth,
			FormattedValue: formatRupiah(netWorth),
		},
		TotalAssets: dto.AssetBreakdown{
			Total:             totalAssets,
			FormattedTotal:    formatRupiah(totalAssets),
			Liquid:            liquidAssets,
			FormattedLiquid:   formatRupiah(liquidAssets),
			Invested:          investedAssets,
			FormattedInvested: formatRupiah(investedAssets),
			Property:          propertyAssets,
			FormattedProperty: formatRupiah(propertyAssets),
		},
		TotalDebts: dto.DebtSummaryDto{
			TotalOutstanding:          totalDebts,
			FormattedTotalOutstanding: formatRupiah(totalDebts),
			ActiveCount:               activeDebtsCount,
		},
		CashAvailable: dto.MoneyValue{
			Value:          cashAvailable,
			FormattedValue: formatRupiah(cashAvailable),
		},
		DTIRatio:  dtiRatio,
		DTIStatus: dtiStatus,
		HealthScore: dto.HealthScoreDto{
			Score:                    healthScoreVal,
			Rating:                   healthRating,
			StatusColor:              healthColor,
			ReconciliationRate:       reconciliationRate,
			ReconciliationConfidence: reconciliationConfidence,
		},
		UpcomingBills: dbBills,
		ForecastEndMonth: dto.MoneyValue{
			Value:          forecastEndMonth,
			FormattedValue: formatRupiah(forecastEndMonth),
		},
		SafeToSpend: dto.MoneyValue{
			Value:          safeToSpend,
			FormattedValue: formatRupiah(safeToSpend),
		},
		SafeToSpendScenarios: dto.SafeToSpendScenarios{
			Conservative: dto.MoneyValue{Value: conservativeSTS, FormattedValue: formatRupiah(conservativeSTS)},
			Expected:     dto.MoneyValue{Value: expectedSTS, FormattedValue: formatRupiah(expectedSTS)},
			Optimistic:   dto.MoneyValue{Value: optimisticSTS, FormattedValue: formatRupiah(optimisticSTS)},
		},
		DataSufficiency: &dto.DataSufficiency{
			IsSufficient:       cf.DataQuality.IsSufficient,
			MissingFields:      cf.DataQuality.MissingFields,
			UsesFallbackValues: cf.DataQuality.UsesFallbackValues,
			Confidence:         cf.DataQuality.Confidence,
		},
		RecentAlerts:   recentAlerts,
		InsightSummary: insightSummary,
		NextAction:     nextAction,
		NetWorthTrend:  netWorthTrend,
		AsOf:           cf.AsOf.Format(time.RFC3339),
		FormulaVersion: cf.FormulaVersion,
		Assumptions:    cf.Assumptions,
	}

	// Cache to Redis with 5 minutes TTL
	respBytes, err := json.Marshal(resp)
	if err == nil {
		_ = s.rdb.Set(ctx, redisKey, string(respBytes), 5*time.Minute).Err()
	}

	return &resp, nil
}

// Helpers
func formatRupiah(val float64) string {
	isNeg := val < 0
	if isNeg {
		val = -val
	}
	parts := formatNumber(val)
	if isNeg {
		return "Rp -" + parts
	}
	return "Rp " + parts
}

func formatNumber(val float64) string {
	v := int64(val)
	var result string
	for v >= 1000 {
		result = fmt.Sprintf(".%03d%s", v%1000, result)
		v /= 1000
	}
	result = fmt.Sprintf("%d%s", v, result)
	return result
}
