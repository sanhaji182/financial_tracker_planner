package dto

type DailyProjectionDto struct {
	Date             string  `json:"date"` // YYYY-MM-DD
	ProjectedBalance float64 `json:"projected_balance"`
	FormattedBalance string  `json:"formatted_balance"`
	EventName        string  `json:"event_name,omitempty"`
	EventAmount      float64 `json:"event_amount,omitempty"`
	FormattedAmount  string  `json:"formatted_amount,omitempty"`
	// Included is false for pre-as-of stub days on current-month forecasts.
	Included bool `json:"included"`
}

type ForecastResponse struct {
	Month                     string               `json:"month"` // YYYY-MM
	EstimatedIncome           MoneyValue           `json:"estimated_income"`
	EstimatedFixedExpenses    MoneyValue           `json:"estimated_fixed_expenses"`
	EstimatedVariableExpenses MoneyValue           `json:"estimated_variable_expenses"`
	ProjectedEndBalance       MoneyValue           `json:"projected_end_balance"`
	LowestBalance             MoneyValue           `json:"lowest_balance"`
	LowestBalanceDate         string               `json:"lowest_balance_date"`
	SafeToSpend               MoneyValue           `json:"safe_to_spend"`
	SafeToSpendScenarios      SafeToSpendScenarios `json:"safe_to_spend_scenarios"`
	IsTight                   bool                 `json:"is_tight"`
	ThresholdLimit            MoneyValue           `json:"threshold_limit"`
	DailyProjections          []DailyProjectionDto `json:"daily_projections"`
	DataSufficiency           *DataSufficiency     `json:"data_sufficiency,omitempty"`
	// Provenance from calculation kernel + ladder.
	AsOf           string   `json:"as_of,omitempty"`
	FormulaVersion string   `json:"formula_version,omitempty"`
	Assumptions    []string `json:"assumptions,omitempty"`
	// As-of event model (forecast-v1).
	OpeningBalance     *MoneyValue `json:"opening_balance,omitempty"`
	IncomeMTD          *MoneyValue `json:"income_mtd,omitempty"`
	RemainingIncome    *MoneyValue `json:"remaining_income,omitempty"`
	IncludedEventCount int         `json:"included_event_count,omitempty"`
	ExcludedDaysBefore int         `json:"excluded_days_before,omitempty"`
}
