package service

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/kernel"
)

type ForecastService interface {
	CalculateMonthlyForecast(ctx context.Context, userID string, month string) (*dto.ForecastResponse, error)
	GetDailyProjections(ctx context.Context, userID string, month string) ([]dto.DailyProjectionDto, error)
}

type forecastService struct {
	dbPool *pgxpool.Pool
	rdb    *redis.Client
}

func NewForecastService(dbPool *pgxpool.Pool, rdb *redis.Client) ForecastService {
	return &forecastService{
		dbPool: dbPool,
		rdb:    rdb,
	}
}

func (s *forecastService) resolveOwnerID(ctx context.Context, userID string) (string, error) {
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

func (s *forecastService) CalculateMonthlyForecast(ctx context.Context, userID string, month string) (*dto.ForecastResponse, error) {
	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	// 1. Try fetching from Redis Cache first
	redisKey := fmt.Sprintf("forecast:%s:%s", ownerID, month)
	cached, err := s.rdb.Get(ctx, redisKey).Result()
	if err == nil {
		var res dto.ForecastResponse
		if jsonErr := json.Unmarshal([]byte(cached), &res); jsonErr == nil {
			return &res, nil
		}
	}

	// Parse month
	targetYearMonth, err := time.Parse("2006-01", month)
	if err != nil {
		return nil, fmt.Errorf("invalid month format (use YYYY-MM): %w", err)
	}

	// 2. Fetch Starting Cash Available
	now := time.Now()
	isCurrentMonth := targetYearMonth.Year() == now.Year() && targetYearMonth.Month() == now.Month()

	var startingCash float64
	if isCurrentMonth {
		// Current month: use actual account balance (as-of liquid cash).
		err = s.dbPool.QueryRow(ctx, `
			SELECT COALESCE(SUM(a.balance * COALESCE(c.exchange_rate_to_idr,1)), 0)
			FROM accounts a LEFT JOIN currencies c ON c.code=a.currency
			WHERE a.user_id = $1 AND a.type IN ('bank', 'e_wallet', 'cash') AND a.is_active = true AND a.deleted_at IS NULL
		`, ownerID).Scan(&startingCash)
		if err != nil {
			return nil, fmt.Errorf("failed to get starting balance: %w", err)
		}
	} else {
		// Future month: use projected end balance from the previous month's forecast
		prevMonth := targetYearMonth.AddDate(0, -1, 0).Format("2006-01")
		err = s.dbPool.QueryRow(ctx, `
			SELECT projected_end_balance FROM forecasts
			WHERE user_id = $1 AND month = $2
		`, ownerID, prevMonth).Scan(&startingCash)
		if err != nil {
			// No previous forecast exists — fall back to actual account balance (FX-aware)
			err = s.dbPool.QueryRow(ctx, `
				SELECT COALESCE(SUM(a.balance * COALESCE(c.exchange_rate_to_idr,1)), 0)
				FROM accounts a LEFT JOIN currencies c ON c.code=a.currency
				WHERE a.user_id = $1 AND a.type IN ('bank', 'e_wallet', 'cash') AND a.is_active = true AND a.deleted_at IS NULL
			`, ownerID).Scan(&startingCash)
			if err != nil {
				return nil, fmt.Errorf("failed to get starting balance: %w", err)
			}
		}
	}

	// 3. Query average income of last 3 completed months
	startOfCurrentMonth := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
	threeMonthsAgo := startOfCurrentMonth.AddDate(0, -3, 0)

	var totalIncomeLast3Months float64
	_ = s.dbPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(t.amount * COALESCE(c.exchange_rate_to_idr,t.exchange_rate,1)), 0)
		FROM transactions t LEFT JOIN currencies c ON c.code=t.currency
		WHERE t.user_id = $1 AND t.type = 'income' AND t.status = 'confirmed' AND t.date >= $2 AND t.date < $3 AND t.deleted_at IS NULL
	`, ownerID, threeMonthsAgo, startOfCurrentMonth).Scan(&totalIncomeLast3Months)

	estimatedIncome := totalIncomeLast3Months / 3.0
	incomeInsufficient := estimatedIncome <= 0

	// 3b. Income MTD in target month (current-month only) — avoids double-count.
	var incomeMTD float64
	if isCurrentMonth {
		monthStart := time.Date(targetYearMonth.Year(), targetYearMonth.Month(), 1, 0, 0, 0, 0, now.Location())
		// Up to now (as-of); transactions dated after today are not posted yet.
		_ = s.dbPool.QueryRow(ctx, `
			SELECT COALESCE(SUM(t.amount * COALESCE(c.exchange_rate_to_idr,t.exchange_rate,1)), 0)
			FROM transactions t LEFT JOIN currencies c ON c.code=t.currency
			WHERE t.user_id = $1 AND t.type = 'income' AND t.status = 'confirmed'
			  AND t.date >= $2 AND t.date < $3 AND t.deleted_at IS NULL
		`, ownerID, monthStart, now).Scan(&incomeMTD)
	}

	// 4. Query average variable expenses of last 3 months
	var totalVariableExpensesLast3Months float64
	_ = s.dbPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount), 0)
		FROM transactions
		WHERE user_id = $1 AND type = 'expense' AND status = 'confirmed'
		  AND notes NOT LIKE 'Pembayaran Cicilan:%' AND notes NOT LIKE 'Pembayaran Tagihan:%'
		  AND date >= $2 AND date < $3 AND deleted_at IS NULL
	`, ownerID, threeMonthsAgo, startOfCurrentMonth).Scan(&totalVariableExpensesLast3Months)

	estimatedVariableExpenses := totalVariableExpensesLast3Months / 3.0
	variableInsufficient := estimatedVariableExpenses <= 0

	// 5. Query average living cost of last 3 months (excluding extra debt payoffs)
	var totalLivingCostLast3Months float64
	_ = s.dbPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount), 0)
		FROM transactions
		WHERE user_id = $1 AND type = 'expense' AND status = 'confirmed'
		  AND notes NOT LIKE 'Pembayaran Cicilan:% (Ekstra)%'
		  AND date >= $2 AND date < $3 AND deleted_at IS NULL
	`, ownerID, threeMonthsAgo, startOfCurrentMonth).Scan(&totalLivingCostLast3Months)

	monthlyLivingCostThreshold := totalLivingCostLast3Months / 3.0
	livingCostInsufficient := monthlyLivingCostThreshold <= 0

	// 5b. Expense MTD (current month) for kernel data quality.
	var expenseMTD float64
	if isCurrentMonth {
		monthStart := time.Date(targetYearMonth.Year(), targetYearMonth.Month(), 1, 0, 0, 0, 0, now.Location())
		_ = s.dbPool.QueryRow(ctx, `
			SELECT COALESCE(SUM(t.amount * COALESCE(c.exchange_rate_to_idr,t.exchange_rate,1)), 0)
			FROM transactions t LEFT JOIN currencies c ON c.code=t.currency
			WHERE t.user_id = $1 AND t.type = 'expense' AND t.status = 'confirmed'
			  AND t.date >= $2 AND t.date < $3 AND t.deleted_at IS NULL
		`, ownerID, monthStart, now).Scan(&expenseMTD)
	}

	// 6. Query expected income day (day of month of latest income)
	var expectedIncomeDay int = 25
	_ = s.dbPool.QueryRow(ctx, `
		SELECT EXTRACT(DAY FROM date)::integer
		FROM transactions
		WHERE user_id = $1 AND type = 'income' AND status = 'confirmed' AND deleted_at IS NULL
		ORDER BY date DESC LIMIT 1
	`, ownerID).Scan(&expectedIncomeDay)
	if expectedIncomeDay < 1 || expectedIncomeDay > 31 {
		expectedIncomeDay = 25
	}

	// 7. Fixed expenses for summary cards: unpaid bills due this month + active debt mins.
	// Bills already paid are excluded so fixed expense = remaining commitment, not full-month estimate.
	var billsSum float64
	_ = s.dbPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount), 0)
		FROM bills
		WHERE user_id = $1 AND deleted_at IS NULL AND is_active = true
		  AND status IN ('unpaid', 'overdue')
		  AND TO_CHAR(next_due_date, 'YYYY-MM') = $2
	`, ownerID, month).Scan(&billsSum)

	// Debt mins still due this month: exclude debts that already received a non-extra payment in target month.
	var debtsMinPaymentSum float64
	if isCurrentMonth {
		monthStart := time.Date(targetYearMonth.Year(), targetYearMonth.Month(), 1, 0, 0, 0, 0, now.Location())
		nextMonthStart := monthStart.AddDate(0, 1, 0)
		_ = s.dbPool.QueryRow(ctx, `
			SELECT COALESCE(SUM(d.minimum_payment), 0)
			FROM debts d
			WHERE d.user_id = $1 AND d.status = 'active' AND d.deleted_at IS NULL
			  AND NOT EXISTS (
			    SELECT 1 FROM debt_payments dp
			    WHERE dp.debt_id = d.id
			      AND dp.payment_date >= $2 AND dp.payment_date < $3
			      AND COALESCE(dp.is_extra_payment, false) = false
			  )
		`, ownerID, monthStart, nextMonthStart).Scan(&debtsMinPaymentSum)
	} else {
		_ = s.dbPool.QueryRow(ctx, `
			SELECT COALESCE(SUM(minimum_payment), 0)
			FROM debts
			WHERE user_id = $1 AND status = 'active' AND deleted_at IS NULL
		`, ownerID).Scan(&debtsMinPaymentSum)
	}

	estimatedFixedExpenses := billsSum + debtsMinPaymentSum

	// 8. Build discrete ladder events (future only for current month).
	daysInMonth := time.Date(targetYearMonth.Year(), targetYearMonth.Month()+1, 0, 0, 0, 0, 0, targetYearMonth.Location()).Day()
	asOfDay := 1
	if isCurrentMonth {
		asOfDay = now.Day()
		if asOfDay < 1 {
			asOfDay = 1
		}
		if asOfDay > daysInMonth {
			asOfDay = daysInMonth
		}
	}

	var ladderEvents []kernel.LadderEvent

	// Remaining income = max(0, estimate − MTD). Never re-add income already in cash.
	remainingIncome := estimatedIncome
	if isCurrentMonth {
		remainingIncome = estimatedIncome - incomeMTD
		if remainingIncome < 0 {
			remainingIncome = 0
		}
		if estimatedIncome <= 0 {
			remainingIncome = 0
		}
	}
	if remainingIncome > 0 {
		incomeDay := expectedIncomeDay
		if incomeDay > daysInMonth {
			incomeDay = daysInMonth
		}
		// If payday already passed in current month, place remaining on as-of day
		// (late/partial receipt still expected, not re-sim of past cash).
		if isCurrentMonth && incomeDay < asOfDay {
			incomeDay = asOfDay
		}
		ladderEvents = append(ladderEvents, kernel.LadderEvent{
			Day:    incomeDay,
			Name:   "Gaji Masuk (Est.)",
			Amount: remainingIncome,
			Kind:   "income",
		})
	}

	// Unpaid bills due in this target month (status filter = not yet paid).
	type dbBill struct {
		Name   string
		Amount float64
		Day    int
	}
	rows, err := s.dbPool.Query(ctx, `
		SELECT name, amount, EXTRACT(DAY FROM next_due_date)::integer
		FROM bills
		WHERE user_id = $1 AND deleted_at IS NULL AND is_active = true AND status IN ('unpaid', 'overdue')
		  AND TO_CHAR(next_due_date, 'YYYY-MM') = $2
	`, ownerID, month)
	var billsList []dbBill
	if err == nil {
		for rows.Next() {
			var b dbBill
			if scanErr := rows.Scan(&b.Name, &b.Amount, &b.Day); scanErr == nil {
				billsList = append(billsList, b)
			}
		}
		rows.Close()
	}
	for _, b := range billsList {
		day := b.Day
		if day < 1 {
			day = 1
		}
		if day > daysInMonth {
			day = daysInMonth
		}
		// Past-due unpaid bills still outstanding: apply on as-of day for current month.
		if isCurrentMonth && day < asOfDay {
			day = asOfDay
		}
		ladderEvents = append(ladderEvents, kernel.LadderEvent{
			Day:    day,
			Name:   b.Name,
			Amount: -b.Amount,
			Kind:   "bill",
		})
	}

	// Active debts whose minimum has not yet been paid this month.
	type dbDebt struct {
		Name           string
		MinimumPayment float64
		DueDay         int
	}
	var debtsList []dbDebt
	if isCurrentMonth {
		monthStart := time.Date(targetYearMonth.Year(), targetYearMonth.Month(), 1, 0, 0, 0, 0, now.Location())
		nextMonthStart := monthStart.AddDate(0, 1, 0)
		rowsDebts, dErr := s.dbPool.Query(ctx, `
			SELECT d.name, COALESCE(d.minimum_payment, 0), COALESCE(d.due_day, 10)
			FROM debts d
			WHERE d.user_id = $1 AND d.status = 'active' AND d.deleted_at IS NULL
			  AND NOT EXISTS (
			    SELECT 1 FROM debt_payments dp
			    WHERE dp.debt_id = d.id
			      AND dp.payment_date >= $2 AND dp.payment_date < $3
			      AND COALESCE(dp.is_extra_payment, false) = false
			  )
		`, ownerID, monthStart, nextMonthStart)
		if dErr == nil {
			for rowsDebts.Next() {
				var d dbDebt
				if scanErr := rowsDebts.Scan(&d.Name, &d.MinimumPayment, &d.DueDay); scanErr == nil {
					debtsList = append(debtsList, d)
				}
			}
			rowsDebts.Close()
		}
	} else {
		rowsDebts, dErr := s.dbPool.Query(ctx, `
			SELECT name, COALESCE(minimum_payment, 0), COALESCE(due_day, 10)
			FROM debts
			WHERE user_id = $1 AND status = 'active' AND deleted_at IS NULL
		`, ownerID)
		if dErr == nil {
			for rowsDebts.Next() {
				var d dbDebt
				if scanErr := rowsDebts.Scan(&d.Name, &d.MinimumPayment, &d.DueDay); scanErr == nil {
					debtsList = append(debtsList, d)
				}
			}
			rowsDebts.Close()
		}
	}
	for _, debt := range debtsList {
		if debt.MinimumPayment <= 0 {
			continue
		}
		day := debt.DueDay
		if day < 1 {
			day = 1
		}
		if day > daysInMonth {
			day = daysInMonth
		}
		if isCurrentMonth && day < asOfDay {
			day = asOfDay
		}
		ladderEvents = append(ladderEvents, kernel.LadderEvent{
			Day:    day,
			Name:   "Cicilan " + debt.Name,
			Amount: -debt.MinimumPayment,
			Kind:   "debt",
		})
	}

	dailyVariableExpense := estimatedVariableExpenses / 30.0

	ladder := kernel.BuildCashLadder(kernel.LadderInputs{
		AsOfDay:              asOfDay,
		DaysInMonth:          daysInMonth,
		IsCurrentMonth:       isCurrentMonth,
		StartingCash:         startingCash,
		Events:               ladderEvents,
		DailyVariableExpense: dailyVariableExpense,
		LivingCostThreshold:  monthlyLivingCostThreshold,
	})

	// Map pure ladder → DTO daily projections with formatted values.
	projections := make([]dto.DailyProjectionDto, 0, len(ladder.Days))
	for _, d := range ladder.Days {
		currentDate := time.Date(targetYearMonth.Year(), targetYearMonth.Month(), d.Day, 0, 0, 0, 0, targetYearMonth.Location())
		dateStr := currentDate.Format("2006-01-02")
		projections = append(projections, dto.DailyProjectionDto{
			Date:             dateStr,
			ProjectedBalance: d.ProjectedBalance,
			FormattedBalance: formatRupiah(d.ProjectedBalance),
			EventName:        d.EventName,
			EventAmount:      d.EventAmount,
			FormattedAmount:  formatRupiah(d.EventAmount),
			Included:         d.Included,
		})
	}

	projectedEndBalance := ladder.ProjectedEndBalance
	lowestBalance := ladder.LowestBalance
	lowestBalanceDate := time.Date(targetYearMonth.Year(), targetYearMonth.Month(), ladder.LowestBalanceDay, 0, 0, 0, 0, targetYearMonth.Location())
	isTight := ladder.IsTight

	// Safe-to-spend via shared calculation kernel, capped by ladder lowest.
	daysRemaining := daysInMonth - asOfDay + 1
	if !isCurrentMonth {
		daysRemaining = daysInMonth
	}
	if daysRemaining < 0 {
		daysRemaining = 0
	}
	// Prefer ladder-measured remaining fixed (unpaid only) for current month.
	minDebtForKernel := debtsMinPaymentSum
	if isCurrentMonth && ladder.RemainingFixed > 0 {
		// Remaining fixed already includes unpaid bills + unpaid debt mins.
		// Kernel remainingFixed for current month uses MinDebtPayments only;
		// pass full remaining fixed so STS subtracts unpaid bills too.
		minDebtForKernel = ladder.RemainingFixed
	}
	cf := kernel.ComputeCashflow(kernel.CashflowInputs{
		AsOf:                      now,
		CashAvailable:             startingCash,
		IncomeMTD:                 incomeMTD,
		ExpenseMTD:                expenseMTD,
		EstimatedIncome:           estimatedIncome,
		EstimatedFixedExpenses:    estimatedFixedExpenses,
		EstimatedVariableExpenses: estimatedVariableExpenses,
		MonthlyLivingCost:         monthlyLivingCostThreshold,
		MinDebtPayments:           minDebtForKernel,
		IsCurrentMonth:            isCurrentMonth,
		DaysRemaining:             daysRemaining,
		DaysInMonth:               daysInMonth,
		HasLowestBalance:          true,
		LowestProjectedBalance:    lowestBalance,
	})
	conservativeSTS := cf.SafeToSpendScenarios.Conservative
	expectedSTS := cf.SafeToSpendScenarios.Expected
	optimisticSTS := cf.SafeToSpendScenarios.Optimistic
	safeToSpend := cf.SafeToSpend

	// Track data sufficiency from kernel + local flags.
	missingFields := append([]string{}, cf.DataQuality.MissingFields...)
	if incomeInsufficient && !containsStr(missingFields, "income") {
		missingFields = append(missingFields, "income")
	}
	if variableInsufficient && !containsStr(missingFields, "variable_expenses") {
		missingFields = append(missingFields, "variable_expenses")
	}
	if livingCostInsufficient && !containsStr(missingFields, "living_cost") {
		missingFields = append(missingFields, "living_cost")
	}
	confidence := cf.DataQuality.Confidence
	if len(missingFields) > 0 {
		confidence = "low"
	}
	ds := &dto.DataSufficiency{
		IsSufficient:       len(missingFields) == 0,
		MissingFields:      missingFields,
		UsesFallbackValues: cf.DataQuality.UsesFallbackValues,
		Confidence:         confidence,
	}

	// Merge assumptions: ladder (as-of semantics) + cashflow kernel.
	assumptions := append([]string{}, ladder.Assumptions...)
	for _, a := range cf.Assumptions {
		if !containsStr(assumptions, a) {
			assumptions = append(assumptions, a)
		}
	}
	// Explicit included/excluded summary for UI.
	includedCount := len(ladder.IncludedEvents)
	excludedBillsNote := ""
	if isCurrentMonth {
		excludedBillsNote = fmt.Sprintf(
			"As-of day %d: %d future event(s) projected; %d pre-as-of day(s) held as opening-cash stubs; income remaining %.0f of estimate %.0f",
			asOfDay, includedCount, ladder.ExcludedDaysBefore, remainingIncome, estimatedIncome,
		)
		assumptions = append(assumptions, excludedBillsNote)
	}

	// Formula version combines ladder + cashflow for provenance.
	formulaVersion := ladder.FormulaVersion + "+" + cf.FormulaVersion

	res := &dto.ForecastResponse{
		Month: month,
		EstimatedIncome: dto.MoneyValue{
			Value:          estimatedIncome,
			FormattedValue: formatRupiah(estimatedIncome),
		},
		EstimatedFixedExpenses: dto.MoneyValue{
			Value:          estimatedFixedExpenses,
			FormattedValue: formatRupiah(estimatedFixedExpenses),
		},
		EstimatedVariableExpenses: dto.MoneyValue{
			Value:          estimatedVariableExpenses,
			FormattedValue: formatRupiah(estimatedVariableExpenses),
		},
		ProjectedEndBalance: dto.MoneyValue{
			Value:          projectedEndBalance,
			FormattedValue: formatRupiah(projectedEndBalance),
		},
		LowestBalance: dto.MoneyValue{
			Value:          lowestBalance,
			FormattedValue: formatRupiah(lowestBalance),
		},
		LowestBalanceDate: lowestBalanceDate.Format("2006-01-02"),
		SafeToSpend: dto.MoneyValue{
			Value:          safeToSpend,
			FormattedValue: formatRupiah(safeToSpend),
		},
		SafeToSpendScenarios: dto.SafeToSpendScenarios{
			Conservative: dto.MoneyValue{Value: conservativeSTS, FormattedValue: formatRupiah(conservativeSTS)},
			Expected:     dto.MoneyValue{Value: expectedSTS, FormattedValue: formatRupiah(expectedSTS)},
			Optimistic:   dto.MoneyValue{Value: optimisticSTS, FormattedValue: formatRupiah(optimisticSTS)},
		},
		IsTight: isTight,
		ThresholdLimit: dto.MoneyValue{
			Value:          monthlyLivingCostThreshold,
			FormattedValue: formatRupiah(monthlyLivingCostThreshold),
		},
		DailyProjections: projections,
		DataSufficiency:  ds,
		AsOf:             now.UTC().Format(time.RFC3339),
		FormulaVersion:   formulaVersion,
		Assumptions:      assumptions,
		OpeningBalance: &dto.MoneyValue{
			Value:          startingCash,
			FormattedValue: formatRupiah(startingCash),
		},
		IncomeMTD: &dto.MoneyValue{
			Value:          incomeMTD,
			FormattedValue: formatRupiah(incomeMTD),
		},
		RemainingIncome: &dto.MoneyValue{
			Value:          remainingIncome,
			FormattedValue: formatRupiah(remainingIncome),
		},
		IncludedEventCount: includedCount,
		ExcludedDaysBefore: ladder.ExcludedDaysBefore,
	}

	// 9. Save to Database (forecasts table)
	projBytes, _ := json.Marshal(projections)
	var exists bool
	_ = s.dbPool.QueryRow(ctx, `
		SELECT EXISTS(SELECT 1 FROM forecasts WHERE user_id = $1 AND month = $2)
	`, ownerID, month).Scan(&exists)

	if exists {
		_, _ = s.dbPool.Exec(ctx, `
			UPDATE forecasts
			SET estimated_income = $1, estimated_fixed_expenses = $2, estimated_variable_expenses = $3,
			    projected_end_balance = $4, lowest_balance = $5, lowest_balance_date = $6,
			    safe_to_spend = $7, is_tight = $8, daily_projections = $9, calculated_at = NOW()
			WHERE user_id = $10 AND month = $11
		`, estimatedIncome, estimatedFixedExpenses, estimatedVariableExpenses, projectedEndBalance,
			lowestBalance, lowestBalanceDate, safeToSpend, isTight, projBytes, ownerID, month)
	} else {
		_, _ = s.dbPool.Exec(ctx, `
			INSERT INTO forecasts (
				user_id, month, estimated_income, estimated_fixed_expenses, estimated_variable_expenses,
				projected_end_balance, lowest_balance, lowest_balance_date, safe_to_spend, is_tight, daily_projections
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		`, ownerID, month, estimatedIncome, estimatedFixedExpenses, estimatedVariableExpenses,
			projectedEndBalance, lowestBalance, lowestBalanceDate, safeToSpend, isTight, projBytes)
	}

	// 10. Cache in Redis (TTL: 30 minutes)
	resBytes, _ := json.Marshal(res)
	_ = s.rdb.Set(ctx, redisKey, string(resBytes), 30*time.Minute).Err()

	return res, nil
}

func (s *forecastService) GetDailyProjections(ctx context.Context, userID string, month string) ([]dto.DailyProjectionDto, error) {
	res, err := s.CalculateMonthlyForecast(ctx, userID, month)
	if err != nil {
		return nil, err
	}
	return res.DailyProjections, nil
}

func containsStr(ss []string, target string) bool {
	for _, s := range ss {
		if s == target {
			return true
		}
	}
	return false
}
