package kernel

import (
	"testing"
	"time"
)

func TestComputeGoalPlan_ContentionAndPriority(t *testing.T) {
	asOf := time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)
	d1 := asOf.AddDate(0, 6, 0)
	d2 := asOf.AddDate(0, 6, 0)
	d3 := asOf.AddDate(0, 12, 0)

	res := ComputeGoalPlan(GoalPlanInputs{
		AsOf:           asOf,
		MonthlySurplus: 5_000_000,
		ReservedForEF:  1_000_000,
		ReservedForDebt: 1_000_000,
		Goals: []GoalPlanItem{
			{ID: "g1", Name: "Liburan", Type: "sinking_fund", TargetAmount: 12_000_000, CurrentAmount: 0, TargetDate: &d1},
			{ID: "g2", Name: "Gadget", Type: "sinking_fund", TargetAmount: 12_000_000, CurrentAmount: 0, TargetDate: &d2},
			{ID: "g3", Name: "Custom", Type: "custom", TargetAmount: 6_000_000, CurrentAmount: 0, TargetDate: &d3},
		},
	})

	if res.FormulaVersion != GoalsPlanVersion {
		t.Fatalf("version %s", res.FormulaVersion)
	}
	// Available = 5M - 1M - 1M = 3M
	if res.AvailableForGoals != 3_000_000 {
		t.Fatalf("available %v", res.AvailableForGoals)
	}
	// Each sinking needs 12M/6 ≈ 2M/mo → total 4M > 3M → contention
	if res.TotalMonthlyRequired < 3_900_000 {
		t.Fatalf("expected high required, got %v", res.TotalMonthlyRequired)
	}
	if len(res.Conflicts) == 0 {
		t.Fatal("expected surplus_contention conflict")
	}
	found := false
	for _, c := range res.Conflicts {
		if c.Kind == "surplus_contention" {
			found = true
		}
	}
	if !found {
		t.Fatalf("conflicts: %+v", res.Conflicts)
	}
	// Priority 3 sinking funds get funded before priority 5 custom
	var sinkAlloc, customAlloc float64
	for _, it := range res.Items {
		switch it.ID {
		case "g1", "g2":
			sinkAlloc += it.AllocatedMonthly
		case "g3":
			customAlloc = it.AllocatedMonthly
		}
	}
	if sinkAlloc <= 0 {
		t.Fatal("sinking funds should receive allocation")
	}
	if customAlloc > sinkAlloc {
		t.Fatalf("custom should not outrank sinking: custom=%v sink=%v", customAlloc, sinkAlloc)
	}
	// Total allocated ≤ available
	if res.TotalAllocated > res.AvailableForGoals+1 {
		t.Fatalf("over-allocated %v > %v", res.TotalAllocated, res.AvailableForGoals)
	}
}

func TestComputeGoalPlan_AchievedAndNoDeadline(t *testing.T) {
	asOf := time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)
	res := ComputeGoalPlan(GoalPlanInputs{
		AsOf:           asOf,
		MonthlySurplus: 2_000_000,
		Goals: []GoalPlanItem{
			{ID: "done", Name: "Done", Type: "sinking_fund", TargetAmount: 1_000_000, CurrentAmount: 1_000_000},
			{ID: "open", Name: "Open", Type: "custom", TargetAmount: 5_000_000, CurrentAmount: 0},
		},
	})
	var done, open *GoalPlanItemResult
	for i := range res.Items {
		if res.Items[i].ID == "done" {
			done = &res.Items[i]
		}
		if res.Items[i].ID == "open" {
			open = &res.Items[i]
		}
	}
	if done == nil || done.FeasibilityStatus != GoalStatusAchieved {
		t.Fatalf("done: %+v", done)
	}
	if open == nil || open.FeasibilityStatus != GoalStatusNoDeadline {
		t.Fatalf("open: %+v", open)
	}
	// Open-ended not in hard required total
	if res.TotalMonthlyRequired != 0 {
		t.Fatalf("required should ignore no-deadline, got %v", res.TotalMonthlyRequired)
	}
}

func TestComputeGoalPlan_OnTrackWhenSurplusEnough(t *testing.T) {
	asOf := time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)
	d := asOf.AddDate(0, 10, 0)
	res := ComputeGoalPlan(GoalPlanInputs{
		AsOf:           asOf,
		MonthlySurplus: 5_000_000,
		Goals: []GoalPlanItem{
			{ID: "g", Name: "Laptop", Type: "sinking_fund", TargetAmount: 10_000_000, CurrentAmount: 0, TargetDate: &d},
		},
	})
	if res.UnfundedGap != 0 {
		t.Fatalf("gap %v", res.UnfundedGap)
	}
	if len(res.Items) != 1 || res.Items[0].FeasibilityStatus != GoalStatusOnTrack {
		t.Fatalf("items %+v", res.Items)
	}
	if res.Items[0].DelayMonths != 0 {
		t.Fatalf("delay %v", res.Items[0].DelayMonths)
	}
}

func TestGoalTypePriority(t *testing.T) {
	if GoalTypePriority("emergency_fund") != 1 || GoalTypePriority("debt_payoff") != 2 ||
		GoalTypePriority("sinking_fund") != 3 || GoalTypePriority("custom") != 5 {
		t.Fatal("priority map mismatch")
	}
}
