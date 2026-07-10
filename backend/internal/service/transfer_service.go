package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/user/financial-os/internal/dto"
)

type TransferService interface {
	CreateTransfer(ctx context.Context, userID string, req *dto.TransferRequest) (*dto.TransactionResponse, error)
	ListTransfers(ctx context.Context, userID string) ([]dto.TransactionResponse, error)
}

type transferService struct {
	dbPool *pgxpool.Pool
}

func NewTransferService(dbPool *pgxpool.Pool) TransferService {
	return &transferService{dbPool: dbPool}
}

func (s *transferService) resolveOwnerID(ctx context.Context, userID string) (string, error) {
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

func (s *transferService) checkWriteAccess(ctx context.Context, userID string) error {
	var role string
	err := s.dbPool.QueryRow(ctx, "SELECT role FROM users WHERE id = $1", userID).Scan(&role)
	if err != nil {
		return err
	}
	if role == "spouse_viewer" {
		return errors.New("unauthorized: spouse cannot initiate transfers")
	}
	return nil
}

func (s *transferService) CreateTransfer(ctx context.Context, userID string, req *dto.TransferRequest) (*dto.TransactionResponse, error) {
	if err := s.checkWriteAccess(ctx, userID); err != nil {
		return nil, err
	}

	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	if req.SourceAccountID == req.TargetAccountID {
		return nil, errors.New("source and target accounts must be different")
	}
	if req.Amount <= 0 {
		return nil, errors.New("transfer amount must be greater than zero")
	}

	// 1. Verify source account exists and has sufficient balance
	var sourceBalance float64
	var sourceName string
	err = s.dbPool.QueryRow(ctx, `
		SELECT balance, name FROM accounts WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
	`, req.SourceAccountID, ownerID).Scan(&sourceBalance, &sourceName)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, errors.New("source account not found")
		}
		return nil, err
	}

	if sourceBalance < req.Amount {
		return nil, fmt.Errorf("insufficient balance in source account %s (available: %s)", sourceName, formatRupiah(sourceBalance))
	}

	// 2. Verify target account exists
	var targetName string
	err = s.dbPool.QueryRow(ctx, `
		SELECT name FROM accounts WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
	`, req.TargetAccountID, ownerID).Scan(&targetName)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, errors.New("target account not found")
		}
		return nil, err
	}

	parsedDate, err := time.Parse("2006-01-02", req.Date)
	if err != nil {
		return nil, fmt.Errorf("invalid date format (use YYYY-MM-DD): %w", err)
	}

	// 3. Begin Database Transaction
	tx, err := s.dbPool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	// Deduct source account balance
	_, err = tx.Exec(ctx, `
		UPDATE accounts
		SET balance = balance - $1, updated_at = NOW()
		WHERE id = $2 AND user_id = $3
	`, req.Amount, req.SourceAccountID, ownerID)
	if err != nil {
		return nil, err
	}

	// Increase target account balance
	_, err = tx.Exec(ctx, `
		UPDATE accounts
		SET balance = balance + $1, updated_at = NOW()
		WHERE id = $2 AND user_id = $3
	`, req.Amount, req.TargetAccountID, ownerID)
	if err != nil {
		return nil, err
	}

	// Insert transaction of type 'transfer'
	var txID string
	notesText := req.Notes
	if notesText == "" {
		notesText = fmt.Sprintf("Transfer dari %s ke %s", sourceName, targetName)
	}

	err = tx.QueryRow(ctx, `
		INSERT INTO transactions (
			user_id, account_id, target_account_id, type, amount, date, notes, status, created_at, updated_at
		) VALUES ($1, $2, $3, 'transfer', $4, $5, $6, 'confirmed', NOW(), NOW())
		RETURNING id
	`, ownerID, req.SourceAccountID, req.TargetAccountID, req.Amount, parsedDate, notesText).Scan(&txID)
	if err != nil {
		return nil, err
	}

	// Write audit log
	_, err = tx.Exec(ctx, `
		INSERT INTO audit_logs (user_id, entity_type, entity_id, action, ip_address, created_at)
		VALUES ($1, 'transaction', $2, 'create', '127.0.0.1', NOW())
	`, ownerID, txID)
	if err != nil {
		return nil, err
	}

	// Commit Transaction
	err = tx.Commit(ctx)
	if err != nil {
		return nil, err
	}

	// 4. Return the created transaction details
	return s.getTransactionByID(ctx, ownerID, txID)
}

func (s *transferService) ListTransfers(ctx context.Context, userID string) ([]dto.TransactionResponse, error) {
	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	rows, err := s.dbPool.Query(ctx, `
		SELECT t.id, t.account_id, a.name, t.target_account_id, ta.name, t.type, t.amount, t.date, t.notes, t.status, t.created_at
		FROM transactions t
		JOIN accounts a ON t.account_id = a.id
		JOIN accounts ta ON t.target_account_id = ta.id
		WHERE t.user_id = $1 AND t.type = 'transfer' AND t.deleted_at IS NULL
		ORDER BY t.date DESC, t.created_at DESC
	`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []dto.TransactionResponse
	for rows.Next() {
		var tx dto.TransactionResponse
		var dateVal time.Time
		err = rows.Scan(&tx.ID, &tx.AccountID, &tx.AccountName, &tx.TargetAccountID, &tx.TargetAccountName, &tx.Type, &tx.Amount, &dateVal, &tx.Notes, &tx.Status, &tx.CreatedAt)
		if err == nil {
			tx.Date = dateVal
			tx.FormattedAmount = formatRupiah(tx.Amount)
			list = append(list, tx)
		}
	}

	return list, nil
}

func (s *transferService) getTransactionByID(ctx context.Context, ownerID string, txID string) (*dto.TransactionResponse, error) {
	var tx dto.TransactionResponse
	var dateVal time.Time
	err := s.dbPool.QueryRow(ctx, `
		SELECT t.id, t.account_id, a.name, t.target_account_id, ta.name, t.type, t.amount, t.date, t.notes, t.status, t.created_at
		FROM transactions t
		JOIN accounts a ON t.account_id = a.id
		JOIN accounts ta ON t.target_account_id = ta.id
		WHERE t.user_id = $1 AND t.id = $2
	`, ownerID, txID).Scan(&tx.ID, &tx.AccountID, &tx.AccountName, &tx.TargetAccountID, &tx.TargetAccountName, &tx.Type, &tx.Amount, &dateVal, &tx.Notes, &tx.Status, &tx.CreatedAt)
	if err != nil {
		return nil, err
	}

	tx.Date = dateVal
	tx.FormattedAmount = formatRupiah(tx.Amount)
	return &tx, nil
}
