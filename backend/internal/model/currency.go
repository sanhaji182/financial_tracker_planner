package model

import "time"

// Currency represents the currency exchange rate reference
type Currency struct {
	Code              string    `json:"code"` // USD, SGD, EUR, IDR
	Name              string    `json:"name"`
	Symbol            string    `json:"symbol"`
	ExchangeRateToIDR float64   `json:"exchange_rate_to_idr"`
	LastUpdatedAt     time.Time `json:"last_updated_at"`
}
