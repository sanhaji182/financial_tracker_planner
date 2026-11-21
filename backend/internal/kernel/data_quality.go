package kernel

import (
	"sort"
	"time"
)

// DataQualityFormulaVersion versions the household data-quality center.
const DataQualityFormulaVersion = "dq-v1"

// Confidence band labels used across decision-support surfaces.
const (
	ConfidenceHigh   = "high"
	ConfidenceMedium = "medium"
	ConfidenceLow    = "low"
)

// MetricKey identifies a decision-support metric that can be gated.
const (
	MetricSafeToSpend   = "safe_to_spend"
	MetricForecast      = "forecast"
	MetricHealthScore   = "health_score"
	MetricDTI           = "dti"
	MetricEFCoverage    = "ef_coverage"
	MetricAllocation    = "allocation"
	MetricDebtPlan      = "debt_plan"
)

// IssueSeverity ranks fix urgency.
const (
	SeverityCritical = "critical" // blocks decision metric
	SeverityWarning  = "warning"  // degrades confidence
	SeverityInfo     = "info"     // hygiene
)

// AccountQualityInput is per-account freshness/completeness signal.
type AccountQualityInput struct {
	ID              string
	Name            string
	Type            string // bank | e_wallet | cash | credit | investment | other
	IsActive        bool
	Currency        string
	// DaysSinceLastTx is days since last confirmed transaction; -1 if never.
	DaysSinceLastTx int
	// HasRecentReconcile is true if any tx on this account was reconciled in window.
	HasRecentReconcile bool
	Balance            float64
}

// DataQualityInputs is a snapshot assembled by the service (no I/O here).
type DataQualityInputs struct {
	AsOf time.Time

	// Completeness
	HasActiveLiquidAccount bool
	AccountCount           int
	Accounts               []AccountQualityInput

	// Cashflow history (completed months / MTD)
	HasIncomeHistory   bool // avg income last 3 completed months > 0 OR income MTD > 0
	HasExpenseHistory  bool
	IncomeMonthsCovered int // 0..3 completed months with income
	ExpenseMonthsCovered int

	// Ledger hygiene (window, typically 90d)
	TxCount90d            int
	UncategorizedCount90d int // expense/income without category and not split
	UnreconciledCount90d  int
	ReconciledCount90d    int
	PendingReviewCount90d int // status pending / needs_review if tracked; else 0
	// DuplicateSuspicionCount: near-duplicate confirmed txs (same amount+date+account).
	DuplicateSuspicionCount int

	// FX
	NonIDRAccountCount   int
	StaleFXRateCount     int // currencies with last_updated older than threshold
	MissingFXRateCount   int

	// Obligations
	ActiveDebtCount       int
	UnpaidBillCount       int
	OverdueBillCount      int
	// Days since last successful monthly closing; -1 if never.
	DaysSinceLastClosing int

	// Window policy (defaults applied if 0)
	ReconcileWindowDays int // default 90
	StaleAccountDays    int // default 45 — account with no tx considered stale
	StaleFXDays         int // default 7
}

// QualityIssue is one actionable data gap.
type QualityIssue struct {
	Code        string   `json:"code"`
	Severity    string   `json:"severity"` // critical | warning | info
	Title       string   `json:"title"`
	Detail      string   `json:"detail"`
	CTALabel    string   `json:"cta_label,omitempty"`
	CTAURL      string   `json:"cta_url,omitempty"`
	Affects     []string `json:"affects,omitempty"` // metric keys degraded/hidden
	Count       int      `json:"count,omitempty"`
	AccountID   string   `json:"account_id,omitempty"`
	AccountName string   `json:"account_name,omitempty"`
}

// MetricGate describes whether a decision metric should show full numbers.
type MetricGate struct {
	Metric     string   `json:"metric"`
	Visible    bool     `json:"visible"`    // false → hide primary number / show placeholder
	Degraded   bool     `json:"degraded"`   // true → show with low-confidence banner
	Confidence string   `json:"confidence"` // high|medium|low
	Reasons    []string `json:"reasons,omitempty"`
	Missing    []string `json:"missing,omitempty"`
}

// AccountQualityScore is per-account rollup for UI cards.
type AccountQualityScore struct {
	AccountID   string  `json:"account_id"`
	AccountName string  `json:"account_name"`
	Type        string  `json:"type"`
	Currency    string  `json:"currency"`
	Score       int     `json:"score"` // 0-100
	Freshness   string  `json:"freshness"` // fresh | stale | empty
	Reconciled  bool    `json:"has_recent_reconcile"`
	DaysSinceTx int     `json:"days_since_last_tx"`
	Balance     float64 `json:"balance"`
}

// DataQualityResult is the Data Quality Center payload.
type DataQualityResult struct {
	AsOf           time.Time `json:"-"`
	FormulaVersion string    `json:"formula_version"`

	// Overall 0-100 composite (completeness 40 + freshness/reconcile 35 + hygiene 25).
	OverallScore int    `json:"overall_score"`
	// high|medium|low — decision surfaces should use this when metric-specific gate absent.
	OverallConfidence string `json:"overall_confidence"`
	// Grade: Excellent | Good | Fair | Poor | Critical
	Grade string `json:"grade"`

	CompletenessScore int `json:"completeness_score"`
	FreshnessScore    int `json:"freshness_score"`
	HygieneScore      int `json:"hygiene_score"`

	// Rates 0..1
	ReconciliationRate float64 `json:"reconciliation_rate"`
	// Same floor policy as health score: 0.70 + 0.30*rate
	ReconciliationConfidence float64 `json:"reconciliation_confidence"`
	UncategorizedRate        float64 `json:"uncategorized_rate"`

	Issues   []QualityIssue       `json:"issues"`
	Accounts []AccountQualityScore `json:"accounts"`
	Gates    []MetricGate         `json:"gates"`

	// MissingInputs is the union of critical missing fields (for DataSufficiency compat).
	MissingInputs []string `json:"missing_inputs"`
	// DecisionMetricsHidden lists metric keys with Visible=false.
	DecisionMetricsHidden []string `json:"decision_metrics_hidden"`
	// DecisionMetricsDegraded lists metric keys with Degraded=true.
	DecisionMetricsDegraded []string `json:"decision_metrics_degraded"`

	Assumptions []string `json:"assumptions"`
}

// ComputeDataQuality builds scores, issues, and metric gates from a snapshot.
// Pure function — no I/O.
func ComputeDataQuality(in DataQualityInputs) DataQualityResult {
	asOf := in.AsOf
	if asOf.IsZero() {
		asOf = time.Now().UTC()
	}
	staleAccountDays := in.StaleAccountDays
	if staleAccountDays <= 0 {
		staleAccountDays = 45
	}
	if in.ReconcileWindowDays <= 0 {
		in.ReconcileWindowDays = 90
	}

	var issues []QualityIssue
	missing := []string{}

	// --- Completeness ---
	if !in.HasActiveLiquidAccount || in.AccountCount == 0 {
		issues = append(issues, QualityIssue{
			Code:     "no_liquid_account",
			Severity: SeverityCritical,
			Title:    "Belum ada rekening kas aktif",
			Detail:   "Tambahkan rekening bank/e-wallet/cash agar saldo dan forecast punya basis.",
			CTALabel: "Kelola rekening",
			CTAURL:   "/accounts",
			Affects:  []string{MetricSafeToSpend, MetricForecast, MetricHealthScore, MetricAllocation, MetricEFCoverage},
		})
		missing = append(missing, "accounts")
	}
	if !in.HasIncomeHistory {
		issues = append(issues, QualityIssue{
			Code:     "missing_income_history",
			Severity: SeverityCritical,
			Title:    "Histori pendapatan kosong",
			Detail:   "Tanpa income, DTI/alokasi/safe-to-spend tidak dapat dihitung secara aman.",
			CTALabel: "Catat income",
			CTAURL:   "/transactions",
			Affects:  []string{MetricSafeToSpend, MetricForecast, MetricDTI, MetricAllocation, MetricHealthScore, MetricEFCoverage},
		})
		missing = append(missing, "income")
	} else if in.IncomeMonthsCovered < 2 {
		issues = append(issues, QualityIssue{
			Code:     "sparse_income_history",
			Severity: SeverityWarning,
			Title:    "Histori pendapatan masih tipis",
			Detail:   "Idealnya 2–3 bulan completed agar estimasi tidak bias ke satu bulan.",
			CTALabel: "Lengkapi transaksi",
			CTAURL:   "/transactions",
			Affects:  []string{MetricForecast, MetricAllocation, MetricEFCoverage},
			Count:    in.IncomeMonthsCovered,
		})
	}
	if !in.HasExpenseHistory {
		issues = append(issues, QualityIssue{
			Code:     "missing_expense_history",
			Severity: SeverityCritical,
			Title:    "Histori pengeluaran kosong",
			Detail:   "Living cost, EF coverage, dan variable forecast butuh data expense.",
			CTALabel: "Catat pengeluaran",
			CTAURL:   "/transactions",
			Affects:  []string{MetricSafeToSpend, MetricForecast, MetricEFCoverage, MetricAllocation, MetricHealthScore},
		})
		missing = append(missing, "expense_history")
	}

	// --- Freshness / reconcile ---
	reconRate := 1.0
	if in.TxCount90d > 0 {
		reconRate = float64(in.ReconciledCount90d) / float64(in.TxCount90d)
	}
	reconConf := 0.70 + 0.30*reconRate
	if in.TxCount90d > 0 && reconRate < 0.5 {
		issues = append(issues, QualityIssue{
			Code:     "low_reconciliation",
			Severity: SeverityWarning,
			Title:    "Banyak transaksi belum direkonsiliasi",
			Detail:   "Health score dan keputusan kas diturunkan keyakinannya sampai buku lebih bersih.",
			CTALabel: "Mulai rekonsiliasi",
			CTAURL:   "/closing", // closing/recon flow; dedicated recon page may map here
			Affects:  []string{MetricHealthScore, MetricSafeToSpend, MetricForecast},
			Count:    in.UnreconciledCount90d,
		})
	}

	// Stale accounts
	for _, a := range in.Accounts {
		if !a.IsActive {
			continue
		}
		if a.DaysSinceLastTx < 0 {
			issues = append(issues, QualityIssue{
				Code:        "account_no_activity",
				Severity:    SeverityInfo,
				Title:       "Rekening tanpa transaksi",
				Detail:      "Belum ada mutasi tercatat — pastikan saldo awal benar atau nonaktifkan jika tidak dipakai.",
				CTALabel:    "Cek rekening",
				CTAURL:      "/accounts",
				Affects:     []string{MetricSafeToSpend},
				AccountID:   a.ID,
				AccountName: a.Name,
			})
			continue
		}
		if a.DaysSinceLastTx > staleAccountDays {
			issues = append(issues, QualityIssue{
				Code:        "account_stale",
				Severity:    SeverityWarning,
				Title:       "Rekening stagnan",
				Detail:      "Tidak ada transaksi dalam periode panjang; saldo mungkin basi.",
				CTALabel:    "Update saldo",
				CTAURL:      "/accounts",
				Affects:     []string{MetricSafeToSpend, MetricForecast, MetricHealthScore},
				Count:       a.DaysSinceLastTx,
				AccountID:   a.ID,
				AccountName: a.Name,
			})
		}
	}

	// --- Hygiene ---
	uncatRate := 0.0
	if in.TxCount90d > 0 {
		uncatRate = float64(in.UncategorizedCount90d) / float64(in.TxCount90d)
	}
	if in.UncategorizedCount90d > 0 {
		sev := SeverityInfo
		if uncatRate >= 0.2 {
			sev = SeverityWarning
		}
		issues = append(issues, QualityIssue{
			Code:     "uncategorized_transactions",
			Severity: sev,
			Title:    "Transaksi belum dikategori",
			Detail:   "Budget, insight, dan alokasi kurang akurat jika banyak transaksi tanpa kategori.",
			CTALabel: "Kategorikan",
			CTAURL:   "/transactions",
			Affects:  []string{MetricAllocation},
			Count:    in.UncategorizedCount90d,
		})
	}
	if in.PendingReviewCount90d > 0 {
		issues = append(issues, QualityIssue{
			Code:     "pending_review",
			Severity: SeverityWarning,
			Title:    "Transaksi menunggu review",
			Detail:   "Selesaikan review agar ledger final.",
			CTALabel: "Review transaksi",
			CTAURL:   "/transactions",
			Affects:  []string{MetricForecast, MetricSafeToSpend},
			Count:    in.PendingReviewCount90d,
		})
	}
	if in.DuplicateSuspicionCount > 0 {
		issues = append(issues, QualityIssue{
			Code:     "duplicate_suspicion",
			Severity: SeverityWarning,
			Title:    "Dugaan transaksi duplikat",
			Detail:   "Beberapa transaksi punya amount+tanggal+rekening sama — cek agar tidak double-count.",
			CTALabel: "Cek transaksi",
			CTAURL:   "/transactions",
			Affects:  []string{MetricForecast, MetricSafeToSpend, MetricHealthScore},
			Count:    in.DuplicateSuspicionCount,
		})
	}

	// FX
	if in.MissingFXRateCount > 0 {
		issues = append(issues, QualityIssue{
			Code:     "missing_fx_rate",
			Severity: SeverityCritical,
			Title:    "Kurs mata uang hilang",
			Detail:   "Agregasi multi-currency tidak valid tanpa kurs.",
			CTALabel: "Update kurs",
			CTAURL:   "/settings/currencies",
			Affects:  []string{MetricHealthScore, MetricSafeToSpend, MetricForecast, MetricEFCoverage},
			Count:    in.MissingFXRateCount,
		})
		missing = append(missing, "fx_rate")
	} else if in.StaleFXRateCount > 0 {
		issues = append(issues, QualityIssue{
			Code:     "stale_fx_rate",
			Severity: SeverityWarning,
			Title:    "Kurs mata uang basi",
			Detail:   "Kurs sudah lama tidak di-update; net worth multi-currency bisa meleset.",
			CTALabel: "Update kurs",
			CTAURL:   "/settings/currencies",
			Affects:  []string{MetricHealthScore},
			Count:    in.StaleFXRateCount,
		})
	}

	if in.OverdueBillCount > 0 {
		issues = append(issues, QualityIssue{
			Code:     "overdue_bills",
			Severity: SeverityWarning,
			Title:    "Tagihan overdue",
			Detail:   "Bayar atau update status agar forecast fixed expense akurat.",
			CTALabel: "Lihat tagihan",
			CTAURL:   "/bills",
			Affects:  []string{MetricForecast, MetricSafeToSpend},
			Count:    in.OverdueBillCount,
		})
	}
	if in.DaysSinceLastClosing < 0 {
		issues = append(issues, QualityIssue{
			Code:     "never_closed",
			Severity: SeverityInfo,
			Title:    "Belum pernah tutup buku",
			Detail:   "Monthly closing mengunci snapshot dan meningkatkan kepercayaan histori.",
			CTALabel: "Tutup buku",
			CTAURL:   "/closing",
			Affects:  []string{MetricHealthScore},
		})
	} else if in.DaysSinceLastClosing > 45 {
		issues = append(issues, QualityIssue{
			Code:     "stale_closing",
			Severity: SeverityInfo,
			Title:    "Tutup buku sudah lama",
			Detail:   "Pertimbangkan closing bulan terakhir untuk menjaga jejak audit.",
			CTALabel: "Tutup buku",
			CTAURL:   "/closing",
			Count:    in.DaysSinceLastClosing,
		})
	}

	// --- Scores ---
	completeness := 100
	if containsStrSlice(missing, "accounts") {
		completeness -= 40
	}
	if containsStrSlice(missing, "income") {
		completeness -= 30
	} else if in.IncomeMonthsCovered < 2 {
		completeness -= 10
	}
	if containsStrSlice(missing, "expense_history") {
		completeness -= 30
	}
	if completeness < 0 {
		completeness = 0
	}

	// Freshness: recon rate + account staleness
	freshness := int(reconRate * 70) // up to 70 from recon
	activeFresh := 0
	activeTotal := 0
	for _, a := range in.Accounts {
		if !a.IsActive {
			continue
		}
		activeTotal++
		if a.DaysSinceLastTx >= 0 && a.DaysSinceLastTx <= staleAccountDays {
			activeFresh++
		}
	}
	if activeTotal > 0 {
		freshness += int(float64(activeFresh) / float64(activeTotal) * 30)
	} else {
		freshness += 0
	}
	if freshness > 100 {
		freshness = 100
	}

	// Hygiene: uncategorized + duplicates + pending
	hygiene := 100
	if in.TxCount90d > 0 {
		hygiene -= int(uncatRate * 50)
		if in.DuplicateSuspicionCount > 0 {
			hygiene -= minInt(30, in.DuplicateSuspicionCount*5)
		}
		if in.PendingReviewCount90d > 0 {
			hygiene -= minInt(20, in.PendingReviewCount90d*2)
		}
	}
	if hygiene < 0 {
		hygiene = 0
	}

	overall := int(0.40*float64(completeness) + 0.35*float64(freshness) + 0.25*float64(hygiene))
	if overall > 100 {
		overall = 100
	}

	// Overall confidence
	overallConf := ConfidenceHigh
	if len(missing) > 0 || overall < 40 {
		overallConf = ConfidenceLow
	} else if overall < 70 || reconRate < 0.7 || uncatRate >= 0.2 {
		overallConf = ConfidenceMedium
	}

	grade := "Critical"
	switch {
	case overall >= 85:
		grade = "Excellent"
	case overall >= 70:
		grade = "Good"
	case overall >= 50:
		grade = "Fair"
	case overall >= 30:
		grade = "Poor"
	}

	// --- Per-account scores ---
	accounts := make([]AccountQualityScore, 0, len(in.Accounts))
	for _, a := range in.Accounts {
		if !a.IsActive {
			continue
		}
		sc := 100
		freshLabel := "fresh"
		if a.DaysSinceLastTx < 0 {
			sc = 40
			freshLabel = "empty"
		} else if a.DaysSinceLastTx > staleAccountDays {
			sc = 55
			freshLabel = "stale"
		}
		if !a.HasRecentReconcile && in.TxCount90d > 0 {
			sc -= 15
		}
		if sc < 0 {
			sc = 0
		}
		accounts = append(accounts, AccountQualityScore{
			AccountID:   a.ID,
			AccountName: a.Name,
			Type:        a.Type,
			Currency:    a.Currency,
			Score:       sc,
			Freshness:   freshLabel,
			Reconciled:  a.HasRecentReconcile,
			DaysSinceTx: a.DaysSinceLastTx,
			Balance:     a.Balance,
		})
	}
	sort.Slice(accounts, func(i, j int) bool {
		if accounts[i].Score != accounts[j].Score {
			return accounts[i].Score < accounts[j].Score
		}
		return accounts[i].AccountName < accounts[j].AccountName
	})

	// --- Metric gates ---
	gates := buildMetricGates(issues, missing, overallConf, reconRate)

	hidden := []string{}
	degraded := []string{}
	for _, g := range gates {
		if !g.Visible {
			hidden = append(hidden, g.Metric)
		} else if g.Degraded {
			degraded = append(degraded, g.Metric)
		}
	}

	// Sort issues: critical → warning → info
	sort.SliceStable(issues, func(i, j int) bool {
		return severityRank(issues[i].Severity) < severityRank(issues[j].Severity)
	})

	// Dedupe missing
	missing = uniqueStrings(missing)

	return DataQualityResult{
		AsOf:                     asOf.UTC(),
		FormulaVersion:           DataQualityFormulaVersion,
		OverallScore:             overall,
		OverallConfidence:        overallConf,
		Grade:                    grade,
		CompletenessScore:        completeness,
		FreshnessScore:           freshness,
		HygieneScore:             hygiene,
		ReconciliationRate:       reconRate,
		ReconciliationConfidence: reconConf,
		UncategorizedRate:        uncatRate,
		Issues:                   issues,
		Accounts:                 accounts,
		Gates:                    gates,
		MissingInputs:            missing,
		DecisionMetricsHidden:    hidden,
		DecisionMetricsDegraded:  degraded,
		Assumptions: []string{
			"Completeness 40% + freshness 35% + hygiene 25%",
			"Reconciliation confidence floor 0.70 (same as health score policy)",
			"Critical missing income/expense/accounts hide decision metrics (not zero-filled)",
			"Formula version " + DataQualityFormulaVersion,
		},
	}
}

func buildMetricGates(issues []QualityIssue, missing []string, overallConf string, reconRate float64) []MetricGate {
	// Map metric → critical/warning reasons
	type agg struct {
		critical []string
		warning  []string
		missing  []string
	}
	by := map[string]*agg{}
	ensure := func(m string) *agg {
		if by[m] == nil {
			by[m] = &agg{}
		}
		return by[m]
	}
	allMetrics := []string{
		MetricSafeToSpend, MetricForecast, MetricHealthScore, MetricDTI,
		MetricEFCoverage, MetricAllocation, MetricDebtPlan,
	}
	for _, m := range allMetrics {
		ensure(m)
	}

	for _, iss := range issues {
		for _, m := range iss.Affects {
			a := ensure(m)
			if iss.Severity == SeverityCritical {
				a.critical = append(a.critical, iss.Code)
			} else if iss.Severity == SeverityWarning {
				a.warning = append(a.warning, iss.Code)
			}
		}
	}
	// Map missing fields to metrics
	for _, mf := range missing {
		switch mf {
		case "income":
			for _, m := range []string{MetricSafeToSpend, MetricForecast, MetricDTI, MetricAllocation, MetricHealthScore, MetricEFCoverage} {
				ensure(m).missing = append(ensure(m).missing, mf)
			}
		case "expense_history":
			for _, m := range []string{MetricSafeToSpend, MetricForecast, MetricEFCoverage, MetricAllocation, MetricHealthScore} {
				ensure(m).missing = append(ensure(m).missing, mf)
			}
		case "accounts":
			for _, m := range []string{MetricSafeToSpend, MetricForecast, MetricHealthScore, MetricAllocation, MetricEFCoverage} {
				ensure(m).missing = append(ensure(m).missing, mf)
			}
		case "fx_rate":
			for _, m := range []string{MetricHealthScore, MetricSafeToSpend, MetricForecast, MetricEFCoverage} {
				ensure(m).missing = append(ensure(m).missing, mf)
			}
		}
	}

	gates := make([]MetricGate, 0, len(allMetrics))
	for _, m := range allMetrics {
		a := ensure(m)
		g := MetricGate{Metric: m, Visible: true, Degraded: false, Confidence: overallConf}
		// Hide when critical issues or critical missing for this metric
		if len(a.critical) > 0 || len(a.missing) > 0 {
			// Debt plan can stay visible without income (uses contract balances).
			if m == MetricDebtPlan && !containsStrSlice(a.missing, "accounts") {
				g.Visible = true
				g.Degraded = true
				g.Confidence = ConfidenceMedium
			} else if m == MetricDTI && containsStrSlice(a.missing, "income") {
				// DTI with no income is meaningless — hide (not healthy 0%)
				g.Visible = false
				g.Confidence = ConfidenceLow
			} else if len(a.missing) > 0 || len(a.critical) > 0 {
				g.Visible = false
				g.Confidence = ConfidenceLow
			}
		} else if len(a.warning) > 0 || reconRate < 0.7 {
			g.Degraded = true
			if g.Confidence == ConfidenceHigh {
				g.Confidence = ConfidenceMedium
			}
		}
		g.Reasons = uniqueStrings(append(append([]string{}, a.critical...), a.warning...))
		g.Missing = uniqueStrings(a.missing)
		// If hidden, force low confidence
		if !g.Visible {
			g.Confidence = ConfidenceLow
			g.Degraded = false // hidden supersedes degraded
		}
		gates = append(gates, g)
	}
	return gates
}

// GateFor returns the gate for a metric, or a safe default (hidden low) if missing.
func GateFor(res DataQualityResult, metric string) MetricGate {
	for _, g := range res.Gates {
		if g.Metric == metric {
			return g
		}
	}
	return MetricGate{Metric: metric, Visible: false, Confidence: ConfidenceLow, Reasons: []string{"unknown_metric"}}
}

// ToDataSufficiency maps overall result into the existing DTO-shaped fields
// used by dashboard/forecast/allocation (without importing dto).
func (r DataQualityResult) SufficiencyFields() (isSufficient bool, missing []string, confidence string) {
	return len(r.MissingInputs) == 0 && r.OverallConfidence != ConfidenceLow,
		append([]string{}, r.MissingInputs...),
		r.OverallConfidence
}

func severityRank(s string) int {
	switch s {
	case SeverityCritical:
		return 0
	case SeverityWarning:
		return 1
	default:
		return 2
	}
}

func containsStrSlice(ss []string, t string) bool {
	for _, s := range ss {
		if s == t {
			return true
		}
	}
	return false
}

func uniqueStrings(ss []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(ss))
	for _, s := range ss {
		if s == "" {
			continue
		}
		if _, ok := seen[s]; ok {
			continue
		}
		seen[s] = struct{}{}
		out = append(out, s)
	}
	return out
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
