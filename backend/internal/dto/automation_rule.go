package dto

import "time"

// RuleCondition defines options for all trigger types
type RuleCondition struct {
	AccountID  string  `json:"account_id,omitempty"`
	Threshold  float64 `json:"threshold,omitempty"`
	DaysBefore int     `json:"days_before,omitempty"`
	CategoryID string  `json:"category_id,omitempty"`
	Percentage float64 `json:"percentage,omitempty"`
	// For recurring transactions
	Amount     float64 `json:"amount,omitempty"`
	Frequency  string  `json:"frequency,omitempty"` // weekly, monthly, yearly
	DayOfMonth int     `json:"day_of_month,omitempty"`
	DayOfWeek  int     `json:"day_of_week,omitempty"` // 1-7 (Monday-Sunday)
}

// RuleActionConfig defines options for all action types
type RuleActionConfig struct {
	Template     string   `json:"template,omitempty"`      // message template
	TelegramChat string   `json:"telegram_chat,omitempty"` // chat target if custom
	AccountID    string   `json:"account_id,omitempty"`
	CategoryID   string   `json:"category_id,omitempty"`
	Amount       float64  `json:"amount,omitempty"`
	Description  string   `json:"description,omitempty"`
	Type         string   `json:"type,omitempty"` // expense, income
	Tags         []string `json:"tags,omitempty"`
}

// CreateAutomationRuleRequest holds input payload to add a rule
type CreateAutomationRuleRequest struct {
	Name         string           `json:"name" binding:"required"`
	TriggerType  string           `json:"trigger_type" binding:"required,oneof=balance_below bill_due_soon budget_exceeded recurring_transaction"`
	Condition    RuleCondition    `json:"condition" binding:"required"`
	ActionType   string           `json:"action_type" binding:"required,oneof=send_alert send_telegram create_transaction"`
	ActionConfig RuleActionConfig `json:"action_config" binding:"required"`
}

// UpdateAutomationRuleRequest holds input payload to update rule status or details
type UpdateAutomationRuleRequest struct {
	Name         *string           `json:"name,omitempty"`
	TriggerType  *string           `json:"trigger_type,omitempty"`
	Condition    *RuleCondition    `json:"condition,omitempty"`
	ActionType   *string           `json:"action_type,omitempty"`
	ActionConfig *RuleActionConfig `json:"action_config,omitempty"`
	IsActive     *bool             `json:"is_active,omitempty"`
}

// AutomationRuleResponse represents a formatted rule
type AutomationRuleResponse struct {
	ID              string           `json:"id"`
	UserID          string           `json:"user_id"`
	Name            string           `json:"name"`
	TriggerType     string           `json:"trigger_type"`
	Condition       RuleCondition    `json:"condition"`
	ActionType      string           `json:"action_type"`
	ActionConfig    RuleActionConfig `json:"action_config"`
	IsActive        bool             `json:"is_active"`
	LastTriggeredAt *time.Time       `json:"last_triggered_at,omitempty"`
	TriggerCount    int              `json:"trigger_count"`
	CreatedAt       time.Time        `json:"created_at"`
	UpdatedAt       time.Time        `json:"updated_at"`
}
