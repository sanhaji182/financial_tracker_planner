package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/model"
)

type ClosingService interface {
	GenerateClosing(ctx context.Context, userID string, req *dto.MonthlyClosingRequest) (*dto.MonthlyClosingResponse, error)
	GetClosingDetail(ctx context.Context, userID string, month string) (*dto.MonthlyClosingResponse, error)
	ListClosings(ctx context.Context, userID string) ([]dto.MonthlyClosingResponse, error)
}

type closingService struct {
	dbPool *pgxpool.Pool
}

func NewClosingService(dbPool *pgxpool.Pool) ClosingService {
	return &closingService{dbPool: dbPool}
}

func (s *closingService) resolveOwnerID(ctx context.Context, userID string) (string, error) {
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

func (s *closingService) checkWriteAccess(ctx context.Context, userID string) error {
	var role string
	err := s.dbPool.QueryRow(ctx, "SELECT role FROM users WHERE id = $1", userID).Scan(&role)
	if err != nil {
		return err
	}
	if role == "spouse_viewer" {
		return errors.New("unauthorized: spouse cannot generate monthly closings")
	}
	return nil
}

func (s *closingService) GenerateClosing(ctx context.Context, userID string, req *dto.MonthlyClosingRequest) (*dto.MonthlyClosingResponse, error) {
	if err := s.checkWriteAccess(ctx, userID); err != nil {
		return nil, err
	}

	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	// 1. Check if closing already exists
	var exists bool
	err = s.dbPool.QueryRow(ctx, `
		SELECT EXISTS(SELECT 1 FROM monthly_closings WHERE user_id = $1 AND month = $2)
	`, ownerID, req.Month).Scan(&exists)
	if err != nil {
		return nil, err
	}
	if exists {
		return nil, fmt.Errorf("monthly closing for month %s already generated", req.Month)
	}

	// 2. Fetch Accounts
	accounts := make([]dto.ClosingAccount, 0)
	rows, err := s.dbPool.Query(ctx, `
		SELECT id, name, balance FROM accounts WHERE user_id = $1 AND deleted_at IS NULL AND is_active = true
	`, ownerID)
	if err == nil {
		for rows.Next() {
			var acc dto.ClosingAccount
			var balance float64
			if scanErr := rows.Scan(&acc.ID, &acc.Name, &balance); scanErr == nil {
				acc.Balance = model.MoneyFromDecimal(balance)
				accounts = append(accounts, acc)
			}
		}
		rows.Close()
	}

	// Total Cash
	var totalCashDecimal float64
	_ = s.dbPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(balance), 0) FROM accounts
		WHERE user_id = $1 AND type IN ('bank', 'e_wallet', 'cash') AND deleted_at IS NULL AND is_active = true
	`, ownerID).Scan(&totalCashDecimal)

	totalCash := model.MoneyFromDecimal(totalCashDecimal)

	// Total Account Balances (Cash + Invest + Deposits)
	var totalAccountsDecimal float64
	_ = s.dbPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(balance), 0) FROM accounts
		WHERE user_id = $1 AND deleted_at IS NULL AND is_active = true
	`, ownerID).Scan(&totalAccountsDecimal)

	totalAccounts := model.MoneyFromDecimal(totalAccountsDecimal)

	// Total Assets Valuation
	var totalAssetsDecimal float64
	_ = s.dbPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(current_value), 0) FROM assets WHERE user_id = $1 AND deleted_at IS NULL
	`, ownerID).Scan(&totalAssetsDecimal)

	totalAssets := model.MoneyFromDecimal(totalAssetsDecimal)

	// Total Debts & Min Payments
	var totalDebtsDecimal, totalMinDebtPaymentsDecimal float64
	_ = s.dbPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(outstanding_balance), 0), COALESCE(SUM(minimum_payment), 0) FROM debts
		WHERE user_id = $1 AND status = 'active' AND deleted_at IS NULL
	`, ownerID).Scan(&totalDebtsDecimal, &totalMinDebtPaymentsDecimal)

	totalDebts := model.MoneyFromDecimal(totalDebtsDecimal)
	totalMinDebtPayments := model.MoneyFromDecimal(totalMinDebtPaymentsDecimal)

	// Net Worth
	netWorth := totalAccounts + totalAssets - totalDebts

	// 3. Transactions (Income & Expense)
	var totalIncomeDecimal, totalExpenseDecimal float64
	_ = s.dbPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount), 0) FROM transactions
		WHERE user_id = $1 AND type = 'income' AND status = 'confirmed'
		  AND TO_CHAR(date, 'YYYY-MM') = $2 AND deleted_at IS NULL
	`, ownerID, req.Month).Scan(&totalIncomeDecimal)

	_ = s.dbPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount), 0) FROM transactions
		WHERE user_id = $1 AND type = 'expense' AND status = 'confirmed'
		  AND TO_CHAR(date, 'YYYY-MM') = $2 AND deleted_at IS NULL
	`, ownerID, req.Month).Scan(&totalExpenseDecimal)

	totalIncome := model.MoneyFromDecimal(totalIncomeDecimal)
	totalExpense := model.MoneyFromDecimal(totalExpenseDecimal)

	// 4. Calculate DTI Ratio
	dtiRatio := 0.0
	if totalIncome > 0 {
		dtiRatio = (float64(totalMinDebtPayments) / float64(totalIncome)) * 100
	}

	// 5. Emergency Fund & Health Score Calculations
	var monthlyLivingCostDecimal float64
	var targetMonths int
	_ = s.dbPool.QueryRow(ctx, `
		SELECT COALESCE(monthly_living_cost_override, 0), target_months
		FROM emergency_fund_configs WHERE user_id = $1
	`, ownerID).Scan(&monthlyLivingCostDecimal, &targetMonths)

	if monthlyLivingCostDecimal <= 0 {
		// Fallback to 3-month average variable expenses
		_ = s.dbPool.QueryRow(ctx, `
			SELECT COALESCE(AVG(spent), 0)
			FROM (
				SELECT SUM(amount) as spent
				FROM transactions
				WHERE user_id = $1 AND type = 'expense' AND deleted_at IS NULL
				GROUP BY TO_CHAR(date, 'YYYY-MM')
				LIMIT 3
			) tmp
		`, ownerID).Scan(&monthlyLivingCostDecimal)
	}

	if targetMonths <= 0 {
		targetMonths = 12
	}
	monthlyLivingCost := model.MoneyFromDecimal(monthlyLivingCostDecimal)

	var efTotalDecimal float64
	_ = s.dbPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(balance), 0) FROM accounts
		WHERE user_id = $1 AND is_emergency_fund = true AND is_active = true AND deleted_at IS NULL
	`, ownerID).Scan(&efTotalDecimal)
	efTotal := model.MoneyFromDecimal(efTotalDecimal)

	efCoverageMonths := 0.0
	if monthlyLivingCost > 0 {
		efCoverageMonths = float64(efTotal) / float64(monthlyLivingCost)
	}

	// Health score components
	dtiScore := 0.0
	if dtiRatio < 20 {
		dtiScore = 100
	} else if dtiRatio <= 60 {
		dtiScore = 100 - (dtiRatio-20)*(100.0/40.0)
	}

	efScore := math.Min(100, (efCoverageMonths/float64(targetMonths))*100)
	cashScore := math.Min(100, (float64(totalCash)/float64(monthlyLivingCost))*50.0)

	savingsThisMonth := totalIncome - totalExpense
	if savingsThisMonth < 0 {
		savingsThisMonth = 0
	}
	savingsRateScore := 0.0
	if totalIncome > 0 {
		savingsRateScore = math.Min(100, (float64(savingsThisMonth)/float64(totalIncome))*200)
	}

	healthScoreVal := int(math.Round((0.3 * dtiScore) + (0.3 * efScore) + (0.2 * cashScore) + (0.2 * savingsRateScore)))

	// 6. Budgets Snapshot
	budgetCategories := make([]dto.ClosingCategoryBudget, 0)
	var totalBudget, totalSpent model.Money
	budgetRows, err := s.dbPool.Query(ctx, `
		SELECT b.amount, c.name, COALESCE((
			SELECT SUM(amount) FROM transactions
			WHERE user_id = $1 AND category_id = b.category_id AND type = 'expense' AND status = 'confirmed'
			  AND TO_CHAR(date, 'YYYY-MM') = $2 AND deleted_at IS NULL AND is_split = false
		), 0) + COALESCE((
			SELECT SUM(s.amount) FROM transaction_splits s
			JOIN transactions t ON s.transaction_id = t.id
			WHERE t.user_id = $1 AND s.category_id = b.category_id AND t.type = 'expense' AND t.status = 'confirmed'
			  AND TO_CHAR(t.date, 'YYYY-MM') = $2 AND t.deleted_at IS NULL
		), 0)
		FROM budgets b
		JOIN categories c ON b.category_id = c.id
		WHERE b.user_id = $1 AND b.month = $2
	`, ownerID, req.Month)
	if err == nil {
		for budgetRows.Next() {
			var b dto.ClosingCategoryBudget
			var budget, actual float64
			if scanErr := budgetRows.Scan(&budget, &b.Name, &actual); scanErr == nil {
				b.Budget = model.MoneyFromDecimal(budget)
				b.Actual = model.MoneyFromDecimal(actual)
				totalBudget += b.Budget
				totalSpent += b.Actual
				budgetCategories = append(budgetCategories, b)
			}
		}
		budgetRows.Close()
	}

	// 7. Goals Progress
	goalsProgress := make([]dto.ClosingGoalProgress, 0)
	// Add Emergency Fund as default
	efProgress := 0.0
	targetEfAmount := monthlyLivingCost * model.Money(targetMonths)
	if targetEfAmount > 0 {
		efProgress = math.Min(100, (float64(efTotal)/float64(targetEfAmount))*100)
	}
	goalsProgress = append(goalsProgress, dto.ClosingGoalProgress{
		Name:     "Dana Darurat",
		Progress: math.Round(efProgress),
	})

	// Fetch other active goals
	goalRows, err := s.dbPool.Query(ctx, `
		SELECT name, target_amount, current_amount FROM goals
		WHERE user_id = $1 AND status = 'active'
	`, ownerID)
	if err == nil {
		for goalRows.Next() {
			var name string
			var targetAmt, currentAmt float64
			if scanErr := goalRows.Scan(&name, &targetAmt, &currentAmt); scanErr == nil {
				prog := 0.0
				if targetAmt > 0 {
					prog = math.Min(100, (currentAmt/targetAmt)*100)
				}
				goalsProgress = append(goalsProgress, dto.ClosingGoalProgress{
					Name:     name,
					Progress: math.Round(prog),
				})
			}
		}
		goalRows.Close()
	}

	// Build Snapshot
	// Track data sufficiency
	var missingFields []string
	if totalIncome <= 0 {
		missingFields = append(missingFields, "income")
	}
	if monthlyLivingCost <= 0 {
		missingFields = append(missingFields, "monthly_living_cost")
	}
	ds := &dto.DataSufficiency{
		IsSufficient:       len(missingFields) == 0,
		MissingFields:      missingFields,
		UsesFallbackValues: false,
	}

	snapshot := dto.ClosingSnapshot{
		Month:            req.Month,
		Accounts:         accounts,
		TotalIncome:      totalIncome,
		TotalExpense:     totalExpense,
		TotalAssets:      totalAssets,
		TotalDebts:       totalDebts,
		NetWorth:         netWorth,
		TotalCash:        totalCash,
		DTIRatio:         dtiRatio,
		HealthScore:      healthScoreVal,
		EFCoverageMonths: efCoverageMonths,
		BudgetSummary: dto.ClosingBudgetSummary{
			TotalBudget: totalBudget,
			TotalSpent:  totalSpent,
			Categories:  budgetCategories,
		},
		GoalsProgress: goalsProgress,
	}

	snapshotBytes, err := json.Marshal(snapshot)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal snapshot: %w", err)
	}

	// 8. Insert monthly_closing (preserve DataSufficiency for response)
	var closingID string
	err = s.dbPool.QueryRow(ctx, `
		INSERT INTO monthly_closings (
			user_id, month, snapshot, total_income, total_expense, net_worth, total_assets, total_debts, total_cash, dti_ratio, ef_coverage_months, is_confirmed, confirmed_at, notes
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true, NOW(), $12)
		RETURNING id
	`, ownerID, req.Month, snapshotBytes, model.DecimalFromMoney(totalIncome), model.DecimalFromMoney(totalExpense), model.DecimalFromMoney(netWorth), model.DecimalFromMoney(totalAssets), model.DecimalFromMoney(totalDebts), model.DecimalFromMoney(totalCash), dtiRatio, efCoverageMonths, req.Notes).Scan(&closingID)
	if err != nil {
		return nil, fmt.Errorf("failed to insert monthly closing: %w", err)
	}

	// 9. Audit Log
	_, _ = s.dbPool.Exec(ctx, `
		INSERT INTO audit_logs (user_id, entity_type, entity_id, action, new_value)
		VALUES ($1, 'closing', $2::uuid, 'close', $3)
	`, ownerID, closingID, snapshotBytes)

	resp, err := s.GetClosingDetail(ctx, userID, req.Month)
	if err != nil {
		return nil, err
	}
	resp.DataSufficiency = ds
	return resp, nil
}

func (s *closingService) GetClosingDetail(ctx context.Context, userID string, month string) (*dto.MonthlyClosingResponse, error) {
	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	var mcID string
	var snapshotBytes []byte
	var isConfirmed bool
	var confirmedAt *time.Time
	var notes string

	err = s.dbPool.QueryRow(ctx, `
		SELECT id, snapshot, is_confirmed, confirmed_at, COALESCE(notes, '')
		FROM monthly_closings
		WHERE user_id = $1 AND month = $2
	`, ownerID, month).Scan(&mcID, &snapshotBytes, &isConfirmed, &confirmedAt, &notes)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, errors.New("monthly closing report not found for this month")
		}
		return nil, err
	}

	var snapshot dto.ClosingSnapshot
	if unmarshalErr := json.Unmarshal(snapshotBytes, &snapshot); unmarshalErr != nil {
		return nil, fmt.Errorf("failed to unmarshal snapshot: %w", unmarshalErr)
	}

	// Formatted values
	res := &dto.MonthlyClosingResponse{
		ID:       mcID,
		Month:    month,
		Snapshot: snapshot,
		TotalIncome: dto.MoneyValue{
			Value:          snapshot.TotalIncome,
			FormattedValue: model.FormatRupiahMoney(snapshot.TotalIncome),
		},
		TotalExpense: dto.MoneyValue{
			Value:          snapshot.TotalExpense,
			FormattedValue: model.FormatRupiahMoney(snapshot.TotalExpense),
		},
		NetWorth: dto.MoneyValue{
			Value:          snapshot.NetWorth,
			FormattedValue: model.FormatRupiahMoney(snapshot.NetWorth),
		},
		TotalAssets: dto.MoneyValue{
			Value:          snapshot.TotalAssets,
			FormattedValue: model.FormatRupiahMoney(snapshot.TotalAssets),
		},
		TotalDebts: dto.MoneyValue{
			Value:          snapshot.TotalDebts,
			FormattedValue: model.FormatRupiahMoney(snapshot.TotalDebts),
		},
		TotalCash: dto.MoneyValue{
			Value:          snapshot.TotalCash,
			FormattedValue: model.FormatRupiahMoney(snapshot.TotalCash),
		},
		DTIRatio:         snapshot.DTIRatio,
		EFCoverageMonths: snapshot.EFCoverageMonths,
		IsConfirmed:      isConfirmed,
		Notes:            notes,
	}

	if confirmedAt != nil {
		res.ConfirmedAt = confirmedAt.Format("02 Jan 2006, 15:04")
	}

	// Calculate MoM Comparison vs previous month
	prevMonthStr := getPreviousMonthStr(month)
	var prevSnapshotBytes []byte
	err = s.dbPool.QueryRow(ctx, `
		SELECT snapshot FROM monthly_closings WHERE user_id = $1 AND month = $2
	`, ownerID, prevMonthStr).Scan(&prevSnapshotBytes)
	if err == nil {
		var prevSnapshot dto.ClosingSnapshot
		if json.Unmarshal(prevSnapshotBytes, &prevSnapshot) == nil {
			res.Comparison = &dto.ClosingComparison{
				PrevMonth:     prevMonthStr,
				NetWorthDelta: calculateDelta(prevSnapshot.NetWorth, snapshot.NetWorth),
				AssetsDelta:   calculateDelta(prevSnapshot.TotalAssets, snapshot.TotalAssets),
				DebtsDelta:    calculateDelta(prevSnapshot.TotalDebts, snapshot.TotalDebts),
				CashDelta:     calculateDelta(prevSnapshot.TotalCash, snapshot.TotalCash),
				IncomeDelta:   calculateDelta(prevSnapshot.TotalIncome, snapshot.TotalIncome),
				ExpenseDelta:  calculateDelta(prevSnapshot.TotalExpense, snapshot.TotalExpense),
			}
		}
	}

	return res, nil
}

func (s *closingService) ListClosings(ctx context.Context, userID string) ([]dto.MonthlyClosingResponse, error) {
	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	rows, err := s.dbPool.Query(ctx, `
		SELECT id, month, total_income, total_expense, net_worth, total_assets, total_debts, total_cash, dti_ratio, ef_coverage_months, is_confirmed, COALESCE(notes, '')
		FROM monthly_closings
		WHERE user_id = $1
		ORDER BY month DESC
	`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []dto.MonthlyClosingResponse
	for rows.Next() {
		var mc dto.MonthlyClosingResponse
		var snapshot dto.ClosingSnapshot
		var totalIncome, totalExpense, netWorth, totalAssets, totalDebts, totalCash float64
		err = rows.Scan(
			&mc.ID, &mc.Month, &totalIncome, &totalExpense, &netWorth,
			&totalAssets, &totalDebts, &totalCash, &mc.DTIRatio, &mc.EFCoverageMonths,
			&mc.IsConfirmed, &mc.Notes,
		)
		if err == nil {
			snapshot.TotalIncome = model.MoneyFromDecimal(totalIncome)
			snapshot.TotalExpense = model.MoneyFromDecimal(totalExpense)
			snapshot.NetWorth = model.MoneyFromDecimal(netWorth)
			snapshot.TotalAssets = model.MoneyFromDecimal(totalAssets)
			snapshot.TotalDebts = model.MoneyFromDecimal(totalDebts)
			snapshot.TotalCash = model.MoneyFromDecimal(totalCash)
			mc.TotalIncome = dto.MoneyValue{Value: snapshot.TotalIncome, FormattedValue: model.FormatRupiahMoney(snapshot.TotalIncome)}
			mc.TotalExpense = dto.MoneyValue{Value: snapshot.TotalExpense, FormattedValue: model.FormatRupiahMoney(snapshot.TotalExpense)}
			mc.NetWorth = dto.MoneyValue{Value: snapshot.NetWorth, FormattedValue: model.FormatRupiahMoney(snapshot.NetWorth)}
			mc.TotalAssets = dto.MoneyValue{Value: snapshot.TotalAssets, FormattedValue: model.FormatRupiahMoney(snapshot.TotalAssets)}
			mc.TotalDebts = dto.MoneyValue{Value: snapshot.TotalDebts, FormattedValue: model.FormatRupiahMoney(snapshot.TotalDebts)}
			mc.TotalCash = dto.MoneyValue{Value: snapshot.TotalCash, FormattedValue: model.FormatRupiahMoney(snapshot.TotalCash)}
			list = append(list, mc)
		}
	}

	return list, nil
}

func calculateDelta(oldVal, newVal model.Money) dto.DeltaValue {
	diff := newVal - oldVal
	direction := "flat"
	if diff > 0 {
		direction = "up"
	} else if diff < 0 {
		direction = "down"
	}

	pct := 0.0
	if oldVal != 0 {
		pct = (float64(diff) / float64(oldVal)) * 100.0
	}

	return dto.DeltaValue{
		AbsoluteChange:          diff,
		FormattedAbsoluteChange: model.FormatRupiahMoney(diff),
		PercentageChange:        pct,
		Direction:               direction,
	}
}

func getPreviousMonthStr(monthStr string) string {
	var year, month int
	_, _ = fmt.Sscanf(monthStr, "%d-%d", &year, &month)
	prevMonth := month - 1
	prevYear := year
	if prevMonth < 1 {
		prevMonth = 12
		prevYear -= 1
	}
	return fmt.Sprintf("%d-%02d", prevYear, prevMonth)
}
