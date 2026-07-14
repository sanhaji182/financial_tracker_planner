package model

import (
	"fmt"
	"math"
	"strings"
)

// Money represents currency in smallest unit (rupiah for IDR).
// Using int64 avoids floating-point precision issues.
type Money = int64

// MoneyFromDecimal converts a decimal float64 (e.g., 150000.50) to Money (15000050 cents).
// Use this when reading from database DECIMAL columns.
func MoneyFromDecimal(v float64) Money {
	return Money(math.Round(v * 100))
}

// DecimalFromMoney converts Money (cents) back to decimal float64.
// Use this when writing to database DECIMAL columns.
func DecimalFromMoney(m Money) float64 {
	return float64(m) / 100.0
}

// MoneyFromCents creates Money from an already-multiplied value.
func MoneyFromCents(c int64) Money {
	return Money(c)
}

// MoneyToCents returns the raw int64 value (already in cents).
func MoneyToCents(m Money) int64 {
	return int64(m)
}

// FormatRupiahMoney formats Money to "Rp 150.000" string.
func FormatRupiahMoney(m Money) string {
	isNegative := m < 0
	if isNegative {
		m = -m
	}
	// Money is in cents, divide by 100 for display
	rupee := m / 100

	// Format with thousand separators
	s := fmt.Sprintf("%d", rupee)
	n := len(s)
	if n <= 3 {
		if isNegative {
			return "-Rp " + s
		}
		return "Rp " + s
	}

	var result []string
	for n > 3 {
		result = append([]string{s[n-3:]}, result...)
		s = s[:n-3]
		n = len(s)
	}
	result = append([]string{s}, result...)

	formatted := "Rp " + strings.Join(result, ".")
	if isNegative {
		formatted = "-" + formatted
	}
	return formatted
}
