package dto

// DataQualityIssue is one actionable data gap (from dq-v1).
type DataQualityIssue struct {
	Code        string   `json:"code"`
	Severity    string   `json:"severity"`
	Title       string   `json:"title"`
	Detail      string   `json:"detail"`
	CTALabel    string   `json:"cta_label,omitempty"`
	CTAURL      string   `json:"cta_url,omitempty"`
	Affects     []string `json:"affects,omitempty"`
	Count       int      `json:"count,omitempty"`
	AccountID   string   `json:"account_id,omitempty"`
	AccountName string   `json:"account_name,omitempty"`
}

// MetricGateDto is the visibility/confidence gate for one decision metric.
type MetricGateDto struct {
	Metric     string   `json:"metric"`
	Visible    bool     `json:"visible"`
	Degraded   bool     `json:"degraded"`
	Confidence string   `json:"confidence"`
	Reasons    []string `json:"reasons,omitempty"`
	Missing    []string `json:"missing,omitempty"`
}

// AccountQualityDto is per-account quality rollup.
type AccountQualityDto struct {
	AccountID   string  `json:"account_id"`
	AccountName string  `json:"account_name"`
	Type        string  `json:"type"`
	Currency    string  `json:"currency"`
	Score       int     `json:"score"`
	Freshness   string  `json:"freshness"`
	Reconciled  bool    `json:"has_recent_reconcile"`
	DaysSinceTx int     `json:"days_since_last_tx"`
	Balance     float64 `json:"balance"`
	FormattedBalance string `json:"formatted_balance,omitempty"`
}

// DataQualityResponse is the Data Quality Center payload.
type DataQualityResponse struct {
	AsOf              string  `json:"as_of"`
	FormulaVersion    string  `json:"formula_version"`
	OverallScore      int     `json:"overall_score"`
	OverallConfidence string  `json:"overall_confidence"`
	Grade             string  `json:"grade"`

	CompletenessScore int `json:"completeness_score"`
	FreshnessScore    int `json:"freshness_score"`
	HygieneScore      int `json:"hygiene_score"`

	ReconciliationRate       float64 `json:"reconciliation_rate"`
	ReconciliationConfidence float64 `json:"reconciliation_confidence"`
	UncategorizedRate        float64 `json:"uncategorized_rate"`

	Issues   []DataQualityIssue  `json:"issues"`
	Accounts []AccountQualityDto `json:"accounts"`
	Gates    []MetricGateDto     `json:"gates"`

	MissingInputs           []string `json:"missing_inputs"`
	DecisionMetricsHidden   []string `json:"decision_metrics_hidden"`
	DecisionMetricsDegraded []string `json:"decision_metrics_degraded"`

	// Compat with existing DataSufficiency consumers.
	DataSufficiency *DataSufficiency `json:"data_sufficiency,omitempty"`
	Assumptions     []string         `json:"assumptions,omitempty"`
}
