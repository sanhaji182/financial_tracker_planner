package service

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/user/financial-os/internal/dto"
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
		// Current month: use actual account balance
		err = s.dbPool.QueryRow(ctx, `
			SELECT COALESCE(SUM(balance), 0)
			FROM accounts
			WHERE user_id = $1 AND type IN ('bank', 'e_wallet', 'cash') AND is_active = true AND deleted_at IS NULL
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
			// No previous forecast exists — fall back to actual account balance
			err = s.dbPool.QueryRow(ctx, `
				SELECT COALESCE(SUM(balance), 0)
				FROM accounts
				WHERE user_id = $1 AND type IN ('bank', 'e_wallet', 'cash') AND is_active = true AND deleted_at IS NULL
			`, ownerID).Scan(&startingCash)
			if err != nil {
				return nil, fmt.Errorf("failed to get starting balance: %w", err)
			}
		}
	}

	// 3. Query average income of last 3 months
	startOfCurrentMonth := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
	threeMonthsAgo := startOfCurrentMonth.AddDate(0, -3, 0)

	var totalIncomeLast3Months float64
	_ = s.dbPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount), 0)
		FROM transactions
		WHERE user_id = $1 AND type = 'income' AND status = 'confirmed' AND date >= $2 AND date < $3 AND deleted_at IS NULL
	`, ownerID, threeMonthsAgo, startOfCurrentMonth).Scan(&totalIncomeLast3Months)

	estimatedIncome := totalIncomeLast3Months / 3.0
	incomeInsufficient := estimatedIncome <= 0

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

	// 7. Calculate fixed expenses for target month (bills + active debts min payment)
	var billsSum float64
	_ = s.dbPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount), 0)
		FROM bills
		WHERE user_id = $1 AND deleted_at IS NULL AND is_active = true
		  AND TO_CHAR(next_due_date, 'YYYY-MM') = $2
	`, ownerID, month).Scan(&billsSum)

	var debtsMinPaymentSum float64
	_ = s.dbPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(minimum_payment), 0)
		FROM debts
		WHERE user_id = $1 AND status = 'active' AND deleted_at IS NULL
	`, ownerID).Scan(&debtsMinPaymentSum)

	estimatedFixedExpenses := billsSum + debtsMinPaymentSum

	// 8. Generate Daily Projections
	daysInMonth := time.Date(targetYearMonth.Year(), targetYearMonth.Month()+1, 0, 0, 0, 0, 0, targetYearMonth.Location()).Day()

	// Determine start projection date.
	// If forecasting current month: start simulation from today onwards.
	// If forecasting future month: start simulation from day 1.
	startDay := 1
	if isCurrentMonth {
		startDay = now.Day()
	}

	dailyVariableExpense := estimatedVariableExpenses / 30.0

	var projections []dto.DailyProjectionDto
	runningBalance := startingCash

	// Fetch all bills due in this target month
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

	// Fetch all active debts due in this month
	type dbDebt struct {
		Name           string
		MinimumPayment float64
		DueDay         int
	}
	rowsDebts, err := s.dbPool.Query(ctx, `
		SELECT name, COALESCE(minimum_payment, 0), COALESCE(due_day, 10)
		FROM debts
		WHERE user_id = $1 AND status = 'active' AND deleted_at IS NULL
	`, ownerID)
	var debtsList []dbDebt
	if err == nil {
		for rowsDebts.Next() {
			var d dbDebt
			if scanErr := rowsDebts.Scan(&d.Name, &d.MinimumPayment, &d.DueDay); scanErr == nil {
				debtsList = append(debtsList, d)
			}
		}
		rowsDebts.Close()
	}

	lowestBalance := startingCash
	lowestBalanceDate := time.Date(targetYearMonth.Year(), targetYearMonth.Month(), startDay, 0, 0, 0, 0, targetYearMonth.Location())
	isTight := false

	// Build projection for all days in target month
	// For days before startDay: keep runningBalance static as starting balance or back-filled
	for d := 1; d <= daysInMonth; d++ {
		currentDate := time.Date(targetYearMonth.Year(), targetYearMonth.Month(), d, 0, 0, 0, 0, targetYearMonth.Location())
		dateStr := currentDate.Format("2006-01-02")

		var eventName string
		var eventAmount float64

		if d >= startDay {
			// Apply transactions for this day
			// 1. Expected Income
			if d == expectedIncomeDay {
				runningBalance += estimatedIncome
				eventName = "Gaji Masuk (Est.)"
				eventAmount = estimatedIncome
			}

			// 2. Bills due on this day
			for _, b := range billsList {
				if b.Day == d {
					runningBalance -= b.Amount
					if eventName != "" {
						eventName += " & " + b.Name
					} else {
						eventName = b.Name
					}
					eventAmount -= b.Amount
				}
			}

			// 3. Debts due on this day
			for _, debt := range debtsList {
				if debt.DueDay == d {
					runningBalance -= debt.MinimumPayment
					if eventName != "" {
						eventName += " & Cicilan " + debt.Name
					} else {
						eventName = "Cicilan " + debt.Name
					}
					eventAmount -= debt.MinimumPayment
				}
			}

			// 4. Daily variable expense
			runningBalance -= dailyVariableExpense

			if runningBalance < lowestBalance {
				lowestBalance = runningBalance
				lowestBalanceDate = currentDate
			}
		}

		if runningBalance < monthlyLivingCostThreshold {
			isTight = true
		}

		projections = append(projections, dto.DailyProjectionDto{
			Date:             dateStr,
			ProjectedBalance: runningBalance,
			FormattedBalance: formatRupiah(runningBalance),
			EventName:        eventName,
			EventAmount:      eventAmount,
			FormattedAmount:  formatRupiah(eventAmount),
		})
	}

	projectedEndBalance := runningBalance

	// Calculate Safe-To-Spend
	// Formula: Safe to Spend = Estimated Income - Total Fixed Expenses - (variable * 80%) - (5% emergency reserve)
	safeToSpend := estimatedIncome - estimatedFixedExpenses - (estimatedVariableExpenses * 0.80) - (0.05 * estimatedIncome)
	if safeToSpend < 0 {
		safeToSpend = 0
	}

	// Track data sufficiency
	var missingFields []string
	if incomeInsufficient {
		missingFields = append(missingFields, "income")
	}
	if variableInsufficient {
		missingFields = append(missingFields, "variable_expenses")
	}
	if livingCostInsufficient {
		missingFields = append(missingFields, "living_cost")
	}
	ds := &dto.DataSufficiency{
		IsSufficient:       len(missingFields) == 0,
		MissingFields:      missingFields,
		UsesFallbackValues: false,
	}

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
		IsTight: isTight,
		ThresholdLimit: dto.MoneyValue{
			Value:          monthlyLivingCostThreshold,
			FormattedValue: formatRupiah(monthlyLivingCostThreshold),
		},
		DailyProjections: projections,
		DataSufficiency:  ds,
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
