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

func TestSimulateAvalancheRollsPaidOffMinimum(t *testing.T) {
	debts := []DebtInput{
		{ID: "first", Name: "First", Balance: 50, AnnualInterestPct: 0, MinimumPayment: 50},
		{ID: "second", Name: "Second", Balance: 200, AnnualInterestPct: 0, MinimumPayment: 50},
	}
	res := SimulateAvalanche(debts, 0, time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	if res.WithExtra.MonthsToPayoff != 3 {
		t.Fatalf("expected 3 months, got %d", res.WithExtra.MonthsToPayoff)
	}
	if len(res.WithExtra.Schedules) < 2 {
		t.Fatal("expected 2 schedules")
	}
	// second debt should payoff month 3
	var second DebtPayoffSchedule
	for _, s := range res.WithExtra.Schedules {
		if s.DebtID == "second" {
			second = s
		}
	}
	if second.PayoffMonthIndex != 3 {
		t.Fatalf("second payoff want 3 got %d", second.PayoffMonthIndex)
	}
}

func TestSimulateAvalancheDetectsNegativeAmortization(t *testing.T) {
	debts := []DebtInput{
		{ID: "toxic", Name: "Toxic", Balance: 1000, AnnualInterestPct: 120, MinimumPayment: 50},
	}
	res := SimulateAvalanche(debts, 0, time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	if res.WithoutExtra.MonthsToPayoff == MaxSimMonths {
		t.Fatal("must not return 100-year payoff")
	}
	if !res.NegativeAmortization || !res.WithoutExtra.Stalled {
		t.Fatal("expected negative amortization flag")
	}
	if res.WithoutExtra.Schedules[0].PayoffMonthIndex != 0 {
		t.Fatalf("unpayable debt payoff month want 0 got %d", res.WithoutExtra.Schedules[0].PayoffMonthIndex)
	}
}

func TestSimulateAvalancheExtraSavesInterest(t *testing.T) {
	debts := []DebtInput{
		{ID: "a", Name: "A", Balance: 10_000_000, AnnualInterestPct: 24, MinimumPayment: 500_000},
		{ID: "b", Name: "B", Balance: 5_000_000, AnnualInterestPct: 12, MinimumPayment: 250_000},
	}
	res := SimulateAvalanche(debts, 1_000_000, time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	if res.WithExtra.MonthsToPayoff >= res.WithoutExtra.MonthsToPayoff && res.WithExtra.TotalInterestPaid >= res.WithoutExtra.TotalInterestPaid {
		t.Fatalf("extra should reduce months or interest: with=%d/%f without=%d/%f",
			res.WithExtra.MonthsToPayoff, res.WithExtra.TotalInterestPaid,
			res.WithoutExtra.MonthsToPayoff, res.WithoutExtra.TotalInterestPaid)
	}
	if res.FormulaVersion != DebtFormulaVersion {
		t.Fatalf("formula %s", res.FormulaVersion)
	}
	if len(res.Assumptions) == 0 {
		t.Fatal("expected assumptions")
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
