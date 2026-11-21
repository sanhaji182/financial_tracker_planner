package dto

// Behavioral / monthly review DTOs (behavioral-v1)

type ReviewChecklistItemDTO struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Category    string `json:"category"`
	Status      string `json:"status"`
	Priority    int    `json:"priority"`
	ActionURL   string `json:"action_url,omitempty"`
	Required    bool   `json:"required"`
}

type SuggestedActionDTO struct {
	ID           string  `json:"id"`
	Kind         string  `json:"kind"`
	Title        string  `json:"title"`
	Rationale    string  `json:"rationale"`
	TargetID     string  `json:"target_id,omitempty"`
	TargetLabel  string  `json:"target_label,omitempty"`
	Amount       float64 `json:"amount,omitempty"`
	IsReversible bool    `json:"is_reversible"`
	ConfirmLabel string  `json:"confirm_label"`
	DismissLabel string  `json:"dismiss_label"`
	ActionURL    string  `json:"action_url,omitempty"`
	Severity     string  `json:"severity"`
}

type MonthlyReviewResponse struct {
	AsOf           string                   `json:"as_of"`
	Month          string                   `json:"month"`
	FormulaVersion string                   `json:"formula_version"`
	Checklist      []ReviewChecklistItemDTO `json:"checklist"`
	Actions        []SuggestedActionDTO     `json:"suggested_actions"`
	CompletedCount int                      `json:"completed_count"`
	TotalRequired  int                      `json:"total_required"`
	ProgressPct    float64                  `json:"progress_pct"`
	Summary        string                   `json:"summary"`
	Assumptions    []string                 `json:"assumptions"`
	Disclaimer     string                   `json:"disclaimer"`
}

type UpdateReviewItemRequest struct {
	ItemID string `json:"item_id" binding:"required"`
	Status string `json:"status" binding:"required"` // pending|done|skipped|blocked
}

type DismissActionRequest struct {
	ActionID string `json:"action_id" binding:"required"`
}
