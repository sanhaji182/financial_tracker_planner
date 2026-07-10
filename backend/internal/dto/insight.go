package dto

import "time"

// InsightDataCategory holds category breakdown data
type InsightDataCategory struct {
	Name   string  `json:"name"`
	Amount float64 `json:"amount"`
	Change float64 `json:"change,omitempty"` // percentage change vs avg
}

// InsightDataCashflow holds weekly spending breakdown
type InsightDataCashflow struct {
	Week    string  `json:"week"` // "Minggu ke-1", etc.
	Amount  float64 `json:"amount"`
	IsSpike bool    `json:"is_spike"`
}

// InsightData is a flexible JSON payload for supporting data
type InsightData struct {
	// For spending_increase / top_categories
	Categories []InsightDataCategory `json:"categories,omitempty"`
	// For cashflow_risk
	Cashflow []InsightDataCashflow `json:"cashflow,omitempty"`
	// For networth_trend
	CurrentNetWorth  float64 `json:"current_net_worth,omitempty"`
	PreviousNetWorth float64 `json:"previous_net_worth,omitempty"`
	ChangePercent    float64 `json:"change_percent,omitempty"`
	// For subscription_change
	CurrentCost  float64 `json:"current_cost,omitempty"`
	PreviousCost float64 `json:"previous_cost,omitempty"`
	// For recommendation
	OverBudgetCategories []string `json:"over_budget_categories,omitempty"`
}

// MonthlyInsightResponse is returned to the client
type MonthlyInsightResponse struct {
	ID          string      `json:"id"`
	UserID      string      `json:"user_id"`
	Month       string      `json:"month"`
	InsightType string      `json:"insight_type"`
	Title       string      `json:"title"`
	Description string      `json:"description"`
	Data        InsightData `json:"data"`
	Severity    string      `json:"severity"` // positive, neutral, negative
	SortOrder   int         `json:"sort_order"`
	CreatedAt   time.Time   `json:"created_at"`
}

// InsightsListResponse wraps the full insights list for a month
type InsightsListResponse struct {
	Month    string                   `json:"month"`
	Insights []MonthlyInsightResponse `json:"insights"`
}

// GenerateInsightsRequest is used for the manual trigger endpoint
type GenerateInsightsRequest struct {
	Month string `json:"month" binding:"required"` // YYYY-MM
}
