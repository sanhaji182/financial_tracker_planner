package model

import (
	"time"
)

type User struct {
	ID              string     `json:"id" db:"id"`
	Email           string     `json:"email" db:"email"`
	PasswordHash    string     `json:"-" db:"password_hash"`
	Name            string     `json:"name" db:"name"`
	Role            string     `json:"role" db:"role"`
	InvitedBy       *string    `json:"invited_by,omitempty" db:"invited_by"`
	AvatarURL       *string    `json:"avatar_url,omitempty" db:"avatar_url"`
	Timezone        string     `json:"timezone" db:"timezone"`
	CurrencyDefault string     `json:"currency_default" db:"currency_default"`
	IsActive        bool       `json:"is_active" db:"is_active"`
	LastLoginAt     *time.Time `json:"last_login_at,omitempty" db:"last_login_at"`
	CreatedAt       time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at" db:"updated_at"`
	DeletedAt       *time.Time `json:"-" db:"deleted_at"`
}

type UserResponse struct {
	ID              string     `json:"id"`
	Email           string     `json:"email"`
	Name            string     `json:"name"`
	Role            string     `json:"role"`
	InvitedBy       *string    `json:"invited_by,omitempty"`
	AvatarURL       *string    `json:"avatar_url,omitempty"`
	Timezone        string     `json:"timezone"`
	CurrencyDefault string     `json:"currency_default"`
	LastLoginAt     *time.Time `json:"last_login_at,omitempty"`
	CreatedAt       time.Time  `json:"created_at"`
}

type RefreshToken struct {
	ID        string    `json:"id" db:"id"`
	UserID    string    `json:"user_id" db:"user_id"`
	TokenHash string    `json:"token_hash" db:"token_hash"`
	ExpiresAt time.Time `json:"expires_at" db:"expires_at"`
	IsRevoked bool      `json:"is_revoked" db:"is_revoked"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
}

func (u *User) ToResponse() UserResponse {
	return UserResponse{
		ID:              u.ID,
		Email:           u.Email,
		Name:            u.Name,
		Role:            u.Role,
		InvitedBy:       u.InvitedBy,
		AvatarURL:       u.AvatarURL,
		Timezone:        u.Timezone,
		CurrencyDefault: u.CurrencyDefault,
		LastLoginAt:     u.LastLoginAt,
		CreatedAt:       u.CreatedAt,
	}
}
