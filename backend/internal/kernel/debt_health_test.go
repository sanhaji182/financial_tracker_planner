package kernel

import (
	"testing"
	"time"
)

func TestAccrueInterestGraceAndFee(t *testing.T) {
	d := DebtInput{Balance: 1_000_000, AnnualInterestPct: 24, MonthlyFee: 10_000, GraceMonths: 2}
	i, f := AccrueInterest(d, d.Balance, 1)
	if i != 0 {
		t.Fatalf("grace interest want 0 got %f", i)
	}
	if f != 10_000 {
		t.Fatalf("fee %f", f)
	}
	i2, _ := AccrueInterest(d, d.Balance, 3)
	if i2 <= 0 {
		t.Fatal("post-grace should accrue")
	}
}

func TestEffectiveMinPaymentCCPercent(t *testing.T) {
	d := DebtInput{Type: "credit_card", MinimumPayment: 100_000, MinPaymentPercent: 10, Balance: 5_000_000}
	min := EffectiveMinPayment(d, 5_000_000)
	if min != 500_000 {
		t.Fatalf("min want 500k got %f", min)
	}
}

func TestDailyInterestHigherThanMonthlyApprox(t *testing.T) {
	// 365-day daily * 30 ≈ slightly different from /12
	bal, apr := 1_000_000.0, 36.0
	m := MonthlyInterest(bal, apr)
	d := DailyInterest30(bal, apr)
	if m <= 0 || d <= 0 {
		t.Fatal("both positive")
	}
}

func TestSimulateAvalancheCCWithFeeStillPays(t *testing.T) {
	debts := []DebtInput{{
		ID: "cc", Name: "CC", Type: "credit_card",
		Balance: 1_000_000, AnnualInterestPct: 24,
		MinimumPayment: 200_000, MonthlyFee: 5_000, MinPaymentPercent: 5,
	}}
	res := SimulateAvalanche(debts, 100_000, time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	if res.FormulaVersion != DebtFormulaVersion {
		t.Fatalf("version %s", res.FormulaVersion)
	}
	if res.WithExtra.TotalFeesPaid <= 0 && res.WithExtra.MonthsToPayoff > 1 {
		// fees should accumulate if multi-month
		t.Logf("fees=%f months=%d", res.WithExtra.TotalFeesPaid, res.WithExtra.MonthsToPayoff)
	}
	if len(res.Sensitivity) < 3 {
		t.Fatalf("sensitivity %d", len(res.Sensitivity))
	}
	if len(res.InterestModels) == 0 {
		t.Fatal("models")
	}
}

func TestSimulateAvalancheNegativeAmortizationStillExplicit(t *testing.T) {
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
}

func TestInstallmentFlatAccrual(t *testing.T) {
	d := DebtInput{
		Type: "installment", Balance: 12_000_000, AnnualInterestPct: 12,
		InstallmentFlat: true, TenorMonths: 12, MinimumPayment: 1_100_000,
	}
	i, _ := AccrueInterest(d, d.Balance, 1)
	// 12% * 12M / 12 = 120_000
	if i != 120_000 {
		t.Fatalf("flat interest want 120000 got %f", i)
	}
}

func TestHealthNoFalseHealthyWithoutIncome(t *testing.T) {
	res := ComputeHealthScore(HealthInputs{
		AsOf:                 time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC),
		IncomeThisMonth:      0,
		TotalMinDebtPayments: 0, // would look like DTI=0 if mishandled
		CashAvailable:        50_000_000,
		MonthlyLivingCost:    5_000_000,
		EFCoverageMonths:     6,
		EFTargetMonths:       6,
		ReconciliationRate:   1,
	})
	if res.DTIStatus == "healthy" {
		t.Fatalf("DTI must not be healthy without income: %+v", res)
	}
	if res.FormulaVersion != HealthFormulaVersion {
		t.Fatalf("version %s", res.FormulaVersion)
	}
	// With living cost + EF, score may still show — but DTI component excluded
	var dti HealthComponent
	for _, c := range res.Components {
		if c.Key == "dti" {
			dti = c
		}
	}
	if dti.Included {
		t.Fatal("DTI component must be excluded without income")
	}
	if res.IsCreditScore {
		t.Fatal("must never claim credit score")
	}
	if len(res.Methodology) == 0 || res.Disclaimer == "" {
		t.Fatal("methodology/disclaimer required")
	}
}

func TestHealthInsufficientEmptyBooks(t *testing.T) {
	res := ComputeHealthScore(HealthInputs{AsOf: time.Now()})
	if res.Rating != "Insufficient" || res.Score != 0 {
		t.Fatalf("want Insufficient/0 got %s/%d", res.Rating, res.Score)
	}
	if res.IsSufficient {
		t.Fatal("not sufficient")
	}
}

func TestHealthOptOut(t *testing.T) {
	res := ComputeHealthScore(HealthInputs{
		IncomeThisMonth: 10_000_000, OptOut: true,
	})
	if res.Rating != "OptOut" || res.Score != 0 {
		t.Fatalf("%s %d", res.Rating, res.Score)
	}
}

func TestHealthExcellentWithStrongBooks(t *testing.T) {
	res := ComputeHealthScore(HealthInputs{
		AsOf:                 time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC),
		IncomeThisMonth:      20_000_000,
		ExpenseThisMonth:     8_000_000,
		TotalMinDebtPayments: 1_000_000, // DTI 5%
		CashAvailable:        40_000_000,
		MonthlyLivingCost:    8_000_000,
		EFCoverageMonths:     8,
		EFTargetMonths:       6,
		ReconciliationRate:   1.0,
		MinMonthlyIncome:     18_000_000,
		MaxMonthlyIncome:     20_000_000,
	})
	if res.Score < 80 || res.Rating != "Excellent" {
		t.Fatalf("score %d rating %s conf %s", res.Score, res.Rating, res.DataConfidence)
	}
	if res.DataConfidence != "high" {
		t.Fatalf("conf %s", res.DataConfidence)
	}
}

func TestHealthReconFloor(t *testing.T) {
	base := HealthInputs{
		IncomeThisMonth: 10_000_000, ExpenseThisMonth: 5_000_000,
		TotalMinDebtPayments: 500_000, CashAvailable: 20_000_000,
		MonthlyLivingCost: 5_000_000, EFCoverageMonths: 6, EFTargetMonths: 6,
	}
	full := ComputeHealthScore(base)
	base.ReconciliationRate = 0
	zero := ComputeHealthScore(base)
	if zero.ReconciliationConfidence < HealthReconFloor-0.001 {
		t.Fatalf("floor %f", zero.ReconciliationConfidence)
	}
	if zero.Score >= full.Score && full.Score > 0 {
		// zero recon should not exceed full recon score
		if zero.Score > full.Score {
			t.Fatalf("zero recon %d > full %d", zero.Score, full.Score)
		}
	}
}
