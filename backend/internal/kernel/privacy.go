package kernel

import (
	"fmt"
	"regexp"
	"strings"
	"time"
)

// PrivacyFormulaVersion versions retention + redaction policy helpers.
const PrivacyFormulaVersion = "privacy-v1"

// Default retention windows (days). Operational policy — not legal advice.
const (
	PrivacyRetentionTxDays       = 365 * 7 // 7 years bookkeeping-friendly default
	PrivacyRetentionAuditDays    = 365 * 2
	PrivacyRetentionInsightDays  = 365
	PrivacyRetentionAIPromptDays = 90
	PrivacyRetentionSessionDays  = 30
)

// PrivacyPolicyInputs is optional context for policy document generation.
type PrivacyPolicyInputs struct {
	AsOf              time.Time
	AIConsentGranted  bool
	LastExportAt      *time.Time
	HouseholdUserIDs  []string
}

// RetentionRule describes one data class retention window.
type RetentionRule struct {
	DataClass      string `json:"data_class"`
	RetentionDays  int    `json:"retention_days"`
	Rationale      string `json:"rationale"`
	UserDeletable  bool   `json:"user_deletable"`
}

// PrivacyPolicyResult is the household privacy control surface (pure).
type PrivacyPolicyResult struct {
	AsOf              time.Time       `json:"as_of"`
	FormulaVersion    string          `json:"formula_version"`
	RetentionRules    []RetentionRule `json:"retention_rules"`
	AIConsentGranted  bool            `json:"ai_consent_granted"`
	AIConsentRequired bool            `json:"ai_consent_required"`
	ExportAvailable   bool            `json:"export_available"`
	DeleteAvailable   bool            `json:"delete_available"`
	RedactionEnabled  bool            `json:"redaction_enabled"`
	Rights            []string        `json:"rights"`
	Assumptions       []string        `json:"assumptions"`
	Disclaimer        string          `json:"disclaimer"`
}

// ComputePrivacyPolicy returns retention + control metadata.
func ComputePrivacyPolicy(in PrivacyPolicyInputs) PrivacyPolicyResult {
	asOf := in.AsOf
	if asOf.IsZero() {
		asOf = time.Now().UTC()
	}
	rules := []RetentionRule{
		{"transactions", PrivacyRetentionTxDays, "Catatan keuangan jangka panjang untuk rekonsiliasi & pajak pribadi (default edukatif).", true},
		{"audit_logs", PrivacyRetentionAuditDays, "Jejak aksi keamanan/operasional.", false},
		{"insights_ai_outputs", PrivacyRetentionInsightDays, "Output insight/AI yang dapat digenerate ulang.", true},
		{"ai_prompt_traces", PrivacyRetentionAIPromptDays, "Prompt/context yang dikirim ke provider AI (jika pernah).", true},
		{"sessions_tokens", PrivacyRetentionSessionDays, "Sesi login & refresh token.", true},
	}
	return PrivacyPolicyResult{
		AsOf:              asOf.UTC(),
		FormulaVersion:    PrivacyFormulaVersion,
		RetentionRules:    rules,
		AIConsentGranted:  in.AIConsentGranted,
		AIConsentRequired: true,
		ExportAvailable:   true,
		DeleteAvailable:   true,
		RedactionEnabled:  true,
		Rights: []string{
			"Unduh salinan data rumah tangga (export JSON/CSV).",
			"Minta hapus data rumah tangga (soft-delete + purge terjadwal).",
			"Cabut consent AI kapan saja — context tidak dikirim tanpa consent.",
			"Redaksi PII otomatis sebelum context AI (nama, email, rekening, telepon).",
		},
		Assumptions: []string{
			"Retensi default adalah kebijakan produk edukatif, bukan nasihat hukum.",
			"Delete household menonaktifkan akun & menandai data untuk purge; backup terenkripsi terpisah mengikuti RPO/RTO.",
			"Export mencakup transaksi, akun, utang, goals, langganan — tanpa secret vault/API key plaintext.",
		},
		Disclaimer: "Kontrol privasi produk ini membantu transparansi. Untuk kewajiban hukum spesifik yurisdiksi, konsultasikan penasihat hukum.",
	}
}

// Redaction patterns for AI context scrubbing.
var (
	reEmail   = regexp.MustCompile(`(?i)[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}`)
	rePhoneID = regexp.MustCompile(`(?i)(\+62|62|0)8[1-9][0-9]{6,11}`)
	reAccount = regexp.MustCompile(`\b\d{10,16}\b`)
	reCCLike  = regexp.MustCompile(`\b(?:\d[ -]*?){13,19}\b`)
	reAPIKey  = regexp.MustCompile(`(?i)\b(sk-[a-z0-9]{10,}|ghp_[a-z0-9]{20,}|xox[baprs]-[a-z0-9-]{10,})\b`)
)

// RedactionResult is the outcome of scrubbing text for AI providers.
type RedactionResult struct {
	OriginalLen    int      `json:"original_len"`
	RedactedText   string   `json:"redacted_text"`
	RedactedCount  int      `json:"redacted_count"`
	Categories     []string `json:"categories"`
	FormulaVersion string   `json:"formula_version"`
	SafeForAI      bool     `json:"safe_for_ai"`
	BlockedReason  string   `json:"blocked_reason,omitempty"`
}

// RedactForAI strips common PII/secrets from text before provider send.
// If consent is false, returns blocked empty payload.
func RedactForAI(text string, consentGranted bool) RedactionResult {
	if !consentGranted {
		return RedactionResult{
			OriginalLen:    len(text),
			RedactedText:   "",
			RedactedCount:  0,
			Categories:     nil,
			FormulaVersion: PrivacyFormulaVersion,
			SafeForAI:      false,
			BlockedReason:  "ai_consent_required",
		}
	}
	out := text
	count := 0
	var cats []string
	mark := func(cat string, re *regexp.Regexp, repl string) {
		if re.MatchString(out) {
			n := len(re.FindAllStringIndex(out, -1))
			count += n
			out = re.ReplaceAllString(out, repl)
			cats = appendUnique(cats, cat)
		}
	}
	mark("api_key", reAPIKey, "[REDACTED_SECRET]")
	mark("email", reEmail, "[REDACTED_EMAIL]")
	mark("phone", rePhoneID, "[REDACTED_PHONE]")
	mark("account_number", reAccount, "[REDACTED_ACCOUNT]")
	mark("card_like", reCCLike, "[REDACTED_CARD]")

	// Collapse obvious name labels (heuristic)
	nameRe := regexp.MustCompile(`(?i)\b(nama|name)\s*[:=]\s*[A-Za-zÀ-ÿ' .\-]{2,60}`)
	if nameRe.MatchString(out) {
		count += len(nameRe.FindAllStringIndex(out, -1))
		out = nameRe.ReplaceAllString(out, "$1: [REDACTED_NAME]")
		cats = appendUnique(cats, "name_label")
	}

	return RedactionResult{
		OriginalLen:    len(text),
		RedactedText:   out,
		RedactedCount:  count,
		Categories:     cats,
		FormulaVersion: PrivacyFormulaVersion,
		SafeForAI:      true,
	}
}

// BuildHouseholdExportManifest lists sections included in a privacy export.
func BuildHouseholdExportManifest(asOf time.Time) map[string]any {
	if asOf.IsZero() {
		asOf = time.Now().UTC()
	}
	return map[string]any{
		"as_of":            asOf.UTC().Format(time.RFC3339),
		"formula_version":  PrivacyFormulaVersion,
		"format":           "json_bundle_v1",
		"includes": []string{
			"profile", "accounts", "transactions", "categories", "debts", "assets",
			"bills", "budgets", "goals", "subscriptions", "insights_metadata",
		},
		"excludes": []string{
			"vault_secrets_plaintext", "ai_api_keys", "session_tokens", "password_hashes",
		},
		"note": "Generated for user download — treat as sensitive household data.",
	}
}

// DeleteHouseholdPlan describes the staged delete sequence (pure plan, no I/O).
func DeleteHouseholdPlan(ownerID string, asOf time.Time) map[string]any {
	if asOf.IsZero() {
		asOf = time.Now().UTC()
	}
	return map[string]any{
		"as_of":           asOf.UTC().Format(time.RFC3339),
		"formula_version": PrivacyFormulaVersion,
		"owner_id":        ownerID,
		"stages": []map[string]string{
			{"stage": "1_confirm", "action": "require_owner_password_and_typed_phrase"},
			{"stage": "2_export_optional", "action": "offer_last_export_before_delete"},
			{"stage": "3_soft_disable", "action": "deactivate_users_revoke_sessions"},
			{"stage": "4_mark_purge", "action": "flag_rows_for_purge_job"},
			{"stage": "5_purge_job", "action": "async_purge_after_grace_period"},
		},
		"grace_days": 14,
		"irreversible_after_purge": true,
		"disclaimer":              "Soft-delete is reversible within grace; purge is permanent.",
	}
}

func appendUnique(xs []string, v string) []string {
	for _, x := range xs {
		if x == v {
			return xs
		}
	}
	return append(xs, v)
}

// ValidateDeleteConfirmation checks the typed phrase for household delete.
func ValidateDeleteConfirmation(phrase string) error {
	norm := strings.TrimSpace(strings.ToUpper(phrase))
	if norm != "HAPUS DATA SAYA" && norm != "DELETE MY DATA" {
		return fmt.Errorf("confirmation phrase mismatch: type HAPUS DATA SAYA")
	}
	return nil
}
