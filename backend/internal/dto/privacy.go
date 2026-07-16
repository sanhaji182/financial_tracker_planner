package dto

// Privacy DTOs (privacy-v1)

type RetentionRuleDTO struct {
	DataClass     string `json:"data_class"`
	RetentionDays int    `json:"retention_days"`
	Rationale     string `json:"rationale"`
	UserDeletable bool   `json:"user_deletable"`
}

type PrivacyPolicyResponse struct {
	AsOf              string             `json:"as_of"`
	FormulaVersion    string             `json:"formula_version"`
	RetentionRules    []RetentionRuleDTO `json:"retention_rules"`
	AIConsentGranted  bool               `json:"ai_consent_granted"`
	AIConsentRequired bool               `json:"ai_consent_required"`
	ExportAvailable   bool               `json:"export_available"`
	DeleteAvailable   bool               `json:"delete_available"`
	RedactionEnabled  bool               `json:"redaction_enabled"`
	Rights            []string           `json:"rights"`
	Assumptions       []string           `json:"assumptions"`
	Disclaimer        string             `json:"disclaimer"`
}

type UpdateAIConsentRequest struct {
	Granted bool `json:"granted"`
}

type RedactRequest struct {
	Text string `json:"text" binding:"required"`
}

type RedactResponse struct {
	OriginalLen    int      `json:"original_len"`
	RedactedText   string   `json:"redacted_text"`
	RedactedCount  int      `json:"redacted_count"`
	Categories     []string `json:"categories"`
	FormulaVersion string   `json:"formula_version"`
	SafeForAI      bool     `json:"safe_for_ai"`
	BlockedReason  string   `json:"blocked_reason,omitempty"`
}

type DeleteHouseholdRequest struct {
	ConfirmationPhrase string `json:"confirmation_phrase" binding:"required"`
	Password           string `json:"password"` // optional extra gate; validated if provided by service
}
