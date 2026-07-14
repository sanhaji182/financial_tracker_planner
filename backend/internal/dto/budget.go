package dto

type BudgetRequest struct {
	CategoryID string `json:"category_id" binding:"required"`
	Month      string `json:"month" binding:"required"`
	Amount     int64  `json:"amount" binding:"required,min=1"`
}

type UpdateBudgetRequest struct {
	Amount int64 `json:"amount" binding:"required,min=1"`
}

type BudgetDto struct {
	ID                 string  `json:"id"`
	CategoryID         string  `json:"category_id"`
	CategoryName       string  `json:"category_name"`
	CategoryIcon       string  `json:"category_icon"`
	CategoryColor      string  `json:"category_color"`
	Month              string  `json:"month"`
	Amount             int64   `json:"amount"`
	FormattedAmount    string  `json:"formatted_amount"`
	Spent              int64   `json:"spent"`
	FormattedSpent     string  `json:"formatted_spent"`
	Remaining          int64   `json:"remaining"`
	FormattedRemaining string  `json:"formatted_remaining"`
	UsedPercentage     float64 `json:"used_percentage"`
	Status             string  `json:"status"` // on_track, attention, almost, over
}

type BudgetSummaryResponse struct {
	TotalBudget    MoneyValue `json:"total_budget"`
	TotalSpent     MoneyValue `json:"total_spent"`
	Remaining      MoneyValue `json:"remaining"`
	CategoriesOver int        `json:"categories_over"`
	Month          string     `json:"month"`
}
