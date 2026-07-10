package dto

type ReconciliationStartRequest struct {
	AccountID     string  `json:"account_id" binding:"required"`
	ActualBalance float64 `json:"actual_balance" binding:"required"`
	Date          string  `json:"date" binding:"required"` // YYYY-MM-DD
}

type ReconciliationConfirmRequest struct {
	AccountID string `json:"account_id" binding:"required"`
	Date      string `json:"date" binding:"required"` // YYYY-MM-DD
}

type ReconciliationResponse struct {
	Difference            float64               `json:"difference"`
	FormattedDifference   string                `json:"formatted_difference"`
	UnmatchedTransactions []TransactionResponse `json:"unmatched_transactions"`
	Suggestions           string                `json:"suggestions"`
	Status                string                `json:"status"` // match, mismatch
}
