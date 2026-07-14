package model

import (
	"testing"
)

func TestMoneyFromDecimal(t *testing.T) {
	tests := []struct {
		input    float64
		expected Money
	}{
		{150000.00, 15000000},
		{150000.50, 15000050},
		{0.01, 1},
		{0.0, 0},
		{1234567.89, 123456789},
		{-50000.00, -5000000},
	}
	for _, tt := range tests {
		result := MoneyFromDecimal(tt.input)
		if result != tt.expected {
			t.Errorf("MoneyFromDecimal(%f) = %d, want %d", tt.input, result, tt.expected)
		}
	}
}

func TestDecimalFromMoney(t *testing.T) {
	tests := []struct {
		input    Money
		expected float64
	}{
		{15000000, 150000.00},
		{15000050, 150000.50},
		{1, 0.01},
		{0, 0.0},
		{-5000000, -50000.00},
	}
	for _, tt := range tests {
		result := DecimalFromMoney(tt.input)
		if result != tt.expected {
			t.Errorf("DecimalFromMoney(%d) = %f, want %f", tt.input, result, tt.expected)
		}
	}
}

func TestFormatRupiahMoney(t *testing.T) {
	tests := []struct {
		input    Money
		expected string
	}{
		{15000000, "Rp 150.000"},
		{15000050, "Rp 150.000"},
		{0, "Rp 0"},
		{-5000000, "-Rp 50.000"},
		{1000000000, "Rp 10.000.000"},
	}
	for _, tt := range tests {
		result := FormatRupiahMoney(tt.input)
		if result != tt.expected {
			t.Errorf("FormatRupiahMoney(%d) = %q, want %q", tt.input, result, tt.expected)
		}
	}
}
