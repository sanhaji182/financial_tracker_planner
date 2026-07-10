package model

import (
	"time"
)

type Debt struct {
	ID                 string     `json:"id" db:"id"`
	UserID             string     `json:"user_id" db:"user_id"`
	Name               string     `json:"name" db:"name"`
	Type               string     `json:"type" db:"type"` // kpr, credit_card, installment, personal_loan, other
	Creditor           *string    `json:"creditor,omitempty" db:"creditor"`
	OriginalAmount     float64    `json:"original_amount" db:"original_amount"`
	OutstandingBalance float64    `json:"outstanding_balance" db:"outstanding_balance"`
	InterestRate       *float64   `json:"interest_rate,omitempty" db:"interest_rate"` // annual rate, e.g., 12.50 for 12.5%
	MinimumPayment     *float64   `json:"minimum_payment,omitempty" db:"minimum_payment"`
	DueDay             *int       `json:"due_day,omitempty" db:"due_day"`
	StartDate          *time.Time `json:"start_date,omitempty" db:"start_date"`
	EndDate            *time.Time `json:"end_date,omitempty" db:"end_date"`
	TenorMonths        *int       `json:"tenor_months,omitempty" db:"tenor_months"`
	AccountID          *string    `json:"account_id,omitempty" db:"account_id"`
	AccountName        *string    `json:"account_name,omitempty"` // join field
	Currency           string     `json:"currency" db:"currency"`
	Status             string     `json:"status" db:"status"` // active, paid_off, defaulted, restructured
	Notes              *string    `json:"notes,omitempty" db:"notes"`
	IsShared           bool       `json:"is_shared" db:"is_shared"`
	CreatedAt          time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt          time.Time  `json:"updated_at" db:"updated_at"`
	DeletedAt          *time.Time `json:"-" db:"deleted_at"`
}

type DebtPayment struct {
	ID             string    `json:"id" db:"id"`
	DebtID         string    `json:"debt_id" db:"debt_id"`
	Amount         float64   `json:"amount" db:"amount"`
	PaymentDate    time.Time `json:"payment_date" db:"payment_date"`
	IsExtraPayment bool      `json:"is_extra_payment" db:"is_extra_payment"`
	PrincipalPortion *float64 `json:"principal_portion,omitempty" db:"principal_portion"`
	InterestPortion  *float64 `json:"interest_portion,omitempty" db:"interest_portion"`
	RemainingBalance  float64   `json:"remaining_balance" db:"remaining_balance"`
	TransactionID  *string   `json:"transaction_id,omitempty" db:"transaction_id"`
	Notes          *string   `json:"notes,omitempty" db:"notes"`
	CreatedAt      time.Time `json:"created_at" db:"created_at"`
}

type DebtSummary struct {
	TotalOutstanding   float64 `json:"total_outstanding"`
	TotalMinimumPayment float64 `json:"total_minimum_payment"`
	ActiveCount        int     `json:"active_count"`
}

type AvalanchePaymentSchedule struct {
	DebtID           string    `json:"debt_id"`
	DebtName         string    `json:"debt_name"`
	PayoffMonthIndex int       `json:"payoff_month_index"` // which month it gets paid off
	PayoffDate       time.Time `json:"payoff_date"`
	TotalInterestPaid float64   `json:"total_interest_paid"`
}

type AvalancheSimulation struct {
	MonthsToPayoff               int                        `json:"months_to_payoff"`
	TotalInterestPaid            float64                    `json:"total_interest_paid"`
	MonthsToPayoffWithoutExtra   int                        `json:"months_to_payoff_without_extra"`
	TotalInterestPaidWithoutExtra float64                    `json:"total_interest_paid_without_extra"`
	SavingsInterest              float64                    `json:"savings_interest"`
	SavingsMonths                int                        `json:"savings_months"`
	SchedulesWithExtra           []AvalanchePaymentSchedule `json:"schedules_with_extra"`
	SchedulesWithoutExtra        []AvalanchePaymentSchedule `json:"schedules_without_extra"`
}
