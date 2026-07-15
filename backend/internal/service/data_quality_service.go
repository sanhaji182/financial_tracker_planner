package service

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/kernel"
)

// DataQualityService exposes the household Data Quality Center (dq-v1).
type DataQualityService interface {
	GetDataQuality(ctx context.Context, userID string) (*dto.DataQualityResponse, error)
}

type dataQualityService struct {
	dbPool *pgxpool.Pool
}

func NewDataQualityService(dbPool *pgxpool.Pool) DataQualityService {
	return &dataQualityService{dbPool: dbPool}
}

func (s *dataQualityService) resolveOwnerID(ctx context.Context, userID string) (string, error) {
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

func (s *dataQualityService) GetDataQuality(ctx context.Context, userID string) (*dto.DataQualityResponse, error) {
	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}
	now := time.Now()
	startOfCurrentMonth := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
	threeMonthsAgo := startOfCurrentMonth.AddDate(0, -3, 0)
	windowStart := now.AddDate(0, 0, -90)

	// --- Accounts ---
	type accRow struct {
		ID       string
		Name     string
		Type     string
		Currency string
		Balance  float64
		IsActive bool
	}
	rows, err := s.dbPool.Query(ctx, `
		SELECT id, name, type, COALESCE(currency,'IDR'), COALESCE(balance,0), COALESCE(is_active,true)
		FROM accounts
		WHERE user_id = $1 AND deleted_at IS NULL
	`, ownerID)
	if err != nil {
		return nil, fmt.Errorf("accounts: %w", err)
	}
	var accounts []accRow
	activeLiquid := 0
	nonIDR := 0
	for rows.Next() {
		var a accRow
		if scanErr := rows.Scan(&a.ID, &a.Name, &a.Type, &a.Currency, &a.Balance, &a.IsActive); scanErr == nil {
			accounts = append(accounts, a)
			if a.IsActive && (a.Type == "bank" || a.Type == "e_wallet" || a.Type == "cash") {
				activeLiquid++
			}
			if a.IsActive && a.Currency != "" && a.Currency != "IDR" {
				nonIDR++
			}
		}
	}
	rows.Close()

	// Last tx per account + reconcile flag in window
	accInputs := make([]kernel.AccountQualityInput, 0, len(accounts))
	for _, a := range accounts {
		var lastDate *time.Time
		_ = s.dbPool.QueryRow(ctx, `
			SELECT MAX(date) FROM transactions
			WHERE user_id = $1 AND account_id = $2 AND status = 'confirmed' AND deleted_at IS NULL
		`, ownerID, a.ID).Scan(&lastDate)
		daysSince := -1
		if lastDate != nil {
			daysSince = int(now.Sub(*lastDate).Hours() / 24)
			if daysSince < 0 {
				daysSince = 0
			}
		}
		var reconCount int
		_ = s.dbPool.QueryRow(ctx, `
			SELECT COUNT(*) FROM transactions
			WHERE user_id = $1 AND account_id = $2 AND status = 'confirmed' AND deleted_at IS NULL
			  AND reconciled = true AND date >= $3
		`, ownerID, a.ID, windowStart).Scan(&reconCount)

		accInputs = append(accInputs, kernel.AccountQualityInput{
			ID:                 a.ID,
			Name:               a.Name,
			Type:               a.Type,
			IsActive:           a.IsActive,
			Currency:           a.Currency,
			DaysSinceLastTx:    daysSince,
			HasRecentReconcile: reconCount > 0,
			Balance:            a.Balance,
		})
	}

	// --- Income / expense history (completed months) ---
	var incomeMonths, expenseMonths int
	_ = s.dbPool.QueryRow(ctx, `
		SELECT COUNT(DISTINCT TO_CHAR(date, 'YYYY-MM'))
		FROM transactions
		WHERE user_id = $1 AND type = 'income' AND status = 'confirmed' AND deleted_at IS NULL
		  AND date >= $2 AND date < $3
	`, ownerID, threeMonthsAgo, startOfCurrentMonth).Scan(&incomeMonths)
	_ = s.dbPool.QueryRow(ctx, `
		SELECT COUNT(DISTINCT TO_CHAR(date, 'YYYY-MM'))
		FROM transactions
		WHERE user_id = $1 AND type = 'expense' AND status = 'confirmed' AND deleted_at IS NULL
		  AND date >= $2 AND date < $3
	`, ownerID, threeMonthsAgo, startOfCurrentMonth).Scan(&expenseMonths)

	var incomeSum, expenseSum float64
	_ = s.dbPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount),0) FROM transactions
		WHERE user_id = $1 AND type = 'income' AND status = 'confirmed' AND deleted_at IS NULL
		  AND date >= $2 AND date < $3
	`, ownerID, threeMonthsAgo, startOfCurrentMonth).Scan(&incomeSum)
	_ = s.dbPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount),0) FROM transactions
		WHERE user_id = $1 AND type = 'expense' AND status = 'confirmed' AND deleted_at IS NULL
		  AND date >= $2 AND date < $3
	`, ownerID, threeMonthsAgo, startOfCurrentMonth).Scan(&expenseSum)

	// MTD also counts as history signal
	var incomeMTD, expenseMTD float64
	_ = s.dbPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount),0) FROM transactions
		WHERE user_id = $1 AND type = 'income' AND status = 'confirmed' AND deleted_at IS NULL
		  AND date >= $2 AND date < $3
	`, ownerID, startOfCurrentMonth, now).Scan(&incomeMTD)
	_ = s.dbPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount),0) FROM transactions
		WHERE user_id = $1 AND type = 'expense' AND status = 'confirmed' AND deleted_at IS NULL
		  AND date >= $2 AND date < $3
	`, ownerID, startOfCurrentMonth, now).Scan(&expenseMTD)

	hasIncome := incomeSum > 0 || incomeMTD > 0
	hasExpense := expenseSum > 0 || expenseMTD > 0

	// --- Ledger hygiene 90d ---
	var txCount, reconciled, uncategorized, pending int
	_ = s.dbPool.QueryRow(ctx, `
		SELECT
			COUNT(*)::int,
			COUNT(*) FILTER (WHERE reconciled = true)::int,
			COUNT(*) FILTER (
				WHERE category_id IS NULL AND COALESCE(is_split,false) = false
				  AND type IN ('income','expense')
			)::int,
			COUNT(*) FILTER (WHERE status IN ('pending','needs_review'))::int
		FROM transactions
		WHERE user_id = $1 AND deleted_at IS NULL AND date >= $2
		  AND status IN ('confirmed','pending','needs_review')
	`, ownerID, windowStart).Scan(&txCount, &reconciled, &uncategorized, &pending)
	unreconciled := txCount - reconciled
	if unreconciled < 0 {
		unreconciled = 0
	}

	// Near-duplicate suspicion: same account+amount+date, count groups with >1
	var dupCount int
	_ = s.dbPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(cnt - 1), 0)::int FROM (
			SELECT account_id, amount, date, COUNT(*) AS cnt
			FROM transactions
			WHERE user_id = $1 AND deleted_at IS NULL AND status = 'confirmed'
			  AND date >= $2 AND type IN ('income','expense')
			GROUP BY account_id, amount, date
			HAVING COUNT(*) > 1
		) d
	`, ownerID, windowStart).Scan(&dupCount)

	// --- FX ---
	var staleFX, missingFX int
	_ = s.dbPool.QueryRow(ctx, `
		SELECT
			COUNT(*) FILTER (
				WHERE code <> 'IDR'
				  AND (last_updated_at IS NULL OR last_updated_at < NOW() - INTERVAL '7 days')
			)::int,
			COUNT(*) FILTER (
				WHERE code <> 'IDR' AND (exchange_rate_to_idr IS NULL OR exchange_rate_to_idr <= 0)
			)::int
		FROM currencies
	`).Scan(&staleFX, &missingFX)
	// Only care about stale/missing if household has non-IDR accounts
	if nonIDR == 0 {
		staleFX = 0
		missingFX = 0
	}

	// --- Obligations ---
	var activeDebts, unpaidBills, overdueBills int
	_ = s.dbPool.QueryRow(ctx, `
		SELECT COUNT(*) FROM debts WHERE user_id = $1 AND status = 'active' AND deleted_at IS NULL
	`, ownerID).Scan(&activeDebts)
	_ = s.dbPool.QueryRow(ctx, `
		SELECT
			COUNT(*) FILTER (WHERE status IN ('unpaid','overdue'))::int,
			COUNT(*) FILTER (WHERE status = 'overdue')::int
		FROM bills
		WHERE user_id = $1 AND deleted_at IS NULL AND is_active = true
	`, ownerID).Scan(&unpaidBills, &overdueBills)

	// Last closing
	var lastClosing *time.Time
	_ = s.dbPool.QueryRow(ctx, `
		SELECT MAX(confirmed_at) FROM monthly_closings
		WHERE user_id = $1 AND is_confirmed = true
	`, ownerID).Scan(&lastClosing)
	daysSinceClosing := -1
	if lastClosing != nil {
		daysSinceClosing = int(now.Sub(*lastClosing).Hours() / 24)
		if daysSinceClosing < 0 {
			daysSinceClosing = 0
		}
	}

	in := kernel.DataQualityInputs{
		AsOf:                    now,
		HasActiveLiquidAccount:  activeLiquid > 0,
		AccountCount:            len(accounts),
		Accounts:                accInputs,
		HasIncomeHistory:        hasIncome,
		HasExpenseHistory:       hasExpense,
		IncomeMonthsCovered:     incomeMonths,
		ExpenseMonthsCovered:    expenseMonths,
		TxCount90d:              txCount,
		UncategorizedCount90d:   uncategorized,
		UnreconciledCount90d:    unreconciled,
		ReconciledCount90d:      reconciled,
		PendingReviewCount90d:   pending,
		DuplicateSuspicionCount: dupCount,
		NonIDRAccountCount:      nonIDR,
		StaleFXRateCount:        staleFX,
		MissingFXRateCount:      missingFX,
		ActiveDebtCount:         activeDebts,
		UnpaidBillCount:         unpaidBills,
		OverdueBillCount:        overdueBills,
		DaysSinceLastClosing:    daysSinceClosing,
	}

	res := kernel.ComputeDataQuality(in)
	return mapDataQualityDTO(res), nil
}

func mapDataQualityDTO(res kernel.DataQualityResult) *dto.DataQualityResponse {
	issues := make([]dto.DataQualityIssue, 0, len(res.Issues))
	for _, iss := range res.Issues {
		issues = append(issues, dto.DataQualityIssue{
			Code:        iss.Code,
			Severity:    iss.Severity,
			Title:       iss.Title,
			Detail:      iss.Detail,
			CTALabel:    iss.CTALabel,
			CTAURL:      iss.CTAURL,
			Affects:     iss.Affects,
			Count:       iss.Count,
			AccountID:   iss.AccountID,
			AccountName: iss.AccountName,
		})
	}
	accounts := make([]dto.AccountQualityDto, 0, len(res.Accounts))
	for _, a := range res.Accounts {
		accounts = append(accounts, dto.AccountQualityDto{
			AccountID:        a.AccountID,
			AccountName:      a.AccountName,
			Type:             a.Type,
			Currency:         a.Currency,
			Score:            a.Score,
			Freshness:        a.Freshness,
			Reconciled:       a.Reconciled,
			DaysSinceTx:      a.DaysSinceTx,
			Balance:          a.Balance,
			FormattedBalance: formatRupiah(a.Balance),
		})
	}
	gates := make([]dto.MetricGateDto, 0, len(res.Gates))
	for _, g := range res.Gates {
		gates = append(gates, dto.MetricGateDto{
			Metric:     g.Metric,
			Visible:    g.Visible,
			Degraded:   g.Degraded,
			Confidence: g.Confidence,
			Reasons:    g.Reasons,
			Missing:    g.Missing,
		})
	}
	suf, miss, conf := res.SufficiencyFields()
	ds := &dto.DataSufficiency{
		IsSufficient:  suf,
		MissingFields: miss,
		Confidence:    conf,
	}
	return &dto.DataQualityResponse{
		AsOf:                     res.AsOf.Format(time.RFC3339),
		FormulaVersion:           res.FormulaVersion,
		OverallScore:             res.OverallScore,
		OverallConfidence:        res.OverallConfidence,
		Grade:                    res.Grade,
		CompletenessScore:        res.CompletenessScore,
		FreshnessScore:           res.FreshnessScore,
		HygieneScore:             res.HygieneScore,
		ReconciliationRate:       res.ReconciliationRate,
		ReconciliationConfidence: res.ReconciliationConfidence,
		UncategorizedRate:        res.UncategorizedRate,
		Issues:                   issues,
		Accounts:                 accounts,
		Gates:                    gates,
		MissingInputs:            res.MissingInputs,
		DecisionMetricsHidden:    res.DecisionMetricsHidden,
		DecisionMetricsDegraded:  res.DecisionMetricsDegraded,
		DataSufficiency:          ds,
		Assumptions:              res.Assumptions,
	}
}
