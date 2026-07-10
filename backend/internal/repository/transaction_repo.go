package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/user/financial-os/internal/model"
)

type TransactionRepository interface {
	Create(ctx context.Context, tx *model.Transaction, splits []model.TransactionSplit, auditLog *model.AuditLog) (*model.Transaction, error)
	GetByID(ctx context.Context, id string) (*model.Transaction, error)
	GetAll(ctx context.Context, userID string, filters map[string]interface{}, page, pageSize int, sortField, sortOrder string) ([]model.Transaction, int64, error)
	Update(ctx context.Context, tx *model.Transaction, oldTx model.Transaction, auditLog *model.AuditLog) error
	SoftDelete(ctx context.Context, id string, auditLog *model.AuditLog) error
	GetSummary(ctx context.Context, userID string, dateFrom, dateTo time.Time) (*model.TransactionSummary, error)
	SaveAttachment(ctx context.Context, att *model.TransactionAttachment) (*model.TransactionAttachment, error)
	DeleteAttachment(ctx context.Context, id string) error
	CreateAuditLog(ctx context.Context, log *model.AuditLog) error
	GetAuditLogs(ctx context.Context, entityType, entityID string) ([]model.AuditLog, error)
	SplitTransaction(ctx context.Context, txID string, splits []model.TransactionSplit, auditLog *model.AuditLog) error
	GetGlobalAuditLogs(ctx context.Context, ownerID string, entityType string, dateFrom, dateTo *time.Time, targetUserID string) ([]model.AuditLog, error)
}

type pgTransactionRepository struct {
	db *pgxpool.Pool
}

func NewTransactionRepository(db *pgxpool.Pool) TransactionRepository {
	return &pgTransactionRepository{db: db}
}

func (r *pgTransactionRepository) Create(ctx context.Context, t *model.Transaction, splits []model.TransactionSplit, auditLog *model.AuditLog) (*model.Transaction, error) {
	conn, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer conn.Rollback(ctx)

	// 1. Insert transaction
	queryTx := `
		INSERT INTO transactions (user_id, account_id, target_account_id, category_id, type, amount, date, description, notes, is_split, source, source_confidence, status, reconciled, currency, exchange_rate, tags)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
		RETURNING id, created_at, updated_at
	`
	err = conn.QueryRow(ctx, queryTx,
		t.UserID,
		t.AccountID,
		t.TargetAccountID,
		t.CategoryID,
		t.Type,
		t.Amount,
		t.Date,
		t.Description,
		t.Notes,
		t.IsSplit,
		t.Source,
		t.SourceConfidence,
		t.Status,
		t.Reconciled,
		t.Currency,
		t.ExchangeRate,
		t.Tags,
	).Scan(&t.ID, &t.CreatedAt, &t.UpdatedAt)

	if err != nil {
		return nil, err
	}

	// 2. Insert splits if split is true
	if t.IsSplit && len(splits) > 0 {
		for i := range splits {
			splits[i].TransactionID = t.ID
			querySplit := `
				INSERT INTO transaction_splits (transaction_id, category_id, amount, description)
				VALUES ($1, $2, $3, $4)
				RETURNING id, created_at
			`
			err = conn.QueryRow(ctx, querySplit,
				splits[i].TransactionID,
				splits[i].CategoryID,
				splits[i].Amount,
				splits[i].Description,
			).Scan(&splits[i].ID, &splits[i].CreatedAt)
			if err != nil {
				return nil, err
			}
		}
		t.Splits = splits
	}

	// 3. Update account balance (only if status is confirmed)
	if t.Status == "confirmed" {
		if t.Type == "income" {
			queryBalance := `UPDATE accounts SET balance = balance + $1, updated_at = NOW() WHERE id = $2`
			_, err = conn.Exec(ctx, queryBalance, t.Amount, t.AccountID)
		} else if t.Type == "expense" {
			queryBalance := `UPDATE accounts SET balance = balance - $1, updated_at = NOW() WHERE id = $2`
			_, err = conn.Exec(ctx, queryBalance, t.Amount, t.AccountID)
		} else if t.Type == "transfer" {
			// Reduce source account
			querySrc := `UPDATE accounts SET balance = balance - $1, updated_at = NOW() WHERE id = $2`
			_, err = conn.Exec(ctx, querySrc, t.Amount, t.AccountID)
			if err != nil {
				return nil, err
			}
			// Add target account
			if t.TargetAccountID != nil {
				queryTarget := `UPDATE accounts SET balance = balance + $1, updated_at = NOW() WHERE id = $2`
				_, err = conn.Exec(ctx, queryTarget, t.Amount, *t.TargetAccountID)
			} else {
				return nil, errors.New("target account ID missing for transfer transaction")
			}
		}
		if err != nil {
			return nil, err
		}
	}

	// 4. Save audit log
	if auditLog != nil {
		auditLog.EntityID = t.ID
		newValJSON, _ := json.Marshal(t)
		queryAudit := `
			INSERT INTO audit_logs (user_id, entity_type, entity_id, action, new_value, ip_address, user_agent)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
			RETURNING id, created_at
		`
		err = conn.QueryRow(ctx, queryAudit,
			auditLog.UserID,
			auditLog.EntityType,
			auditLog.EntityID,
			auditLog.Action,
			newValJSON,
			auditLog.IPAddress,
			auditLog.UserAgent,
		).Scan(&auditLog.ID, &auditLog.CreatedAt)
		if err != nil {
			return nil, err
		}
	}

	err = conn.Commit(ctx)
	if err != nil {
		return nil, err
	}
	return t, nil
}

func (r *pgTransactionRepository) GetByID(ctx context.Context, id string) (*model.Transaction, error) {
	// Query transaction details with joined names
	query := `
		SELECT t.id, t.user_id, t.account_id, a.name as account_name, 
		       t.target_account_id, ta.name as target_account_name, 
		       t.category_id, c.name as category_name, c.icon as category_icon, c.color as category_color,
		       t.type, t.amount, t.date, t.description, t.notes, t.is_split, t.source, t.source_confidence,
		       t.status, t.reconciled, t.bill_id, t.debt_payment_id, t.currency, t.exchange_rate, t.tags,
		       t.created_at, t.updated_at
		FROM transactions t
		JOIN accounts a ON a.id = t.account_id
		LEFT JOIN accounts ta ON ta.id = t.target_account_id
		LEFT JOIN categories c ON c.id = t.category_id
		WHERE t.id = $1 AND t.deleted_at IS NULL
	`

	var t model.Transaction
	err := r.db.QueryRow(ctx, query, id).Scan(
		&t.ID,
		&t.UserID,
		&t.AccountID,
		&t.AccountName,
		&t.TargetAccountID,
		&t.TargetAccountName,
		&t.CategoryID,
		&t.CategoryName,
		&t.CategoryIcon,
		&t.CategoryColor,
		&t.Type,
		&t.Amount,
		&t.Date,
		&t.Description,
		&t.Notes,
		&t.IsSplit,
		&t.Source,
		&t.SourceConfidence,
		&t.Status,
		&t.Reconciled,
		&t.BillID,
		&t.DebtPaymentID,
		&t.Currency,
		&t.ExchangeRate,
		&t.Tags,
		&t.CreatedAt,
		&t.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, errors.New("transaction not found")
		}
		return nil, err
	}

	// Fetch splits if split is true
	if t.IsSplit {
		querySplits := `
			SELECT ts.id, ts.transaction_id, ts.category_id, c.name as category_name, ts.amount, ts.description, ts.created_at
			FROM transaction_splits ts
			JOIN categories c ON c.id = ts.category_id
			WHERE ts.transaction_id = $1
			ORDER BY ts.created_at ASC
		`
		rows, err := r.db.Query(ctx, querySplits, t.ID)
		if err == nil {
			defer rows.Close()
			var splits []model.TransactionSplit
			for rows.Next() {
				var s model.TransactionSplit
				err := rows.Scan(&s.ID, &s.TransactionID, &s.CategoryID, &s.CategoryName, &s.Amount, &s.Description, &s.CreatedAt)
				if err == nil {
					splits = append(splits, s)
				}
			}
			t.Splits = splits
		}
	}

	// Fetch attachments
	queryAtts := `
		SELECT id, transaction_id, file_name, file_path, file_type, file_size, created_at
		FROM transaction_attachments
		WHERE transaction_id = $1
		ORDER BY created_at ASC
	`
	rows, err := r.db.Query(ctx, queryAtts, t.ID)
	if err == nil {
		defer rows.Close()
		var attachments []model.TransactionAttachment
		for rows.Next() {
			var a model.TransactionAttachment
			err := rows.Scan(&a.ID, &a.TransactionID, &a.FileName, &a.FilePath, &a.FileType, &a.FileSize, &a.CreatedAt)
			if err == nil {
				attachments = append(attachments, a)
			}
		}
		t.Attachments = attachments
	}

	// Fetch audit logs
	t.AuditLogs, _ = r.GetAuditLogs(ctx, "transaction", t.ID)

	return &t, nil
}

func (r *pgTransactionRepository) GetAll(ctx context.Context, userID string, filters map[string]interface{}, page, pageSize int, sortField, sortOrder string) ([]model.Transaction, int64, error) {
	var countQuery strings.Builder
	var dataQuery strings.Builder
	var whereClauses []string
	var args []interface{}
	argCount := 1

	whereClauses = append(whereClauses, fmt.Sprintf("t.user_id = $%d", argCount))
	args = append(args, userID)
	argCount++

	whereClauses = append(whereClauses, "t.deleted_at IS NULL")

	// Apply filters dynamically
	if fType, exists := filters["type"]; exists && fType != "" {
		whereClauses = append(whereClauses, fmt.Sprintf("t.type = $%d", argCount))
		args = append(args, fType)
		argCount++
	}
	if fCategory, exists := filters["category_id"]; exists && fCategory != "" {
		whereClauses = append(whereClauses, fmt.Sprintf("t.category_id = $%d", argCount))
		args = append(args, fCategory)
		argCount++
	}
	if fAccount, exists := filters["account_id"]; exists && fAccount != "" {
		whereClauses = append(whereClauses, fmt.Sprintf("(t.account_id = $%d OR t.target_account_id = $%d)", argCount, argCount))
		args = append(args, fAccount)
		argCount++
	}
	if fDateFrom, exists := filters["date_from"]; exists && !fDateFrom.(time.Time).IsZero() {
		whereClauses = append(whereClauses, fmt.Sprintf("t.date >= $%d", argCount))
		args = append(args, fDateFrom)
		argCount++
	}
	if fDateTo, exists := filters["date_to"]; exists && !fDateTo.(time.Time).IsZero() {
		whereClauses = append(whereClauses, fmt.Sprintf("t.date <= $%d", argCount))
		args = append(args, fDateTo)
		argCount++
	}
	if fMinAmount, exists := filters["amount_min"]; exists && fMinAmount.(float64) > 0 {
		whereClauses = append(whereClauses, fmt.Sprintf("t.amount >= $%d", argCount))
		args = append(args, fMinAmount)
		argCount++
	}
	if fMaxAmount, exists := filters["amount_max"]; exists && fMaxAmount.(float64) > 0 {
		whereClauses = append(whereClauses, fmt.Sprintf("t.amount <= $%d", argCount))
		args = append(args, fMaxAmount)
		argCount++
	}
	if fSearch, exists := filters["search"]; exists && fSearch != "" {
		whereClauses = append(whereClauses, fmt.Sprintf("t.description ILIKE $%d", argCount))
		args = append(args, "%"+fSearch.(string)+"%")
		argCount++
	}
	if fStatus, exists := filters["status"]; exists && fStatus != "" {
		whereClauses = append(whereClauses, fmt.Sprintf("t.status = $%d", argCount))
		args = append(args, fStatus)
		argCount++
	}
	if fSource, exists := filters["source"]; exists && fSource != "" {
		whereClauses = append(whereClauses, fmt.Sprintf("t.source = $%d", argCount))
		args = append(args, fSource)
		argCount++
	}

	wherePart := strings.Join(whereClauses, " AND ")

	// 1. Get total items count
	countQuery.WriteString("SELECT COUNT(*) FROM transactions t WHERE " + wherePart)
	var totalItems int64
	err := r.db.QueryRow(ctx, countQuery.String(), args...).Scan(&totalItems)
	if err != nil {
		return nil, 0, err
	}

	// 2. Fetch paginated records
	allowedSortFields := map[string]string{
		"date":       "t.date",
		"amount":     "t.amount",
		"created_at": "t.created_at",
	}
	dbSortField := "t.date"
	if field, ok := allowedSortFields[sortField]; ok {
		dbSortField = field
	}

	dbSortOrder := "DESC"
	if strings.ToUpper(sortOrder) == "ASC" {
		dbSortOrder = "ASC"
	}

	dataQuery.WriteString(`
		SELECT t.id, t.user_id, t.account_id, a.name as account_name, 
		       t.target_account_id, ta.name as target_account_name, 
		       t.category_id, c.name as category_name, c.icon as category_icon, c.color as category_color,
		       t.type, t.amount, t.date, t.description, t.notes, t.is_split, t.source, t.source_confidence,
		       t.status, t.reconciled, t.bill_id, t.debt_payment_id, t.currency, t.exchange_rate, t.tags,
		       t.created_at, t.updated_at
		FROM transactions t
		JOIN accounts a ON a.id = t.account_id
		LEFT JOIN accounts ta ON ta.id = t.target_account_id
		LEFT JOIN categories c ON c.id = t.category_id
		WHERE ` + wherePart)

	// Add order by
	dataQuery.WriteString(fmt.Sprintf(" ORDER BY %s %s, t.created_at DESC", dbSortField, dbSortOrder))

	// Add limit & offset
	if page > 0 && pageSize > 0 {
		limit := pageSize
		offset := (page - 1) * pageSize
		dataQuery.WriteString(fmt.Sprintf(" LIMIT %d OFFSET %d", limit, offset))
	}

	rows, err := r.db.Query(ctx, dataQuery.String(), args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var transactions []model.Transaction
	for rows.Next() {
		var t model.Transaction
		err := rows.Scan(
			&t.ID,
			&t.UserID,
			&t.AccountID,
			&t.AccountName,
			&t.TargetAccountID,
			&t.TargetAccountName,
			&t.CategoryID,
			&t.CategoryName,
			&t.CategoryIcon,
			&t.CategoryColor,
			&t.Type,
			&t.Amount,
			&t.Date,
			&t.Description,
			&t.Notes,
			&t.IsSplit,
			&t.Source,
			&t.SourceConfidence,
			&t.Status,
			&t.Reconciled,
			&t.BillID,
			&t.DebtPaymentID,
			&t.Currency,
			&t.ExchangeRate,
			&t.Tags,
			&t.CreatedAt,
			&t.UpdatedAt,
		)
		if err != nil {
			return nil, 0, err
		}
		transactions = append(transactions, t)
	}

	return transactions, totalItems, nil
}

func (r *pgTransactionRepository) Update(ctx context.Context, t *model.Transaction, old model.Transaction, auditLog *model.AuditLog) error {
	conn, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer conn.Rollback(ctx)

	// 1. Reverse balance impact of old transaction (only if confirmed)
	if old.Status == "confirmed" {
		if old.Type == "income" {
			query := `UPDATE accounts SET balance = balance - $1, updated_at = NOW() WHERE id = $2`
			_, err = conn.Exec(ctx, query, old.Amount, old.AccountID)
		} else if old.Type == "expense" {
			query := `UPDATE accounts SET balance = balance + $1, updated_at = NOW() WHERE id = $2`
			_, err = conn.Exec(ctx, query, old.Amount, old.AccountID)
		} else if old.Type == "transfer" {
			querySrc := `UPDATE accounts SET balance = balance + $1, updated_at = NOW() WHERE id = $2`
			_, err = conn.Exec(ctx, querySrc, old.Amount, old.AccountID)
			if err != nil {
				return err
			}
			if old.TargetAccountID != nil {
				queryTarget := `UPDATE accounts SET balance = balance - $1, updated_at = NOW() WHERE id = $2`
				_, err = conn.Exec(ctx, queryTarget, old.Amount, *old.TargetAccountID)
			}
		}
		if err != nil {
			return err
		}
	}

	// 2. Apply balance impact of new transaction (only if confirmed)
	if t.Status == "confirmed" {
		if t.Type == "income" {
			query := `UPDATE accounts SET balance = balance + $1, updated_at = NOW() WHERE id = $2`
			_, err = conn.Exec(ctx, query, t.Amount, t.AccountID)
		} else if t.Type == "expense" {
			query := `UPDATE accounts SET balance = balance - $1, updated_at = NOW() WHERE id = $2`
			_, err = conn.Exec(ctx, query, t.Amount, t.AccountID)
		} else if t.Type == "transfer" {
			querySrc := `UPDATE accounts SET balance = balance - $1, updated_at = NOW() WHERE id = $2`
			_, err = conn.Exec(ctx, querySrc, t.Amount, t.AccountID)
			if err != nil {
				return err
			}
			if t.TargetAccountID != nil {
				queryTarget := `UPDATE accounts SET balance = balance + $1, updated_at = NOW() WHERE id = $2`
				_, err = conn.Exec(ctx, queryTarget, t.Amount, *t.TargetAccountID)
			} else {
				return errors.New("target account ID missing for transfer transaction")
			}
		}
		if err != nil {
			return err
		}
	}

	// 3. Update transaction record
	queryUpdate := `
		UPDATE transactions
		SET account_id = $1, target_account_id = $2, category_id = $3, type = $4, amount = $5, date = $6,
		    description = $7, notes = $8, status = $9, reconciled = $10, tags = $11, updated_at = NOW()
		WHERE id = $12 AND deleted_at IS NULL
	`
	_, err = conn.Exec(ctx, queryUpdate,
		t.AccountID,
		t.TargetAccountID,
		t.CategoryID,
		t.Type,
		t.Amount,
		t.Date,
		t.Description,
		t.Notes,
		t.Status,
		t.Reconciled,
		t.Tags,
		t.ID,
	)
	if err != nil {
		return err
	}

	// 4. Save audit log
	if auditLog != nil {
		oldValJSON, _ := json.Marshal(old)
		newValJSON, _ := json.Marshal(t)
		queryAudit := `
			INSERT INTO audit_logs (user_id, entity_type, entity_id, action, old_value, new_value, ip_address, user_agent)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
			RETURNING id, created_at
		`
		err = conn.QueryRow(ctx, queryAudit,
			auditLog.UserID,
			auditLog.EntityType,
			auditLog.EntityID,
			auditLog.Action,
			oldValJSON,
			newValJSON,
			auditLog.IPAddress,
			auditLog.UserAgent,
		).Scan(&auditLog.ID, &auditLog.CreatedAt)
		if err != nil {
			return err
		}
	}

	return conn.Commit(ctx)
}

func (r *pgTransactionRepository) SoftDelete(ctx context.Context, id string, auditLog *model.AuditLog) error {
	conn, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer conn.Rollback(ctx)

	// 1. Fetch transaction to reverse balance
	queryGet := `SELECT account_id, target_account_id, type, amount, status FROM transactions WHERE id = $1 AND deleted_at IS NULL`
	var t model.Transaction
	err = conn.QueryRow(ctx, queryGet, id).Scan(
		&t.AccountID,
		&t.TargetAccountID,
		&t.Type,
		&t.Amount,
		&t.Status,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return errors.New("transaction not found")
		}
		return err
	}

	// 2. Reverse balance impact (only if confirmed)
	if t.Status == "confirmed" {
		if t.Type == "income" {
			query := `UPDATE accounts SET balance = balance - $1, updated_at = NOW() WHERE id = $2`
			_, err = conn.Exec(ctx, query, t.Amount, t.AccountID)
		} else if t.Type == "expense" {
			query := `UPDATE accounts SET balance = balance + $1, updated_at = NOW() WHERE id = $2`
			_, err = conn.Exec(ctx, query, t.Amount, t.AccountID)
		} else if t.Type == "transfer" {
			querySrc := `UPDATE accounts SET balance = balance + $1, updated_at = NOW() WHERE id = $2`
			_, err = conn.Exec(ctx, querySrc, t.Amount, t.AccountID)
			if err != nil {
				return err
			}
			if t.TargetAccountID != nil {
				queryTarget := `UPDATE accounts SET balance = balance - $1, updated_at = NOW() WHERE id = $2`
				_, err = conn.Exec(ctx, queryTarget, t.Amount, *t.TargetAccountID)
			}
		}
	}
	if err != nil {
		return err
	}

	// 3. Soft delete transaction
	queryDelete := `UPDATE transactions SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL`
	_, err = conn.Exec(ctx, queryDelete, id)
	if err != nil {
		return err
	}

	// 4. Save audit log
	if auditLog != nil {
		oldValJSON, _ := json.Marshal(t)
		queryAudit := `
			INSERT INTO audit_logs (user_id, entity_type, entity_id, action, old_value, ip_address, user_agent)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
			RETURNING id, created_at
		`
		err = conn.QueryRow(ctx, queryAudit,
			auditLog.UserID,
			auditLog.EntityType,
			id,
			auditLog.Action,
			oldValJSON,
			auditLog.IPAddress,
			auditLog.UserAgent,
		).Scan(&auditLog.ID, &auditLog.CreatedAt)
		if err != nil {
			return err
		}
	}

	return conn.Commit(ctx)
}

func (r *pgTransactionRepository) GetSummary(ctx context.Context, userID string, dateFrom, dateTo time.Time) (*model.TransactionSummary, error) {
	// Summary calculates total income and total expense for user in selected period (excluding transfers!)
	query := `
		SELECT 
			COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) as total_income,
			COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) as total_expense
		FROM transactions
		WHERE user_id = $1 AND deleted_at IS NULL AND status = 'confirmed' AND date >= $2 AND date <= $3
	`
	var summary model.TransactionSummary
	err := r.db.QueryRow(ctx, query, userID, dateFrom, dateTo).Scan(&summary.TotalIncome, &summary.TotalExpense)
	if err != nil {
		return nil, err
	}
	summary.Net = summary.TotalIncome - summary.TotalExpense
	return &summary, nil
}

func (r *pgTransactionRepository) SaveAttachment(ctx context.Context, a *model.TransactionAttachment) (*model.TransactionAttachment, error) {
	query := `
		INSERT INTO transaction_attachments (transaction_id, file_name, file_path, file_type, file_size)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, created_at
	`
	err := r.db.QueryRow(ctx, query,
		a.TransactionID,
		a.FileName,
		a.FilePath,
		a.FileType,
		a.FileSize,
	).Scan(&a.ID, &a.CreatedAt)

	if err != nil {
		return nil, err
	}
	return a, nil
}

func (r *pgTransactionRepository) DeleteAttachment(ctx context.Context, id string) error {
	query := `DELETE FROM transaction_attachments WHERE id = $1`
	_, err := r.db.Exec(ctx, query, id)
	return err
}

func (r *pgTransactionRepository) CreateAuditLog(ctx context.Context, log *model.AuditLog) error {
	newValJSON, _ := json.Marshal(log.NewValue)
	oldValJSON, _ := json.Marshal(log.OldValue)

	query := `
		INSERT INTO audit_logs (user_id, entity_type, entity_id, action, old_value, new_value, ip_address, user_agent)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id, created_at
	`
	return r.db.QueryRow(ctx, query,
		log.UserID,
		log.EntityType,
		log.EntityID,
		log.Action,
		oldValJSON,
		newValJSON,
		log.IPAddress,
		log.UserAgent,
	).Scan(&log.ID, &log.CreatedAt)
}

func (r *pgTransactionRepository) GetAuditLogs(ctx context.Context, entityType, entityID string) ([]model.AuditLog, error) {
	query := `
		SELECT l.id, l.user_id, u.name as user_name, u.role as user_role, l.entity_type, l.entity_id, l.action, l.old_value, l.new_value, l.ip_address, l.user_agent, l.created_at
		FROM audit_logs l
		JOIN users u ON u.id = l.user_id
		WHERE l.entity_type = $1 AND l.entity_id = $2
		ORDER BY l.created_at DESC
	`
	rows, err := r.db.Query(ctx, query, entityType, entityID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var logs []model.AuditLog
	for rows.Next() {
		var l model.AuditLog
		var oldValJSON []byte
		var newValJSON []byte

		err := rows.Scan(
			&l.ID,
			&l.UserID,
			&l.UserName,
			&l.UserRole,
			&l.EntityType,
			&l.EntityID,
			&l.Action,
			&oldValJSON,
			&newValJSON,
			&l.IPAddress,
			&l.UserAgent,
			&l.CreatedAt,
		)
		if err != nil {
			return nil, err
		}

		if len(oldValJSON) > 0 {
			json.Unmarshal(oldValJSON, &l.OldValue)
		}
		if len(newValJSON) > 0 {
			json.Unmarshal(newValJSON, &l.NewValue)
		}

		logs = append(logs, l)
	}
	return logs, nil
}

func (r *pgTransactionRepository) SplitTransaction(ctx context.Context, txID string, splits []model.TransactionSplit, auditLog *model.AuditLog) error {
	conn, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer conn.Rollback(ctx)

	// 1. Delete existing splits if any
	_, err = conn.Exec(ctx, "DELETE FROM transaction_splits WHERE transaction_id = $1", txID)
	if err != nil {
		return err
	}

	// 2. Insert new splits
	for _, s := range splits {
		_, err = conn.Exec(ctx, `
			INSERT INTO transaction_splits (transaction_id, category_id, amount, description)
			VALUES ($1, $2, $3, $4)
		`, txID, s.CategoryID, s.Amount, s.Description)
		if err != nil {
			return err
		}
	}

	// 3. Update parent transaction: is_split = true, category_id = NULL
	_, err = conn.Exec(ctx, `
		UPDATE transactions
		SET is_split = true, category_id = NULL, updated_at = NOW()
		WHERE id = $1
	`, txID)
	if err != nil {
		return err
	}

	// 4. Insert Audit Log
	if auditLog != nil {
		oldValJSON, _ := json.Marshal(auditLog.OldValue)
		newValJSON, _ := json.Marshal(auditLog.NewValue)
		_, err = conn.Exec(ctx, `
			INSERT INTO audit_logs (user_id, entity_type, entity_id, action, old_value, new_value, ip_address, user_agent)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		`, auditLog.UserID, auditLog.EntityType, auditLog.EntityID, auditLog.Action, oldValJSON, newValJSON, auditLog.IPAddress, auditLog.UserAgent)
		if err != nil {
			return err
		}
	}

	return conn.Commit(ctx)
}

func (r *pgTransactionRepository) GetGlobalAuditLogs(ctx context.Context, ownerID string, entityType string, dateFrom, dateTo *time.Time, targetUserID string) ([]model.AuditLog, error) {
	var query strings.Builder
	query.WriteString(`
		SELECT l.id, l.user_id, u.name as user_name, u.role as user_role, l.entity_type, l.entity_id, l.action, l.old_value, l.new_value, l.ip_address, l.user_agent, l.created_at
		FROM audit_logs l
		JOIN users u ON u.id = l.user_id
		WHERE (l.user_id = $1 OR u.invited_by = $1 OR l.user_id = (SELECT COALESCE(invited_by, '00000000-0000-0000-0000-000000000000'::uuid) FROM users WHERE id = $1))
	`)

	args := []interface{}{ownerID}
	argIdx := 2

	if entityType != "" {
		query.WriteString(fmt.Sprintf(" AND l.entity_type = $%d", argIdx))
		args = append(args, entityType)
		argIdx++
	}

	if dateFrom != nil {
		query.WriteString(fmt.Sprintf(" AND l.created_at >= $%d", argIdx))
		args = append(args, *dateFrom)
		argIdx++
	}

	if dateTo != nil {
		query.WriteString(fmt.Sprintf(" AND l.created_at <= $%d", argIdx))
		args = append(args, *dateTo)
		argIdx++
	}

	if targetUserID != "" {
		query.WriteString(fmt.Sprintf(" AND l.user_id = $%d", argIdx))
		args = append(args, targetUserID)
		argIdx++
	}

	query.WriteString(" ORDER BY l.created_at DESC LIMIT 200")

	rows, err := r.db.Query(ctx, query.String(), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	logs := make([]model.AuditLog, 0)
	for rows.Next() {
		var l model.AuditLog
		var oldValJSON []byte
		var newValJSON []byte
		err := rows.Scan(
			&l.ID,
			&l.UserID,
			&l.UserName,
			&l.UserRole,
			&l.EntityType,
			&l.EntityID,
			&l.Action,
			&oldValJSON,
			&newValJSON,
			&l.IPAddress,
			&l.UserAgent,
			&l.CreatedAt,
		)
		if err != nil {
			return nil, err
		}

		if len(oldValJSON) > 0 {
			json.Unmarshal(oldValJSON, &l.OldValue)
		}
		if len(newValJSON) > 0 {
			json.Unmarshal(newValJSON, &l.NewValue)
		}

		logs = append(logs, l)
	}
	return logs, nil
}
