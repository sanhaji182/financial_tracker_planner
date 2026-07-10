package model

import "time"

type Goal struct {
	ID              string     `json:"id" db:"id"`
	UserID          string     `json:"user_id" db:"user_id"`
	Name            string     `json:"name" db:"name"`
	Type            string     `json:"type" db:"type"`
	TargetAmount    float64    `json:"target_amount" db:"target_amount"`
	CurrentAmount   float64    `json:"current_amount" db:"current_amount"`
	TargetDate      *time.Time `json:"target_date,omitempty" db:"target_date"`
	LinkedAccountID *string    `json:"linked_account_id,omitempty" db:"linked_account_id"`
	LinkedDebtID    *string    `json:"linked_debt_id,omitempty" db:"linked_debt_id"`
	Icon            *string    `json:"icon,omitempty" db:"icon"`
	Color           *string    `json:"color,omitempty" db:"color"`
	Status          string     `json:"status" db:"status"`
	Notes           *string    `json:"notes,omitempty" db:"notes"`
	CreatedAt       time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at" db:"updated_at"`
	DeletedAt       *time.Time `json:"-" db:"deleted_at"`
}
