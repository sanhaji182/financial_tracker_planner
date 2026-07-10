package dto

type EFSummaryResponse struct {
	TotalEmergencyFund MoneyValue `json:"total_emergency_fund"`
	MonthlyLivingCost  MoneyValue `json:"monthly_living_cost"`
	TargetMonths       int        `json:"target_months"`
	TargetAmount       MoneyValue `json:"target_amount"`
	CoverageMonths     float64    `json:"coverage_months"`
	ProgressPercentage float64    `json:"progress_percentage"`
	Status             string     `json:"status"` // Aman, Kurang, Kritis
}

type UpdateEFConfigRequest struct {
	TargetMonths               int      `json:"target_months" binding:"required,min=1"`
	MonthlyLivingCostOverride  *float64 `json:"monthly_living_cost_override"`
}
