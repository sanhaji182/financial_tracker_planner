package repository

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/user/financial-os/internal/model"
)

type AccountRepository interface {
	Create(ctx context.Context, account *model.Account) (*model.Account, error)
	GetByID(ctx context.Context, id string) (*model.Account, error)
	GetAllByUser(ctx context.Context, userID string) ([]model.Account, error)
	Update(ctx context.Context, account *model.Account) error
	SoftDelete(ctx context.Context, id string) error
	GetSummaryByUser(ctx context.Context, userID string) (*model.AccountSummary, error)
	UpdateBalance(ctx context.Context, accountID string, delta float64) error
	HasActiveTransactions(ctx context.Context, accountID string) (bool, error)
}

type pgAccountRepository struct {
	db *pgxpool.Pool
}

func NewAccountRepository(db *pgxpool.Pool) AccountRepository {
	return &pgAccountRepository{db: db}
}

func (r *pgAccountRepository) Create(ctx context.Context, account *model.Account) (*model.Account, error) {
	query := `
		INSERT INTO accounts (user_id, name, type, bank_provider, account_number_masked, balance, initial_balance, currency, icon, color, is_active, is_shared, is_emergency_fund, sort_order, notes)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
		RETURNING id, created_at, updated_at
	`
	err := r.db.QueryRow(ctx, query,
		account.UserID,
		account.Name,
		account.Type,
		account.BankProvider,
		account.AccountNumberMasked,
		account.Balance,
		account.InitialBalance,
		account.Currency,
		account.Icon,
		account.Color,
		account.IsActive,
		account.IsShared,
		account.IsEmergencyFund,
		account.SortOrder,
		account.Notes,
	).Scan(&account.ID, &account.CreatedAt, &account.UpdatedAt)

	if err != nil {
		return nil, err
	}
	return account, nil
}

func (r *pgAccountRepository) GetByID(ctx context.Context, id string) (*model.Account, error) {
	query := `
		SELECT id, user_id, name, type, bank_provider, account_number_masked, balance, initial_balance, currency, icon, color, is_active, is_shared, is_emergency_fund, sort_order, notes, created_at, updated_at, deleted_at
		FROM accounts
		WHERE id = $1 AND deleted_at IS NULL
	`
	var a model.Account
	err := r.db.QueryRow(ctx, query, id).Scan(
		&a.ID,
		&a.UserID,
		&a.Name,
		&a.Type,
		&a.BankProvider,
		&a.AccountNumberMasked,
		&a.Balance,
		&a.InitialBalance,
		&a.Currency,
		&a.Icon,
		&a.Color,
		&a.IsActive,
		&a.IsShared,
		&a.IsEmergencyFund,
		&a.SortOrder,
		&a.Notes,
		&a.CreatedAt,
		&a.UpdatedAt,
		&a.DeletedAt,
	)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, errors.New("account not found")
		}
		return nil, err
	}
	return &a, nil
}

func (r *pgAccountRepository) GetAllByUser(ctx context.Context, userID string) ([]model.Account, error) {
	query := `
		SELECT id, user_id, name, type, bank_provider, account_number_masked, balance, initial_balance, currency, icon, color, is_active, is_shared, is_emergency_fund, sort_order, notes, created_at, updated_at, deleted_at
		FROM accounts
		WHERE user_id = $1 AND deleted_at IS NULL
		ORDER BY sort_order ASC, created_at DESC
	`
	rows, err := r.db.Query(ctx, query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var accounts []model.Account
	for rows.Next() {
		var a model.Account
		err := rows.Scan(
			&a.ID,
			&a.UserID,
			&a.Name,
			&a.Type,
			&a.BankProvider,
			&a.AccountNumberMasked,
			&a.Balance,
			&a.InitialBalance,
			&a.Currency,
			&a.Icon,
			&a.Color,
			&a.IsActive,
			&a.IsShared,
			&a.IsEmergencyFund,
			&a.SortOrder,
			&a.Notes,
			&a.CreatedAt,
			&a.UpdatedAt,
			&a.DeletedAt,
		)
		if err != nil {
			return nil, err
		}
		accounts = append(accounts, a)
	}
	return accounts, nil
}

func (r *pgAccountRepository) Update(ctx context.Context, a *model.Account) error {
	query := `
		UPDATE accounts
		SET name = $1, bank_provider = $2, icon = $3, color = $4, is_active = $5, 
			is_shared = $6, is_emergency_fund = $7, sort_order = $8, notes = $9, updated_at = NOW()
		WHERE id = $10 AND deleted_at IS NULL
	`
	_, err := r.db.Exec(ctx, query,
		a.Name,
		a.BankProvider,
		a.Icon,
		a.Color,
		a.IsActive,
		a.IsShared,
		a.IsEmergencyFund,
		a.SortOrder,
		a.Notes,
		a.ID,
	)
	return err
}

func (r *pgAccountRepository) SoftDelete(ctx context.Context, id string) error {
	query := `
		UPDATE accounts
		SET deleted_at = NOW(), updated_at = NOW()
		WHERE id = $1 AND deleted_at IS NULL
	`
	_, err := r.db.Exec(ctx, query, id)
	return err
}

func (r *pgAccountRepository) GetSummaryByUser(ctx context.Context, userID string) (*model.AccountSummary, error) {
	query := `
		SELECT type, COALESCE(SUM(balance), 0)
		FROM accounts
		WHERE user_id = $1 AND deleted_at IS NULL AND is_active = true
		GROUP BY type
	`
	rows, err := r.db.Query(ctx, query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	summary := &model.AccountSummary{}
	for rows.Next() {
		var t string
		var val float64
		if err := rows.Scan(&t, &val); err != nil {
			return nil, err
		}
		switch t {
		case "bank":
			summary.TotalBank = val
		case "e_wallet":
			summary.TotalEWallet = val
		case "cash":
			summary.TotalCash = val
		case "investment":
			summary.TotalInvestment = val
		case "deposit":
			summary.TotalDeposit = val
		}
	}
	summary.GrandTotal = summary.TotalBank + summary.TotalEWallet + summary.TotalCash + summary.TotalInvestment + summary.TotalDeposit
	return summary, nil
}

func (r *pgAccountRepository) UpdateBalance(ctx context.Context, accountID string, delta float64) error {
	query := `
		UPDATE accounts
		SET balance = balance + $1, updated_at = NOW()
		WHERE id = $2 AND deleted_at IS NULL
	`
	_, err := r.db.Exec(ctx, query, delta, accountID)
	return err
}

func (r *pgAccountRepository) HasActiveTransactions(ctx context.Context, accountID string) (bool, error) {
	// First let's check if the transactions table even exists!
	// If the transactions table doesn't exist yet, we can return false.
	var exists bool
	checkQuery := `
		SELECT EXISTS (
			SELECT FROM information_schema.tables 
			WHERE table_name = 'transactions'
		)
	`
	err := r.db.QueryRow(ctx, checkQuery).Scan(&exists)
	if err != nil {
		return false, err
	}
	if !exists {
		return false, nil
	}

	// If table exists, check if there are any transactions referencing this account ID
	query := `
		SELECT EXISTS(
			SELECT 1 FROM transactions 
			WHERE (account_id = $1 OR target_account_id = $1) AND deleted_at IS NULL
		)
	`
	var hasTx bool
	err = r.db.QueryRow(ctx, query, accountID).Scan(&hasTx)
	if err != nil {
		return false, err
	}
	return hasTx, nil
}
