package kernel

import (
	"testing"
	"time"
)

func TestComputeProtection_NeedsBasedGap(t *testing.T) {
	res := ComputeProtectionAssessment(ProtectionInputs{
		AsOf:               time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC),
		MonthlyIncome:      20_000_000,
		MonthlyExpenses:    10_000_000,
		EFBalance:          15_000_000,
		EFCoverageMonths:   1.5,
		EFTargetMonths:     6,
		OutstandingDebts:   50_000_000,
		DependentsCount:    2,
		IncomeEarnersCount: 1,
		HasHealthInsurance: false,
		HasLifeInsurance:   false,
		ExistingLifeCover:  0,
		MinMonthlyIncome:   18_000_000,
		MaxMonthlyIncome:   22_000_000,
	})

	if res.FormulaVersion != ProtectionFormulaVersion {
		t.Fatalf("version %s", res.FormulaVersion)
	}
	if res.IsProductAdvice {
		t.Fatal("must never be product advice")
	}
	if res.Disclaimer == "" || len(res.Methodology) == 0 {
		t.Fatal("methodology/disclaimer required")
	}
	// Income replacement 10x * 20M*12 = 2.4B
	if res.IncomeReplacement < 2_000_000_000 {
		t.Fatalf("income replacement %v", res.IncomeReplacement)
	}
	if res.DebtClearance != 50_000_000 {
		t.Fatalf("debt %v", res.DebtClearance)
	}
	if res.DependentEducation != 100_000_000 { // 2 * 50M
		t.Fatalf("edu %v", res.DependentEducation)
	}
	if res.LifeCoverNeed <= 0 || res.LifeCoverGap <= 0 {
		t.Fatalf("need/gap %v %v", res.LifeCoverNeed, res.LifeCoverGap)
	}
	// Gap should be reduced by EF liquid offset
	if res.LiquidOffset != 15_000_000 {
		t.Fatalf("liquid %v", res.LiquidOffset)
	}
	if res.LifeCoverGap != res.LifeCoverNeed-res.ExistingLifeCover-res.LiquidOffset {
		t.Fatalf("gap identity failed: need=%v existing=%v liquid=%v gap=%v",
			res.LifeCoverNeed, res.ExistingLifeCover, res.LiquidOffset, res.LifeCoverGap)
	}
	// High severity health + life gaps expected
	cats := map[string]bool{}
	for _, g := range res.Gaps {
		cats[g.Category] = true
	}
	if !cats["health_insurance"] || !cats["life_insurance"] {
		t.Fatalf("gaps %+v", res.Gaps)
	}
	if res.DataConfidence != "high" {
		t.Fatalf("confidence %s", res.DataConfidence)
	}
}

func TestComputeProtection_NoFalseStrongWithoutIncome(t *testing.T) {
	res := ComputeProtectionAssessment(ProtectionInputs{
		AsOf:               time.Now(),
		MonthlyIncome:      0,
		MonthlyExpenses:    5_000_000,
		HasHealthInsurance: true,
		HasLifeInsurance:   true,
		ExistingLifeCover:  1_000_000_000,
		EFBalance:          100_000_000,
		EFCoverageMonths:   12,
		EFTargetMonths:     6,
		IncomeEarnersCount: 2,
	})
	if res.IsSufficient {
		t.Fatal("insufficient without income")
	}
	if res.DataConfidence != "low" {
		t.Fatalf("conf %s", res.DataConfidence)
	}
	if res.ScoreLabel != "Insufficient" {
		t.Fatalf("label %s", res.ScoreLabel)
	}
	// Score capped
	if res.ProtectionScore > 40 {
		t.Fatalf("score should be capped when income missing, got %d", res.ProtectionScore)
	}
	found := false
	for _, m := range res.MissingFields {
		if m == "income" {
			found = true
		}
	}
	if !found {
		t.Fatalf("missing %v", res.MissingFields)
	}
}

func TestComputeProtection_ExistingCoverReducesGap(t *testing.T) {
	base := ProtectionInputs{
		AsOf:               time.Now(),
		MonthlyIncome:      15_000_000,
		MonthlyExpenses:    8_000_000,
		DependentsCount:    1,
		IncomeEarnersCount: 2,
		HasHealthInsurance: true,
		HasLifeInsurance:   true,
		OutstandingDebts:   0,
		EFBalance:          0,
	}
	none := ComputeProtectionAssessment(base)
	base.ExistingLifeCover = none.LifeCoverNeed // full cover
	full := ComputeProtectionAssessment(base)
	if full.LifeCoverGap != 0 {
		t.Fatalf("expected zero gap, got %v (need %v existing %v)", full.LifeCoverGap, full.LifeCoverNeed, full.ExistingLifeCover)
	}
	if full.ProtectionScore <= none.ProtectionScore {
		// with health already true and full cover, score should be >= partial
		// none has HasLifeInsurance true but Existing=0 so partial life points
		if full.ProtectionScore < none.ProtectionScore {
			t.Fatalf("full cover score %d < none %d", full.ProtectionScore, none.ProtectionScore)
		}
	}
}
