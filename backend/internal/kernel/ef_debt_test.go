package kernel

import (
	"math"
	"testing"
	"time"
)

func TestComputeEFAdaptiveUnstableIncome(t *testing.T) {
	res := ComputeEF(EFInputs{
		AsOf:                   time.Date(2026, 7, 15, 0, 0, 0, 0, time.UTC),
		EFBalance:              20_000_000,
		MonthlyLivingCost:      5_000_000,
		ConfiguredTargetMonths: 6,
		UseAdaptive:            true,
		MinMonthlyIncome:       5_000_000,
		MaxMonthlyIncome:       10_000_000, // ratio 0.5 < 0.7
	})
	if res.TargetMonths != EFUnstableTargetMonths {
		t.Fatalf("want %d months, got %d", EFUnstableTargetMonths, res.TargetMonths)
	}
	if math.Abs(res.TargetAmount-45_000_000) > 0.01 {
		t.Fatalf("target amount want 45M got %f", res.TargetAmount)
	}
	if math.Abs(res.CoverageMonths-4.0) > 0.01 {
		t.Fatalf("coverage want 4 got %f", res.CoverageMonths)
	}
	if res.Status != "Kurang" {
		t.Fatalf("status want Kurang got %s", res.Status)
	}
	if res.FormulaVersion != EFFormulaVersion {
		t.Fatalf("formula %s", res.FormulaVersion)
	}
}

func TestComputeEFAdaptiveStableIncome(t *testing.T) {
	res := ComputeEF(EFInputs{
		EFBalance:              20_000_000,
		MonthlyLivingCost:      5_000_000,
		ConfiguredTargetMonths: 6,
		UseAdaptive:            true,
		MinMonthlyIncome:       9_000_000,
		MaxMonthlyIncome:       10_000_000, // ratio 0.9
	})
	if res.TargetMonths != EFStableTargetMonths {
		t.Fatalf("want %d got %d", EFStableTargetMonths, res.TargetMonths)
	}
	// coverage 4 months, target 4 → Aman
	if res.Status != "Aman" {
		t.Fatalf("status want Aman got %s", res.Status)
	}
}

func TestComputeEFManualTargetWins(t *testing.T) {
	res := ComputeEF(EFInputs{
		EFBalance:              10_000_000,
		MonthlyLivingCost:      5_000_000,
		ConfiguredTargetMonths: 12, // explicit non-default
		UseAdaptive:            true,
		MinMonthlyIncome:       1,
		MaxMonthlyIncome:       100, // would be unstable if adaptive applied
	})
	if res.TargetMonths != 12 {
		t.Fatalf("manual target should win, got %d", res.TargetMonths)
	}
	if res.TargetRationale != "Target manual pengguna" {
		t.Fatalf("rationale %s", res.TargetRationale)
	}
}

func TestComputeEFInsufficientLivingCost(t *testing.T) {
	res := ComputeEF(EFInputs{EFBalance: 1_000_000, UseAdaptive: true})
	if res.DataQuality.IsSufficient {
		t.Fatal("expected insufficient")
	}
	if res.DataQuality.Confidence != "low" {
		t.Fatalf("confidence %s", res.DataQuality.Confidence)
	}
}




func TestMonthlyInterest(t *testing.T) {
	// 12% APR on 1_200_000 → 12_000 / month
	got := MonthlyInterest(1_200_000, 12)
	if math.Abs(got-12_000) > 0.01 {
		t.Fatalf("want 12000 got %f", got)
	}
	if MonthlyInterest(0, 12) != 0 || MonthlyInterest(100, 0) != 0 {
		t.Fatal("zero cases")
	}
}
