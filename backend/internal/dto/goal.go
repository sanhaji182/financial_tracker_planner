package dto

import "time"

type GoalResponse struct {
	ID                         string  `json:"id"`
	UserID                     string  `json:"user_id"`
	Name                       string  `json:"name"`
	Type                       string  `json:"type"`
	TargetAmount               float64 `json:"target_amount"`
	CurrentAmount              float64 `json:"current_amount"`
	TargetDate                 *string `json:"target_date,omitempty"` // YYYY-MM-DD
	LinkedAccountID            *string `json:"linked_account_id,omitempty"`
	LinkedAccountName          *string `json:"linked_account_name,omitempty"`
	LinkedDebtID               *string `json:"linked_debt_id,omitempty"`
	LinkedDebtName             *string `json:"linked_debt_name,omitempty"`
	Icon                       string  `json:"icon"`
	Color                      string  `json:"color"`
	Status                     string  `json:"status"`
	Notes                      string  `json:"notes"`
	Progress                   float64 `json:"progress"`                  // Percentage 0-100
	ProjectedCompletionDate    *string `json:"projected_completion_date"` // YYYY-MM-DD
	AverageMonthlyContribution float64 `json:"average_monthly_contribution"`
	// Affordability & sinking fund fields (calculated)
	MonthlyRequired     *float64               `json:"monthly_required,omitempty"` // How much per month needed to reach target by target_date
	IsAffordable        *bool                  `json:"is_affordable,omitempty"`    // true if monthly_required <= available surplus
	FundingGap          *float64               `json:"funding_gap,omitempty"`      // How much per month shortfall if not affordable
	IsSinkingFund       bool                   `json:"is_sinking_fund"`            // true if type is sinking_fund
	Priority            int                    `json:"priority"`                   // 1=highest, auto-assigned by type
	MonthsRemaining     *float64               `json:"months_remaining,omitempty"` // months until target_date
	// Feasibility / on-track metrics
	IsOnTrack          *bool    `json:"is_on_track,omitempty"`         // projected completion on or before target_date
	FeasibilityStatus  string   `json:"feasibility_status,omitempty"`  // on_track | at_risk | off_track | achieved | no_deadline | unknown
	FeasibilityNote    string   `json:"feasibility_note,omitempty"`    // human-readable explanation
	RequiredVsActual   *float64 `json:"required_vs_actual,omitempty"`  // average_monthly / monthly_required ratio (1.0 = exact pace)
	CreatedAt          time.Time              `json:"created_at"`
	ContributionHistory []GoalContributionItem `json:"contribution_history"`
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
