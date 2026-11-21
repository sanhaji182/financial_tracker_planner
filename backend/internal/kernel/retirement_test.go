package kernel

import (
	"math"
	"testing"
	"time"
)

func TestComputeRetirementEducationBasic(t *testing.T) {
	asOf := time.Date(2026, 7, 16, 0, 0, 0, 0, time.UTC)
	res := ComputeRetirementEducation(RetirementInputs{
		AsOf:            asOf,
		CurrentAge:      35,
		RetirementAge:   60,
		CurrentSavings:  200_000_000,
		MonthlyContrib:  2_000_000,
		MonthlyExpenses: 15_000_000,
	})

	if res.FormulaVersion != RetirementFormulaVersion {
		t.Fatalf("version = %s", res.FormulaVersion)
	}
	if res.IsGuaranteedReturn {
		t.Fatal("must never claim guaranteed return")
	}
	if res.IsProductAdvice {
		t.Fatal("must never be product advice")
	}
	if res.YearsToRetire != 25 {
		t.Fatalf("years_to_retire = %d", res.YearsToRetire)
	}
	if res.ProjectedCorpus <= res.CurrentSavings {
		t.Fatalf("projected corpus should grow with contrib: got %v", res.ProjectedCorpus)
	}
	if len(res.Scenarios) != 3 {
		t.Fatalf("want 3 longevity scenarios, got %d", len(res.Scenarios))
	}
	// Longevity high needs more corpus than low
	if res.Scenarios[2].CorpusNeeded < res.Scenarios[0].CorpusNeeded {
		t.Fatalf("high longevity corpus %v < low %v", res.Scenarios[2].CorpusNeeded, res.Scenarios[0].CorpusNeeded)
	}
	if res.TargetMonthlyAtRetire <= res.MonthlyExpenses*res.IncomeReplaceRatio {
		t.Fatalf("target at retire should be inflated: %v", res.TargetMonthlyAtRetire)
	}
	if res.Disclaimer == "" || len(res.Assumptions) == 0 {
		t.Fatal("missing disclaimer/assumptions")
	}
	if !res.IsSufficient {
		t.Fatalf("expected sufficient inputs, missing=%v", res.MissingFields)
	}
}

func TestComputeRetirementEducationMissingData(t *testing.T) {
	res := ComputeRetirementEducation(RetirementInputs{})
	if res.IsSufficient {
		t.Fatal("empty inputs should be insufficient")
	}
	if res.DataConfidence == "high" {
		t.Fatalf("confidence should not be high: %s", res.DataConfidence)
	}
	if len(res.MissingFields) == 0 {
		t.Fatal("expected missing fields")
	}
	if res.IsGuaranteedReturn || res.IsProductAdvice {
		t.Fatal("flags must stay false")
	}
}

func TestComputeRetirementEducationNoGuaranteeLanguage(t *testing.T) {
	res := ComputeRetirementEducation(RetirementInputs{
		CurrentAge: 40, RetirementAge: 55,
		CurrentSavings: 500_000_000, MonthlyContrib: 5_000_000, MonthlyExpenses: 10_000_000,
	})
	for _, a := range res.Assumptions {
		if containsAny(a, []string{"dijamin", "guaranteed return", "pasti untung"}) {
			t.Fatalf("assumption must not guarantee: %s", a)
		}
	}
	// Contribution gap finite
	if math.IsNaN(res.ContributionGap) || math.IsInf(res.ContributionGap, 0) {
		t.Fatal("contribution gap invalid")
	}
}

func TestFutureValueAndPMTRoundTrip(t *testing.T) {
	// Saving 0, pay PMT for 10y at 6% should roughly equal FV used to derive PMT
	fv := 100_000_000.0
	pmt := pmtForFutureValue(fv, 0.06, 10)
	got := futureValueMonthly(0, pmt, 0.06, 10)
	// within 1%
	if math.Abs(got-fv)/fv > 0.01 {
		t.Fatalf("PMT round-trip: want ~%v got %v (pmt=%v)", fv, got, pmt)
	}
}

func containsAny(s string, needles []string) bool {
	for _, n := range needles {
		if len(n) > 0 && (len(s) >= len(n)) {
			for i := 0; i+len(n) <= len(s); i++ {
				if s[i:i+len(n)] == n {
					return true
				}
			}
		}
	}
	return false
}
