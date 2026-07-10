package repository

import (
	"context"
	"errors"
	"fmt"
	"encoding/json"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/user/financial-os/internal/model"
)

type AssetRepository interface {
	Create(ctx context.Context, a *model.Asset) (*model.Asset, error)
	GetByID(ctx context.Context, id string) (*model.Asset, error)
	GetAllByUser(ctx context.Context, userID string, typeFilter *string, isSharedFilter *bool) ([]model.Asset, error)
	Update(ctx context.Context, a *model.Asset) error
	SoftDelete(ctx context.Context, id string) error
	CreateValuation(ctx context.Context, v *model.AssetValuation) (*model.AssetValuation, error)
	GetValuationsByAsset(ctx context.Context, assetID string) ([]model.AssetValuation, error)
	GetSummaryByUser(ctx context.Context, userID string) (*model.AssetSummary, error)
}

type pgAssetRepository struct {
	db *pgxpool.Pool
}

func NewAssetRepository(db *pgxpool.Pool) AssetRepository {
	return &pgAssetRepository{db: db}
}

func (r *pgAssetRepository) Create(ctx context.Context, a *model.Asset) (*model.Asset, error) {
	query := `
		INSERT INTO assets (user_id, name, type, current_value, purchase_value, purchase_date, currency, linked_account_id, is_shared, is_liquid, notes, metadata)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
		RETURNING id, created_at, updated_at
	`
	err := r.db.QueryRow(ctx, query,
		a.UserID,
		a.Name,
		a.Type,
		a.CurrentValue,
		a.PurchaseValue,
		a.PurchaseDate,
		a.Currency,
		a.LinkedAccountID,
		a.IsShared,
		a.IsLiquid,
		a.Notes,
		a.Metadata,
	).Scan(&a.ID, &a.CreatedAt, &a.UpdatedAt)

	if err != nil {
		return nil, err
	}
	r.createAuditLog(ctx, a.UserID, "asset", a.ID, "create", nil, a)
	return a, nil
}

func (r *pgAssetRepository) GetByID(ctx context.Context, id string) (*model.Asset, error) {
	query := `
		SELECT ast.id, ast.user_id, ast.name, ast.type, ast.current_value, ast.purchase_value, ast.purchase_date,
		       ast.currency, ast.linked_account_id, acc.name as linked_account_name, ast.is_shared, ast.is_liquid,
		       ast.notes, ast.metadata, ast.created_at, ast.updated_at
		FROM assets ast
		LEFT JOIN accounts acc ON acc.id = ast.linked_account_id
		WHERE ast.id = $1 AND ast.deleted_at IS NULL
	`

	var a model.Asset
	err := r.db.QueryRow(ctx, query, id).Scan(
		&a.ID,
		&a.UserID,
		&a.Name,
		&a.Type,
		&a.CurrentValue,
		&a.PurchaseValue,
		&a.PurchaseDate,
		&a.Currency,
		&a.LinkedAccountID,
		&a.LinkedAccountName,
		&a.IsShared,
		&a.IsLiquid,
		&a.Notes,
		&a.Metadata,
		&a.CreatedAt,
		&a.UpdatedAt,
	)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, errors.New("asset not found")
		}
		return nil, err
	}
	return &a, nil
}

func (r *pgAssetRepository) GetAllByUser(ctx context.Context, userID string, typeFilter *string, isSharedFilter *bool) ([]model.Asset, error) {
	var queryBuilder strings.Builder
	var args []interface{}
	argCount := 1

	queryBuilder.WriteString(`
		SELECT ast.id, ast.user_id, ast.name, ast.type, ast.current_value, ast.purchase_value, ast.purchase_date,
		       ast.currency, ast.linked_account_id, acc.name as linked_account_name, ast.is_shared, ast.is_liquid,
		       ast.notes, ast.metadata, ast.created_at, ast.updated_at
		FROM assets ast
		LEFT JOIN accounts acc ON acc.id = ast.linked_account_id
		WHERE ast.user_id = $1 AND ast.deleted_at IS NULL
	`)
	args = append(args, userID)
	argCount++

	if typeFilter != nil && *typeFilter != "" {
		queryBuilder.WriteString(fmt.Sprintf(" AND ast.type = $%d", argCount))
		args = append(args, *typeFilter)
		argCount++
	}

	if isSharedFilter != nil {
		queryBuilder.WriteString(fmt.Sprintf(" AND ast.is_shared = $%d", argCount))
		args = append(args, *isSharedFilter)
		argCount++
	}

	queryBuilder.WriteString(" ORDER BY ast.created_at DESC")

	rows, err := r.db.Query(ctx, queryBuilder.String(), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []model.Asset
	for rows.Next() {
		var a model.Asset
		err := rows.Scan(
			&a.ID,
			&a.UserID,
			&a.Name,
			&a.Type,
			&a.CurrentValue,
			&a.PurchaseValue,
			&a.PurchaseDate,
			&a.Currency,
			&a.LinkedAccountID,
			&a.LinkedAccountName,
			&a.IsShared,
			&a.IsLiquid,
			&a.Notes,
			&a.Metadata,
			&a.CreatedAt,
			&a.UpdatedAt,
		)
		if err != nil {
			return nil, err
		}
		list = append(list, a)
	}
	return list, nil
}

func (r *pgAssetRepository) Update(ctx context.Context, a *model.Asset) error {
	oldA, errOld := r.GetByID(ctx, a.ID)

	query := `
		UPDATE assets
		SET name = $1, current_value = $2, purchase_value = $3, purchase_date = $4, is_shared = $5, is_liquid = $6, notes = $7, metadata = $8, updated_at = NOW()
		WHERE id = $9 AND deleted_at IS NULL
	`
	_, err := r.db.Exec(ctx, query,
		a.Name,
		a.CurrentValue,
		a.PurchaseValue,
		a.PurchaseDate,
		a.IsShared,
		a.IsLiquid,
		a.Notes,
		a.Metadata,
		a.ID,
	)
	if err == nil && errOld == nil {
		r.createAuditLog(ctx, a.UserID, "asset", a.ID, "update", oldA, a)
	}
	return err
}

func (r *pgAssetRepository) SoftDelete(ctx context.Context, id string) error {
	oldA, errOld := r.GetByID(ctx, id)
	query := `UPDATE assets SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1`
	_, err := r.db.Exec(ctx, query, id)
	if err == nil && errOld == nil {
		r.createAuditLog(ctx, oldA.UserID, "asset", id, "delete", oldA, nil)
	}
	return err
}

func (r *pgAssetRepository) CreateValuation(ctx context.Context, v *model.AssetValuation) (*model.AssetValuation, error) {
	query := `
		INSERT INTO asset_valuations (asset_id, value, valuation_date, source, notes)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, created_at
	`
	err := r.db.QueryRow(ctx, query,
		v.AssetID,
		v.Value,
		v.ValuationDate,
		v.Source,
		v.Notes,
	).Scan(&v.ID, &v.CreatedAt)

	if err != nil {
		return nil, err
	}
	return v, nil
}

func (r *pgAssetRepository) GetValuationsByAsset(ctx context.Context, assetID string) ([]model.AssetValuation, error) {
	query := `
		SELECT id, asset_id, value, valuation_date, source, notes, created_at
		FROM asset_valuations
		WHERE asset_id = $1
		ORDER BY valuation_date ASC, created_at ASC
	`
	rows, err := r.db.Query(ctx, query, assetID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []model.AssetValuation
	for rows.Next() {
		var v model.AssetValuation
		err := rows.Scan(
			&v.ID,
			&v.AssetID,
			&v.Value,
			&v.ValuationDate,
			&v.Source,
			&v.Notes,
			&v.CreatedAt,
		)
		if err != nil {
			return nil, err
		}
		list = append(list, v)
	}
	return list, nil
}

func (r *pgAssetRepository) GetSummaryByUser(ctx context.Context, userID string) (*model.AssetSummary, error) {
	// Query total asset breakdown by type
	queryBreakdown := `
		SELECT type, COALESCE(SUM(current_value), 0)
		FROM assets
		WHERE user_id = $1 AND deleted_at IS NULL
		GROUP BY type
	`
	rows, err := r.db.Query(ctx, queryBreakdown, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var breakdown []model.AssetTypeSummary
	typeSet := make(map[string]bool)
	for rows.Next() {
		var b model.AssetTypeSummary
		if err := rows.Scan(&b.Type, &b.Total); err == nil {
			breakdown = append(breakdown, b)
			typeSet[b.Type] = true
		}
	}

	// Add missing asset types as 0 to have clean data structure
	allowedTypes := []string{"savings", "property", "vehicle", "investment", "cash", "e_wallet", "deposit", "other"}
	for _, t := range allowedTypes {
		if !typeSet[t] {
			breakdown = append(breakdown, model.AssetTypeSummary{Type: t, Total: 0})
		}
	}

	// Query main aggregated metrics
	queryAggregations := `
		SELECT 
			COALESCE(SUM(current_value), 0) as total_assets,
			COALESCE(SUM(CASE WHEN is_liquid = true THEN current_value ELSE 0 END), 0) as total_liquid,
			COALESCE(SUM(CASE WHEN is_shared = true THEN current_value ELSE 0 END), 0) as total_shared,
			COALESCE(SUM(CASE WHEN is_shared = false THEN current_value ELSE 0 END), 0) as total_private
		FROM assets
		WHERE user_id = $1 AND deleted_at IS NULL
	`

	var s model.AssetSummary
	err = r.db.QueryRow(ctx, queryAggregations, userID).Scan(
		&s.TotalAssets,
		&s.TotalLiquid,
		&s.TotalShared,
		&s.TotalPrivate,
	)
	if err != nil {
		return nil, err
	}
	s.BreakdownByType = breakdown

	return &s, nil
}

func (r *pgAssetRepository) createAuditLog(ctx context.Context, userID, entityType, entityID, action string, oldValue, newValue interface{}) {
	oldValJSON, _ := json.Marshal(oldValue)
	newValJSON, _ := json.Marshal(newValue)
	_, _ = r.db.Exec(ctx, `
		INSERT INTO audit_logs (user_id, entity_type, entity_id, action, old_value, new_value)
		VALUES ($1, $2, $3::uuid, $4, $5, $6)
	`, userID, entityType, entityID, action, oldValJSON, newValJSON)
}
