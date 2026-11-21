package kernel

import (
	"testing"
	"time"
)

func baseOKInputs() DataQualityInputs {
	return DataQualityInputs{
		AsOf:                   time.Date(2026, 7, 16, 0, 0, 0, 0, time.UTC),
		HasActiveLiquidAccount: true,
		AccountCount:           2,
		Accounts: []AccountQualityInput{
			{ID: "a1", Name: "BCA", Type: "bank", IsActive: true, Currency: "IDR", DaysSinceLastTx: 2, HasRecentReconcile: true, Balance: 5_000_000},
			{ID: "a2", Name: "Cash", Type: "cash", IsActive: true, Currency: "IDR", DaysSinceLastTx: 5, HasRecentReconcile: true, Balance: 500_000},
		},
		HasIncomeHistory:     true,
		HasExpenseHistory:    true,
		IncomeMonthsCovered:  3,
		ExpenseMonthsCovered: 3,
		TxCount90d:           100,
		ReconciledCount90d:   90,
		UnreconciledCount90d: 10,
		UncategorizedCount90d: 5,
	}
}

func TestComputeDataQualityHealthy(t *testing.T) {
	res := ComputeDataQuality(baseOKInputs())
	if res.FormulaVersion != DataQualityFormulaVersion {
		t.Fatalf("version %s", res.FormulaVersion)
	}
	if res.OverallConfidence != ConfidenceHigh {
		t.Fatalf("confidence %s score=%d", res.OverallConfidence, res.OverallScore)
	}
	if res.OverallScore < 70 {
		t.Fatalf("expected healthy score, got %d", res.OverallScore)
	}
	// All core decision metrics visible
	for _, m := range []string{MetricSafeToSpend, MetricForecast, MetricHealthScore, MetricDTI, MetricAllocation} {
		g := GateFor(res, m)
		if !g.Visible {
			t.Fatalf("%s should be visible: %+v", m, g)
		}
	}
	if len(res.MissingInputs) != 0 {
		t.Fatalf("missing %v", res.MissingInputs)
	}
}

func TestComputeDataQualityHidesWithoutIncome(t *testing.T) {
	in := baseOKInputs()
	in.HasIncomeHistory = false
	in.IncomeMonthsCovered = 0
	res := ComputeDataQuality(in)
	if res.OverallConfidence != ConfidenceLow {
		t.Fatalf("want low, got %s", res.OverallConfidence)
	}
	if !containsStrSlice(res.MissingInputs, "income") {
		t.Fatalf("missing income: %v", res.MissingInputs)
	}
	// DTI must not appear as healthy 0 — hidden
	dti := GateFor(res, MetricDTI)
	if dti.Visible {
		t.Fatalf("DTI must be hidden without income: %+v", dti)
	}
	sts := GateFor(res, MetricSafeToSpend)
	if sts.Visible {
		t.Fatalf("STS hidden without income")
	}
	alloc := GateFor(res, MetricAllocation)
	if alloc.Visible {
		t.Fatalf("allocation hidden without income")
	}
	// Debt plan still ok (contract-based)
	debt := GateFor(res, MetricDebtPlan)
	if !debt.Visible {
		t.Fatalf("debt plan should remain visible")
	}
}

func TestComputeDataQualityHidesWithoutExpense(t *testing.T) {
	in := baseOKInputs()
	in.HasExpenseHistory = false
	res := ComputeDataQuality(in)
	if GateFor(res, MetricEFCoverage).Visible {
		t.Fatal("EF should hide without expense history")
	}
	if GateFor(res, MetricForecast).Visible {
		t.Fatal("forecast should hide without expense history")
	}
}

func TestComputeDataQualityNoAccounts(t *testing.T) {
	in := baseOKInputs()
	in.HasActiveLiquidAccount = false
	in.AccountCount = 0
	in.Accounts = nil
	res := ComputeDataQuality(in)
	if !containsStrSlice(res.MissingInputs, "accounts") {
		t.Fatal("accounts missing")
	}
	if GateFor(res, MetricSafeToSpend).Visible {
		t.Fatal("STS hidden without accounts")
	}
}

func TestComputeDataQualityLowReconDegradesHealth(t *testing.T) {
	in := baseOKInputs()
	in.ReconciledCount90d = 10
	in.UnreconciledCount90d = 90
	res := ComputeDataQuality(in)
	h := GateFor(res, MetricHealthScore)
	if !h.Visible {
		t.Fatal("health still visible but degraded when only recon is low")
	}
	if !h.Degraded && h.Confidence == ConfidenceHigh {
		t.Fatalf("expected degraded/medium health gate: %+v", h)
	}
	if res.ReconciliationRate > 0.2 {
		t.Fatalf("recon rate %f", res.ReconciliationRate)
	}
	// Floor policy
	if res.ReconciliationConfidence < 0.70-0.001 || res.ReconciliationConfidence > 1.0 {
		t.Fatalf("recon conf %f", res.ReconciliationConfidence)
	}
}

func TestComputeDataQualityUncategorizedWarning(t *testing.T) {
	in := baseOKInputs()
	in.UncategorizedCount90d = 40 // 40%
	res := ComputeDataQuality(in)
	found := false
	for _, iss := range res.Issues {
		if iss.Code == "uncategorized_transactions" && iss.Severity == SeverityWarning {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected uncategorized warning, issues=%+v", res.Issues)
	}
}

func TestComputeDataQualityStaleAccount(t *testing.T) {
	in := baseOKInputs()
	in.Accounts = append(in.Accounts, AccountQualityInput{
		ID: "stale", Name: "Old Wallet", Type: "e_wallet", IsActive: true,
		Currency: "IDR", DaysSinceLastTx: 120, HasRecentReconcile: false, Balance: 10_000,
	})
	res := ComputeDataQuality(in)
	found := false
	for _, iss := range res.Issues {
		if iss.Code == "account_stale" && iss.AccountID == "stale" {
			found = true
		}
	}
	if !found {
		t.Fatal("expected stale account issue")
	}
	// Account list sorted worst-first
	if len(res.Accounts) == 0 || res.Accounts[0].AccountID != "stale" {
		t.Fatalf("stale account should rank worst: %+v", res.Accounts)
	}
}

func TestComputeDataQualityMissingFXHidesAggregates(t *testing.T) {
	in := baseOKInputs()
	in.MissingFXRateCount = 1
	in.NonIDRAccountCount = 1
	res := ComputeDataQuality(in)
	if !containsStrSlice(res.MissingInputs, "fx_rate") {
		t.Fatal("fx_rate missing")
	}
	if GateFor(res, MetricHealthScore).Visible {
		t.Fatal("health hidden without FX")
	}
}

func TestComputeDataQualityDuplicateSuspicion(t *testing.T) {
	in := baseOKInputs()
	in.DuplicateSuspicionCount = 3
	res := ComputeDataQuality(in)
	found := false
	for _, iss := range res.Issues {
		if iss.Code == "duplicate_suspicion" {
			found = true
		}
	}
	if !found {
		t.Fatal("expected duplicate issue")
	}
}

func TestSufficiencyFields(t *testing.T) {
	ok := ComputeDataQuality(baseOKInputs())
	suf, miss, conf := ok.SufficiencyFields()
	if !suf || len(miss) != 0 || conf != ConfidenceHigh {
		t.Fatalf("ok sufficiency %v %v %s", suf, miss, conf)
	}
	bad := baseOKInputs()
	bad.HasIncomeHistory = false
	res := ComputeDataQuality(bad)
	suf, miss, conf = res.SufficiencyFields()
	if suf || conf != ConfidenceLow || !containsStrSlice(miss, "income") {
		t.Fatalf("bad sufficiency %v %v %s", suf, miss, conf)
	}
}

func TestEmptyLedgerReconRateIsOne(t *testing.T) {
	in := baseOKInputs()
	in.TxCount90d = 0
	in.ReconciledCount90d = 0
	res := ComputeDataQuality(in)
	if res.ReconciliationRate != 1.0 {
		t.Fatalf("empty ledger rate want 1 got %f", res.ReconciliationRate)
	}
}
