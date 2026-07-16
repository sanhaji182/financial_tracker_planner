package kernel

import (
	"fmt"
	"sort"
	"time"
)

// BehavioralFormulaVersion versions monthly review + suggested-action engine.
const BehavioralFormulaVersion = "behavioral-v1"

// Review checklist item statuses.
const (
	ReviewPending   = "pending"
	ReviewDone      = "done"
	ReviewSkipped   = "skipped"
	ReviewBlocked   = "blocked"
)

// Suggested action kinds (reversible where noted).
const (
	ActionConfirmAnomaly     = "confirm_anomaly"
	ActionDismissAnomaly     = "dismiss_anomaly"
	ActionReviewSubscription = "review_subscription"
	ActionCancelSubscription = "cancel_subscription" // reversible suggestion — user confirms elsewhere
	ActionReconcileAccount   = "reconcile_account"
	ActionCloseMonth         = "close_month"
	ActionTopUpEF            = "top_up_ef"
	ActionPayBill            = "pay_bill"
	ActionReviewBudget       = "review_budget"
)

// BehavioralInputs drives the pure monthly-review generator.
type BehavioralInputs struct {
	AsOf   time.Time
	Month  string // YYYY-MM

	// Bookkeeping signals
	UnreconciledTxCount int
	UnconfirmedTxCount  int
	OpenAnomalyCount    int
	AnomalyIDs          []string
	AnomalyLabels       []string

	// Subscriptions flagged unused / expensive
	UnusedSubscriptionCount int
	UnusedSubscriptionIDs   []string
	UnusedSubscriptionNames []string
	MonthlySubWaste         float64

	// Cash / EF / bills
	EFCoverageMonths float64
	EFTargetMonths   float64
	OverdueBillCount int
	BudgetOverCount  int

	// Closing
	MonthAlreadyClosed bool

	// Prior checklist progress (id → status)
	PriorItemStatus map[string]string
}

// ReviewChecklistItem is one monthly review step.
type ReviewChecklistItem struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Category    string `json:"category"` // books | anomalies | subscriptions | buffers | closing
	Status      string `json:"status"`
	Priority    int    `json:"priority"` // 1 = highest
	ActionURL   string `json:"action_url,omitempty"`
	Required    bool   `json:"required"`
}

// SuggestedAction is a reversible or confirmable next step.
type SuggestedAction struct {
	ID            string  `json:"id"`
	Kind          string  `json:"kind"`
	Title         string  `json:"title"`
	Rationale     string  `json:"rationale"`
	TargetID      string  `json:"target_id,omitempty"`
	TargetLabel   string  `json:"target_label,omitempty"`
	Amount        float64 `json:"amount,omitempty"`
	IsReversible  bool    `json:"is_reversible"`
	ConfirmLabel  string  `json:"confirm_label"`
	DismissLabel  string  `json:"dismiss_label"`
	ActionURL     string  `json:"action_url,omitempty"`
	Severity      string  `json:"severity"` // high | medium | low
}

// BehavioralResult is the pure monthly behavioral UX pack.
type BehavioralResult struct {
	AsOf           time.Time              `json:"as_of"`
	Month          string                 `json:"month"`
	FormulaVersion string                 `json:"formula_version"`
	Checklist      []ReviewChecklistItem  `json:"checklist"`
	Actions        []SuggestedAction      `json:"suggested_actions"`
	CompletedCount int                    `json:"completed_count"`
	TotalRequired  int                    `json:"total_required"`
	ProgressPct    float64                `json:"progress_pct"`
	Summary        string                 `json:"summary"`
	Assumptions    []string               `json:"assumptions"`
	Disclaimer     string                 `json:"disclaimer"`
}

// ComputeMonthlyReview builds checklist + reversible suggested actions.
func ComputeMonthlyReview(in BehavioralInputs) BehavioralResult {
	asOf := in.AsOf
	if asOf.IsZero() {
		asOf = time.Now().UTC()
	}
	month := in.Month
	if month == "" {
		month = asOf.Format("2006-01")
	}
	prior := in.PriorItemStatus
	if prior == nil {
		prior = map[string]string{}
	}
	statusOf := func(id, def string) string {
		if s, ok := prior[id]; ok && s != "" {
			return s
		}
		return def
	}

	efTarget := in.EFTargetMonths
	if efTarget <= 0 {
		efTarget = 6
	}

	items := []ReviewChecklistItem{
		{
			ID: "recon_tx", Title: "Rekonsiliasi transaksi",
			Description: fmt.Sprintf("%d transaksi belum direkonsiliasi", in.UnreconciledTxCount),
			Category: "books", Priority: 1, Required: true, ActionURL: "/transactions",
			Status: statusOf("recon_tx", statusIf(in.UnreconciledTxCount == 0, ReviewDone, ReviewPending)),
		},
		{
			ID: "confirm_tx", Title: "Konfirmasi transaksi draft",
			Description: fmt.Sprintf("%d transaksi masih draft/unconfirmed", in.UnconfirmedTxCount),
			Category: "books", Priority: 2, Required: true, ActionURL: "/transactions",
			Status: statusOf("confirm_tx", statusIf(in.UnconfirmedTxCount == 0, ReviewDone, ReviewPending)),
		},
		{
			ID: "anomalies", Title: "Tinjau anomali",
			Description: fmt.Sprintf("%d anomali menunggu konfirmasi/abaikan", in.OpenAnomalyCount),
			Category: "anomalies", Priority: 3, Required: in.OpenAnomalyCount > 0, ActionURL: "/alerts",
			Status: statusOf("anomalies", statusIf(in.OpenAnomalyCount == 0, ReviewDone, ReviewPending)),
		},
		{
			ID: "subscriptions", Title: "Bersihkan langganan menganggur",
			Description: fmt.Sprintf("%d langganan berpotensi tidak terpakai (≈ waste bulanan terdeteksi)", in.UnusedSubscriptionCount),
			Category: "subscriptions", Priority: 4, Required: false, ActionURL: "/subscriptions",
			Status: statusOf("subscriptions", statusIf(in.UnusedSubscriptionCount == 0, ReviewDone, ReviewPending)),
		},
		{
			ID: "overdue_bills", Title: "Bayar tagihan jatuh tempo",
			Description: fmt.Sprintf("%d tagihan overdue", in.OverdueBillCount),
			Category: "buffers", Priority: 2, Required: in.OverdueBillCount > 0, ActionURL: "/bills",
			Status: statusOf("overdue_bills", statusIf(in.OverdueBillCount == 0, ReviewDone, ReviewPending)),
		},
		{
			ID: "ef_buffer", Title: "Cek cakupan dana darurat",
			Description: fmt.Sprintf("EF ≈ %.1f bln (target %.0f)", in.EFCoverageMonths, efTarget),
			Category: "buffers", Priority: 5, Required: false, ActionURL: "/emergency-fund",
			Status: statusOf("ef_buffer", statusIf(in.EFCoverageMonths >= efTarget, ReviewDone, ReviewPending)),
		},
		{
			ID: "budget_over", Title: "Review budget overflow",
			Description: fmt.Sprintf("%d kategori over-budget", in.BudgetOverCount),
			Category: "books", Priority: 6, Required: false, ActionURL: "/budgets",
			Status: statusOf("budget_over", statusIf(in.BudgetOverCount == 0, ReviewDone, ReviewPending)),
		},
		{
			ID: "close_month", Title: "Tutup buku bulanan",
			Description: "Generate monthly closing setelah checklist utama selesai",
			Category: "closing", Priority: 9, Required: true, ActionURL: "/monthly-closing",
			Status: statusOf("close_month", statusIf(in.MonthAlreadyClosed, ReviewDone, ReviewPending)),
		},
	}

	// Sort by priority
	sort.SliceStable(items, func(i, j int) bool {
		return items[i].Priority < items[j].Priority
	})

	var actions []SuggestedAction
	// Anomalies → confirm / dismiss pairs
	for i, id := range in.AnomalyIDs {
		label := id
		if i < len(in.AnomalyLabels) && in.AnomalyLabels[i] != "" {
			label = in.AnomalyLabels[i]
		}
		actions = append(actions, SuggestedAction{
			ID: "anomaly_confirm_" + id, Kind: ActionConfirmAnomaly,
			Title: "Konfirmasi anomali", Rationale: "Tandai sebagai sah agar tidak muncul lagi di review.",
			TargetID: id, TargetLabel: label, IsReversible: true,
			ConfirmLabel: "Konfirmasi sah", DismissLabel: "Nanti",
			ActionURL: "/alerts", Severity: "medium",
		})
		actions = append(actions, SuggestedAction{
			ID: "anomaly_dismiss_" + id, Kind: ActionDismissAnomaly,
			Title: "Abaikan anomali", Rationale: "False positive — abaikan tanpa mengubah transaksi.",
			TargetID: id, TargetLabel: label, IsReversible: true,
			ConfirmLabel: "Abaikan", DismissLabel: "Batal",
			ActionURL: "/alerts", Severity: "low",
		})
	}

	// Subscription cleanup suggestions
	for i, id := range in.UnusedSubscriptionIDs {
		name := id
		if i < len(in.UnusedSubscriptionNames) && in.UnusedSubscriptionNames[i] != "" {
			name = in.UnusedSubscriptionNames[i]
		}
		actions = append(actions, SuggestedAction{
			ID: "sub_review_" + id, Kind: ActionReviewSubscription,
			Title: "Review langganan: " + name,
			Rationale: "Tidak ada aktivitas terdeteksi — tinjau apakah masih dibutuhkan.",
			TargetID: id, TargetLabel: name, IsReversible: true,
			ConfirmLabel: "Buka detail", DismissLabel: "Tetap aktif",
			ActionURL: "/subscriptions", Severity: "medium",
		})
	}
	if in.UnusedSubscriptionCount > 0 && in.MonthlySubWaste > 0 {
		actions = append(actions, SuggestedAction{
			ID: "sub_waste_summary", Kind: ActionCancelSubscription,
			Title: "Potensi hemat langganan",
			Rationale: fmt.Sprintf("Estimasi waste ≈ Rp %.0f / bln dari langganan menganggur.", in.MonthlySubWaste),
			Amount: in.MonthlySubWaste, IsReversible: true,
			ConfirmLabel: "Lihat daftar", DismissLabel: "Nanti",
			ActionURL: "/subscriptions", Severity: "high",
		})
	}

	if in.UnreconciledTxCount > 0 {
		actions = append(actions, SuggestedAction{
			ID: "recon_batch", Kind: ActionReconcileAccount,
			Title: "Rekonsiliasi batch",
			Rationale: fmt.Sprintf("%d transaksi menunggu rekonsiliasi — skor kesehatan didiskon sampai selesai.", in.UnreconciledTxCount),
			IsReversible: true, ConfirmLabel: "Ke transaksi", DismissLabel: "Nanti",
			ActionURL: "/transactions", Severity: "high",
		})
	}
	if in.OverdueBillCount > 0 {
		actions = append(actions, SuggestedAction{
			ID: "pay_overdue", Kind: ActionPayBill,
			Title: "Bayar tagihan overdue",
			Rationale: fmt.Sprintf("%d tagihan lewat jatuh tempo.", in.OverdueBillCount),
			IsReversible: false, ConfirmLabel: "Ke tagihan", DismissLabel: "Nanti",
			ActionURL: "/bills", Severity: "high",
		})
	}
	if in.EFCoverageMonths < efTarget {
		actions = append(actions, SuggestedAction{
			ID: "ef_topup", Kind: ActionTopUpEF,
			Title: "Top-up dana darurat",
			Rationale: fmt.Sprintf("Cakupan %.1f bln di bawah target %.0f bln.", in.EFCoverageMonths, efTarget),
			IsReversible: true, ConfirmLabel: "Ke EF", DismissLabel: "Nanti",
			ActionURL: "/emergency-fund", Severity: "medium",
		})
	}
	if in.BudgetOverCount > 0 {
		actions = append(actions, SuggestedAction{
			ID: "budget_review", Kind: ActionReviewBudget,
			Title: "Review kategori over-budget",
			Rationale: fmt.Sprintf("%d kategori melewati budget — sesuaikan atau catat alasan.", in.BudgetOverCount),
			IsReversible: true, ConfirmLabel: "Ke budget", DismissLabel: "Nanti",
			ActionURL: "/budgets", Severity: "medium",
		})
	}
	if !in.MonthAlreadyClosed {
		actions = append(actions, SuggestedAction{
			ID: "close_" + month, Kind: ActionCloseMonth,
			Title: "Tutup buku " + month,
			Rationale: "Setelah checklist books/anomaly, generate monthly closing.",
			IsReversible: false, ConfirmLabel: "Ke tutup buku", DismissLabel: "Belum siap",
			ActionURL: "/monthly-closing", Severity: "low",
		})
	}

	completed := 0
	required := 0
	for _, it := range items {
		if it.Required {
			required++
			if it.Status == ReviewDone || it.Status == ReviewSkipped {
				completed++
			}
		}
	}
	pct := 0.0
	if required > 0 {
		pct = RoundMoney(float64(completed)/float64(required)*100, 1)
	}

	summary := fmt.Sprintf("Review %s: %d/%d checklist wajib selesai (%.0f%%).", month, completed, required, pct)
	if in.OpenAnomalyCount > 0 {
		summary += fmt.Sprintf(" %d anomali menunggu keputusan.", in.OpenAnomalyCount)
	}
	if in.UnusedSubscriptionCount > 0 {
		summary += fmt.Sprintf(" %d langganan kandidat cleanup.", in.UnusedSubscriptionCount)
	}

	return BehavioralResult{
		AsOf:           asOf.UTC(),
		Month:          month,
		FormulaVersion: BehavioralFormulaVersion,
		Checklist:      items,
		Actions:        actions,
		CompletedCount: completed,
		TotalRequired:  required,
		ProgressPct:    pct,
		Summary:        summary,
		Assumptions: []string{
			"Checklist bersifat edukatif/operasional — tidak mengubah data tanpa aksi user.",
			"Suggested actions bertanda is_reversible dapat dibatalkan; cancel subscription hanya usulan.",
			"Status prior (done/skipped) dihormati jika dikirim ulang.",
		},
		Disclaimer: "Ini daftar tinjauan bulanan & usulan tindakan, bukan nasihat keuangan berizin. " +
			"Konfirmasi anomali/langganan tetap keputusan Anda.",
	}
}

func statusIf(cond bool, a, b string) string {
	if cond {
		return a
	}
	return b
}
