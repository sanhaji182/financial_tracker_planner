package kernel

import (
	"math"
	"testing"
)

func TestBuildCashLadderFutureMonthFullProjection(t *testing.T) {
	// Full month: start 10M, +20M income day 25, -2M bill day 10, -1M debt day 5, 100k/day variable.
	in := LadderInputs{
		AsOfDay:              1,
		DaysInMonth:          30,
		IsCurrentMonth:       false,
		StartingCash:         10_000_000,
		DailyVariableExpense: 100_000,
		LivingCostThreshold:  5_000_000,
		Events: []LadderEvent{
			{Day: 5, Name: "Cicilan KPR", Amount: -1_000_000, Kind: "debt"},
			{Day: 10, Name: "Listrik", Amount: -2_000_000, Kind: "bill"},
			{Day: 25, Name: "Gaji Masuk (Est.)", Amount: 20_000_000, Kind: "income"},
		},
	}
	res := BuildCashLadder(in)
	if res.FormulaVersion != ForecastLadderVersion {
		t.Fatalf("version %s", res.FormulaVersion)
	}
	if len(res.Days) != 30 {
		t.Fatalf("days want 30 got %d", len(res.Days))
	}
	// End = 10M - 1M - 2M + 20M - 100k*30 = 24M
	wantEnd := 24_000_000.0
	if math.Abs(res.ProjectedEndBalance-wantEnd) > 1 {
		t.Fatalf("end want %f got %f", wantEnd, res.ProjectedEndBalance)
	}
	if math.Abs(res.RemainingIncome-20_000_000) > 1 {
		t.Fatalf("remaining income %f", res.RemainingIncome)
	}
	if math.Abs(res.RemainingFixed-3_000_000) > 1 {
		t.Fatalf("remaining fixed %f", res.RemainingFixed)
	}
	if res.ExcludedDaysBefore != 0 {
		t.Fatalf("future month should not exclude days, got %d", res.ExcludedDaysBefore)
	}
}

func TestBuildCashLadderCurrentMonthSkipsPastEvents(t *testing.T) {
	// As-of day 15: bill day 5 and income day 10 must NOT re-apply (caller already omitted them).
	// Only future bill day 20 and remaining variable days 15..30 apply.
	in := LadderInputs{
		AsOfDay:              15,
		DaysInMonth:          30,
		IsCurrentMonth:       true,
		StartingCash:         12_000_000, // already includes past income/expense
		DailyVariableExpense: 100_000,
		LivingCostThreshold:  3_000_000,
		Events: []LadderEvent{
			// Past events intentionally omitted by service — only remaining:
			{Day: 20, Name: "Internet", Amount: -500_000, Kind: "bill"},
			{Day: 25, Name: "Cicilan CC", Amount: -1_000_000, Kind: "debt"},
		},
	}
	res := BuildCashLadder(in)
	// Days 1-14 stub at opening cash
	if res.ExcludedDaysBefore != 14 {
		t.Fatalf("excluded before want 14 got %d", res.ExcludedDaysBefore)
	}
	for i := 0; i < 14; i++ {
		if res.Days[i].Included {
			t.Fatalf("day %d should be stub", i+1)
		}
		if math.Abs(res.Days[i].ProjectedBalance-12_000_000) > 0.01 {
			t.Fatalf("stub day %d balance %f", i+1, res.Days[i].ProjectedBalance)
		}
	}
	// Projected days = 16 (15..30). Variable = 100k * 16 = 1.6M
	// End = 12M - 0.5M - 1M - 1.6M = 8.9M
	wantEnd := 8_900_000.0
	if math.Abs(res.ProjectedEndBalance-wantEnd) > 1 {
		t.Fatalf("end want %f got %f", wantEnd, res.ProjectedEndBalance)
	}
	if math.Abs(res.RemainingFixed-1_500_000) > 1 {
		t.Fatalf("remaining fixed want 1.5M got %f", res.RemainingFixed)
	}
	if res.RemainingIncome != 0 {
		t.Fatalf("no income event expected, got %f", res.RemainingIncome)
	}
	// Lowest should be on or after day 15, never re-count past
	if res.LowestBalanceDay < 15 {
		t.Fatalf("lowest day %d before as-of", res.LowestBalanceDay)
	}
}

func TestBuildCashLadderDoesNotDoubleCountIncomeWhenOmitted(t *testing.T) {
	// Income already in cash; service omits income event. End must not add +estimate.
	in := LadderInputs{
		AsOfDay:              20,
		DaysInMonth:          31,
		IsCurrentMonth:       true,
		StartingCash:         15_000_000,
		DailyVariableExpense: 200_000, // 200k * 12 days (20..31) = 2.4M
		Events: []LadderEvent{
			{Day: 28, Name: "Listrik", Amount: -800_000, Kind: "bill"},
		},
	}
	res := BuildCashLadder(in)
	wantEnd := 15_000_000.0 - 800_000 - 2_400_000 // 11.8M
	if math.Abs(res.ProjectedEndBalance-wantEnd) > 1 {
		t.Fatalf("end want %f got %f", wantEnd, res.ProjectedEndBalance)
	}
	if res.RemainingIncome != 0 {
		t.Fatalf("income must not be re-added, got %f", res.RemainingIncome)
	}
}

func TestBuildCashLadderRemainingIncomeOnFuturePayDay(t *testing.T) {
	// Partial income received; remaining applied on future payday.
	in := LadderInputs{
		AsOfDay:              10,
		DaysInMonth:          30,
		IsCurrentMonth:       true,
		StartingCash:         5_000_000,
		DailyVariableExpense: 0,
		Events: []LadderEvent{
			{Day: 25, Name: "Gaji Sisa (Est.)", Amount: 8_000_000, Kind: "income"},
			{Day: 15, Name: "Cicilan", Amount: -2_000_000, Kind: "debt"},
		},
	}
	res := BuildCashLadder(in)
	// 5M - 2M + 8M = 11M
	if math.Abs(res.ProjectedEndBalance-11_000_000) > 1 {
		t.Fatalf("end want 11M got %f", res.ProjectedEndBalance)
	}
	if math.Abs(res.RemainingIncome-8_000_000) > 1 {
		t.Fatalf("remaining income %f", res.RemainingIncome)
	}
}

func TestBuildCashLadderPastPayDayAppliesRemainingOnAsOf(t *testing.T) {
	// Payday already passed but remaining income still expected (late/partial).
	// Service places remaining on AsOfDay.
	in := LadderInputs{
		AsOfDay:              20,
		DaysInMonth:          30,
		IsCurrentMonth:       true,
		StartingCash:         3_000_000,
		DailyVariableExpense: 0,
		Events: []LadderEvent{
			{Day: 20, Name: "Gaji Sisa (Est.)", Amount: 4_000_000, Kind: "income"},
		},
	}
	res := BuildCashLadder(in)
	if math.Abs(res.ProjectedEndBalance-7_000_000) > 1 {
		t.Fatalf("end want 7M got %f", res.ProjectedEndBalance)
	}
	if res.Days[19].EventName == "" {
		t.Fatal("as-of day should carry remaining income event")
	}
}

func TestBuildCashLadderIsTightWhenBelowLiving(t *testing.T) {
	in := LadderInputs{
		AsOfDay:              1,
		DaysInMonth:          5,
		IsCurrentMonth:       false,
		StartingCash:         2_000_000,
		DailyVariableExpense: 600_000,
		LivingCostThreshold:  1_500_000,
	}
	res := BuildCashLadder(in)
	if !res.IsTight {
		t.Fatal("expected tight cash")
	}
	// Day5 end = 2M - 3M = -1M
	if res.ProjectedEndBalance >= 0 {
		t.Fatalf("expected negative end, got %f", res.ProjectedEndBalance)
	}
}
