package model

import "time"

type Transaction struct {
	ID               string                   `json:"id" db:"id"`
	UserID           string                   `json:"user_id" db:"user_id"`
	AccountID        string                   `json:"account_id" db:"account_id"`
	AccountName      string                   `json:"account_name,omitempty"`      // Join field
	TargetAccountID  *string                  `json:"target_account_id,omitempty" db:"target_account_id"`
	TargetAccountName *string                 `json:"target_account_name,omitempty"` // Join field
	CategoryID       *string                  `json:"category_id,omitempty" db:"category_id"`
	CategoryName     *string                  `json:"category_name,omitempty"`     // Join field
	CategoryIcon     *string                  `json:"category_icon,omitempty"`     // Join field
	CategoryColor    *string                  `json:"category_color,omitempty"`     // Join field
	Type             string                   `json:"type" db:"type"`              // income, expense, transfer
	Amount           float64                  `json:"amount" db:"amount"`
	Date             time.Time                `json:"date" db:"date"`
	Description      *string                  `json:"description,omitempty" db:"description"`
	Notes            *string                  `json:"notes,omitempty" db:"notes"`
	IsSplit          bool                     `json:"is_split" db:"is_split"`
	Source           string                   `json:"source" db:"source"` // manual, ocr, pdf_parse, recurring, ai_suggested
	SourceConfidence *float64                 `json:"source_confidence,omitempty" db:"source_confidence"`
	Status           string                   `json:"status" db:"status"` // confirmed, pending_review, draft
	Reconciled       bool                     `json:"reconciled" db:"reconciled"`
	BillID           *string                  `json:"bill_id,omitempty" db:"bill_id"`
	DebtPaymentID    *string                  `json:"debt_payment_id,omitempty" db:"debt_payment_id"`
	Currency         string                   `json:"currency" db:"currency"`
	ExchangeRate     float64                  `json:"exchange_rate" db:"exchange_rate"`
	Tags             []string                 `json:"tags,omitempty" db:"tags"`
	CreatedAt        time.Time                `json:"created_at" db:"created_at"`
	UpdatedAt        time.Time                `json:"updated_at" db:"updated_at"`
	DeletedAt        *time.Time               `json:"-" db:"deleted_at"`
	Splits           []TransactionSplit       `json:"splits,omitempty"`
	Attachments      []TransactionAttachment  `json:"attachments,omitempty"`
	AuditLogs        []AuditLog               `json:"audit_logs,omitempty"`
}

type TransactionSplit struct {
	ID            string    `json:"id" db:"id"`
	TransactionID string    `json:"transaction_id" db:"transaction_id"`
	CategoryID    string    `json:"category_id" db:"category_id"`
	CategoryName  string    `json:"category_name,omitempty"` // Join field
	Amount        float64   `json:"amount" db:"amount"`
	Description   *string   `json:"description,omitempty" db:"description"`
	CreatedAt     time.Time `json:"created_at" db:"created_at"`
}

type TransactionAttachment struct {
	ID            string    `json:"id" db:"id"`
	TransactionID string    `json:"transaction_id" db:"transaction_id"`
	FileName      string    `json:"file_name" db:"file_name"`
	FilePath      string    `json:"file_path" db:"file_path"`
	FileType      *string   `json:"file_type,omitempty" db:"file_type"`
	FileSize      *int      `json:"file_size,omitempty" db:"file_size"`
	CreatedAt     time.Time `json:"created_at" db:"created_at"`
}

type AuditLog struct {
	ID         string     `json:"id" db:"id"`
	UserID     string     `json:"user_id" db:"user_id"`
	UserName   string     `json:"user_name,omitempty"` // Join field
	UserRole   string     `json:"user_role,omitempty"` // Join field
	EntityType string     `json:"entity_type" db:"entity_type"`
	EntityID   string     `json:"entity_id" db:"entity_id"`
	Action     string     `json:"action" db:"action"` // create, update, delete, reconcile, close
	OldValue   interface{} `json:"old_value,omitempty" db:"old_value"`
	NewValue   interface{} `json:"new_value,omitempty" db:"new_value"`
	IPAddress  *string    `json:"ip_address,omitempty" db:"ip_address"`
	UserAgent  *string    `json:"user_agent,omitempty" db:"user_agent"`
	CreatedAt  time.Time  `json:"created_at" db:"created_at"`
}

type TransactionSummary struct {
	TotalIncome  float64 `json:"total_income"`
	TotalExpense float64 `json:"total_expense"`
	Net          float64 `json:"net"`
}
