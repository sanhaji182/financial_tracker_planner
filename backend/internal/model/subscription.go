package model

import "time"

type Subscription struct {
	ID               string     `json:"id" db:"id"`
	UserID           string     `json:"user_id" db:"user_id"`
	Name             string     `json:"name" db:"name"`
	Provider         *string    `json:"provider,omitempty" db:"provider"`
	Amount           float64    `json:"amount" db:"amount"`
	Currency         string     `json:"currency" db:"currency"`
	Frequency        string     `json:"frequency" db:"frequency"`
	CategoryID       *string    `json:"category_id,omitempty" db:"category_id"`
	NextRenewalDate  *time.Time `json:"next_renewal_date,omitempty" db:"next_renewal_date"`
	LastUsedDate     *time.Time `json:"last_used_date,omitempty" db:"last_used_date"`
	IsActive         bool       `json:"is_active" db:"is_active"`
	AutoRenew        bool       `json:"auto_renew" db:"auto_renew"`
	Notes            *string    `json:"notes,omitempty" db:"notes"`
	CreatedAt        time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at" db:"updated_at"`
	DeletedAt        *time.Time `json:"-" db:"deleted_at"`
}
