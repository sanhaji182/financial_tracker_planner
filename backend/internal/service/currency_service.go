package service

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/user/financial-os/internal/dto"
)

// CurrencyService manages multi-currency configurations and conversions
type CurrencyService interface {
	ListCurrencies(ctx context.Context) ([]dto.CurrencyResponse, error)
	GetExchangeRatesMap(ctx context.Context) (map[string]float64, error)
	UpdateExchangeRate(ctx context.Context, code string, rate float64) error
	ConvertToIDR(ctx context.Context, amount float64, code string) (float64, error)
}

type currencyService struct {
	dbPool *pgxpool.Pool
}

// NewCurrencyService creates a new CurrencyService
func NewCurrencyService(dbPool *pgxpool.Pool) CurrencyService {
	return &currencyService{dbPool: dbPool}
}

// ListCurrencies returns all currency exchange rates
func (s *currencyService) ListCurrencies(ctx context.Context) ([]dto.CurrencyResponse, error) {
	rows, err := s.dbPool.Query(ctx, `
		SELECT code, name, symbol, exchange_rate_to_idr, last_updated_at
		FROM currencies
		ORDER BY code ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("failed to list currencies: %w", err)
	}
	defer rows.Close()

	var list []dto.CurrencyResponse
	for rows.Next() {
		var c dto.CurrencyResponse
		if err := rows.Scan(&c.Code, &c.Name, &c.Symbol, &c.ExchangeRateToIDR, &c.LastUpdatedAt); err != nil {
			continue
		}
		list = append(list, c)
	}

	return list, nil
}

// GetExchangeRatesMap loads all rates into a map for fast lookup
func (s *currencyService) GetExchangeRatesMap(ctx context.Context) (map[string]float64, error) {
	list, err := s.ListCurrencies(ctx)
	if err != nil {
		return nil, err
	}

	rates := make(map[string]float64)
	for _, c := range list {
		rates[c.Code] = c.ExchangeRateToIDR
	}

	// Always default IDR to 1.0
	rates["IDR"] = 1.0

	return rates, nil
}

// UpdateExchangeRate changes exchange_rate_to_idr and updates last_updated_at
func (s *currencyService) UpdateExchangeRate(ctx context.Context, code string, rate float64) error {
	tag, err := s.dbPool.Exec(ctx, `
		UPDATE currencies
		SET exchange_rate_to_idr = $1, last_updated_at = NOW()
		WHERE code = $2
	`, rate, code)
	if err != nil {
		return fmt.Errorf("failed to update currency rate: %w", err)
	}

	if tag.RowsAffected() == 0 {
		return fmt.Errorf("currency code %s not found", code)
	}

	return nil
}

// ConvertToIDR converts foreign currency amount to IDR
func (s *currencyService) ConvertToIDR(ctx context.Context, amount float64, code string) (float64, error) {
	if code == "IDR" || code == "" {
		return amount, nil
	}

	var rate float64
	err := s.dbPool.QueryRow(ctx, `
		SELECT exchange_rate_to_idr FROM currencies WHERE code = $1
	`, code).Scan(&rate)
	if err != nil {
		// Fallback to default rates in case of query failure
		switch code {
		case "USD":
			rate = 16500.0
		case "SGD":
			rate = 12300.0
		case "EUR":
			rate = 17800.0
		default:
			rate = 1.0
		}
	}

	return amount * rate, nil
}
