package dto

import "time"

// ScenarioChangeParam represents flexible params for different change types
type ScenarioChangeParam struct {
	DebtID             string  `json:"debt_id,omitempty"`
	CategoryID         string  `json:"category_id,omitempty"`
	MonthlyExtraAmount float64 `json:"monthly_extra_amount,omitempty"`
	Percentage         float64 `json:"percentage,omitempty"`
	Amount             float64 `json:"amount,omitempty"`
	Month              string  `json:"month,omitempty"` // YYYY-MM
	MonthlyAmount      float64 `json:"monthly_amount,omitempty"`
}

// ScenarioChange represents a single simulated change
type ScenarioChange struct {
	Type   string              `json:"type"` // extra_debt_payment, income_change, large_purchase, investment_increase, add_subscription, remove_expense
	Params ScenarioChangeParam `json:"params"`
}

// MetricState represents the comparison state for a single metric
type MetricState struct {
	Base     float64 `json:"base"`
	Scenario float64 `json:"scenario"`
	Impact   float64 `json:"impact"`
	Severity string  `json:"severity"` // positive (green), neutral (blue/gray), negative (red/yellow)
	Unit     string  `json:"unit,omitempty"` // idr | months | ratio
}

// ScenarioResult represents the simulated side-by-side impact comparison
type ScenarioResult struct {
	EndingBalance   MetricState `json:"ending_balance"`
	TotalDebts      MetricState `json:"total_debts"`
	EFCoverage      MetricState `json:"ef_coverage"`
	CashRunway      MetricState `json:"cash_runway"`
	DebtInterest    MetricState `json:"debt_interest_cost"`
	GoalFundingGap  MetricState `json:"goal_funding_gap"`
	GoalDelayMonths MetricState `json:"goal_delay_months"`
	DownsideRunway  MetricState `json:"downside_runway"`
	AsOf            string      `json:"as_of,omitempty"`
	FormulaVersion  string      `json:"formula_version,omitempty"`
	HorizonMonths   int         `json:"horizon_months,omitempty"`
	Assumptions     []string    `json:"assumptions,omitempty"`
	Notes           []string    `json:"notes,omitempty"`
}

// SimulateScenarioRequest is the request body for simulation
type SimulateScenarioRequest struct {
	Changes []ScenarioChange `json:"changes" binding:"required"`
}

// SaveScenarioRequest is the request body to persist a template
type SaveScenarioRequest struct {
	Name    string           `json:"name" binding:"required"`
	Changes []ScenarioChange `json:"changes" binding:"required"`
	Result  ScenarioResult   `json:"result" binding:"required"`
}

// ScenarioResponse represents a saved scenario entry
type ScenarioResponse struct {
	ID        string           `json:"id"`
	UserID    string           `json:"user_id"`
	Name      string           `json:"name"`
	Changes   []ScenarioChange `json:"changes"`
	Result    ScenarioResult   `json:"result"`
	CreatedAt time.Time        `json:"created_at"`
}
