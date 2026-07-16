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
	// Scenario band balances (forecast-v2); expected == ProjectedBalance.
	BandConservative float64 `json:"band_conservative,omitempty"`
	BandExpected     float64 `json:"band_expected,omitempty"`
	BandOptimistic   float64 `json:"band_optimistic,omitempty"`
	FormattedBandConservative string `json:"formatted_band_conservative,omitempty"`
	FormattedBandExpected     string `json:"formatted_band_expected,omitempty"`
	FormattedBandOptimistic   string `json:"formatted_band_optimistic,omitempty"`
}

// EndBalanceScenarios is projected end-of-month cash under variable-spend bands.
type EndBalanceScenarios struct {
	Conservative MoneyValue `json:"conservative"`
	Expected     MoneyValue `json:"expected"`
	Optimistic   MoneyValue `json:"optimistic"`
}

type ForecastResponse struct {
	Month                     string               `json:"month"` // YYYY-MM
	EstimatedIncome           MoneyValue           `json:"estimated_income"`
	EstimatedFixedExpenses    MoneyValue           `json:"estimated_fixed_expenses"`
	EstimatedVariableExpenses MoneyValue           `json:"estimated_variable_expenses"`
	ProjectedEndBalance       MoneyValue           `json:"projected_end_balance"`
	// End-balance scenario bands (forecast-v2). Primary projected_end = expected.
	EndBalanceScenarios *EndBalanceScenarios `json:"end_balance_scenarios,omitempty"`
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

// HorizonAccuracy is error metrics for one forecast horizon.
type HorizonAccuracy struct {
	HorizonDays         int     `json:"horizon_days"`
	Label               string  `json:"label"`
	SampleSize          int     `json:"sample_size"`
	MAE                 float64 `json:"mae"`
	FormattedMAE        string  `json:"formatted_mae"`
	WAPE                float64 `json:"wape"`
	Bias                float64 `json:"bias"`
	FormattedBias       string  `json:"formatted_bias"`
	DirectionalAccuracy float64 `json:"directional_accuracy"`
	BandCoverage        float64 `json:"band_coverage,omitempty"`
	BandSamples         int     `json:"band_samples,omitempty"`
}

// ForecastBacktestPoint is one month used in accuracy evaluation.
type ForecastBacktestPoint struct {
	Month              string  `json:"month"`
	ProjectedNet       float64 `json:"projected_net"`
	FormattedProjected string  `json:"formatted_projected_net"`
	ActualNet          float64 `json:"actual_net"`
	FormattedActual    string  `json:"formatted_actual_net"`
	Error              float64 `json:"error"` // projected - actual
	FormattedError     string  `json:"formatted_error"`
}

// ForecastBacktestResponse is GET /forecast/backtest.
type ForecastBacktestResponse struct {
	AsOf           string               `json:"as_of"`
	FormulaVersion string               `json:"formula_version"`
	Overall        HorizonAccuracy      `json:"overall"`
	ByHorizon      []HorizonAccuracy    `json:"by_horizon"`
	Points         []ForecastBacktestPoint `json:"points"`
	PointsUsed     int                  `json:"points_used"`
	PointsSkipped  int                  `json:"points_skipped"`
	Assumptions    []string             `json:"assumptions,omitempty"`
	// MetricNote clarifies we compare monthly net cashflow (not balance snapshot).
	MetricNote string `json:"metric_note"`
}
