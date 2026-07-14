package model

import (
	"time"
)

type Account struct {
	ID                  string     `json:"id" db:"id"`
	UserID              string     `json:"user_id" db:"user_id"`
	Name                string     `json:"name" db:"name"`
	Type                string     `json:"type" db:"type"` // bank, e_wallet, cash, investment, deposit
	BankProvider        *string    `json:"bank_provider,omitempty" db:"bank_provider"`
	AccountNumberMasked *string    `json:"account_number_masked,omitempty" db:"account_number_masked"`
	Balance             Money      `json:"balance" db:"balance"`
	InitialBalance      Money      `json:"initial_balance" db:"initial_balance"`
	Currency            string     `json:"currency" db:"currency"`
	Icon                *string    `json:"icon,omitempty" db:"icon"`
	Color               *string    `json:"color,omitempty" db:"color"`
	IsActive            bool       `json:"is_active" db:"is_active"`
	IsShared            bool       `json:"is_shared" db:"is_shared"`
	IsEmergencyFund     bool       `json:"is_emergency_fund" db:"is_emergency_fund"`
	SortOrder           int        `json:"sort_order" db:"sort_order"`
	Notes               *string    `json:"notes,omitempty" db:"notes"`
	CreatedAt           time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt           time.Time  `json:"updated_at" db:"updated_at"`
	DeletedAt           *time.Time `json:"-" db:"deleted_at"`
}

type AccountSummary struct {
	TotalBank       Money `json:"total_bank"`
	TotalEWallet    Money `json:"total_e_wallet"`
	TotalCash       Money `json:"total_cash"`
	TotalInvestment Money `json:"total_investment"`
	TotalDeposit    Money `json:"total_deposit"`
	GrandTotal      Money `json:"grand_total"`
}
