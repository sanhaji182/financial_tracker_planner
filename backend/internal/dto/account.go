package dto

import (
	"fmt"
	"strings"
	"time"

	"github.com/user/financial-os/internal/model"
)

type CreateAccountRequest struct {
	Name            string  `json:"name" binding:"required"`
	Type            string  `json:"type" binding:"required,oneof=bank e_wallet cash investment deposit"`
	BankProvider    *string `json:"bank_provider"`
	AccountNumber   *string `json:"account_number"`
	InitialBalance  int64   `json:"initial_balance" binding:"required,gte=0"` // Changed from float64
	Currency        string  `json:"currency" binding:"omitempty,len=3"`
	IsShared        *bool   `json:"is_shared"`
	IsEmergencyFund *bool   `json:"is_emergency_fund"`
	Icon            *string `json:"icon"`
	Color           *string `json:"color"`
	Notes           *string `json:"notes"`
}

type UpdateAccountRequest struct {
	Name            string  `json:"name" binding:"required"`
	BankProvider    *string `json:"bank_provider"`
	IsActive        *bool   `json:"is_active"`
	IsShared        *bool   `json:"is_shared"`
	IsEmergencyFund *bool   `json:"is_emergency_fund"`
	Icon            *string `json:"icon"`
	Color           *string `json:"color"`
	Notes           *string `json:"notes"`
}

type AccountResponse struct {
	ID                  string    `json:"id"`
	UserID              string    `json:"user_id"`
	Name                string    `json:"name"`
	Type                string    `json:"type"`
	BankProvider        *string   `json:"bank_provider,omitempty"`
	AccountNumberMasked *string   `json:"account_number_masked,omitempty"`
	Balance             int64     `json:"balance"` // Changed from float64
	FormattedBalance    string    `json:"formatted_balance"`
	InitialBalance      int64     `json:"initial_balance"` // Changed from float64
	Currency            string    `json:"currency"`
	Icon                *string   `json:"icon,omitempty"`
	Color               *string   `json:"color,omitempty"`
	IsActive            bool      `json:"is_active"`
	IsShared            bool      `json:"is_shared"`
	IsEmergencyFund     bool      `json:"is_emergency_fund"`
	SortOrder           int       `json:"sort_order"`
	Notes               *string   `json:"notes,omitempty"`
	CreatedAt           time.Time `json:"created_at"`
	UpdatedAt           time.Time `json:"updated_at"`
}

type AccountSummaryResponse struct {
	TotalBank             int64  `json:"total_bank"` // Changed from float64
	FormattedTotalBank    string `json:"formatted_total_bank"`
	TotalEWallet          int64  `json:"total_e_wallet"` // Changed from float64
	FormattedTotalEWallet string `json:"formatted_total_e_wallet"`
	TotalCash             int64  `json:"total_cash"` // Changed from float64
	FormattedTotalCash    string `json:"formatted_total_cash"`
	TotalInvestment       int64  `json:"total_investment"` // Changed from float64
	FormattedTotalInvestment string `json:"formatted_total_investment"`
	TotalDeposit          int64  `json:"total_deposit"` // Changed from float64
	FormattedTotalDeposit string `json:"formatted_total_deposit"`
	GrandTotal            int64  `json:"grand_total"` // Changed from float64
	FormattedGrandTotal   string `json:"formatted_grand_total"`
}

func FormatRupiah(amount float64) string {
	isNegative := amount < 0
	if isNegative {
		amount = -amount
	}

	intPart := int64(amount)
	decPart := int64((amount - float64(intPart)) * 100)

	intStr := fmt.Sprintf("%d", intPart)
	var result []string
	
	// Add thousands separator dots
	for len(intStr) > 3 {
		n := len(intStr)
		result = append([]string{intStr[n-3:]}, result...)
		intStr = intStr[:n-3]
	}
	if len(intStr) > 0 {
		result = append([]string{intStr}, result...)
	}
	
	formattedInt := strings.Join(result, ".")
	formatted := "Rp " + formattedInt
	if decPart > 0 {
		formatted += fmt.Sprintf(",%02d", decPart)
	}

	if isNegative {
		formatted = "-" + formatted
	}
	return formatted
}

func ToAccountResponse(a *model.Account) AccountResponse {
	return AccountResponse{
		ID:                  a.ID,
		UserID:              a.UserID,
		Name:                a.Name,
		Type:                a.Type,
		BankProvider:        a.BankProvider,
		AccountNumberMasked: a.AccountNumberMasked,
		Balance:             a.Balance,
		FormattedBalance:    model.FormatRupiahMoney(a.Balance),
		InitialBalance:      a.InitialBalance,
		Currency:            a.Currency,
		Icon:                a.Icon,
		Color:               a.Color,
		IsActive:            a.IsActive,
		IsShared:            a.IsShared,
		IsEmergencyFund:     a.IsEmergencyFund,
		SortOrder:           a.SortOrder,
		Notes:               a.Notes,
		CreatedAt:           a.CreatedAt,
		UpdatedAt:           a.UpdatedAt,
	}
}

func ToAccountSummaryResponse(s *model.AccountSummary) AccountSummaryResponse {
	return AccountSummaryResponse{
		TotalBank:             s.TotalBank,
		FormattedTotalBank:    model.FormatRupiahMoney(s.TotalBank),
		TotalEWallet:          s.TotalEWallet,
		FormattedTotalEWallet: model.FormatRupiahMoney(s.TotalEWallet),
		TotalCash:             s.TotalCash,
		FormattedTotalCash:    model.FormatRupiahMoney(s.TotalCash),
		TotalInvestment:       s.TotalInvestment,
		FormattedTotalInvestment: model.FormatRupiahMoney(s.TotalInvestment),
		TotalDeposit:          s.TotalDeposit,
		FormattedTotalDeposit: model.FormatRupiahMoney(s.TotalDeposit),
		GrandTotal:            s.GrandTotal,
		FormattedGrandTotal:   model.FormatRupiahMoney(s.GrandTotal),
	}
}
