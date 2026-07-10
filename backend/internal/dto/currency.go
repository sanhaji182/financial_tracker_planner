package dto

import "time"

// CurrencyResponse is returned to client for exchange rates
type CurrencyResponse struct {
	Code              string    `json:"code"`
	Name              string    `json:"name"`
	Symbol            string    `json:"symbol"`
	ExchangeRateToIDR float64   `json:"exchange_rate_to_idr"`
	LastUpdatedAt     time.Time `json:"last_updated_at"`
}

// UpdateCurrencyRequest is body payload to update exchange rates
type UpdateCurrencyRequest struct {
	ExchangeRateToIDR float64 `json:"exchange_rate_to_idr" binding:"required,gt=0"`
}
