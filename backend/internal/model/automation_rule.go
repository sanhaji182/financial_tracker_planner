package model

import "time"

// AutomationRule represents a rule-based automated financial action
type AutomationRule struct {
	ID              string     `json:"id"`
	UserID          string     `json:"user_id"`
	Name            string     `json:"name"`
	TriggerType     string     `json:"trigger_type"` // balance_below, bill_due_soon, budget_exceeded, recurring_transaction
	Condition       []byte     `json:"condition"`    // JSONB raw bytes
	ActionType      string     `json:"action_type"`  // send_alert, send_telegram, create_transaction
	ActionConfig    []byte     `json:"action_config"` // JSONB raw bytes
	IsActive        bool       `json:"is_active"`
	LastTriggeredAt *time.Time `json:"last_triggered_at,omitempty"`
	TriggerCount    int        `json:"trigger_count"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
}
