package kernel

import (
	"math"
	"testing"
	"time"
)

func TestComputeCashflowSurplusFormula(t *testing.T) {
	in := CashflowInputs{
		AsOf:                      time.Date(2026, 7, 15, 12, 0, 0, 0, time.UTC),
		CashAvailable:             10_000_000,
		EstimatedIncome:           20_000_000,
		EstimatedFixedExpenses:    5_000_000,
		EstimatedVariableExpenses: 6_000_000,
		MonthlyLivingCost:         7_000_000,
		IsCurrentMonth:            false,
		DaysRemaining:             30,
		DaysInMonth:               30,
	}
	// surplus = 20M - 5M - 6M - 2M(buffer) = 7M
	res := ComputeCashflow(in)
	if math.Abs(res.Surplus-7_000_000) > 0.01 {
		t.Fatalf("surplus want 7000000 got %f", res.Surplus)
	}
	if res.FormulaVersion != FormulaVersion {
		t.Fatalf("formula version %s", res.FormulaVersion)
	}
	if !res.DataQuality.IsSufficient {
		t.Fatalf("expected sufficient data, missing=%v", res.DataQuality.MissingFields)
	}
}

func TestComputeCashflowSurplusFloorsAtZero(t *testing.T) {
	in := CashflowInputs{
		EstimatedIncome:           1_000_000,
		EstimatedFixedExpenses:    800_000,
		EstimatedVariableExpenses: 500_000,
		MonthlyLivingCost:         500_000,
	}
	res := ComputeCashflow(in)
	if res.Surplus != 0 {
		t.Fatalf("expected zero surplus, got %f", res.Surplus)
	}
}

func TestComputeCashflowNoDoubleCountIncomeCurrentMonth(t *testing.T) {
	// Income already received (MTD == estimate). Remaining income must be 0.
	in := CashflowInputs{
		AsOf:                      time.Date(2026, 7, 20, 0, 0, 0, 0, time.UTC),
		CashAvailable:             15_000_000,
		IncomeMTD:                 20_000_000,
		ExpenseMTD:                5_000_000,
		EstimatedIncome:           20_000_000,
		EstimatedFixedExpenses:    3_000_000,
		EstimatedVariableExpenses: 6_000_000,
		MonthlyLivingCost:         6_000_000,
		MinDebtPayments:           1_000_000,
		IsCurrentMonth:            true,
		DaysRemaining:             10,
		DaysInMonth:               31,
	}
	res := ComputeCashflow(in)
	// Without double-count: cash 15M + remaining income 0 - min debt 1M - remaining var (6M/30*10=2M) - living 6M
	// conservative = 15 - 1 - 2 - 6 = 6M
	want := 6_000_000.0
	if math.Abs(res.SafeToSpend-want) > 1 {
		t.Fatalf("safe_to_spend want %f got %f (scenarios %+v)", want, res.SafeToSpend, res.SafeToSpendScenarios)
	}
}

func TestComputeCashflowCapsByLowestProjectedBalance(t *testing.T) {
	in := CashflowInputs{
		CashAvailable:             50_000_000,
		EstimatedIncome:           20_000_000,
		EstimatedFixedExpenses:    2_000_000,
		EstimatedVariableExpenses: 3_000_000,
		MonthlyLivingCost:         5_000_000,
		IsCurrentMonth:            false,
		DaysRemaining:             30,
		HasLowestBalance:          true,
		LowestProjectedBalance:    1_000_000,
		RequiredBuffer:            200_000,
	}
	res := ComputeCashflow(in)
	// Cap = max(0, 1_000_000 - 200_000) = 800_000
	if res.SafeToSpend > 800_000+0.01 {
		t.Fatalf("safe_to_spend should be capped at 800000, got %f", res.SafeToSpend)
	}
	// Invariant: STS <= max(0, lowest - required_buffer)
	cap := math.Max(0, in.LowestProjectedBalance-in.RequiredBuffer)
	if res.SafeToSpend > cap+0.01 {
		t.Fatalf("invariant violated: sts %f > cap %f", res.SafeToSpend, cap)
	}
}

func TestComputeCashflowScenarioOrdering(t *testing.T) {
	in := CashflowInputs{
		CashAvailable:             12_000_000,
		EstimatedIncome:           15_000_000,
		EstimatedFixedExpenses:    4_000_000,
		EstimatedVariableExpenses: 5_000_000,
		MonthlyLivingCost:         5_000_000,
		IsCurrentMonth:            false,
		DaysRemaining:             30,
	}
	res := ComputeCashflow(in)
	s := res.SafeToSpendScenarios
	if s.Conservative > s.Expected+0.01 || s.Expected > s.Optimistic+0.01 {
		t.Fatalf("scenario order broken: C=%f E=%f O=%f", s.Conservative, s.Expected, s.Optimistic)
	}
	if res.SafeToSpend != s.Conservative {
		t.Fatalf("primary STS should equal conservative")
	}
}

func TestComputeCashflowInsufficientData(t *testing.T) {
	res := ComputeCashflow(CashflowInputs{CashAvailable: 100})
	if res.DataQuality.IsSufficient {
		t.Fatal("expected insufficient")
	}
	if res.DataQuality.Confidence != "low" {
		t.Fatalf("confidence want low got %s", res.DataQuality.Confidence)
	}
	if len(res.DataQuality.MissingFields) == 0 {
		t.Fatal("expected missing fields")
	}
}

func TestComputeCashflowProjectedEndCurrentMonth(t *testing.T) {
	in := CashflowInputs{
		CashAvailable:             10_000_000,
		EstimatedVariableExpenses: 3_000_000, // 100k/day
		MinDebtPayments:           1_000_000,
		IsCurrentMonth:            true,
		DaysRemaining:             10,
		MonthlyLivingCost:         3_000_000,
		EstimatedIncome:           10_000_000,
		IncomeMTD:                 10_000_000,
	}
	res := ComputeCashflow(in)
	// 10M - (100k*10) - 1M = 8M
	want := 8_000_000.0
	if math.Abs(res.ProjectedEndBalance-want) > 1 {
		t.Fatalf("projected end want %f got %f", want, res.ProjectedEndBalance)
	}
}

// Property-style: safe_to_spend never exceeds cash when no future income remaining.
func TestComputeCashflowSTSNeverExceedsCashWithoutFutureIncome(t *testing.T) {
	cases := []CashflowInputs{
		{CashAvailable: 1e6, IncomeMTD: 5e6, EstimatedIncome: 5e6, MinDebtPayments: 0, EstimatedVariableExpenses: 0, MonthlyLivingCost: 0, IsCurrentMonth: true, DaysRemaining: 5},
		{CashAvailable: 500_000, IncomeMTD: 0, EstimatedIncome: 0, MinDebtPayments: 100_000, EstimatedVariableExpenses: 300_000, MonthlyLivingCost: 300_000, IsCurrentMonth: true, DaysRemaining: 15},
		{CashAvailable: 0, EstimatedIncome: 0, EstimatedFixedExpenses: 1e6, EstimatedVariableExpenses: 1e6, MonthlyLivingCost: 1e6, IsCurrentMonth: false, DaysRemaining: 30},
	}
	for i, in := range cases {
		res := ComputeCashflow(in)
		if res.SafeToSpend < 0 {
			t.Fatalf("case %d: negative STS %f", i, res.SafeToSpend)
		}
		// Without remaining income and with living buffer, STS should not invent cash.
		if in.IsCurrentMonth && in.EstimatedIncome <= in.IncomeMTD {
			if res.SafeToSpend > in.CashAvailable+0.01 {
				t.Fatalf("case %d: STS %f exceeds cash %f without future income", i, res.SafeToSpend, in.CashAvailable)
			}
		}
	}
}
