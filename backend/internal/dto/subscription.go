package dto

import "time"

type SubscriptionResponse struct {
	ID               string     `json:"id"`
	UserID           string     `json:"user_id"`
	Name             string     `json:"name"`
	Provider         string     `json:"provider"`
	Amount           float64    `json:"amount"`
	Currency         string     `json:"currency"`
	Frequency        string     `json:"frequency"`
	CategoryID       *string    `json:"category_id,omitempty"`
	CategoryName     string     `json:"category_name"`
	NextRenewalDate  *string    `json:"next_renewal_date,omitempty"` // YYYY-MM-DD
	LastUsedDate     *string    `json:"last_used_date,omitempty"`    // YYYY-MM-DD
	IsActive         bool       `json:"is_active"`
	AutoRenew        bool       `json:"auto_renew"`
	Notes            string     `json:"notes"`
	UnusedWarning    bool       `json:"unused_warning"`
	DaysUnused       int        `json:"days_unused"`
	WarningMessage   string     `json:"warning_message"`
	CreatedAt        time.Time  `json:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at"`
}

type SubscriptionSummaryResponse struct {
	TotalMonthlyCost float64                    `json:"total_monthly_cost"`
	ActiveCount      int                        `json:"active_count"`
	Warnings         []SubscriptionWarningItem `json:"warnings"`
}

type SubscriptionWarningItem struct {
	SubscriptionID string  `json:"subscription_id"`
	Name           string  `json:"name"`
	Amount         float64 `json:"amount"`
	Frequency      string  `json:"frequency"`
	DaysUnused     int     `json:"days_unused"`
	Message        string  `json:"message"`
}

type CreateSubscriptionRequest struct {
	Name            string  `json:"name" binding:"required"`
	Provider        string  `json:"provider"`
	Amount          float64 `json:"amount" binding:"required,min=1"`
	Currency        string  `json:"currency"` // Default IDR
	Frequency       string  `json:"frequency" binding:"required"` // monthly, yearly, weekly
	CategoryID      string  `json:"category_id"`
	NextRenewalDate string  `json:"next_renewal_date"` // YYYY-MM-DD
	LastUsedDate    string  `json:"last_used_date"`    // YYYY-MM-DD
	IsActive        *bool   `json:"is_active"`
	AutoRenew       *bool   `json:"auto_renew"`
	Notes           string  `json:"notes"`
}

type UpdateSubscriptionRequest struct {
	Name            *string  `json:"name"`
	Provider        *string  `json:"provider"`
	Amount          *float64 `json:"amount" binding:"omitempty,min=1"`
	Currency        *string  `json:"currency"`
	Frequency       *string  `json:"frequency"`
	CategoryID      *string  `json:"category_id"`
	NextRenewalDate *string  `json:"next_renewal_date"` // YYYY-MM-DD
	LastUsedDate    *string  `json:"last_used_date"`    // YYYY-MM-DD
	IsActive        *bool    `json:"is_active"`
	AutoRenew       *bool    `json:"auto_renew"`
	Notes           *string  `json:"notes"`
}
