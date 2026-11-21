package kernel

import (
	"math"
	"testing"
	"time"
)

func TestBuildScenarioLaddersOrdering(t *testing.T) {
	base := LadderInputs{
		AsOfDay:              1,
		DaysInMonth:          30,
		IsCurrentMonth:       false,
		StartingCash:         10_000_000,
		DailyVariableExpense: 100_000,
		LivingCostThreshold:  3_000_000,
		Events: []LadderEvent{
			{Day: 10, Name: "Bill", Amount: -1_000_000, Kind: "bill"},
			{Day: 25, Name: "Gaji", Amount: 8_000_000, Kind: "income"},
		},
	}
	set := BuildScenarioLadders(base)
	if set.FormulaVersion != ForecastScenarioVersion {
		t.Fatalf("version %s", set.FormulaVersion)
	}
	// More variable spend → lower end
	if set.EndConservative > set.EndExpected+0.01 {
		t.Fatalf("C %f > E %f", set.EndConservative, set.EndExpected)
	}
	if set.EndExpected > set.EndOptimistic+0.01 {
		t.Fatalf("E %f > O %f", set.EndExpected, set.EndOptimistic)
	}
	// Expected end matches single ladder at mult 1.0
	expOnly := BuildCashLadder(base)
	if math.Abs(set.EndExpected-expOnly.ProjectedEndBalance) > 1 {
		t.Fatalf("expected end %f vs ladder %f", set.EndExpected, expOnly.ProjectedEndBalance)
	}
	// Day bands length
	if len(set.DayBands) != 30 {
		t.Fatalf("bands %d", len(set.DayBands))
	}
	for _, b := range set.DayBands {
		if b.Conservative > b.Expected+0.01 || b.Expected > b.Optimistic+0.01 {
			t.Fatalf("day %d band order C=%f E=%f O=%f", b.Day, b.Conservative, b.Expected, b.Optimistic)
		}
	}
}

func TestBuildScenarioLaddersCurrentMonthAsOf(t *testing.T) {
	base := LadderInputs{
		AsOfDay:              15,
		DaysInMonth:          30,
		IsCurrentMonth:       true,
		StartingCash:         5_000_000,
		DailyVariableExpense: 50_000,
		Events: []LadderEvent{
			{Day: 20, Name: "Cicilan", Amount: -500_000, Kind: "debt"},
		},
	}
	set := BuildScenarioLadders(base)
	if set.Expected.ExcludedDaysBefore != 14 {
		t.Fatalf("excluded %d", set.Expected.ExcludedDaysBefore)
	}
	// Conservative spends more remaining days → lower or equal end
	if set.EndConservative > set.EndOptimistic+0.01 {
		t.Fatalf("cons %f > opt %f", set.EndConservative, set.EndOptimistic)
	}
}

func TestEvaluateBacktestMAE_WAPE_Bias(t *testing.T) {
	// projected 10, actual 8 → err +2
	// projected 5, actual 7 → err -2
	// MAE = 2, bias = 0, WAPE = 4/15
	pts := []BacktestPoint{
		{Month: "2026-01", ProjectedEnd: 10_000_000, ActualEnd: 8_000_000},
		{Month: "2026-02", ProjectedEnd: 5_000_000, ActualEnd: 7_000_000},
	}
	res := EvaluateBacktest(pts, time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC))
	if res.PointsUsed != 2 {
		t.Fatalf("used %d", res.PointsUsed)
	}
	if math.Abs(res.Overall.MAE-2_000_000) > 1 {
		t.Fatalf("MAE %f", res.Overall.MAE)
	}
	if math.Abs(res.Overall.Bias) > 1 {
		t.Fatalf("bias want ~0 got %f", res.Overall.Bias)
	}
	wantWAPE := 4_000_000.0 / 15_000_000.0
	if math.Abs(res.Overall.WAPE-wantWAPE) > 1e-6 {
		t.Fatalf("WAPE want %f got %f", wantWAPE, res.Overall.WAPE)
	}
}

func TestEvaluateBacktestBandCoverage(t *testing.T) {
	pts := []BacktestPoint{
		{Month: "2026-01", ProjectedEnd: 10, ActualEnd: 9, BandLow: 8, BandHigh: 12, HasBand: true},
		{Month: "2026-02", ProjectedEnd: 10, ActualEnd: 15, BandLow: 8, BandHigh: 12, HasBand: true},
	}
	res := EvaluateBacktest(pts, time.Time{})
	if res.Overall.BandSamples != 2 {
		t.Fatalf("band samples %d", res.Overall.BandSamples)
	}
	if math.Abs(res.Overall.BandCoverage-0.5) > 1e-9 {
		t.Fatalf("coverage %f", res.Overall.BandCoverage)
	}
}

func TestEvaluateBacktestSkipsEmptyMonth(t *testing.T) {
	pts := []BacktestPoint{
		{Month: "", ProjectedEnd: 1, ActualEnd: 1},
		{Month: "2026-03", ProjectedEnd: 100, ActualEnd: 100},
	}
	res := EvaluateBacktest(pts, time.Time{})
	if res.PointsUsed != 1 || res.PointsSkipped != 1 {
		t.Fatalf("used=%d skipped=%d", res.PointsUsed, res.PointsSkipped)
	}
}

func TestEvaluateBacktestHorizonBuckets(t *testing.T) {
	pts := []BacktestPoint{
		{Month: "2026-01", HorizonDays: 7, ProjectedEnd: 10, ActualEnd: 10},
		{Month: "2026-01", HorizonDays: 30, ProjectedEnd: 20, ActualEnd: 18},
		{Month: "2026-02", HorizonDays: 7, ProjectedEnd: 10, ActualEnd: 12},
	}
	res := EvaluateBacktest(pts, time.Time{})
	if len(res.ByHorizon) < 2 {
		t.Fatalf("horizons %+v", res.ByHorizon)
	}
	var h7, h30 *HorizonBacktest
	for i := range res.ByHorizon {
		if res.ByHorizon[i].HorizonDays == 7 {
			h7 = &res.ByHorizon[i]
		}
		if res.ByHorizon[i].HorizonDays == 30 {
			h30 = &res.ByHorizon[i]
		}
	}
	if h7 == nil || h7.SampleSize != 2 {
		t.Fatalf("h7 %+v", h7)
	}
	if h30 == nil || h30.SampleSize != 1 {
		t.Fatalf("h30 %+v", h30)
	}
}

func TestEvaluateBacktestWAPESafeNearZeroActual(t *testing.T) {
	// MAPE would explode; WAPE uses sum|actual|
	pts := []BacktestPoint{
		{Month: "2026-01", ProjectedEnd: 100, ActualEnd: 0},
		{Month: "2026-02", ProjectedEnd: 50, ActualEnd: 0},
	}
	res := EvaluateBacktest(pts, time.Time{})
	if res.Overall.WAPE != 0 {
		// sum|actual|=0 → WAPE 0 by definition (undefined → 0)
		t.Fatalf("WAPE %f", res.Overall.WAPE)
	}
	if res.Overall.MAE != 75 {
		t.Fatalf("MAE %f", res.Overall.MAE)
	}
}
