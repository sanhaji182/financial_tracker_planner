package dto

import (
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/user/financial-os/internal/model"
)

type CreateDebtRequest struct {
	Name            string     `json:"name" binding:"required"`
	Type            string     `json:"type" binding:"required,oneof=kpr credit_card installment personal_loan other"`
	Creditor        *string    `json:"creditor"`
	OriginalAmount  float64    `json:"original_amount" binding:"required,gt=0"`
	Outstanding     float64    `json:"outstanding_balance" binding:"required,gte=0"`
	InterestRate    *float64   `json:"interest_rate" binding:"omitempty,gte=0"`
	MinimumPayment  *float64   `json:"minimum_payment" binding:"omitempty,gte=0"`
	DueDay          *int       `json:"due_day" binding:"omitempty,min=1,max=31"`
	StartDate       *time.Time `json:"start_date"`
	EndDate         *time.Time `json:"end_date"`
	TenorMonths     *int       `json:"tenor_months" binding:"omitempty,gt=0"`
	AccountID       *string    `json:"account_id"`
	Notes           *string    `json:"notes"`
	IsShared        bool       `json:"is_shared"`
	Currency        string     `json:"currency"`
}

type UpdateDebtRequest struct {
	Name            string     `json:"name" binding:"required"`
	Creditor        *string    `json:"creditor"`
	Outstanding     float64    `json:"outstanding_balance" binding:"gte=0"`
	InterestRate    *float64   `json:"interest_rate" binding:"omitempty,gte=0"`
	MinimumPayment  *float64   `json:"minimum_payment" binding:"omitempty,gte=0"`
	DueDay          *int       `json:"due_day" binding:"omitempty,min=1,max=31"`
	StartDate       *time.Time `json:"start_date"`
	EndDate         *time.Time `json:"end_date"`
	TenorMonths     *int       `json:"tenor_months" binding:"omitempty,gt=0"`
	AccountID       *string    `json:"account_id"`
	Notes           *string    `json:"notes"`
	IsShared        bool       `json:"is_shared"`
	Status          string     `json:"status" binding:"required,oneof=active paid_off defaulted restructured"`
	Currency        string     `json:"currency"`
}

type RecordDebtPaymentRequest struct {
	Amount          float64   `json:"amount" binding:"required,gt=0"`
	PaymentDate     time.Time `json:"payment_date" binding:"required"`
	IsExtraPayment  bool      `json:"is_extra_payment"`
	Notes           *string   `json:"notes"`
	AccountID       string    `json:"account_id" binding:"required"` // source account
}

func (r *RecordDebtPaymentRequest) UnmarshalJSON(data []byte) error {
	type Alias RecordDebtPaymentRequest
	aux := &struct {
		PaymentDate interface{} `json:"payment_date"`
		Date        interface{} `json:"date"`
		*Alias
	}{
		Alias: (*Alias)(r),
	}
	if err := json.Unmarshal(data, &aux); err != nil {
		return err
	}

	parseTime := func(val interface{}) (time.Time, error) {
		if val == nil {
			return time.Time{}, errors.New("nil value")
		}
		str, ok := val.(string)
		if !ok {
			return time.Time{}, errors.New("not a string")
		}
		if str == "" {
			return time.Time{}, errors.New("empty string")
		}
		// Try RFC3339 first
		if t, err := time.Parse(time.RFC3339, str); err == nil {
			return t, nil
		}
		// Try ISO Date Only
		if t, err := time.Parse("2006-01-02", str); err == nil {
			return t, nil
		}
		return time.Time{}, fmt.Errorf("invalid time format: %s", str)
	}

	if aux.PaymentDate != nil {
		t, err := parseTime(aux.PaymentDate)
		if err == nil {
			r.PaymentDate = t
		} else if aux.Date != nil {
			t2, err2 := parseTime(aux.Date)
			if err2 == nil {
				r.PaymentDate = t2
			}
		}
	} else if aux.Date != nil {
		t, err := parseTime(aux.Date)
		if err == nil {
			r.PaymentDate = t
		}
	}

	return nil
}

type DebtPaymentResponse struct {
	ID             string    `json:"id"`
	DebtID         string    `json:"debt_id"`
	Amount         float64   `json:"amount"`
	FormattedAmount string   `json:"formatted_amount"`
	PaymentDate    time.Time `json:"payment_date"`
	IsExtraPayment bool      `json:"is_extra_payment"`
	PrincipalPortion *float64 `json:"principal_portion,omitempty"`
	FormattedPrincipal *string `json:"formatted_principal,omitempty"`
	InterestPortion  *float64 `json:"interest_portion,omitempty"`
	FormattedInterest *string  `json:"formatted_interest,omitempty"`
	RemainingBalance  float64   `json:"remaining_balance"`
	FormattedRemaining string   `json:"formatted_remaining"`
	TransactionID  *string   `json:"transaction_id,omitempty"`
	Notes          *string   `json:"notes,omitempty"`
	CreatedAt      time.Time `json:"created_at"`
}

type DebtResponse struct {
	ID                 string                `json:"id"`
	UserID             string                `json:"user_id"`
	Name               string                `json:"name"`
	Type               string                `json:"type"`
	Creditor           *string               `json:"creditor,omitempty"`
	OriginalAmount     float64               `json:"original_amount"`
	FormattedOriginal  string                `json:"formatted_original"`
	OutstandingBalance float64               `json:"outstanding_balance"`
	FormattedOutstanding string              `json:"formatted_outstanding"`
	InterestRate       *float64              `json:"interest_rate,omitempty"`
	MinimumPayment     *float64              `json:"minimum_payment,omitempty"`
	FormattedMinPayment *string              `json:"formatted_minimum_payment,omitempty"`
	DueDay             *int                  `json:"due_day,omitempty"`
	StartDate          *time.Time            `json:"start_date,omitempty"`
	EndDate            *time.Time            `json:"end_date,omitempty"`
	TenorMonths        *int                  `json:"tenor_months,omitempty"`
	AccountID          *string               `json:"account_id,omitempty"`
	AccountName        *string               `json:"account_name,omitempty"`
	Currency           string                `json:"currency"`
	Status             string                `json:"status"`
	Notes              *string               `json:"notes,omitempty"`
	IsShared           bool                  `json:"is_shared"`
	CreatedAt          time.Time             `json:"created_at"`
	UpdatedAt          time.Time             `json:"updated_at"`
	Payments           []DebtPaymentResponse `json:"payments,omitempty"`
}

type DebtSummaryResponse struct {
	TotalOutstanding          float64 `json:"total_outstanding"`
	FormattedTotalOutstanding string  `json:"formatted_total_outstanding"`
	TotalMinimumPayment       float64 `json:"total_minimum_payment"`
	FormattedTotalMinPayment  string  `json:"formatted_total_minimum_payment"`
	ActiveCount               int     `json:"active_count"`
}

type AvalanchePaymentScheduleResponse struct {
	DebtID                 string    `json:"debt_id"`
	DebtName               string    `json:"debt_name"`
	DebtType               string    `json:"debt_type,omitempty"`
	PayoffMonthIndex       int       `json:"payoff_month_index"`
	PayoffDate             time.Time `json:"payoff_date"`
	TotalInterestPaid      float64   `json:"total_interest_paid"`
	FormattedTotalInterest string    `json:"formatted_total_interest"`
	TotalFeesPaid          float64   `json:"total_fees_paid,omitempty"`
	FormattedTotalFees     string    `json:"formatted_total_fees,omitempty"`
	EffectiveAPR           float64   `json:"effective_apr,omitempty"`
	InterestModel          string    `json:"interest_model,omitempty"`
}

type DebtSensitivityPoint struct {
	Label                  string  `json:"label"`
	ExtraMonthly           float64 `json:"extra_monthly"`
	FormattedExtraMonthly  string  `json:"formatted_extra_monthly"`
	MonthsToPayoff         int     `json:"months_to_payoff"`
	TotalInterestPaid      float64 `json:"total_interest_paid"`
	FormattedTotalInterest string  `json:"formatted_total_interest"`
	Stalled                bool    `json:"stalled"`
}

type AvalancheSimulationResponse struct {
	MonthsToPayoff                int                                `json:"months_to_payoff"`
	TotalInterestPaid             float64                            `json:"total_interest_paid"`
	FormattedTotalInterest        string                             `json:"formatted_total_interest"`
	TotalFeesPaid                 float64                            `json:"total_fees_paid,omitempty"`
	FormattedTotalFees            string                             `json:"formatted_total_fees,omitempty"`
	MonthsToPayoffWithoutExtra    int                                `json:"months_to_payoff_without_extra"`
	TotalInterestPaidWithoutExtra float64                            `json:"total_interest_paid_without_extra"`
	FormattedInterestWithoutExtra string                             `json:"formatted_interest_without_extra"`
	SavingsInterest               float64                            `json:"savings_interest"`
	FormattedSavingsInterest      string                             `json:"formatted_savings_interest"`
	SavingsMonths                 int                                `json:"savings_months"`
	SchedulesWithExtra            []AvalanchePaymentScheduleResponse `json:"schedules_with_extra"`
	SchedulesWithoutExtra         []AvalanchePaymentScheduleResponse `json:"schedules_without_extra"`
	// Provenance + model limitations (debt-v2).
	AsOf                 string                 `json:"as_of,omitempty"`
	FormulaVersion       string                 `json:"formula_version,omitempty"`
	Assumptions          []string               `json:"assumptions,omitempty"`
	NegativeAmortization bool                   `json:"negative_amortization"`
	IsEstimate           bool                   `json:"is_estimate"`
	BlendedNominalAPR    float64                `json:"blended_nominal_apr,omitempty"`
	InterestModels       []string               `json:"interest_models,omitempty"`
	Sensitivity          []DebtSensitivityPoint `json:"sensitivity,omitempty"`
}

func ToDebtPaymentResponse(p *model.DebtPayment) DebtPaymentResponse {
	var fmtPrincipal, fmtInterest *string
	if p.PrincipalPortion != nil {
		str := FormatRupiah(*p.PrincipalPortion)
		fmtPrincipal = &str
	}
	if p.InterestPortion != nil {
		str := FormatRupiah(*p.InterestPortion)
		fmtInterest = &str
	}

	return DebtPaymentResponse{
		ID:                 p.ID,
		DebtID:             p.DebtID,
		Amount:             p.Amount,
		FormattedAmount:    FormatRupiah(p.Amount),
		PaymentDate:        p.PaymentDate,
		IsExtraPayment:     p.IsExtraPayment,
		PrincipalPortion:   p.PrincipalPortion,
		FormattedPrincipal: fmtPrincipal,
		InterestPortion:    p.InterestPortion,
		FormattedInterest:  fmtInterest,
		RemainingBalance:    p.RemainingBalance,
		FormattedRemaining: FormatRupiah(p.RemainingBalance),
		TransactionID:      p.TransactionID,
		Notes:              p.Notes,
		CreatedAt:          p.CreatedAt,
	}
}

func ToDebtResponse(d *model.Debt, payments []model.DebtPayment) DebtResponse {
	var pmResponses []DebtPaymentResponse
	for _, p := range payments {
		pmResponses = append(pmResponses, ToDebtPaymentResponse(&p))
	}

	var fmtMinPayment *string
	if d.MinimumPayment != nil {
		str := FormatRupiah(*d.MinimumPayment)
		fmtMinPayment = &str
	}

	return DebtResponse{
		ID:                   d.ID,
		UserID:               d.UserID,
		Name:                 d.Name,
		Type:                 d.Type,
		Creditor:             d.Creditor,
		OriginalAmount:       d.OriginalAmount,
		FormattedOriginal:    FormatRupiah(d.OriginalAmount),
		OutstandingBalance:   d.OutstandingBalance,
		FormattedOutstanding: FormatRupiah(d.OutstandingBalance),
		InterestRate:         d.InterestRate,
		MinimumPayment:       d.MinimumPayment,
		FormattedMinPayment:  fmtMinPayment,
		DueDay:               d.DueDay,
		StartDate:            d.StartDate,
		EndDate:              d.EndDate,
		TenorMonths:          d.TenorMonths,
		AccountID:            d.AccountID,
		AccountName:          d.AccountName,
		Currency:             d.Currency,
		Status:               d.Status,
		Notes:                d.Notes,
		IsShared:             d.IsShared,
		CreatedAt:            d.CreatedAt,
		UpdatedAt:            d.UpdatedAt,
		Payments:             pmResponses,
	}
}

func ToDebtSummaryResponse(s *model.DebtSummary) DebtSummaryResponse {
	return DebtSummaryResponse{
		TotalOutstanding:          s.TotalOutstanding,
		FormattedTotalOutstanding: FormatRupiah(s.TotalOutstanding),
		TotalMinimumPayment:       s.TotalMinimumPayment,
		FormattedTotalMinPayment:  FormatRupiah(s.TotalMinimumPayment),
		ActiveCount:               s.ActiveCount,
	}
}

func ToAvalancheSimulationResponse(sim *model.AvalancheSimulation) AvalancheSimulationResponse {
	var schedulesWithExtra []AvalanchePaymentScheduleResponse
	for _, s := range sim.SchedulesWithExtra {
		schedulesWithExtra = append(schedulesWithExtra, AvalanchePaymentScheduleResponse{
			DebtID:                 s.DebtID,
			DebtName:               s.DebtName,
			PayoffMonthIndex:       s.PayoffMonthIndex,
			PayoffDate:             s.PayoffDate,
			TotalInterestPaid:      s.TotalInterestPaid,
			FormattedTotalInterest: FormatRupiah(s.TotalInterestPaid),
		})
	}

	var schedulesWithoutExtra []AvalanchePaymentScheduleResponse
	for _, s := range sim.SchedulesWithoutExtra {
		schedulesWithoutExtra = append(schedulesWithoutExtra, AvalanchePaymentScheduleResponse{
			DebtID:                 s.DebtID,
			DebtName:               s.DebtName,
			PayoffMonthIndex:       s.PayoffMonthIndex,
			PayoffDate:             s.PayoffDate,
			TotalInterestPaid:      s.TotalInterestPaid,
			FormattedTotalInterest: FormatRupiah(s.TotalInterestPaid),
		})
	}

	return AvalancheSimulationResponse{
		MonthsToPayoff:                sim.MonthsToPayoff,
		TotalInterestPaid:             sim.TotalInterestPaid,
		FormattedTotalInterest:        FormatRupiah(sim.TotalInterestPaid),
		MonthsToPayoffWithoutExtra:    sim.MonthsToPayoffWithoutExtra,
		TotalInterestPaidWithoutExtra: sim.TotalInterestPaidWithoutExtra,
		FormattedInterestWithoutExtra: FormatRupiah(sim.TotalInterestPaidWithoutExtra),
		SavingsInterest:               sim.SavingsInterest,
		FormattedSavingsInterest:      FormatRupiah(sim.SavingsInterest),
		SavingsMonths:                 sim.SavingsMonths,
		SchedulesWithExtra:            schedulesWithExtra,
		SchedulesWithoutExtra:         schedulesWithoutExtra,
	}
}
