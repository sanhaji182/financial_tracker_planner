package dto

type AdviceDto struct {
	Priority        int        `json:"priority"`
	Title           string     `json:"title"`
	AmountSuggested MoneyValue `json:"amount_suggested"`
	Reason          string     `json:"reason"`
	ActionType      string     `json:"action_type"` // top_up, pay_extra, fund_goal, hold_buffer, invest
	ActionUrl       string     `json:"action_url"`
}

type AllocationAdviceResponse struct {
	Surplus         MoneyValue       `json:"surplus"`
	Advices         []AdviceDto      `json:"advices"`
	DataSufficiency *DataSufficiency `json:"data_sufficiency,omitempty"`
	// Hierarchy documents the decision order used for this response.
	Hierarchy []string `json:"hierarchy"`
}
