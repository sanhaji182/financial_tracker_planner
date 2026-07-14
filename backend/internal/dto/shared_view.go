package dto

type SharedSummaryResponse struct {
	TotalAssetsShared    int64             `json:"total_assets_shared"`
	FormattedTotalAssets string            `json:"formatted_total_assets"`
	TotalDebts           int64             `json:"total_debts"`
	FormattedTotalDebts  string            `json:"formatted_total_debts"`
	NetWorthShared       int64             `json:"net_worth_shared"`
	FormattedNetWorth    string            `json:"formatted_net_worth"`
	UpcomingBills        []UpcomingBillDto `json:"upcoming_bills"`
	ForecastEndMonth     MoneyValue        `json:"forecast_end_month"`
	OwnerName            string            `json:"owner_name"`
}
