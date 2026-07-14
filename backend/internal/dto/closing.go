package dto

type MonthlyClosingRequest struct {
	Month string `json:"month" binding:"required"`
	Notes string `json:"notes"`
}

type ClosingAccount struct {
	ID      string  `json:"id"`
	Name    string  `json:"name"`
	Balance float64 `json:"balance"`
}

type ClosingCategoryBudget struct {
	Name   string  `json:"name"`
	Budget float64 `json:"budget"`
	Actual float64 `json:"actual"`
}

type ClosingBudgetSummary struct {
	TotalBudget float64                 `json:"total_budget"`
	TotalSpent  float64                 `json:"total_spent"`
	Categories  []ClosingCategoryBudget `json:"categories"`
}

type ClosingGoalProgress struct {
	Name     string  `json:"name"`
	Progress float64 `json:"progress"`
}

type ClosingSnapshot struct {
	Month            string                `json:"month"`
	Accounts         []ClosingAccount      `json:"accounts"`
	TotalIncome      float64               `json:"total_income"`
	TotalExpense     float64               `json:"total_expense"`
	TotalAssets      float64               `json:"total_assets"`
	TotalDebts       float64               `json:"total_debts"`
	NetWorth         float64               `json:"net_worth"`
	TotalCash        float64               `json:"total_cash"`
	DTIRatio         float64               `json:"dti_ratio"`
	HealthScore      int                   `json:"health_score"`
	EFCoverageMonths float64               `json:"ef_coverage_months"`
	BudgetSummary    ClosingBudgetSummary  `json:"budget_summary"`
	GoalsProgress    []ClosingGoalProgress `json:"goals_progress"`
}

type DeltaValue struct {
	AbsoluteChange          float64 `json:"absolute_change"`
	FormattedAbsoluteChange string  `json:"formatted_absolute_change"`
	PercentageChange        float64 `json:"percentage_change"`
	Direction               string  `json:"direction"` // up, down, flat
}

type ClosingComparison struct {
	PrevMonth     string     `json:"prev_month"`
	NetWorthDelta DeltaValue `json:"net_worth_delta"`
	AssetsDelta   DeltaValue `json:"assets_delta"`
	DebtsDelta    DeltaValue `json:"debts_delta"`
	CashDelta     DeltaValue `json:"cash_delta"`
	IncomeDelta   DeltaValue `json:"income_delta"`
	ExpenseDelta  DeltaValue `json:"expense_delta"`
}

type DataSufficiency struct {
	IsSufficient       bool     `json:"is_sufficient"`
	MissingFields      []string `json:"missing_fields,omitempty"`
	UsesFallbackValues bool     `json:"uses_fallback_values"`
}

type MonthlyClosingResponse struct {
	ID               string             `json:"id"`
	Month            string             `json:"month"`
	Snapshot         ClosingSnapshot    `json:"snapshot"`
	TotalIncome      MoneyValue         `json:"total_income"`
	TotalExpense     MoneyValue         `json:"total_expense"`
	NetWorth         MoneyValue         `json:"net_worth"`
	TotalAssets      MoneyValue         `json:"total_assets"`
	TotalDebts       MoneyValue         `json:"total_debts"`
	TotalCash        MoneyValue         `json:"total_cash"`
	DTIRatio         float64            `json:"dti_ratio"`
	EFCoverageMonths float64            `json:"ef_coverage_months"`
	IsConfirmed      bool               `json:"is_confirmed"`
	ConfirmedAt      string             `json:"confirmed_at,omitempty"`
	Notes            string             `json:"notes"`
	Comparison       *ClosingComparison `json:"comparison,omitempty"`
	DataSufficiency  *DataSufficiency   `json:"data_sufficiency,omitempty"`
}
