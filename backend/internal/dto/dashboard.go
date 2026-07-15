package dto

import "time"

type MoneyValue struct {
	Value          float64 `json:"value"`
	FormattedValue string  `json:"formatted_value"`
}

type AssetBreakdown struct {
	Total             float64 `json:"total"`
	FormattedTotal    string  `json:"formatted_total"`
	Liquid            float64 `json:"liquid"`
	FormattedLiquid   string  `json:"formatted_liquid"`
	Invested          float64 `json:"invested"`
	FormattedInvested string  `json:"formatted_invested"`
	Property          float64 `json:"property"`
	FormattedProperty string  `json:"formatted_property"`
}

type DebtSummaryDto struct {
	TotalOutstanding          float64 `json:"total_outstanding"`
	FormattedTotalOutstanding string  `json:"formatted_total_outstanding"`
	ActiveCount               int     `json:"active_count"`
}

type HealthScoreDto struct {
	Score       int    `json:"score"`
	Rating      string `json:"rating"`       // Excellent, Good, Fair, Poor, Critical
	StatusColor string `json:"status_color"` // Green, Yellow, Orange, Red
	// Reconciliation confidence: % of confirmed txs in last 90d that are reconciled.
	// Factor (0-1) multiplies raw score so unreconciled books cap the health grade.
	ReconciliationRate       float64 `json:"reconciliation_rate"`
	ReconciliationConfidence float64 `json:"reconciliation_confidence"` // 0.7–1.0 multiplier applied
}

type SafeToSpendScenarios struct {
	Conservative MoneyValue `json:"conservative"`
	Expected     MoneyValue `json:"expected"`
	Optimistic   MoneyValue `json:"optimistic"`
}

type UpcomingBillDto struct {
	ID              string    `json:"id"`
	Name            string    `json:"name"`
	Amount          float64   `json:"amount"`
	FormattedAmount string    `json:"formatted_amount"`
	DueDate         time.Time `json:"due_date"`
	DaysRemaining   int       `json:"days_remaining"`
}

type AlertDto struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	Severity  string    `json:"severity"` // info, warning, danger
	Message   string    `json:"message"`
	CreatedAt time.Time `json:"created_at"`
}

type NextActionDto struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	ActionLabel string `json:"action_label"`
	ActionUrl   string `json:"action_url"`
	Priority    int    `json:"priority"`
}

type TrendPoint struct {
	Month string  `json:"month"`
	Value float64 `json:"value"`
}

type DashboardResponse struct {
	NetWorth             MoneyValue           `json:"net_worth"`
	TotalAssets          AssetBreakdown       `json:"total_assets"`
	TotalDebts           DebtSummaryDto       `json:"total_debts"`
	CashAvailable        MoneyValue           `json:"cash_available"`
	DTIRatio             float64              `json:"dti_ratio"`
	DTIStatus            string               `json:"dti_status"` // healthy, warning, danger
	HealthScore          HealthScoreDto       `json:"health_score"`
	UpcomingBills        []UpcomingBillDto    `json:"upcoming_bills"`
	ForecastEndMonth     MoneyValue           `json:"forecast_end_month"`
	SafeToSpend          MoneyValue           `json:"safe_to_spend"`
	SafeToSpendScenarios SafeToSpendScenarios `json:"safe_to_spend_scenarios"`
	DataSufficiency      *DataSufficiency     `json:"data_sufficiency,omitempty"`
	RecentAlerts         []AlertDto           `json:"recent_alerts"`
	InsightSummary       string               `json:"insight_summary"`
	NextAction           NextActionDto        `json:"next_action"`
	NetWorthTrend        []TrendPoint         `json:"net_worth_trend"`
	// Provenance for decision-support numbers (trust freeze).
	AsOf           string `json:"as_of"`
	FormulaVersion string `json:"formula_version"`
}
