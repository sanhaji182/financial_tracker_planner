package model

import "time"

type Bill struct {
	ID                   string     `json:"id" db:"id"`
	UserID               string     `json:"user_id" db:"user_id"`
	Name                 string     `json:"name" db:"name"`
	Amount               float64    `json:"amount" db:"amount"`
	CategoryID           *string    `json:"category_id,omitempty" db:"category_id"`
	CategoryName         *string    `json:"category_name,omitempty"` // join field
	AccountID            *string    `json:"account_id,omitempty" db:"account_id"`
	AccountName          *string    `json:"account_name,omitempty"` // join field
	Frequency            string     `json:"frequency" db:"frequency"` // monthly, yearly, quarterly, weekly, custom
	DueDay               *int       `json:"due_day,omitempty" db:"due_day"`
	DueDate              *time.Time `json:"due_date,omitempty" db:"due_date"`
	NextDueDate          time.Time  `json:"next_due_date" db:"next_due_date"`
	CustomIntervalDays   *int       `json:"custom_interval_days,omitempty" db:"custom_interval_days"`
	AutoRemind           bool       `json:"auto_remind" db:"auto_remind"`
	ReminderDaysBefore   int        `json:"reminder_days_before" db:"reminder_days_before"`
	Status               string     `json:"status" db:"status"` // paid, unpaid, overdue, cancelled
	IsActive             bool       `json:"is_active" db:"is_active"`
	Notes                *string    `json:"notes,omitempty" db:"notes"`
	CreatedAt            time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt            time.Time  `json:"updated_at" db:"updated_at"`
	DeletedAt            *time.Time `json:"-" db:"deleted_at"`
}

type BillPayment struct {
	ID              string    `json:"id" db:"id"`
	BillID          string    `json:"bill_id" db:"bill_id"`
	Amount          float64   `json:"amount" db:"amount"`
	PaymentDate     time.Time `json:"payment_date" db:"payment_date"`
	IsPartial       bool      `json:"is_partial" db:"is_partial"`
	RemainingAmount float64   `json:"remaining_amount" db:"remaining_amount"`
	TransactionID   *string   `json:"transaction_id,omitempty" db:"transaction_id"`
	Notes           *string   `json:"notes,omitempty" db:"notes"`
	CreatedAt       time.Time `json:"created_at" db:"created_at"`
}
