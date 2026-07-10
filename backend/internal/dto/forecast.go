package dto

type DailyProjectionDto struct {
	Date             string     `json:"date"` // YYYY-MM-DD
	ProjectedBalance float64    `json:"projected_balance"`
	FormattedBalance string     `json:"formatted_balance"`
	EventName        string     `json:"event_name,omitempty"`
	EventAmount      float64    `json:"event_amount,omitempty"`
	FormattedAmount  string     `json:"formatted_amount,omitempty"`
}

type ForecastResponse struct {
	Month                      string               `json:"month"` // YYYY-MM
	EstimatedIncome            MoneyValue           `json:"estimated_income"`
	EstimatedFixedExpenses     MoneyValue           `json:"estimated_fixed_expenses"`
	EstimatedVariableExpenses  MoneyValue           `json:"estimated_variable_expenses"`
	ProjectedEndBalance        MoneyValue           `json:"projected_end_balance"`
	LowestBalance              MoneyValue           `json:"lowest_balance"`
	LowestBalanceDate          string               `json:"lowest_balance_date"`
	SafeToSpend                MoneyValue           `json:"safe_to_spend"`
	IsTight                    bool                 `json:"is_tight"`
	ThresholdLimit             MoneyValue           `json:"threshold_limit"`
	DailyProjections           []DailyProjectionDto `json:"daily_projections"`
}
