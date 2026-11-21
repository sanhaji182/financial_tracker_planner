package kernel

import (
	"testing"
	"time"
)

func TestComputeScenarioCompare_ExtraDebtPayment(t *testing.T) {
	res := ComputeScenarioCompare(ScenarioCompareInputs{
		AsOf:                   time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC),
		StartingCash:           20_000_000,
		AvgMonthlyIncome:       15_000_000,
		AvgMonthlyExpense:      10_000_000,
		OutstandingDebts:       50_000_000,
		BlendedDebtAPR:         0.24,
		ActiveGoalsMonthlyNeed: 2_000_000,
		HorizonMonths:          12,
		Changes: []ScenarioChangeInput{
			{Type: ScenarioExtraDebtPayment, MonthlyExtraAmount: 3_000_000},
		},
	})

	if res.FormulaVersion != ScenarioCompareVersion {
		t.Fatalf("version %s", res.FormulaVersion)
	}
	if res.HorizonMonths != 12 {
		t.Fatalf("horizon %d", res.HorizonMonths)
	}
	// Debts down by extra payment
	if res.TotalDebts.Scenario != 47_000_000 {
		t.Fatalf("debts scenario %v", res.TotalDebts.Scenario)
	}
	if res.TotalDebts.Severity != "positive" {
		t.Fatalf("less debt should be positive, got %s", res.TotalDebts.Severity)
	}
	// Ending balance lower (cash used to pay debt)
	if res.EndingBalance.Impact >= 0 {
		t.Fatalf("ending impact should be negative, got %v", res.EndingBalance.Impact)
	}
	// Interest estimate should decrease or stay ≤ base
	if res.DebtInterest.Scenario > res.DebtInterest.Base+1 {
		t.Fatalf("interest should not rise: base=%v scen=%v", res.DebtInterest.Base, res.DebtInterest.Scenario)
	}
	// Downside runway present
	if res.DownsideRunway.Base <= 0 {
		t.Fatalf("downside base %v", res.DownsideRunway.Base)
	}
	if len(res.Assumptions) == 0 {
		t.Fatal("assumptions required")
	}
}

func TestComputeScenarioCompare_IncomeCutWorsensGoals(t *testing.T) {
	res := ComputeScenarioCompare(ScenarioCompareInputs{
		AsOf:                   time.Now(),
		StartingCash:           10_000_000,
		AvgMonthlyIncome:       20_000_000,
		AvgMonthlyExpense:      12_000_000,
		OutstandingDebts:       0,
		ActiveGoalsMonthlyNeed: 5_000_000,
		HorizonMonths:          12,
		Changes: []ScenarioChangeInput{
			{Type: ScenarioIncomeChange, Percentage: -30},
		},
	})
	// Base surplus 8M covers 5M need → gap 0; scenario income 14M surplus 2M → gap 3M
	if res.GoalFundingGap.Scenario <= res.GoalFundingGap.Base {
		t.Fatalf("goal gap should worsen: base=%v scen=%v", res.GoalFundingGap.Base, res.GoalFundingGap.Scenario)
	}
	if res.GoalFundingGap.Severity != "negative" {
		t.Fatalf("severity %s", res.GoalFundingGap.Severity)
	}
	if res.GoalDelayMonths.Scenario < res.GoalDelayMonths.Base {
		t.Fatalf("delay should not improve on income cut")
	}
}

func TestComputeScenarioCompare_RemoveExpenseImprovesRunway(t *testing.T) {
	res := ComputeScenarioCompare(ScenarioCompareInputs{
		AsOf:              time.Now(),
		StartingCash:      6_000_000,
		AvgMonthlyIncome:  10_000_000,
		AvgMonthlyExpense: 9_000_000,
		Changes: []ScenarioChangeInput{
			{Type: ScenarioRemoveExpense, MonthlyAmount: 2_000_000},
		},
	})
	// Cash pool unchanged for remove_expense (only monthly expense), runway uses cash/expense
	// scenario expense 7M → runway 6/7 > base 6/9
	if res.CashRunway.Scenario <= res.CashRunway.Base {
		t.Fatalf("runway base=%v scen=%v", res.CashRunway.Base, res.CashRunway.Scenario)
	}
	if res.CashRunway.Severity != "positive" {
		t.Fatalf("severity %s", res.CashRunway.Severity)
	}
	if res.EndingBalance.Impact <= 0 {
		t.Fatalf("ending should improve, impact %v", res.EndingBalance.Impact)
	}
}

func TestComputeScenarioCompare_OrderingNeutralZero(t *testing.T) {
	res := ComputeScenarioCompare(ScenarioCompareInputs{
		AsOf:              time.Now(),
		StartingCash:      5_000_000,
		AvgMonthlyIncome:  5_000_000,
		AvgMonthlyExpense: 4_000_000,
		OutstandingDebts:  1_000_000,
		BlendedDebtAPR:    0.12,
		Changes:           nil,
	})
	if res.EndingBalance.Severity != "neutral" || res.TotalDebts.Impact != 0 {
		t.Fatalf("no-change should be neutral: %+v %+v", res.EndingBalance, res.TotalDebts)
	}
}
