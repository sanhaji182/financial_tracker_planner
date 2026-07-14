package repository

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/user/financial-os/internal/model"
)

type BillRepository interface {
	CreateBill(ctx context.Context, b *model.Bill) (*model.Bill, error)
	GetBillByID(ctx context.Context, userID string, id string) (*model.Bill, error)
	UpdateBill(ctx context.Context, b *model.Bill) error
	DeleteBill(ctx context.Context, userID string, id string) error
	ListBills(ctx context.Context, userID string, status string, month string) ([]model.Bill, error)
	GetUpcomingBills(ctx context.Context, userID string, days int) ([]model.Bill, error)
	GetMonthlyBills(ctx context.Context, userID string, month string) ([]model.Bill, error)

	// Payments
	CreateBillPayment(ctx context.Context, p *model.BillPayment) (*model.BillPayment, error)
	CreateBillPaymentTx(ctx context.Context, tx pgx.Tx, p *model.BillPayment) (*model.BillPayment, error)
	GetPaymentsByBillID(ctx context.Context, billID string) ([]model.BillPayment, error)
}

type billRepository struct {
	dbPool *pgxpool.Pool
}

func NewBillRepository(dbPool *pgxpool.Pool) BillRepository {
	return &billRepository{dbPool: dbPool}
}

func (r *billRepository) CreateBill(ctx context.Context, b *model.Bill) (*model.Bill, error) {
	query := `
		INSERT INTO bills (
			user_id, name, amount, category_id, account_id, frequency, due_day, due_date,
			next_due_date, custom_interval_days, auto_remind, reminder_days_before, status, is_active, notes
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
		RETURNING id, created_at, updated_at
	`
	err := r.dbPool.QueryRow(ctx, query,
		b.UserID, b.Name, b.Amount, b.CategoryID, b.AccountID, b.Frequency, b.DueDay, b.DueDate,
		b.NextDueDate, b.CustomIntervalDays, b.AutoRemind, b.ReminderDaysBefore, b.Status, b.IsActive, b.Notes,
	).Scan(&b.ID, &b.CreatedAt, &b.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("failed to create bill: %w", err)
	}
	r.createAuditLog(ctx, b.UserID, "bill", b.ID, "create", nil, b)
	return b, nil
}

func (r *billRepository) GetBillByID(ctx context.Context, userID string, id string) (*model.Bill, error) {
	query := `
		SELECT b.id, b.user_id, b.name, b.amount, b.category_id, cat.name as category_name,
	       b.account_id, acc.name as account_name, b.frequency, b.due_day, b.due_date,
	       b.next_due_date, b.custom_interval_days, b.auto_remind, b.reminder_days_before,
	       b.status, b.is_active, b.notes, b.created_at, b.updated_at
	FROM bills b
	LEFT JOIN categories cat ON b.category_id = cat.id
	LEFT JOIN accounts acc ON b.account_id = acc.id
	WHERE b.id = $1 AND b.user_id = $2 AND b.deleted_at IS NULL
	`
	var b model.Bill
	err := r.dbPool.QueryRow(ctx, query, id, userID).Scan(
		&b.ID, &b.UserID, &b.Name, &b.Amount, &b.CategoryID, &b.CategoryName,
		&b.AccountID, &b.AccountName, &b.Frequency, &b.DueDay, &b.DueDate,
		&b.NextDueDate, &b.CustomIntervalDays, &b.AutoRemind, &b.ReminderDaysBefore,
		&b.Status, &b.IsActive, &b.Notes, &b.CreatedAt, &b.UpdatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("bill not found: %s", id)
		}
		return nil, err
	}
	return &b, nil
}

func (r *billRepository) UpdateBill(ctx context.Context, b *model.Bill) error {
	oldB, errOld := r.GetBillByID(ctx, b.UserID, b.ID)

	query := `
		UPDATE bills
		SET name = $1, amount = $2, category_id = $3, account_id = $4, frequency = $5,
		    due_day = $6, due_date = $7, next_due_date = $8, custom_interval_days = $9,
		    auto_remind = $10, reminder_days_before = $11, status = $12, is_active = $13,
		    notes = $14, updated_at = NOW()
		WHERE id = $15 AND user_id = $16 AND deleted_at IS NULL
	`
	_, err := r.dbPool.Exec(ctx, query,
		b.Name, b.Amount, b.CategoryID, b.AccountID, b.Frequency, b.DueDay, b.DueDate,
		b.NextDueDate, b.CustomIntervalDays, b.AutoRemind, b.ReminderDaysBefore, b.Status,
		b.IsActive, b.Notes, b.ID, b.UserID,
	)
	if err == nil && errOld == nil {
		r.createAuditLog(ctx, b.UserID, "bill", b.ID, "update", oldB, b)
	}
	return err
}

func (r *billRepository) DeleteBill(ctx context.Context, userID string, id string) error {
	oldB, errOld := r.GetBillByID(ctx, userID, id)
	query := `UPDATE bills SET deleted_at = NOW() WHERE id = $1 AND user_id = $2`
	_, err := r.dbPool.Exec(ctx, query, id, userID)
	if err == nil && errOld == nil {
		r.createAuditLog(ctx, userID, "bill", id, "delete", oldB, nil)
	}
	return err
}

func (r *billRepository) ListBills(ctx context.Context, userID string, status string, month string) ([]model.Bill, error) {
	query := `
		SELECT b.id, b.user_id, b.name, b.amount, b.category_id, cat.name as category_name,
		       b.account_id, acc.name as account_name, b.frequency, b.due_day, b.due_date,
		       b.next_due_date, b.custom_interval_days, b.auto_remind, b.reminder_days_before,
		       b.status, b.is_active, b.notes, b.created_at, b.updated_at
		FROM bills b
		LEFT JOIN categories cat ON b.category_id = cat.id
		LEFT JOIN accounts acc ON b.account_id = acc.id
		WHERE b.user_id = $1 AND b.deleted_at IS NULL
	`
	args := []interface{}{userID}
	placeholderIndex := 2

	if status != "" {
		query += fmt.Sprintf(" AND b.status = $%d", placeholderIndex)
		args = append(args, status)
		placeholderIndex++
	}

	if month != "" {
		// filter by next_due_date falling in the month (YYYY-MM)
		query += fmt.Sprintf(" AND TO_CHAR(b.next_due_date, 'YYYY-MM') = $%d", placeholderIndex)
		args = append(args, month)
		placeholderIndex++
	}

	query += " ORDER BY b.next_due_date ASC, b.name ASC"

	rows, err := r.dbPool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []model.Bill
	for rows.Next() {
		var b model.Bill
		err := rows.Scan(
			&b.ID, &b.UserID, &b.Name, &b.Amount, &b.CategoryID, &b.CategoryName,
			&b.AccountID, &b.AccountName, &b.Frequency, &b.DueDay, &b.DueDate,
			&b.NextDueDate, &b.CustomIntervalDays, &b.AutoRemind, &b.ReminderDaysBefore,
			&b.Status, &b.IsActive, &b.Notes, &b.CreatedAt, &b.UpdatedAt,
		)
		if err != nil {
			return nil, err
		}
		list = append(list, b)
	}
	return list, nil
}

func (r *billRepository) GetUpcomingBills(ctx context.Context, userID string, days int) ([]model.Bill, error) {
	query := `
		SELECT b.id, b.user_id, b.name, b.amount, b.category_id, cat.name as category_name,
		       b.account_id, acc.name as account_name, b.frequency, b.due_day, b.due_date,
		       b.next_due_date, b.custom_interval_days, b.auto_remind, b.reminder_days_before,
		       b.status, b.is_active, b.notes, b.created_at, b.updated_at
		FROM bills b
		LEFT JOIN categories cat ON b.category_id = cat.id
		LEFT JOIN accounts acc ON b.account_id = acc.id
		WHERE b.user_id = $1 AND b.deleted_at IS NULL AND b.status IN ('unpaid', 'overdue')
		  AND b.next_due_date >= CURRENT_DATE AND b.next_due_date <= CURRENT_DATE + $2 * INTERVAL '1 day'
		ORDER BY b.next_due_date ASC, b.name ASC
	`
	rows, err := r.dbPool.Query(ctx, query, userID, days)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []model.Bill
	for rows.Next() {
		var b model.Bill
		err := rows.Scan(
			&b.ID, &b.UserID, &b.Name, &b.Amount, &b.CategoryID, &b.CategoryName,
			&b.AccountID, &b.AccountName, &b.Frequency, &b.DueDay, &b.DueDate,
			&b.NextDueDate, &b.CustomIntervalDays, &b.AutoRemind, &b.ReminderDaysBefore,
			&b.Status, &b.IsActive, &b.Notes, &b.CreatedAt, &b.UpdatedAt,
		)
		if err != nil {
			return nil, err
		}
		list = append(list, b)
	}
	return list, nil
}

func (r *billRepository) GetMonthlyBills(ctx context.Context, userID string, month string) ([]model.Bill, error) {
	query := `
		SELECT b.id, b.user_id, b.name, b.amount, b.category_id, cat.name as category_name,
		       b.account_id, acc.name as account_name, b.frequency, b.due_day, b.due_date,
		       b.next_due_date, b.custom_interval_days, b.auto_remind, b.reminder_days_before,
		       b.status, b.is_active, b.notes, b.created_at, b.updated_at
		FROM bills b
		LEFT JOIN categories cat ON b.category_id = cat.id
		LEFT JOIN accounts acc ON b.account_id = acc.id
		WHERE b.user_id = $1 AND b.deleted_at IS NULL AND TO_CHAR(b.next_due_date, 'YYYY-MM') = $2
	`
	rows, err := r.dbPool.Query(ctx, query, userID, month)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []model.Bill
	for rows.Next() {
		var b model.Bill
		err := rows.Scan(
			&b.ID, &b.UserID, &b.Name, &b.Amount, &b.CategoryID, &b.CategoryName,
			&b.AccountID, &b.AccountName, &b.Frequency, &b.DueDay, &b.DueDate,
			&b.NextDueDate, &b.CustomIntervalDays, &b.AutoRemind, &b.ReminderDaysBefore,
			&b.Status, &b.IsActive, &b.Notes, &b.CreatedAt, &b.UpdatedAt,
		)
		if err != nil {
			return nil, err
		}
		list = append(list, b)
	}
	return list, nil
}

func (r *billRepository) CreateBillPayment(ctx context.Context, p *model.BillPayment) (*model.BillPayment, error) {
	query := `
		INSERT INTO bill_payments (bill_id, amount, payment_date, is_partial, remaining_amount, transaction_id, notes)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id, created_at
	`
	err := r.dbPool.QueryRow(ctx, query,
		p.BillID, p.Amount, p.PaymentDate, p.IsPartial, p.RemainingAmount, p.TransactionID, p.Notes,
	).Scan(&p.ID, &p.CreatedAt)
	if err != nil {
		return nil, err
	}
	return p, nil
}

func (r *billRepository) CreateBillPaymentTx(ctx context.Context, tx pgx.Tx, p *model.BillPayment) (*model.BillPayment, error) {
	query := `
		INSERT INTO bill_payments (bill_id, amount, payment_date, is_partial, remaining_amount, transaction_id, notes)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id, created_at
	`
	err := tx.QueryRow(ctx, query,
		p.BillID, p.Amount, p.PaymentDate, p.IsPartial, p.RemainingAmount, p.TransactionID, p.Notes,
	).Scan(&p.ID, &p.CreatedAt)
	if err != nil {
		return nil, err
	}
	return p, nil
}

func (r *billRepository) GetPaymentsByBillID(ctx context.Context, billID string) ([]model.BillPayment, error) {
	query := `
		SELECT id, bill_id, amount, payment_date, is_partial, remaining_amount, transaction_id, notes, created_at
		FROM bill_payments
		WHERE bill_id = $1
		ORDER BY payment_date DESC, created_at DESC
	`
	rows, err := r.dbPool.Query(ctx, query, billID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []model.BillPayment
	for rows.Next() {
		var p model.BillPayment
		err := rows.Scan(
			&p.ID, &p.BillID, &p.Amount, &p.PaymentDate, &p.IsPartial, &p.RemainingAmount, &p.TransactionID, &p.Notes, &p.CreatedAt,
		)
		if err != nil {
			return nil, err
		}
		list = append(list, p)
	}
	return list, nil
}

func (r *billRepository) createAuditLog(ctx context.Context, userID, entityType, entityID, action string, oldValue, newValue interface{}) {
	oldValJSON, _ := json.Marshal(oldValue)
	newValJSON, _ := json.Marshal(newValue)
	_, _ = r.dbPool.Exec(ctx, `
		INSERT INTO audit_logs (user_id, entity_type, entity_id, action, old_value, new_value)
		VALUES ($1, $2, $3::uuid, $4, $5, $6)
	`, userID, entityType, entityID, action, oldValJSON, newValJSON)
}
