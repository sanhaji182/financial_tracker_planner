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

	// 2. Fetch Accounts (balances converted to IDR for display consistency)
	accounts := make([]dto.ClosingAccount, 0)
	rows, err := s.dbPool.Query(ctx, `
		SELECT a.id, a.name, a.balance * COALESCE(c.exchange_rate_to_idr, 1.0)
		FROM accounts a
		LEFT JOIN currencies c ON a.currency = c.code
		WHERE a.user_id = $1 AND a.deleted_at IS NULL AND a.is_active = true
	`, ownerID)
	if err == nil {
		for rows.Next() {
			var acc dto.ClosingAccount
			if scanErr := rows.Scan(&acc.ID, &acc.Name, &acc.Balance); scanErr == nil {
				accounts = append(accounts, acc)
			}
		}
		rows.Close()
	}

	// Total Cash (IDR-normalized)
	var totalCash float64
	_ = s.dbPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(a.balance * COALESCE(c.exchange_rate_to_idr, 1.0)), 0)
		FROM accounts a
		LEFT JOIN currencies c ON a.currency = c.code
		WHERE a.user_id = $1 AND a.type IN ('bank', 'e_wallet', 'cash')
		  AND a.deleted_at IS NULL AND a.is_active = true
	`, ownerID).Scan(&totalCash)

	// Total Account Balances (Cash + Invest + Deposits), IDR-normalized
	// Exclude accounts already linked to an asset to avoid double-counting.
	var totalAccounts float64
	_ = s.dbPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(a.balance * COALESCE(c.exchange_rate_to_idr, 1.0)), 0)
		FROM accounts a
		LEFT JOIN currencies c ON a.currency = c.code
		WHERE a.user_id = $1 AND a.deleted_at IS NULL AND a.is_active = true
		  AND NOT EXISTS (
			SELECT 1 FROM assets linked
			WHERE linked.linked_account_id = a.id AND linked.deleted_at IS NULL
		  )
	`, ownerID).Scan(&totalAccounts)

	// Total Assets Valuation (IDR-normalized; linked-account assets use account balance)
	var totalAssets float64
	_ = s.dbPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(
			CASE
				WHEN a.linked_account_id IS NOT NULL THEN ac.balance * COALESCE(curr_ac.exchange_rate_to_idr, 1.0)
				ELSE a.current_value * COALESCE(curr_a.exchange_rate_to_idr, 1.0)
			END
		), 0)
		FROM assets a
		LEFT JOIN accounts ac ON a.linked_account_id = ac.id
		LEFT JOIN currencies curr_ac ON ac.currency = curr_ac.code
		LEFT JOIN currencies curr_a ON a.currency = curr_a.code
		WHERE a.user_id = $1 AND a.deleted_at IS NULL
	`, ownerID).Scan(&totalAssets)

	// Total Debts & Min Payments (IDR-normalized)
	var totalDebts, totalMinDebtPayments float64
	_ = s.dbPool.QueryRow(ctx, `
		SELECT
			COALESCE(SUM(d.outstanding_balance * COALESCE(c.exchange_rate_to_idr, 1.0)), 0),
			COALESCE(SUM(d.minimum_payment * COALESCE(c.exchange_rate_to_idr, 1.0)), 0)
		FROM debts d
		LEFT JOIN currencies c ON d.currency = c.code
		WHERE d.user_id = $1 AND d.status = 'active' AND d.deleted_at IS NULL
	`, ownerID).Scan(&totalDebts, &totalMinDebtPayments)

	// Net Worth (canonical: independent assets + unlinked accounts − debts)
	netWorth := totalAccounts + totalAssets - totalDebts

	// 3. Transactions (Income & Expense) — IDR-normalized
	var totalIncome, totalExpense float64
	_ = s.dbPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(t.amount * COALESCE(c.exchange_rate_to_idr, t.exchange_rate, 1.0)), 0)
		FROM transactions t
		LEFT JOIN currencies c ON t.currency = c.code
		WHERE t.user_id = $1 AND t.type = 'income' AND t.status = 'confirmed'
		  AND TO_CHAR(t.date, 'YYYY-MM') = $2 AND t.deleted_at IS NULL
	`, ownerID, req.Month).Scan(&totalIncome)

	_ = s.dbPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(t.amount * COALESCE(c.exchange_rate_to_idr, t.exchange_rate, 1.0)), 0)
		FROM transactions t
		LEFT JOIN currencies c ON t.currency = c.code
		WHERE t.user_id = $1 AND t.type = 'expense' AND t.status = 'confirmed'
		  AND TO_CHAR(t.date, 'YYYY-MM') = $2 AND t.deleted_at IS NULL
	`, ownerID, req.Month).Scan(&totalExpense)

	// 4. Calculate DTI Ratio
	dtiRatio := 0.0
	if totalIncome > 0 {
		dtiRatio = (totalMinDebtPayments / totalIncome) * 100
	}

	// 5. Emergency Fund & Health Score Calculations
	var monthlyLivingCost float64
	var targetMonths int
	_ = s.dbPool.QueryRow(ctx, `
		SELECT COALESCE(monthly_living_cost_override, 0), target_months
		FROM emergency_fund_configs WHERE user_id = $1
	`, ownerID).Scan(&monthlyLivingCost, &targetMonths)

	if monthlyLivingCost <= 0 {
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
		`, ownerID).Scan(&monthlyLivingCost)
	}

	if targetMonths <= 0 {
		targetMonths = 12
	}

	var efTotal float64
	_ = s.dbPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(a.balance * COALESCE(c.exchange_rate_to_idr, 1.0)), 0)
		FROM accounts a
		LEFT JOIN currencies c ON a.currency = c.code
		WHERE a.user_id = $1 AND a.is_emergency_fund = true AND a.is_active = true AND a.deleted_at IS NULL
	`, ownerID).Scan(&efTotal)

	efCoverageMonths := 0.0
	if monthlyLivingCost > 0 {
		efCoverageMonths = efTotal / monthlyLivingCost
	}

	// Health score components
	dtiScore := 0.0
	if dtiRatio < 20 {
		dtiScore = 100
	} else if dtiRatio <= 60 {
		dtiScore = 100 - (dtiRatio-20)*(100.0/40.0)
	}

	efScore := math.Min(100, (efCoverageMonths/float64(targetMonths))*100)
	cashScore := math.Min(100, (totalCash/monthlyLivingCost)*50.0)

	savingsThisMonth := totalIncome - totalExpense
	if savingsThisMonth < 0 {
		savingsThisMonth = 0
	}
	savingsRateScore := 0.0
	if totalIncome > 0 {
		savingsRateScore = math.Min(100, (savingsThisMonth/totalIncome)*200)
	}

	healthScoreVal := int(math.Round((0.3 * dtiScore) + (0.3 * efScore) + (0.2 * cashScore) + (0.2 * savingsRateScore)))

	// 6. Budgets Snapshot
	budgetCategories := make([]dto.ClosingCategoryBudget, 0)
	var totalBudget, totalSpent float64
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
			if scanErr := budgetRows.Scan(&b.Budget, &b.Name, &b.Actual); scanErr == nil {
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
	targetEfAmount := monthlyLivingCost * float64(targetMonths)
	if targetEfAmount > 0 {
		efProgress = math.Min(100, (efTotal/targetEfAmount)*100)
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
	`, ownerID, req.Month, snapshotBytes, totalIncome, totalExpense, netWorth, totalAssets, totalDebts, totalCash, dtiRatio, efCoverageMonths, req.Notes).Scan(&closingID)
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
			FormattedValue: formatRupiah(snapshot.TotalIncome),
		},
		TotalExpense: dto.MoneyValue{
			Value:          snapshot.TotalExpense,
			FormattedValue: formatRupiah(snapshot.TotalExpense),
		},
		NetWorth: dto.MoneyValue{
			Value:          snapshot.NetWorth,
			FormattedValue: formatRupiah(snapshot.NetWorth),
		},
		TotalAssets: dto.MoneyValue{
			Value:          snapshot.TotalAssets,
			FormattedValue: formatRupiah(snapshot.TotalAssets),
		},
		TotalDebts: dto.MoneyValue{
			Value:          snapshot.TotalDebts,
			FormattedValue: formatRupiah(snapshot.TotalDebts),
		},
		TotalCash: dto.MoneyValue{
			Value:          snapshot.TotalCash,
			FormattedValue: formatRupiah(snapshot.TotalCash),
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
		err = rows.Scan(
			&mc.ID, &mc.Month, &snapshot.TotalIncome, &snapshot.TotalExpense, &snapshot.NetWorth,
			&snapshot.TotalAssets, &snapshot.TotalDebts, &snapshot.TotalCash, &mc.DTIRatio, &mc.EFCoverageMonths,
			&mc.IsConfirmed, &mc.Notes,
		)
		if err == nil {
			mc.TotalIncome = dto.MoneyValue{Value: snapshot.TotalIncome, FormattedValue: formatRupiah(snapshot.TotalIncome)}
			mc.TotalExpense = dto.MoneyValue{Value: snapshot.TotalExpense, FormattedValue: formatRupiah(snapshot.TotalExpense)}
			mc.NetWorth = dto.MoneyValue{Value: snapshot.NetWorth, FormattedValue: formatRupiah(snapshot.NetWorth)}
			mc.TotalAssets = dto.MoneyValue{Value: snapshot.TotalAssets, FormattedValue: formatRupiah(snapshot.TotalAssets)}
			mc.TotalDebts = dto.MoneyValue{Value: snapshot.TotalDebts, FormattedValue: formatRupiah(snapshot.TotalDebts)}
			mc.TotalCash = dto.MoneyValue{Value: snapshot.TotalCash, FormattedValue: formatRupiah(snapshot.TotalCash)}
			list = append(list, mc)
		}
	}

	return list, nil
}

func calculateDelta(oldVal, newVal float64) dto.DeltaValue {
	diff := newVal - oldVal
	direction := "flat"
	if diff > 0 {
		direction = "up"
	} else if diff < 0 {
		direction = "down"
	}

	pct := 0.0
	if oldVal > 0 {
		pct = (diff / oldVal) * 100.0
	}

	return dto.DeltaValue{
		AbsoluteChange:          diff,
		FormattedAbsoluteChange: formatRupiah(diff),
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
