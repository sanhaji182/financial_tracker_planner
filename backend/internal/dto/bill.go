package dto

import (
	"fmt"
	"time"

	"github.com/user/financial-os/internal/model"
)

type CreateBillRequest struct {
	Name               string     `json:"name" binding:"required"`
	Amount             float64    `json:"amount" binding:"required,gt=0"`
	CategoryID         *string    `json:"category_id"`
	AccountID          *string    `json:"account_id"`
	Frequency          string     `json:"frequency" binding:"required,oneof=monthly yearly quarterly weekly custom"`
	DueDay             *int       `json:"due_day" binding:"omitempty,min=1,max=31"`
	DueDate            *time.Time `json:"due_date"`
	CustomIntervalDays *int       `json:"custom_interval_days"`
	AutoRemind         bool       `json:"auto_remind"`
	ReminderDaysBefore int        `json:"reminder_days_before"`
	Notes              *string    `json:"notes"`
}

type UpdateBillRequest struct {
	Name               string     `json:"name" binding:"required"`
	Amount             float64    `json:"amount" binding:"required,gt=0"`
	CategoryID         *string    `json:"category_id"`
	AccountID          *string    `json:"account_id"`
	Frequency          string     `json:"frequency" binding:"required,oneof=monthly yearly quarterly weekly custom"`
	DueDay             *int       `json:"due_day" binding:"omitempty,min=1,max=31"`
	DueDate            *time.Time `json:"due_date"`
	CustomIntervalDays *int       `json:"custom_interval_days"`
	AutoRemind         bool       `json:"auto_remind"`
	ReminderDaysBefore int        `json:"reminder_days_before"`
	Status             string     `json:"status" binding:"required,oneof=paid unpaid overdue cancelled"`
	Notes              *string    `json:"notes"`
}

type PayBillRequest struct {
	Amount      float64   `json:"amount" binding:"required,gt=0"`
	PaymentDate time.Time `json:"payment_date" binding:"required"`
	Notes       *string   `json:"notes"`
	AccountID   string    `json:"account_id" binding:"required"` // source account for transaction
}

type BillPaymentResponse struct {
	ID              string    `json:"id"`
	BillID          string    `json:"bill_id"`
	Amount          float64   `json:"amount"`
	FormattedAmount string    `json:"formatted_amount"`
	PaymentDate     time.Time `json:"payment_date"`
	IsPartial       bool      `json:"is_partial"`
	RemainingAmount float64   `json:"remaining_amount"`
	FormattedRemaining string `json:"formatted_remaining"`
	TransactionID   *string   `json:"transaction_id,omitempty"`
	Notes           *string   `json:"notes,omitempty"`
	CreatedAt       time.Time `json:"created_at"`
}

type BillResponse struct {
	ID                 string                `json:"id"`
	UserID             string                `json:"user_id"`
	Name               string                `json:"name"`
	Amount             float64               `json:"amount"`
	FormattedAmount    string                `json:"formatted_amount"`
	CategoryID         *string               `json:"category_id,omitempty"`
	CategoryName       *string               `json:"category_name,omitempty"`
	AccountID          *string               `json:"account_id,omitempty"`
	AccountName        *string               `json:"account_name,omitempty"`
	Frequency          string                `json:"frequency"`
	DueDay             *int                  `json:"due_day,omitempty"`
	DueDate            *string               `json:"due_date,omitempty"`
	NextDueDate        string                `json:"next_due_date"`
	CustomIntervalDays *int                  `json:"custom_interval_days,omitempty"`
	AutoRemind         bool                  `json:"auto_remind"`
	ReminderDaysBefore int                   `json:"reminder_days_before"`
	Status             string                `json:"status"`
	Notes              *string               `json:"notes,omitempty"`
	CreatedAt          time.Time             `json:"created_at"`
	UpdatedAt          time.Time             `json:"updated_at"`
	Payments           []BillPaymentResponse `json:"payments,omitempty"`
}

type BillMonthlyCommitmentResponse struct {
	Month              string  `json:"month"` // YYYY-MM
	TotalCommitment    float64 `json:"total_commitment"`
	FormattedTotal     string  `json:"formatted_total"`
	TotalPaid          float64 `json:"total_paid"`
	FormattedPaid      string  `json:"formatted_paid"`
	TotalUnpaid        float64 `json:"total_unpaid"`
	FormattedUnpaid    string  `json:"formatted_unpaid"`
	TotalOverdue       float64 `json:"total_overdue"`
	FormattedOverdue   string  `json:"formatted_overdue"`
}

// Convert model to DTO
func ToBillResponse(b *model.Bill, payments []model.BillPayment) BillResponse {
	var categoryName, accountName *string
	if b.CategoryName != nil {
		categoryName = b.CategoryName
	}
	if b.AccountName != nil {
		accountName = b.AccountName
	}

	var dueDateStr *string
	if b.DueDate != nil {
		s := b.DueDate.Format("2006-01-02")
		dueDateStr = &s
	}

	var pays []BillPaymentResponse
	for _, p := range payments {
		pays = append(pays, ToBillPaymentResponse(&p))
	}

	return BillResponse{
		ID:                 b.ID,
		UserID:             b.UserID,
		Name:               b.Name,
		Amount:             b.Amount,
		FormattedAmount:    formatRupiah(b.Amount),
		CategoryID:         b.CategoryID,
		CategoryName:       categoryName,
		AccountID:          b.AccountID,
		AccountName:        accountName,
		Frequency:          b.Frequency,
		DueDay:             b.DueDay,
		DueDate:            dueDateStr,
		NextDueDate:        b.NextDueDate.Format("2006-01-02"),
		CustomIntervalDays: b.CustomIntervalDays,
		AutoRemind:         b.AutoRemind,
		ReminderDaysBefore: b.ReminderDaysBefore,
		Status:             b.Status,
		Notes:              b.Notes,
		CreatedAt:          b.CreatedAt,
		UpdatedAt:          b.UpdatedAt,
		Payments:           pays,
	}
}

func ToBillPaymentResponse(p *model.BillPayment) BillPaymentResponse {
	return BillPaymentResponse{
		ID:                 p.ID,
		BillID:             p.BillID,
		Amount:             p.Amount,
		FormattedAmount:    formatRupiah(p.Amount),
		PaymentDate:        p.PaymentDate,
		IsPartial:          p.IsPartial,
		RemainingAmount:    p.RemainingAmount,
		FormattedRemaining: formatRupiah(p.RemainingAmount),
		TransactionID:      p.TransactionID,
		Notes:              p.Notes,
		CreatedAt:          p.CreatedAt,
	}
}

func formatRupiah(val float64) string {
	isNeg := val < 0
	if isNeg {
		val = -val
	}
	parts := formatNumber(val)
	if isNeg {
		return "Rp -" + parts
	}
	return "Rp " + parts
}

func formatNumber(val float64) string {
	v := int64(val)
	var result string
	for v >= 1000 {
		result = fmt.Sprintf(".%03d%s", v%1000, result)
		v /= 1000
	}
	result = fmt.Sprintf("%d%s", v, result)
	return result
}
