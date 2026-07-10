package service

import (
	"context"
	"errors"
	"fmt"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/user/financial-os/internal/dto"
)

type ReconciliationService interface {
	StartReconciliation(ctx context.Context, userID string, req *dto.ReconciliationStartRequest) (*dto.ReconciliationResponse, error)
	ConfirmReconciliation(ctx context.Context, userID string, req *dto.ReconciliationConfirmRequest) error
}

type reconciliationService struct {
	dbPool *pgxpool.Pool
}

func NewReconciliationService(dbPool *pgxpool.Pool) ReconciliationService {
	return &reconciliationService{dbPool: dbPool}
}

func (s *reconciliationService) resolveOwnerID(ctx context.Context, userID string) (string, error) {
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

func (s *reconciliationService) checkWriteAccess(ctx context.Context, userID string) error {
	var role string
	err := s.dbPool.QueryRow(ctx, "SELECT role FROM users WHERE id = $1", userID).Scan(&role)
	if err != nil {
		return err
	}
	if role == "spouse_viewer" {
		return errors.New("unauthorized: spouse cannot perform reconciliation")
	}
	return nil
}

func (s *reconciliationService) StartReconciliation(ctx context.Context, userID string, req *dto.ReconciliationStartRequest) (*dto.ReconciliationResponse, error) {
	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	// 1. Fetch current app balance of the account
	var appBalance float64
	err = s.dbPool.QueryRow(ctx, `
		SELECT balance FROM accounts WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
	`, req.AccountID, ownerID).Scan(&appBalance)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, errors.New("account not found")
		}
		return nil, err
	}

	parsedDate, err := time.Parse("2006-01-02", req.Date)
	if err != nil {
		return nil, fmt.Errorf("invalid date format (YYYY-MM-DD): %w", err)
	}

	difference := appBalance - req.ActualBalance
	var status string
	var suggestion string

	if difference == 0 {
		status = "match"
		suggestion = "Cocok ✅"
	} else if difference > 0 {
		status = "mismatch"
		suggestion = "Saldo aplikasi lebih tinggi — mungkin ada pengeluaran yang belum dicatat"
	} else {
		status = "mismatch"
		suggestion = "Saldo aplikasi lebih rendah — mungkin ada pemasukan yang belum dicatat"
	}

	// 2. Query unmatched transactions
	rows, err := s.dbPool.Query(ctx, `
		SELECT t.id, t.account_id, a.name, t.target_account_id, COALESCE(ta.name, ''), 
		       t.category_id, COALESCE(c.name, ''), COALESCE(c.icon, ''), COALESCE(c.color, ''), 
		       t.type, t.amount, t.date, t.notes, t.status, t.created_at
		FROM transactions t
		JOIN accounts a ON t.account_id = a.id
		LEFT JOIN accounts ta ON t.target_account_id = ta.id
		LEFT JOIN categories c ON t.category_id = c.id
		WHERE t.user_id = $1 
		  AND (t.account_id = $2 OR t.target_account_id = $2) 
		  AND t.reconciled = false 
		  AND t.date <= $3 
		  AND t.deleted_at IS NULL
		ORDER BY t.date DESC, t.created_at DESC
	`, ownerID, req.AccountID, parsedDate)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	unmatched := make([]dto.TransactionResponse, 0)
	for rows.Next() {
		var tx dto.TransactionResponse
		var dateVal time.Time
		var targetAccId, targetAccName, catId, catName, catIcon, catColor string
		err = rows.Scan(
			&tx.ID, &tx.AccountID, &tx.AccountName, &targetAccId, &targetAccName,
			&catId, &catName, &catIcon, &catColor,
			&tx.Type, &tx.Amount, &dateVal, &tx.Notes, &tx.Status, &tx.CreatedAt,
		)
		if err == nil {
			tx.Date = dateVal
			tx.FormattedAmount = formatRupiah(tx.Amount)
			
			if targetAccId != "" {
				tx.TargetAccountID = &targetAccId
				tx.TargetAccountName = &targetAccName
			}
			if catId != "" {
				tx.CategoryID = &catId
				tx.CategoryName = &catName
				tx.CategoryIcon = &catIcon
				tx.CategoryColor = &catColor
			}
			unmatched = append(unmatched, tx)
		}
	}

	return &dto.ReconciliationResponse{
		Difference:            difference,
		FormattedDifference:   formatRupiah(difference),
		UnmatchedTransactions: unmatched,
		Suggestions:           suggestion,
		Status:                status,
	}, nil
}

func (s *reconciliationService) ConfirmReconciliation(ctx context.Context, userID string, req *dto.ReconciliationConfirmRequest) error {
	if err := s.checkWriteAccess(ctx, userID); err != nil {
		return err
	}

	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	parsedDate, err := time.Parse("2006-01-02", req.Date)
	if err != nil {
		return fmt.Errorf("invalid date format: %w", err)
	}

	// 1. Verify account exists
	var accountName string
	err = s.dbPool.QueryRow(ctx, `
		SELECT name FROM accounts WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
	`, req.AccountID, ownerID).Scan(&accountName)
	if err != nil {
		return errors.New("account not found")
	}

	// 2. DB Transaction to update transactions and insert audit log
	tx, err := s.dbPool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	_, err = tx.Exec(ctx, `
		UPDATE transactions
		SET reconciled = true, updated_at = NOW()
		WHERE user_id = $1 
		  AND (account_id = $2 OR target_account_id = $2) 
		  AND date <= $3 
		  AND reconciled = false 
		  AND deleted_at IS NULL
	`, ownerID, req.AccountID, parsedDate)
	if err != nil {
		return err
	}

	// Audit Log
	newVal := map[string]interface{}{
		"reconciled_to_date": req.Date,
	}
	newValJSON, _ := json.Marshal(newVal)
	_, err = tx.Exec(ctx, `
		INSERT INTO audit_logs (user_id, entity_type, entity_id, action, new_value, ip_address, created_at)
		VALUES ($1, 'account', $2, 'reconcile', $3, '127.0.0.1', NOW())
	`, ownerID, req.AccountID, newValJSON)
	if err != nil {
		return err
	}

	return tx.Commit(ctx)
}
