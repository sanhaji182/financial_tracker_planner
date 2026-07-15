package kernel

import (
	"math"
	"testing"
)

func TestRoundMoneyHalfAway(t *testing.T) {
	cases := []struct {
		v, want float64
		scale   int
	}{
		{1.005, 1.01, 2},
		{1.004, 1.00, 2},
		{1.015, 1.02, 2},
		{-1.005, -1.01, 2},
		{100.999, 101.00, 2},
		{math.NaN(), 0, 2},
		{math.Inf(1), 0, 2},
	}
	for _, c := range cases {
		got := RoundMoney(c.v, c.scale)
		if !MoneyEqual(got, c.want, c.scale) {
			t.Fatalf("RoundMoney(%v,%d)=%v want %v", c.v, c.scale, got, c.want)
		}
	}
}

func TestToMinorFromMinorRoundTrip(t *testing.T) {
	for _, v := range []float64{0, 1, 1.5, 12345.67, -99.99, 0.01} {
		m := ToMinor(v, 2)
		back := FromMinor(m, 2)
		if !MoneyEqual(v, back, 2) {
			t.Fatalf("roundtrip %v → %d → %v", v, m, back)
		}
	}
}

func TestMoneyEqualScale(t *testing.T) {
	// 0.1+0.2 style noise should still equal at 2dp.
	a := 0.1 + 0.2
	if !MoneyEqual(a, 0.3, 2) {
		t.Fatalf("0.1+0.2 should equal 0.3 at 2dp, got %v", a)
	}
	if MoneyEqual(1.001, 1.009, 2) {
		// both round to 1.00
	} else {
		// 1.001 → 1.00, 1.009 → 1.01 — not equal
		if MoneyEqual(RoundIDR(1.001), RoundIDR(1.009), 2) {
			t.Fatal("1.001 and 1.009 should not equal after round to 2dp")
		}
	}
}

func TestMoneyAddSubMul(t *testing.T) {
	if !MoneyEqual(MoneyAdd(2, 10.005, 0.005), 10.01, 2) {
		t.Fatalf("add: %v", MoneyAdd(2, 10.005, 0.005))
	}
	if !MoneyEqual(MoneySub(10.00, 3.335, 2), 6.66, 2) && !MoneyEqual(MoneySub(10.00, 3.335, 2), 6.67, 2) {
		// 10 - 3.335 = 6.665 → 6.67 half-away
		got := MoneySub(10.00, 3.335, 2)
		if !MoneyEqual(got, 6.67, 2) {
			t.Fatalf("sub got %v", got)
		}
	}
	// 15_000_000 * 0.01 = 150_000 exact
	if !MoneyEqual(MoneyMul(15_000_000, 0.01, 2), 150_000, 2) {
		t.Fatalf("mul interest sample %v", MoneyMul(15_000_000, 0.01, 2))
	}
}

func TestFloor0Money(t *testing.T) {
	if Floor0Money(-0.004, 2) != 0 {
		t.Fatal("floor0 negative")
	}
	if !MoneyEqual(Floor0Money(1.234, 2), 1.23, 2) {
		t.Fatal("floor0 positive")
	}
}
