package service

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/model"
	"github.com/user/financial-os/internal/repository"
)

type BillService interface {
	CreateBill(ctx context.Context, userID string, req dto.CreateBillRequest) (*dto.BillResponse, error)
	GetBillByID(ctx context.Context, id string) (*dto.BillResponse, error)
	UpdateBill(ctx context.Context, id string, req dto.UpdateBillRequest) error
	DeleteBill(ctx context.Context, id string) error
	ListBills(ctx context.Context, userID string, status string, month string) ([]dto.BillResponse, error)
	PayBill(ctx context.Context, billID string, req dto.PayBillRequest) (*dto.BillPaymentResponse, error)
	GetUpcomingBills(ctx context.Context, userID string, days int) ([]dto.BillResponse, error)
	GetMonthlyCommitment(ctx context.Context, userID string, month string) (*dto.BillMonthlyCommitmentResponse, error)
	AutoUpdateStatus(ctx context.Context) error
}

type billService struct {
	dbPool       *pgxpool.Pool
	billRepo     repository.BillRepository
	accountRepo  repository.AccountRepository
	categoryRepo repository.CategoryRepository
}

func NewBillService(dbPool *pgxpool.Pool, billRepo repository.BillRepository, accountRepo repository.AccountRepository, categoryRepo repository.CategoryRepository) BillService {
	return &billService{
		dbPool:       dbPool,
		billRepo:     billRepo,
		accountRepo:  accountRepo,
		categoryRepo: categoryRepo,
	}
}

func CalculateNextDueDate(frequency string, dueDay *int, dueDate *time.Time, customDays *int, from time.Time) time.Time {
	switch frequency {
	case "monthly":
		day := 1
		if dueDay != nil {
			day = *dueDay
		}
		// target in the "from" month
		target := time.Date(from.Year(), from.Month(), day, 0, 0, 0, 0, from.Location())
		if target.Before(from) || target.Equal(from) {
			target = target.AddDate(0, 1, 0)
		}
		return target
	case "yearly":
		if dueDate != nil {
			target := time.Date(from.Year(), dueDate.Month(), dueDate.Day(), 0, 0, 0, 0, from.Location())
			if target.Before(from) || target.Equal(from) {
				target = target.AddDate(1, 0, 0)
			}
			return target
		}
		return from.AddDate(1, 0, 0)
	case "quarterly":
		return from.AddDate(0, 3, 0)
	case "weekly":
		return from.AddDate(0, 0, 7)
	case "custom":
		days := 30
		if customDays != nil {
			days = *customDays
		}
		return from.AddDate(0, 0, days)
	default:
		return from.AddDate(0, 1, 0)
	}
}

func (s *billService) CreateBill(ctx context.Context, userID string, req dto.CreateBillRequest) (*dto.BillResponse, error) {
	now := time.Now()
	nextDueDate := CalculateNextDueDate(req.Frequency, req.DueDay, req.DueDate, req.CustomIntervalDays, now)

	b := &model.Bill{
		UserID:             userID,
		Name:               req.Name,
		Amount:             req.Amount,
		CategoryID:         req.CategoryID,
		AccountID:          req.AccountID,
		Frequency:          req.Frequency,
		DueDay:             req.DueDay,
		DueDate:            req.DueDate,
		NextDueDate:        nextDueDate,
		CustomIntervalDays: req.CustomIntervalDays,
		AutoRemind:         req.AutoRemind,
		ReminderDaysBefore: req.ReminderDaysBefore,
		Status:             "unpaid",
		IsActive:           true,
		Notes:              req.Notes,
	}

	created, err := s.billRepo.CreateBill(ctx, b)
	if err != nil {
		return nil, err
	}

	// Fetch join names
	full, _ := s.billRepo.GetBillByID(ctx, created.ID)
	if full != nil {
		created = full
	}

	res := dto.ToBillResponse(created, nil)
	return &res, nil
}

func (s *billService) GetBillByID(ctx context.Context, id string) (*dto.BillResponse, error) {
	b, err := s.billRepo.GetBillByID(ctx, id)
	if err != nil {
		return nil, err
	}

	payments, _ := s.billRepo.GetPaymentsByBillID(ctx, id)
	res := dto.ToBillResponse(b, payments)
	return &res, nil
}

func (s *billService) UpdateBill(ctx context.Context, id string, req dto.UpdateBillRequest) error {
	b, err := s.billRepo.GetBillByID(ctx, id)
	if err != nil {
		return err
	}

	// Recalculate next due date if schedule changes
	now := time.Now()
	scheduleChanged := b.Frequency != req.Frequency || 
		(b.DueDay != nil && req.DueDay != nil && *b.DueDay != *req.DueDay) ||
		(b.DueDay == nil && req.DueDay != nil) ||
		(b.DueDay != nil && req.DueDay == nil)

	b.Name = req.Name
	b.Amount = req.Amount
	b.CategoryID = req.CategoryID
	b.AccountID = req.AccountID
	b.Frequency = req.Frequency
	b.DueDay = req.DueDay
	b.DueDate = req.DueDate
	b.CustomIntervalDays = req.CustomIntervalDays
	b.AutoRemind = req.AutoRemind
	b.ReminderDaysBefore = req.ReminderDaysBefore
	b.Status = req.Status
	b.Notes = req.Notes

	if scheduleChanged {
		b.NextDueDate = CalculateNextDueDate(b.Frequency, b.DueDay, b.DueDate, b.CustomIntervalDays, now)
	}

	return s.billRepo.UpdateBill(ctx, b)
}

func (s *billService) DeleteBill(ctx context.Context, id string) error {
	return s.billRepo.DeleteBill(ctx, id)
}

func (s *billService) ListBills(ctx context.Context, userID string, status string, month string) ([]dto.BillResponse, error) {
	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}
	bills, err := s.billRepo.ListBills(ctx, ownerID, status, month)
	if err != nil {
		return nil, err
	}

	var res []dto.BillResponse
	for _, b := range bills {
		payments, _ := s.billRepo.GetPaymentsByBillID(ctx, b.ID)
		res = append(res, dto.ToBillResponse(&b, payments))
	}
	return res, nil
}

func (s *billService) PayBill(ctx context.Context, billID string, req dto.PayBillRequest) (*dto.BillPaymentResponse, error) {
	// Start Database Transaction
	tx, err := s.dbPool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	// 1. Fetch Bill in Tx context
	var b model.Bill
	query := `
		SELECT id, user_id, name, amount, category_id, account_id, frequency, due_day, due_date,
		       next_due_date, custom_interval_days, auto_remind, reminder_days_before, status, is_active, notes
		FROM bills
		WHERE id = $1 AND deleted_at IS NULL FOR UPDATE
	`
	err = tx.QueryRow(ctx, query, billID).Scan(
		&b.ID, &b.UserID, &b.Name, &b.Amount, &b.CategoryID, &b.AccountID, &b.Frequency, &b.DueDay, &b.DueDate,
		&b.NextDueDate, &b.CustomIntervalDays, &b.AutoRemind, &b.ReminderDaysBefore, &b.Status, &b.IsActive, &b.Notes,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch bill for payment: %w", err)
	}

	// 2. Fetch already paid sum for this specific bill instance
	var paidSum float64
	err = tx.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount), 0) FROM bill_payments WHERE bill_id = $1
	`, billID).Scan(&paidSum)
	if err != nil {
		return nil, fmt.Errorf("failed to check existing payments: %w", err)
	}

	remainingAmountBefore := b.Amount - paidSum
	if remainingAmountBefore <= 0 {
		return nil, fmt.Errorf("bill is already fully paid")
	}

	if req.Amount > remainingAmountBefore {
		return nil, fmt.Errorf("payment amount (Rp %.0f) exceeds remaining bill balance (Rp %.0f)", req.Amount, remainingAmountBefore)
	}

	remainingAmountAfter := remainingAmountBefore - req.Amount
	isPartial := remainingAmountAfter > 0

	// 3. Deduct from target account
	var currentBalance float64
	err = tx.QueryRow(ctx, `
		SELECT balance FROM accounts WHERE id = $1 AND user_id = $2 FOR UPDATE
	`, req.AccountID, b.UserID).Scan(&currentBalance)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch account balance: %w", err)
	}

	if currentBalance < req.Amount {
		return nil, fmt.Errorf("insufficient account balance: current balance is %s", formatRupiah(currentBalance))
	}

	_, err = tx.Exec(ctx, `
		UPDATE accounts SET balance = balance - $1, updated_at = NOW() WHERE id = $2
	`, req.Amount, req.AccountID)
	if err != nil {
		return nil, fmt.Errorf("failed to deduct account balance: %w", err)
	}

	// 4. Create Ledger Expense Transaction
	var categoryID *string = b.CategoryID
	if categoryID == nil {
		// Fallback: search for utility or general expense category
		var fallbackID string
		err = tx.QueryRow(ctx, `
			SELECT id FROM categories WHERE user_id = $1 AND type = 'expense' LIMIT 1
		`, b.UserID).Scan(&fallbackID)
		if err == nil {
			categoryID = &fallbackID
		}
	}

	var txID string
	txNotes := fmt.Sprintf("Pembayaran Tagihan: %s", b.Name)
	if req.Notes != nil && *req.Notes != "" {
		txNotes += " - " + *req.Notes
	}

	err = tx.QueryRow(ctx, `
		INSERT INTO transactions (user_id, account_id, category_id, type, amount, date, status, notes)
		VALUES ($1, $2, $3, 'expense', $4, $5, 'confirmed', $6)
		RETURNING id
	`, b.UserID, req.AccountID, categoryID, req.Amount, req.PaymentDate, txNotes).Scan(&txID)
	if err != nil {
		return nil, fmt.Errorf("failed to write ledger transaction: %w", err)
	}

	// 5. Create Bill Payment Record
	p := &model.BillPayment{
		BillID:          billID,
		Amount:          req.Amount,
		PaymentDate:     req.PaymentDate,
		IsPartial:       isPartial,
		RemainingAmount: remainingAmountAfter,
		TransactionID:   &txID,
		Notes:           req.Notes,
	}
	p, err = s.billRepo.CreateBillPaymentTx(ctx, tx, p)
	if err != nil {
		return nil, fmt.Errorf("failed to save bill payment: %w", err)
	}

	// 6. Update Bill Status / Handle Recurring Generation
	if !isPartial {
		// Fully Paid!
		_, err = tx.Exec(ctx, `UPDATE bills SET status = 'paid', updated_at = NOW() WHERE id = $1`, billID)
		if err != nil {
			return nil, fmt.Errorf("failed to update bill status: %w", err)
		}

		// Generate next occurrence if recurring and active
		if b.IsActive {
			nextDueDate := CalculateNextDueDate(b.Frequency, b.DueDay, b.DueDate, b.CustomIntervalDays, b.NextDueDate)
			_, err = tx.Exec(ctx, `
				INSERT INTO bills (
					user_id, name, amount, category_id, account_id, frequency, due_day, due_date,
					next_due_date, custom_interval_days, auto_remind, reminder_days_before, status, is_active, notes
				) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'unpaid', $13, $14)
			`, b.UserID, b.Name, b.Amount, b.CategoryID, b.AccountID, b.Frequency, b.DueDay, b.DueDate,
				nextDueDate, b.CustomIntervalDays, b.AutoRemind, b.ReminderDaysBefore, b.IsActive, b.Notes,
			)
			if err != nil {
				return nil, fmt.Errorf("failed to generate next recurring bill occurrence: %w", err)
			}
		}
	} else {
		// Partially Paid! Keep status as unpaid (or partial but PRD specifies unpaid/overdue)
		// We just leave the status or update notes/balance
	}

	err = tx.Commit(ctx)
	if err != nil {
		return nil, err
	}

	res := dto.ToBillPaymentResponse(p)
	return &res, nil
}

func (s *billService) GetUpcomingBills(ctx context.Context, userID string, days int) ([]dto.BillResponse, error) {
	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}
	bills, err := s.billRepo.GetUpcomingBills(ctx, ownerID, days)
	if err != nil {
		return nil, err
	}

	var res []dto.BillResponse
	for _, b := range bills {
		res = append(res, dto.ToBillResponse(&b, nil))
	}
	return res, nil
}

func (s *billService) GetMonthlyCommitment(ctx context.Context, userID string, month string) (*dto.BillMonthlyCommitmentResponse, error) {
	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}
	bills, err := s.billRepo.GetMonthlyBills(ctx, ownerID, month)
	if err != nil {
		return nil, err
	}

	var total, paid, unpaid, overdue float64
	for _, b := range bills {
		total += b.Amount
		switch b.Status {
		case "paid":
			paid += b.Amount
		case "unpaid":
			unpaid += b.Amount
		case "overdue":
			overdue += b.Amount
		}
	}

	return &dto.BillMonthlyCommitmentResponse{
		Month:            month,
		TotalCommitment:  total,
		FormattedTotal:   formatRupiah(total),
		TotalPaid:        paid,
		FormattedPaid:    formatRupiah(paid),
		TotalUnpaid:      unpaid,
		FormattedUnpaid:  formatRupiah(unpaid),
		TotalOverdue:     overdue,
		FormattedOverdue: formatRupiah(overdue),
	}, nil
}

func (s *billService) AutoUpdateStatus(ctx context.Context) error {
	// Update status of unpaid bills to overdue if next_due_date is before today
	query := `
		UPDATE bills
		SET status = 'overdue', updated_at = NOW()
		WHERE status = 'unpaid' AND next_due_date < CURRENT_DATE AND deleted_at IS NULL
	`
	_, err := s.dbPool.Exec(ctx, query)
	return err
}



func (s *billService) resolveOwnerID(ctx context.Context, userID string) (string, error) {
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
