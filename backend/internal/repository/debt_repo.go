package repository

import (
	"context"
	"errors"
	"fmt"

	"encoding/json"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/user/financial-os/internal/model"
)

type DebtRepository interface {
	Create(ctx context.Context, d *model.Debt) (*model.Debt, error)
	GetByID(ctx context.Context, id string) (*model.Debt, error)
	GetAllByUser(ctx context.Context, userID string) ([]model.Debt, error)
	Update(ctx context.Context, d *model.Debt) error
	SoftDelete(ctx context.Context, id string) error
	CreatePayment(ctx context.Context, p *model.DebtPayment, expense *model.Transaction, paymentAccountID string) (*model.DebtPayment, error)
	GetPaymentsByDebt(ctx context.Context, debtID string) ([]model.DebtPayment, error)
	GetSummaryByUser(ctx context.Context, userID string) (*model.DebtSummary, error)
}

type pgDebtRepository struct {
	db *pgxpool.Pool
}

func NewDebtRepository(db *pgxpool.Pool) DebtRepository {
	return &pgDebtRepository{db: db}
}

func (r *pgDebtRepository) Create(ctx context.Context, d *model.Debt) (*model.Debt, error) {
	query := `
		INSERT INTO debts (user_id, name, type, creditor, original_amount, outstanding_balance, interest_rate, minimum_payment, due_day, start_date, end_date, tenor_months, account_id, currency, status, notes, is_shared)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
		RETURNING id, created_at, updated_at
	`
	err := r.db.QueryRow(ctx, query,
		d.UserID,
		d.Name,
		d.Type,
		d.Creditor,
		d.OriginalAmount,
		d.OutstandingBalance,
		d.InterestRate,
		d.MinimumPayment,
		d.DueDay,
		d.StartDate,
		d.EndDate,
		d.TenorMonths,
		d.AccountID,
		d.Currency,
		d.Status,
		d.Notes,
		d.IsShared,
	).Scan(&d.ID, &d.CreatedAt, &d.UpdatedAt)

	if err != nil {
		return nil, err
	}
	r.createAuditLog(ctx, d.UserID, "debt", d.ID, "create", nil, d)
	return d, nil
}

func (r *pgDebtRepository) GetByID(ctx context.Context, id string) (*model.Debt, error) {
	query := `
		SELECT d.id, d.user_id, d.name, d.type, d.creditor, d.original_amount, d.outstanding_balance,
		       d.interest_rate, d.minimum_payment, d.due_day, d.start_date, d.end_date, d.tenor_months,
		       d.account_id, a.name as account_name, d.currency, d.status, d.notes, d.is_shared,
		       d.created_at, d.updated_at
		FROM debts d
		LEFT JOIN accounts a ON a.id = d.account_id
		WHERE d.id = $1 AND d.deleted_at IS NULL
	`

	var d model.Debt
	err := r.db.QueryRow(ctx, query, id).Scan(
		&d.ID,
		&d.UserID,
		&d.Name,
		&d.Type,
		&d.Creditor,
		&d.OriginalAmount,
		&d.OutstandingBalance,
		&d.InterestRate,
		&d.MinimumPayment,
		&d.DueDay,
		&d.StartDate,
		&d.EndDate,
		&d.TenorMonths,
		&d.AccountID,
		&d.AccountName,
		&d.Currency,
		&d.Status,
		&d.Notes,
		&d.IsShared,
		&d.CreatedAt,
		&d.UpdatedAt,
	)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, errors.New("debt not found")
		}
		return nil, err
	}
	return &d, nil
}

func (r *pgDebtRepository) GetAllByUser(ctx context.Context, userID string) ([]model.Debt, error) {
	query := `
		SELECT d.id, d.user_id, d.name, d.type, d.creditor, d.original_amount, d.outstanding_balance,
		       d.interest_rate, d.minimum_payment, d.due_day, d.start_date, d.end_date, d.tenor_months,
		       d.account_id, a.name as account_name, d.currency, d.status, d.notes, d.is_shared,
		       d.created_at, d.updated_at
		FROM debts d
		LEFT JOIN accounts a ON a.id = d.account_id
		WHERE d.user_id = $1 AND d.deleted_at IS NULL
		ORDER BY d.interest_rate DESC, d.created_at DESC
	`

	rows, err := r.db.Query(ctx, query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []model.Debt
	for rows.Next() {
		var d model.Debt
		err := rows.Scan(
			&d.ID,
			&d.UserID,
			&d.Name,
			&d.Type,
			&d.Creditor,
			&d.OriginalAmount,
			&d.OutstandingBalance,
			&d.InterestRate,
			&d.MinimumPayment,
			&d.DueDay,
			&d.StartDate,
			&d.EndDate,
			&d.TenorMonths,
			&d.AccountID,
			&d.AccountName,
			&d.Currency,
			&d.Status,
			&d.Notes,
			&d.IsShared,
			&d.CreatedAt,
			&d.UpdatedAt,
		)
		if err != nil {
			return nil, err
		}
		list = append(list, d)
	}
	return list, nil
}

func (r *pgDebtRepository) Update(ctx context.Context, d *model.Debt) error {
	oldD, errOld := r.GetByID(ctx, d.ID)

	query := `
		UPDATE debts
		SET name = $1, creditor = $2, outstanding_balance = $3, interest_rate = $4, minimum_payment = $5,
		    due_day = $6, start_date = $7, end_date = $8, tenor_months = $9, account_id = $10,
		    status = $11, notes = $12, is_shared = $13, updated_at = NOW()
		WHERE id = $14 AND deleted_at IS NULL
	`
	_, err := r.db.Exec(ctx, query,
		d.Name,
		d.Creditor,
		d.OutstandingBalance,
		d.InterestRate,
		d.MinimumPayment,
		d.DueDay,
		d.StartDate,
		d.EndDate,
		d.TenorMonths,
		d.AccountID,
		d.Status,
		d.Notes,
		d.IsShared,
		d.ID,
	)
	if err == nil && errOld == nil {
		r.createAuditLog(ctx, d.UserID, "debt", d.ID, "update", oldD, d)
	}
	return err
}

func (r *pgDebtRepository) SoftDelete(ctx context.Context, id string) error {
	oldD, errOld := r.GetByID(ctx, id)
	query := `UPDATE debts SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1`
	_, err := r.db.Exec(ctx, query, id)
	if err == nil && errOld == nil {
		r.createAuditLog(ctx, oldD.UserID, "debt", id, "delete", oldD, nil)
	}
	return err
}

func (r *pgDebtRepository) CreatePayment(ctx context.Context, p *model.DebtPayment, expense *model.Transaction, paymentAccountID string) (*model.DebtPayment, error) {
	conn, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer conn.Rollback(ctx)

	// 1. Deduct balance from source account
	queryAcc := `
		UPDATE accounts
		SET balance = balance - $1, updated_at = NOW()
		WHERE id = $2 AND deleted_at IS NULL
	`
	_, err = conn.Exec(ctx, queryAcc, p.Amount, paymentAccountID)
	if err != nil {
		return nil, fmt.Errorf("failed to deduct account balance: %w", err)
	}

	// 2. Insert ledger transaction
	queryTx := `
		INSERT INTO transactions (user_id, account_id, category_id, type, amount, date, description, notes, status, currency)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		RETURNING id, created_at, updated_at
	`
	err = conn.QueryRow(ctx, queryTx,
		expense.UserID,
		expense.AccountID,
		expense.CategoryID,
		expense.Type,
		expense.Amount,
		expense.Date,
		expense.Description,
		expense.Notes,
		expense.Status,
		expense.Currency,
	).Scan(&expense.ID, &expense.CreatedAt, &expense.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("failed to create ledger transaction: %w", err)
	}

	// 3. Update debt outstanding balance & status using principal portion only
	// (interest is financing cost; principal reduces liability — ledger-v1).
	var outstanding float64
	queryDebtLock := `
		SELECT outstanding_balance FROM debts WHERE id = $1 FOR UPDATE
	`
	err = conn.QueryRow(ctx, queryDebtLock, p.DebtID).Scan(&outstanding)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch debt for update: %w", err)
	}

	principalReduction := p.Amount
	if p.PrincipalPortion != nil {
		principalReduction = *p.PrincipalPortion
	}
	// Floor at 0 — never store negative outstanding (matches kernel.SplitDebtPayment).
	newOutstanding := outstanding - principalReduction
	status := "active"
	if newOutstanding <= 0 {
		newOutstanding = 0
		status = "paid_off"
	}
	// Defensive: principal must not exceed outstanding even if caller mis-set portion.
	if principalReduction > outstanding {
		principalReduction = outstanding
		newOutstanding = 0
		status = "paid_off"
		if p.PrincipalPortion != nil {
			p.PrincipalPortion = &principalReduction
		}
	}

	queryDebtUpdate := `
		UPDATE debts
		SET outstanding_balance = $1, status = $2, updated_at = NOW()
		WHERE id = $3
	`
	_, err = conn.Exec(ctx, queryDebtUpdate, newOutstanding, status, p.DebtID)
	if err != nil {
		return nil, fmt.Errorf("failed to update debt balance: %w", err)
	}

	// 4. Create debt_payment log
	p.RemainingBalance = newOutstanding
	p.TransactionID = &expense.ID

	queryPayment := `
		INSERT INTO debt_payments (debt_id, amount, payment_date, is_extra_payment, principal_portion, interest_portion, remaining_balance, transaction_id, notes)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		RETURNING id, created_at
	`
	err = conn.QueryRow(ctx, queryPayment,
		p.DebtID,
		p.Amount,
		p.PaymentDate,
		p.IsExtraPayment,
		p.PrincipalPortion,
		p.InterestPortion,
		p.RemainingBalance,
		p.TransactionID,
		p.Notes,
	).Scan(&p.ID, &p.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("failed to insert debt payment log: %w", err)
	}

	// 5. Commit atomic transaction
	if err := conn.Commit(ctx); err != nil {
		return nil, err
	}

	return p, nil
}

func (r *pgDebtRepository) GetPaymentsByDebt(ctx context.Context, debtID string) ([]model.DebtPayment, error) {
	query := `
		SELECT id, debt_id, amount, payment_date, is_extra_payment, principal_portion, interest_portion, remaining_balance, transaction_id, notes, created_at
		FROM debt_payments
		WHERE debt_id = $1
		ORDER BY payment_date DESC, created_at DESC
	`

	rows, err := r.db.Query(ctx, query, debtID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []model.DebtPayment
	for rows.Next() {
		var p model.DebtPayment
		err := rows.Scan(
			&p.ID,
			&p.DebtID,
			&p.Amount,
			&p.PaymentDate,
			&p.IsExtraPayment,
			&p.PrincipalPortion,
			&p.InterestPortion,
			&p.RemainingBalance,
			&p.TransactionID,
			&p.Notes,
			&p.CreatedAt,
		)
		if err != nil {
			return nil, err
		}
		list = append(list, p)
	}
	return list, nil
}

func (r *pgDebtRepository) GetSummaryByUser(ctx context.Context, userID string) (*model.DebtSummary, error) {
	query := `
		SELECT 
			COALESCE(SUM(outstanding_balance), 0) as total_outstanding,
			COALESCE(SUM(CASE WHEN status = 'active' THEN minimum_payment ELSE 0 END), 0) as total_minimum,
			COUNT(CASE WHEN status = 'active' THEN 1 END) as active_count
		FROM debts
		WHERE user_id = $1 AND deleted_at IS NULL
	`

	var s model.DebtSummary
	err := r.db.QueryRow(ctx, query, userID).Scan(
		&s.TotalOutstanding,
		&s.TotalMinimumPayment,
		&s.ActiveCount,
	)
	if err != nil {
		return nil, err
	}
	return &s, nil
}

func (r *pgDebtRepository) createAuditLog(ctx context.Context, userID, entityType, entityID, action string, oldValue, newValue interface{}) {
	oldValJSON, _ := json.Marshal(oldValue)
	newValJSON, _ := json.Marshal(newValue)
	_, _ = r.db.Exec(ctx, `
		INSERT INTO audit_logs (user_id, entity_type, entity_id, action, old_value, new_value)
		VALUES ($1, $2, $3::uuid, $4, $5, $6)
	`, userID, entityType, entityID, action, oldValJSON, newValJSON)
}
