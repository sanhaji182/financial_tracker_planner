package dto

type InvestmentBreakdownDto struct {
	AssetType       string     `json:"asset_type"` // e.g. Reksadana, Saham, Deposito, Logam Mulia
	Amount          float64    `json:"amount"`
	FormattedAmount string     `json:"formatted_amount"`
	Percentage      float64    `json:"percentage"`
}

type InvestmentSummaryResponse struct {
	TotalInvestment MoneyValue               `json:"total_investment"`
	LiquidCash      MoneyValue               `json:"liquid_cash"`
	LiquidRatio     float64                  `json:"liquid_ratio"`
	InvestedRatio   float64                  `json:"invested_ratio"`
	Breakdown       []InvestmentBreakdownDto `json:"breakdown"`
	Trend           []MonthlyTrendDto        `json:"trend"`
}

type MonthlyTrendDto struct {
	Month           string     `json:"month"` // YYYY-MM
	Value           float64    `json:"value"`
	FormattedValue  string     `json:"formatted_value"`
}
