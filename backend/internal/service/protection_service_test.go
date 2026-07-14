package service

import "testing"

func TestFormatRupiahProtection(t *testing.T) {
	tests := []struct {
		name   string
		amount float64
		want   string
	}{
		{name: "positif", amount: 1250000, want: "Rp 1.250.000"},
		{name: "negatif", amount: -1250000, want: "-Rp 1.250.000"},
		{name: "nol", amount: 0, want: "Rp 0"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := formatRupiahProtection(tt.amount); got != tt.want {
				t.Fatalf("formatRupiahProtection(%v) = %q, ingin %q", tt.amount, got, tt.want)
			}
		})
	}
}
