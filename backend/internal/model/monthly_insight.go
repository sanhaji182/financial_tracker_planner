package model

import "time"

// MonthlyInsight represents an auto-generated monthly financial insight
type MonthlyInsight struct {
	ID          string     `json:"id"`
	UserID      string     `json:"user_id"`
	Month       string     `json:"month"` // YYYY-MM
	InsightType string     `json:"insight_type"`
	Title       string     `json:"title"`
	Description string     `json:"description"`
	Data        *[]byte    `json:"data,omitempty"` // JSONB raw bytes
	Severity    string     `json:"severity"` // positive, neutral, negative
	SortOrder   int        `json:"sort_order"`
	CreatedAt   time.Time  `json:"created_at"`
}
