package kernel

import (
	"strings"
	"testing"
	"time"
)

func TestComputePrivacyPolicy(t *testing.T) {
	res := ComputePrivacyPolicy(PrivacyPolicyInputs{
		AsOf:             time.Date(2026, 7, 16, 0, 0, 0, 0, time.UTC),
		AIConsentGranted: false,
	})
	if res.FormulaVersion != PrivacyFormulaVersion {
		t.Fatalf("version %s", res.FormulaVersion)
	}
	if !res.AIConsentRequired {
		t.Fatal("AI consent must be required")
	}
	if !res.ExportAvailable || !res.DeleteAvailable || !res.RedactionEnabled {
		t.Fatal("export/delete/redaction must be available")
	}
	if len(res.RetentionRules) < 3 {
		t.Fatalf("rules=%d", len(res.RetentionRules))
	}
}

func TestRedactForAIBlocksWithoutConsent(t *testing.T) {
	r := RedactForAI("email me at a@b.com", false)
	if r.SafeForAI {
		t.Fatal("must block without consent")
	}
	if r.BlockedReason != "ai_consent_required" {
		t.Fatalf("reason=%s", r.BlockedReason)
	}
	if r.RedactedText != "" {
		t.Fatal("text must be empty when blocked")
	}
}

func TestRedactForAIScrubsPII(t *testing.T) {
	in := "Hubungi nama: Budi Santoso email test.user@example.com tel +6281212345678 rek 1234567890123 key sk-abc1234567890xyz"
	r := RedactForAI(in, true)
	if !r.SafeForAI {
		t.Fatal("should be safe with consent")
	}
	if r.RedactedCount == 0 {
		t.Fatal("expected redactions")
	}
	if strings.Contains(r.RedactedText, "test.user@example.com") {
		t.Fatalf("email not redacted: %s", r.RedactedText)
	}
	if strings.Contains(r.RedactedText, "81212345678") {
		t.Fatalf("phone not redacted: %s", r.RedactedText)
	}
	if strings.Contains(r.RedactedText, "sk-abc") {
		t.Fatalf("api key not redacted: %s", r.RedactedText)
	}
	if !strings.Contains(r.RedactedText, "[REDACTED_EMAIL]") {
		t.Fatalf("missing email marker: %s", r.RedactedText)
	}
}

func TestValidateDeleteConfirmation(t *testing.T) {
	if err := ValidateDeleteConfirmation("hapus data saya"); err != nil {
		t.Fatal(err)
	}
	if err := ValidateDeleteConfirmation("DELETE MY DATA"); err != nil {
		t.Fatal(err)
	}
	if err := ValidateDeleteConfirmation("yes"); err == nil {
		t.Fatal("expected error")
	}
}

func TestExportManifestExcludesSecrets(t *testing.T) {
	m := BuildHouseholdExportManifest(time.Time{})
	ex := m["excludes"].([]string)
	joined := strings.Join(ex, ",")
	if !strings.Contains(joined, "ai_api_keys") {
		t.Fatalf("excludes=%v", ex)
	}
}
