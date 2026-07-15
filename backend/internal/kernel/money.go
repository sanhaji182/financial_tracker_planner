package kernel

import "math"

// MoneyPolicyVersion documents the cash-amount rounding contract.
// Bump when scale / rounding mode changes.
const MoneyPolicyVersion = "money-v1"

// DefaultMoneyScale is decimal places for IDR and other 2-dp currencies.
// DB columns are DECIMAL(15,2); all cash amounts round to this scale before
// compare/store. FX rates use a separate higher scale and are NOT rounded here.
const DefaultMoneyScale = 2

// RoundMoney rounds v half-away-from-zero to `scale` decimal places.
// scale < 0 is treated as 0. Pure — no locale / currency table lookup.
//
// A tiny directed epsilon counters binary float representation of exact
// halfway cases (e.g. 1.005 * 100 → 100.49999… without correction).
// Policy is still half-away-from-zero at the documented money scale; FX rates
// must not use this helper (they keep higher precision elsewhere).
func RoundMoney(v float64, scale int) float64 {
	if scale < 0 {
		scale = 0
	}
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0
	}
	pow := math.Pow(10, float64(scale))
	// math.Round is half-away-from-zero; epsilon is ~1e-10 of the scaled unit.
	eps := math.Copysign(1e-9, v)
	return math.Round(v*pow+eps) / pow
}

// RoundIDR is RoundMoney with DefaultMoneyScale (2 dp).
func RoundIDR(v float64) float64 {
	return RoundMoney(v, DefaultMoneyScale)
}

// ToMinor converts a major-unit amount to integer minor units (e.g. sen for IDR).
// Used for exact equality checks without float epsilon.
func ToMinor(v float64, scale int) int64 {
	if scale < 0 {
		scale = 0
	}
	pow := math.Pow(10, float64(scale))
	return int64(math.Round(v * pow))
}

// FromMinor converts integer minor units back to major units.
func FromMinor(minor int64, scale int) float64 {
	if scale < 0 {
		scale = 0
	}
	pow := math.Pow(10, float64(scale))
	return float64(minor) / pow
}

// MoneyEqual reports whether a and b are equal at the given scale
// (after rounding each to minor units).
func MoneyEqual(a, b float64, scale int) bool {
	return ToMinor(a, scale) == ToMinor(b, scale)
}

// MoneyAdd adds amounts then rounds to scale (associative for fixed-scale cash).
func MoneyAdd(scale int, parts ...float64) float64 {
	var sum float64
	for _, p := range parts {
		sum += p
	}
	return RoundMoney(sum, scale)
}

// MoneySub returns RoundMoney(a - b, scale).
func MoneySub(a, b float64, scale int) float64 {
	return RoundMoney(a-b, scale)
}

// MoneyMul returns RoundMoney(a * factor, scale).
func MoneyMul(a, factor float64, scale int) float64 {
	return RoundMoney(a*factor, scale)
}

// Floor0Money returns max(0, RoundMoney(v, scale)).
func Floor0Money(v float64, scale int) float64 {
	r := RoundMoney(v, scale)
	if r < 0 {
		return 0
	}
	return r
}
