package dto

import "time"

type GoalResponse struct {
	ID                         string                 `json:"id"`
	UserID                     string                 `json:"user_id"`
	Name                       string                 `json:"name"`
	Type                       string                 `json:"type"`
	TargetAmount               float64                `json:"target_amount"`
	CurrentAmount              float64                `json:"current_amount"`
	TargetDate                 *string                `json:"target_date,omitempty"` // YYYY-MM-DD
	LinkedAccountID            *string                `json:"linked_account_id,omitempty"`
	LinkedAccountName          *string                `json:"linked_account_name,omitempty"`
	LinkedDebtID               *string                `json:"linked_debt_id,omitempty"`
	LinkedDebtName             *string                `json:"linked_debt_name,omitempty"`
	Icon                       string                 `json:"icon"`
	Color                      string                 `json:"color"`
	Status                     string                 `json:"status"`
	Notes                      string                 `json:"notes"`
	Progress                   float64                `json:"progress"`                      // Percentage 0-100
	ProjectedCompletionDate    *string                `json:"projected_completion_date"`     // YYYY-MM-DD
	AverageMonthlyContribution float64                `json:"average_monthly_contribution"`
	CreatedAt                  time.Time              `json:"created_at"`
	ContributionHistory        []GoalContributionItem `json:"contribution_history"`
}

type GoalContributionItem struct {
	ID                string  `json:"id"`
	Amount            float64 `json:"amount"`
	Date              string  `json:"date"`
	Description       string  `json:"description"`
	SourceAccountName string  `json:"source_account_name"`
	Notes             string  `json:"notes"`
}

type CreateGoalRequest struct {
	Name            string  `json:"name" binding:"required"`
	Type            string  `json:"type" binding:"required"`
	TargetAmount    float64 `json:"target_amount" binding:"required,min=1"`
	CurrentAmount   float64 `json:"current_amount"`
	TargetDate      string  `json:"target_date"` // YYYY-MM-DD
	LinkedAccountID string  `json:"linked_account_id"`
	LinkedDebtID    string  `json:"linked_debt_id"`
	Icon            string  `json:"icon"`
	Color           string  `json:"color"`
	Notes           string  `json:"notes"`
}

type UpdateGoalRequest struct {
	Name            *string  `json:"name"`
	Type            *string  `json:"type"`
	TargetAmount    *float64 `json:"target_amount" binding:"omitempty,min=1"`
	CurrentAmount   *float64 `json:"current_amount"`
	TargetDate      *string  `json:"target_date"` // YYYY-MM-DD
	LinkedAccountID *string  `json:"linked_account_id"`
	LinkedDebtID    *string  `json:"linked_debt_id"`
	Icon            *string  `json:"icon"`
	Color           *string  `json:"color"`
	Status          *string  `json:"status"`
	Notes           *string  `json:"notes"`
}

type GoalContributionRequest struct {
	SourceAccountID string  `json:"source_account_id" binding:"required"`
	Amount          float64 `json:"amount" binding:"required,min=1"`
	Date            string  `json:"date" binding:"required"` // YYYY-MM-DD
	Notes           string  `json:"notes"`
}
