package kernel

import (
	"testing"
	"time"
)

func TestComputeMonthlyReviewProgress(t *testing.T) {
	res := ComputeMonthlyReview(BehavioralInputs{
		AsOf:                time.Date(2026, 7, 16, 0, 0, 0, 0, time.UTC),
		Month:               "2026-07",
		UnreconciledTxCount: 0,
		UnconfirmedTxCount:  0,
		OpenAnomalyCount:    0,
		OverdueBillCount:    0,
		MonthAlreadyClosed:  true,
	})
	if res.FormulaVersion != BehavioralFormulaVersion {
		t.Fatalf("version %s", res.FormulaVersion)
	}
	if res.TotalRequired == 0 {
		t.Fatal("expected required items")
	}
	if res.ProgressPct != 100 {
		t.Fatalf("want 100%% progress, got %v (completed=%d required=%d)", res.ProgressPct, res.CompletedCount, res.TotalRequired)
	}
	if len(res.Checklist) < 5 {
		t.Fatalf("checklist too short: %d", len(res.Checklist))
	}
}

func TestComputeMonthlyReviewAnomalyActionsReversible(t *testing.T) {
	res := ComputeMonthlyReview(BehavioralInputs{
		Month:            "2026-06",
		OpenAnomalyCount: 1,
		AnomalyIDs:       []string{"a1"},
		AnomalyLabels:    []string{"Transfer besar"},
		UnusedSubscriptionCount: 1,
		UnusedSubscriptionIDs:   []string{"s1"},
		UnusedSubscriptionNames: []string{"Streaming X"},
		MonthlySubWaste:         150000,
		UnreconciledTxCount:     3,
	})
	if len(res.Actions) == 0 {
		t.Fatal("expected suggested actions")
	}
	var sawConfirm, sawDismiss, sawSub bool
	for _, a := range res.Actions {
		if a.Kind == ActionConfirmAnomaly {
			sawConfirm = true
			if !a.IsReversible {
				t.Fatal("confirm anomaly should be reversible")
			}
		}
		if a.Kind == ActionDismissAnomaly {
			sawDismiss = true
		}
		if a.Kind == ActionReviewSubscription {
			sawSub = true
		}
	}
	if !sawConfirm || !sawDismiss || !sawSub {
		t.Fatalf("missing action kinds confirm=%v dismiss=%v sub=%v", sawConfirm, sawDismiss, sawSub)
	}
}

func TestComputeMonthlyReviewPriorStatusHonored(t *testing.T) {
	res := ComputeMonthlyReview(BehavioralInputs{
		Month:               "2026-05",
		UnreconciledTxCount: 5, // would be pending
		PriorItemStatus: map[string]string{
			"recon_tx": ReviewSkipped,
		},
	})
	for _, it := range res.Checklist {
		if it.ID == "recon_tx" && it.Status != ReviewSkipped {
			t.Fatalf("prior skip not honored: %s", it.Status)
		}
	}
}
