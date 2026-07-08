package repository

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/user/financial-os/internal/model"
)

type UserRepository interface {
	CreateUser(ctx context.Context, user *model.User) (*model.User, error)
	GetUserByEmail(ctx context.Context, email string) (*model.User, error)
	GetUserByID(ctx context.Context, id string) (*model.User, error)
	UpdateUser(ctx context.Context, user *model.User) error
	
	CreateRefreshToken(ctx context.Context, token *model.RefreshToken) error
	GetRefreshToken(ctx context.Context, tokenHash string) (*model.RefreshToken, error)
	RevokeRefreshToken(ctx context.Context, tokenHash string) error
	RevokeAllUserTokens(ctx context.Context, userID string) error
}

type pgUserRepository struct {
	db *pgxpool.Pool
}

func NewUserRepository(db *pgxpool.Pool) UserRepository {
	return &pgUserRepository{db: db}
}

func (r *pgUserRepository) CreateUser(ctx context.Context, user *model.User) (*model.User, error) {
	query := `
		INSERT INTO users (email, password_hash, name, role, invited_by, avatar_url, timezone, currency_default, is_active)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		RETURNING id, created_at, updated_at
	`
	err := r.db.QueryRow(ctx, query,
		user.Email,
		user.PasswordHash,
		user.Name,
		user.Role,
		user.InvitedBy,
		user.AvatarURL,
		user.Timezone,
		user.CurrencyDefault,
		user.IsActive,
	).Scan(&user.ID, &user.CreatedAt, &user.UpdatedAt)

	if err != nil {
		return nil, err
	}
	return user, nil
}

func (r *pgUserRepository) GetUserByEmail(ctx context.Context, email string) (*model.User, error) {
	query := `
		SELECT id, email, password_hash, name, role, invited_by, avatar_url, timezone, currency_default, is_active, last_login_at, created_at, updated_at, deleted_at
		FROM users
		WHERE email = $1 AND deleted_at IS NULL
	`
	var user model.User
	err := r.db.QueryRow(ctx, query, email).Scan(
		&user.ID,
		&user.Email,
		&user.PasswordHash,
		&user.Name,
		&user.Role,
		&user.InvitedBy,
		&user.AvatarURL,
		&user.Timezone,
		&user.CurrencyDefault,
		&user.IsActive,
		&user.LastLoginAt,
		&user.CreatedAt,
		&user.UpdatedAt,
		&user.DeletedAt,
	)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, errors.New("user not found")
		}
		return nil, err
	}
	return &user, nil
}

func (r *pgUserRepository) GetUserByID(ctx context.Context, id string) (*model.User, error) {
	query := `
		SELECT id, email, password_hash, name, role, invited_by, avatar_url, timezone, currency_default, is_active, last_login_at, created_at, updated_at, deleted_at
		FROM users
		WHERE id = $1 AND deleted_at IS NULL
	`
	var user model.User
	err := r.db.QueryRow(ctx, query, id).Scan(
		&user.ID,
		&user.Email,
		&user.PasswordHash,
		&user.Name,
		&user.Role,
		&user.InvitedBy,
		&user.AvatarURL,
		&user.Timezone,
		&user.CurrencyDefault,
		&user.IsActive,
		&user.LastLoginAt,
		&user.CreatedAt,
		&user.UpdatedAt,
		&user.DeletedAt,
	)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, errors.New("user not found")
		}
		return nil, err
	}
	return &user, nil
}

func (r *pgUserRepository) UpdateUser(ctx context.Context, user *model.User) error {
	query := `
		UPDATE users
		SET email = $1, password_hash = $2, name = $3, role = $4, invited_by = $5, 
			avatar_url = $6, timezone = $7, currency_default = $8, is_active = $9, 
			last_login_at = $10, updated_at = NOW(), deleted_at = $11
		WHERE id = $12
	`
	_, err := r.db.Exec(ctx, query,
		user.Email,
		user.PasswordHash,
		user.Name,
		user.Role,
		user.InvitedBy,
		user.AvatarURL,
		user.Timezone,
		user.CurrencyDefault,
		user.IsActive,
		user.LastLoginAt,
		user.DeletedAt,
		user.ID,
	)
	return err
}

func (r *pgUserRepository) CreateRefreshToken(ctx context.Context, token *model.RefreshToken) error {
	query := `
		INSERT INTO refresh_tokens (user_id, token_hash, expires_at, is_revoked)
		VALUES ($1, $2, $3, $4)
		RETURNING id, created_at
	`
	return r.db.QueryRow(ctx, query,
		token.UserID,
		token.TokenHash,
		token.ExpiresAt,
		token.IsRevoked,
	).Scan(&token.ID, &token.CreatedAt)
}

func (r *pgUserRepository) GetRefreshToken(ctx context.Context, tokenHash string) (*model.RefreshToken, error) {
	query := `
		SELECT id, user_id, token_hash, expires_at, is_revoked, created_at
		FROM refresh_tokens
		WHERE token_hash = $1
	`
	var token model.RefreshToken
	err := r.db.QueryRow(ctx, query, tokenHash).Scan(
		&token.ID,
		&token.UserID,
		&token.TokenHash,
		&token.ExpiresAt,
		&token.IsRevoked,
		&token.CreatedAt,
	)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, errors.New("refresh token not found")
		}
		return nil, err
	}
	return &token, nil
}

func (r *pgUserRepository) RevokeRefreshToken(ctx context.Context, tokenHash string) error {
	query := `
		UPDATE refresh_tokens
		SET is_revoked = true
		WHERE token_hash = $1
	`
	_, err := r.db.Exec(ctx, query, tokenHash)
	return err
}

func (r *pgUserRepository) RevokeAllUserTokens(ctx context.Context, userID string) error {
	query := `
		UPDATE refresh_tokens
		SET is_revoked = true
		WHERE user_id = $1 AND is_revoked = false
	`
	_, err := r.db.Exec(ctx, query, userID)
	return err
}
