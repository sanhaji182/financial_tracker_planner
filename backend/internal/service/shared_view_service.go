package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/user/financial-os/internal/dto"
)

type SharedViewService interface {
	GetSharedSummary(ctx context.Context, userID string) (*dto.SharedSummaryResponse, error)
	GetSharedAssets(ctx context.Context, userID string) ([]dto.AssetResponse, error)
	GetSharedDebts(ctx context.Context, userID string) ([]dto.DebtResponse, error)
	GetSharedBills(ctx context.Context, userID string) ([]dto.UpcomingBillDto, error)
}

type sharedViewService struct {
	dbPool *pgxpool.Pool
}

func NewSharedViewService(dbPool *pgxpool.Pool) SharedViewService {
	return &sharedViewService{dbPool: dbPool}
}

// Helper to resolve Owner ID and Owner Name for spouse_viewer or owner
func (s *sharedViewService) resolveOwner(ctx context.Context, userID string) (string, string, error) {
	var role string
	var invitedBy *string
	var name string

	err := s.dbPool.QueryRow(ctx, `
		SELECT role, invited_by, name FROM users WHERE id = $1 AND is_active = true
	`, userID).Scan(&role, &invitedBy, &name)
	if err != nil {
		return "", "", fmt.Errorf("failed to fetch user context: %w", err)
	}

	if role == "owner" {
		return userID, name, nil
	}

	if role == "spouse_viewer" {
		if invitedBy == nil || *invitedBy == "" {
			return "", "", errors.New("spouse user does not have a linked family owner")
		}
		var ownerName string
		err = s.dbPool.QueryRow(ctx, `
			SELECT name FROM users WHERE id = $1
		`, *invitedBy).Scan(&ownerName)
		if err != nil {
			return "", "", fmt.Errorf("failed to fetch owner name: %w", err)
		}
		return *invitedBy, ownerName, nil
	}

	return "", "", errors.New("unsupported user role for shared view")
}

func (s *sharedViewService) GetSharedSummary(ctx context.Context, userID string) (*dto.SharedSummaryResponse, error) {
	ownerID, ownerName, err := s.resolveOwner(ctx, userID)
	if err != nil {
		return nil, err
	}

	// 1. Fetch Shared Assets Sum
	var totalAssetsShared float64
	assetQuery := `
		SELECT COALESCE(SUM(
			CASE 
				WHEN a.linked_account_id IS NOT NULL THEN ac.balance
				ELSE a.current_value 
			END
		), 0)
		FROM assets a
		LEFT JOIN accounts ac ON a.linked_account_id = ac.id
		WHERE a.user_id = $1 AND a.is_shared = true AND a.deleted_at IS NULL
	`
	err = s.dbPool.QueryRow(ctx, assetQuery, ownerID).Scan(&totalAssetsShared)
	if err != nil {
		return nil, fmt.Errorf("failed to sum shared assets: %w", err)
	}

	// 2. Fetch Debts Sum (all active debts are shared by default)
	var totalDebts float64
	debtQuery := `
		SELECT COALESCE(SUM(outstanding_balance), 0)
		FROM debts
		WHERE user_id = $1 AND status = 'active' AND deleted_at IS NULL
	`
	err = s.dbPool.QueryRow(ctx, debtQuery, ownerID).Scan(&totalDebts)
	if err != nil {
		return nil, fmt.Errorf("failed to sum debts: %w", err)
	}

	// 3. Fetch Cash Available from Shared Accounts
	var cashAvailableShared float64
	cashQuery := `
		SELECT COALESCE(SUM(ac.balance), 0)
		FROM assets a
		JOIN accounts ac ON a.linked_account_id = ac.id
		WHERE a.user_id = $1 AND a.is_shared = true AND a.type IN ('savings', 'cash', 'e_wallet') AND a.deleted_at IS NULL
	`
	err = s.dbPool.QueryRow(ctx, cashQuery, ownerID).Scan(&cashAvailableShared)
	if err != nil {
		// Fallback: sum all accounts from owner directly if no linked assets
		_ = s.dbPool.QueryRow(ctx, `
			SELECT COALESCE(SUM(balance), 0) FROM accounts WHERE user_id = $1 AND type IN ('bank', 'e_wallet', 'cash') AND is_active = true AND deleted_at IS NULL
		`, ownerID).Scan(&cashAvailableShared)
	}

	// 4. Calculate simplified monthly forecast
	// Average expenses last 3 months
	now := time.Now()
	startOfMonth := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
	threeMonthsAgo := startOfMonth.AddDate(0, -3, 0)
	var totalExpensesLast3Months float64
	_ = s.dbPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount), 0) 
		FROM transactions 
		WHERE user_id = $1 AND type = 'expense' AND date >= $2 AND date < $3 AND status = 'confirmed' AND deleted_at IS NULL
	`, ownerID, threeMonthsAgo, startOfMonth).Scan(&totalExpensesLast3Months)
	
	monthlyLivingCost := totalExpensesLast3Months / 3.0
	if monthlyLivingCost <= 0 {
		monthlyLivingCost = 5000000.0
	}
	daysInMonth := time.Date(now.Year(), now.Month()+1, 0, 0, 0, 0, 0, now.Location()).Day()
	daysRemaining := daysInMonth - now.Day()
	if daysRemaining < 0 {
		daysRemaining = 0
	}
	dailyVariableExpense := monthlyLivingCost / 30.0
	projectedRemainingExpenses := dailyVariableExpense * float64(daysRemaining)

	forecastEndMonth := cashAvailableShared - projectedRemainingExpenses
	if forecastEndMonth < 0 {
		forecastEndMonth = 0
	}

	var dbBills []dto.UpcomingBillDto
	rows, err := s.dbPool.Query(ctx, `
		SELECT id, name, amount, next_due_date
		FROM bills
		WHERE user_id = $1 AND deleted_at IS NULL AND status IN ('unpaid', 'overdue')
		  AND next_due_date >= CURRENT_DATE AND next_due_date <= CURRENT_DATE + 7 * INTERVAL '1 day'
		ORDER BY next_due_date ASC, name ASC
	`, ownerID)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var b dto.UpcomingBillDto
			var nextDue time.Time
			if errScan := rows.Scan(&b.ID, &b.Name, &b.Amount, &nextDue); errScan == nil {
				b.FormattedAmount = formatRupiah(b.Amount)
				b.DueDate = nextDue
				days := int(nextDue.Sub(time.Now().Truncate(24 * time.Hour)).Hours() / 24)
				if days < 0 {
					days = 0
				}
				b.DaysRemaining = days
				dbBills = append(dbBills, b)
			}
		}
	}

	netWorthShared := totalAssetsShared - totalDebts

	return &dto.SharedSummaryResponse{
		TotalAssetsShared:    totalAssetsShared,
		FormattedTotalAssets: formatRupiah(totalAssetsShared),
		TotalDebts:           totalDebts,
		FormattedTotalDebts:  formatRupiah(totalDebts),
		NetWorthShared:       netWorthShared,
		FormattedNetWorth:    formatRupiah(netWorthShared),
		UpcomingBills:        dbBills,
		ForecastEndMonth: dto.MoneyValue{
			Value:          forecastEndMonth,
			FormattedValue: formatRupiah(forecastEndMonth),
		},
		OwnerName: ownerName,
	}, nil
}

func (s *sharedViewService) GetSharedAssets(ctx context.Context, userID string) ([]dto.AssetResponse, error) {
	ownerID, _, err := s.resolveOwner(ctx, userID)
	if err != nil {
		return nil, err
	}

	// Query only shared assets
	rows, err := s.dbPool.Query(ctx, `
		SELECT a.id, a.user_id, a.name, a.type, a.current_value, a.purchase_value, a.purchase_date, a.currency,
		       a.linked_account_id, ac.name as linked_account_name, a.is_shared, a.is_liquid, a.notes, a.created_at, a.updated_at
		FROM assets a
		LEFT JOIN accounts ac ON a.linked_account_id = ac.id
		WHERE a.user_id = $1 AND a.is_shared = true AND a.deleted_at IS NULL
		ORDER BY a.type ASC, a.name ASC
	`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []dto.AssetResponse
	for rows.Next() {
		var a dto.AssetResponse
		var currentVal float64
		var purchaseVal *float64
		var purchaseDate *time.Time
		var notes *string
		var linkedAccID, linkedAccName *string

		err := rows.Scan(
			&a.ID, &a.UserID, &a.Name, &a.Type, &currentVal, &purchaseVal, &purchaseDate, &a.Currency,
			&linkedAccID, &linkedAccName, &a.IsShared, &a.IsLiquid, &notes, &a.CreatedAt, &a.UpdatedAt,
		)
		if err != nil {
			return nil, err
		}

		// Overwrite current value if linked to a live account
		if linkedAccID != nil {
			var liveBalance float64
			err = s.dbPool.QueryRow(ctx, `SELECT balance FROM accounts WHERE id = $1`, *linkedAccID).Scan(&liveBalance)
			if err == nil {
				currentVal = liveBalance
			}
		}

		a.CurrentValue = currentVal
		a.FormattedValue = formatRupiah(currentVal)
		a.LinkedAccountID = linkedAccID
		a.LinkedAccountName = linkedAccName
		a.PurchaseValue = purchaseVal
		if purchaseVal != nil {
			str := formatRupiah(*purchaseVal)
			a.FormattedPurchase = &str
		}
		a.PurchaseDate = purchaseDate
		a.Notes = notes

		list = append(list, a)
	}

	return list, nil
}

func (s *sharedViewService) GetSharedDebts(ctx context.Context, userID string) ([]dto.DebtResponse, error) {
	ownerID, _, err := s.resolveOwner(ctx, userID)
	if err != nil {
		return nil, err
	}

	rows, err := s.dbPool.Query(ctx, `
		SELECT d.id, d.user_id, d.name, d.type, d.creditor, d.original_amount, d.outstanding_balance,
		       d.interest_rate, d.minimum_payment, d.due_day, d.start_date, d.end_date, d.tenor_months,
		       d.account_id, ac.name as account_name, d.currency, d.status, d.notes, d.is_shared, d.created_at, d.updated_at
		FROM debts d
		LEFT JOIN accounts ac ON d.account_id = ac.id
		WHERE d.user_id = $1 AND d.deleted_at IS NULL
		ORDER BY d.interest_rate DESC, d.name ASC
	`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []dto.DebtResponse
	for rows.Next() {
		var d dto.DebtResponse
		var creditor, accountID, accountName, notes *string
		var interestRate, minimumPayment *float64
		var dueDay, tenorMonths *int
		var startDate, endDate *time.Time

		err := rows.Scan(
			&d.ID, &d.UserID, &d.Name, &d.Type, &creditor, &d.OriginalAmount, &d.OutstandingBalance,
			&interestRate, &minimumPayment, &dueDay, &startDate, &endDate, &tenorMonths,
			&accountID, &accountName, &d.Currency, &d.Status, &notes, &d.IsShared, &d.CreatedAt, &d.UpdatedAt,
		)
		if err != nil {
			return nil, err
		}

		d.FormattedOriginal = formatRupiah(d.OriginalAmount)
		d.FormattedOutstanding = formatRupiah(d.OutstandingBalance)

		d.Creditor = creditor
		d.InterestRate = interestRate
		d.MinimumPayment = minimumPayment
		if minimumPayment != nil {
			str := formatRupiah(*minimumPayment)
			d.FormattedMinPayment = &str
		}
		d.DueDay = dueDay
		d.StartDate = startDate
		d.EndDate = endDate
		d.TenorMonths = tenorMonths
		d.AccountID = accountID
		d.AccountName = accountName
		d.Notes = notes

		list = append(list, d)
	}

	return list, nil
}

func (s *sharedViewService) GetSharedBills(ctx context.Context, userID string) ([]dto.UpcomingBillDto, error) {
	ownerID, _, err := s.resolveOwner(ctx, userID)
	if err != nil {
		return nil, err
	}

	rows, err := s.dbPool.Query(ctx, `
		SELECT id, name, amount, next_due_date
		FROM bills
		WHERE user_id = $1 AND deleted_at IS NULL AND status IN ('unpaid', 'overdue')
		ORDER BY next_due_date ASC, name ASC
	`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []dto.UpcomingBillDto
	for rows.Next() {
		var b dto.UpcomingBillDto
		var nextDue time.Time
		err = rows.Scan(&b.ID, &b.Name, &b.Amount, &nextDue)
		if err != nil {
			return nil, err
		}
		b.FormattedAmount = formatRupiah(b.Amount)
		b.DueDate = nextDue
		
		days := int(nextDue.Sub(time.Now().Truncate(24 * time.Hour)).Hours() / 24)
		if days < 0 {
			days = 0
		}
		b.DaysRemaining = days
		list = append(list, b)
	}

	return list, nil
}
