package kernel

import (
	"testing"
	"time"
)

func TestSafetyEvalSuitePasses(t *testing.T) {
	res := RunSafetyEvalSuite(nil, time.Date(2026, 7, 16, 0, 0, 0, 0, time.UTC))
	if res.FormulaVersion != ModelGovVersion {
		t.Fatalf("version %s", res.FormulaVersion)
	}
	if res.Total < 5 {
		t.Fatalf("suite too small: %d", res.Total)
	}
	if res.Failed != 0 {
		t.Fatalf("suite failures: %v hits=%v", res.FailIDs, res.PolicyHits)
	}
	if res.Passed != res.Total {
		t.Fatalf("passed %d total %d", res.Passed, res.Total)
	}
}

func TestEvaluateModelOutputBlocksGuarantees(t *testing.T) {
	blocked, hits := EvaluateModelOutput("Investasi ini guaranteed return 20%")
	if !blocked {
		t.Fatal("expected block")
	}
	if len(hits) == 0 {
		t.Fatal("expected hits")
	}
}

func TestEvaluateModelOutputAllowsEducation(t *testing.T) {
	blocked, _ := EvaluateModelOutput("Coverage EF 3 bulan adalah estimasi edukatif berdasarkan biaya hidup.")
	if blocked {
		t.Fatal("education should pass")
	}
}

func TestDeterministicFallback(t *testing.T) {
	fb := DeterministicFallback("advisor", "timeout")
	if fb["fallback_used"] != true {
		t.Fatal("fallback flag")
	}
	if fb["is_product_advice"] != false || fb["is_guaranteed_return"] != false {
		t.Fatal("must not be product/guarantee")
	}
}

func TestComputeModelGovPolicy(t *testing.T) {
	p := ComputeModelGovPolicy(time.Time{})
	if len(p.PromptVersions) == 0 || len(p.FallbackOrder) < 3 {
		t.Fatalf("policy incomplete: %+v", p)
	}
}

func TestNewPromptAudit(t *testing.T) {
	a := NewPromptAudit("advisor", "advisor-system-v1", "openai", "gpt-x", true, true, false, "", time.Time{})
	if a.PromptVersion != "advisor-system-v1" || !a.ConsentOK || !a.RedactionApplied {
		t.Fatalf("%+v", a)
	}
}
