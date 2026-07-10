package dto

type TransferRequest struct {
	SourceAccountID string  `json:"source_account_id" binding:"required"`
	TargetAccountID string  `json:"target_account_id" binding:"required"`
	Amount          float64 `json:"amount" binding:"required,min=1"`
	Date            string  `json:"date" binding:"required"` // YYYY-MM-DD
	Notes           string  `json:"notes"`
}
