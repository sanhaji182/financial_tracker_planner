package repository

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/user/financial-os/internal/model"
)

type CategoryRepository interface {
	GetAll(ctx context.Context, userID string) ([]model.Category, error)
	GetByID(ctx context.Context, id string) (*model.Category, error)
	Create(ctx context.Context, c *model.Category) (*model.Category, error)
	Update(ctx context.Context, c *model.Category) error
	SoftDelete(ctx context.Context, id string) error
}

type pgCategoryRepository struct {
	db *pgxpool.Pool
}

func NewCategoryRepository(db *pgxpool.Pool) CategoryRepository {
	return &pgCategoryRepository{db: db}
}

func (r *pgCategoryRepository) GetAll(ctx context.Context, userID string) ([]model.Category, error) {
	query := `
		SELECT id, user_id, parent_id, name, type, icon, color, is_system, sort_order, created_at, updated_at, deleted_at
		FROM categories
		WHERE (user_id = $1 OR user_id IS NULL) AND deleted_at IS NULL
		ORDER BY type ASC, sort_order ASC, name ASC
	`
	rows, err := r.db.Query(ctx, query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []model.Category
	for rows.Next() {
		var c model.Category
		err := rows.Scan(
			&c.ID,
			&c.UserID,
			&c.ParentID,
			&c.Name,
			&c.Type,
			&c.Icon,
			&c.Color,
			&c.IsSystem,
			&c.SortOrder,
			&c.CreatedAt,
			&c.UpdatedAt,
			&c.DeletedAt,
		)
		if err != nil {
			return nil, err
		}
		list = append(list, c)
	}
	return list, nil
}

func (r *pgCategoryRepository) GetByID(ctx context.Context, id string) (*model.Category, error) {
	query := `
		SELECT id, user_id, parent_id, name, type, icon, color, is_system, sort_order, created_at, updated_at, deleted_at
		FROM categories
		WHERE id = $1 AND deleted_at IS NULL
	`
	var c model.Category
	err := r.db.QueryRow(ctx, query, id).Scan(
		&c.ID,
		&c.UserID,
		&c.ParentID,
		&c.Name,
		&c.Type,
		&c.Icon,
		&c.Color,
		&c.IsSystem,
		&c.SortOrder,
		&c.CreatedAt,
		&c.UpdatedAt,
		&c.DeletedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, errors.New("category not found")
		}
		return nil, err
	}
	return &c, nil
}

func (r *pgCategoryRepository) Create(ctx context.Context, c *model.Category) (*model.Category, error) {
	query := `
		INSERT INTO categories (user_id, parent_id, name, type, icon, color, is_system, sort_order)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id, created_at, updated_at
	`
	err := r.db.QueryRow(ctx, query,
		c.UserID,
		c.ParentID,
		c.Name,
		c.Type,
		c.Icon,
		c.Color,
		c.IsSystem,
		c.SortOrder,
	).Scan(&c.ID, &c.CreatedAt, &c.UpdatedAt)

	if err != nil {
		return nil, err
	}
	return c, nil
}

func (r *pgCategoryRepository) Update(ctx context.Context, c *model.Category) error {
	query := `
		UPDATE categories
		SET name = $1, icon = $2, color = $3, parent_id = $4, updated_at = NOW()
		WHERE id = $5 AND deleted_at IS NULL AND is_system = false
	`
	_, err := r.db.Exec(ctx, query,
		c.Name,
		c.Icon,
		c.Color,
		c.ParentID,
		c.ID,
	)
	return err
}

func (r *pgCategoryRepository) SoftDelete(ctx context.Context, id string) error {
	query := `
		UPDATE categories
		SET deleted_at = NOW(), updated_at = NOW()
		WHERE id = $1 AND deleted_at IS NULL AND is_system = false
	`
	_, err := r.db.Exec(ctx, query, id)
	return err
}
