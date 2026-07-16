package kernel

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"time"
)

// JobLockVersion versions distributed job lock semantics.
const JobLockVersion = "jobs-v1"

// Job names used by the API process.
const (
	JobBillsOverdue     = "bills_auto_overdue"
	JobAlertGenerate    = "alert_generate"
	JobTasksOverdue     = "tasks_auto_overdue"
	JobAutomationRules  = "automation_rules"
	JobForecastRefresh  = "forecast_refresh"
	JobBackupCreate     = "backup_create"
)

// JobLockRequest is what a replica presents to acquire work.
type JobLockRequest struct {
	JobName    string
	OwnerID    string // replica/instance id
	Now        time.Time
	TTL        time.Duration // lock validity
	IdempotencyKey string    // optional stable key for this tick
}

// JobLockState is stored in Redis (or memory for tests).
type JobLockState struct {
	JobName        string    `json:"job_name"`
	OwnerID        string    `json:"owner_id"`
	AcquiredAt     time.Time `json:"acquired_at"`
	ExpiresAt      time.Time `json:"expires_at"`
	IdempotencyKey string    `json:"idempotency_key,omitempty"`
	RunCount       int       `json:"run_count"`
}

// JobLockDecision is pure acquire result given current state (may be nil = free).
type JobLockDecision struct {
	Acquired bool
	Reason   string // acquired | held_by_other | idempotent_skip | invalid
	NewState *JobLockState
}

// TryAcquireJobLock is a pure function: given existing state (or nil), decide acquire.
// Caller persists NewState only when Acquired.
func TryAcquireJobLock(existing *JobLockState, req JobLockRequest) JobLockDecision {
	if req.JobName == "" || req.OwnerID == "" {
		return JobLockDecision{Acquired: false, Reason: "invalid"}
	}
	if req.TTL <= 0 {
		req.TTL = 5 * time.Minute
	}
	if req.Now.IsZero() {
		req.Now = time.Now().UTC()
	}
	now := req.Now.UTC()

	if existing != nil {
		// Idempotent: same key already ran and lock still valid or completed recently
		if req.IdempotencyKey != "" && existing.IdempotencyKey == req.IdempotencyKey && existing.OwnerID == req.OwnerID {
			return JobLockDecision{Acquired: false, Reason: "idempotent_skip", NewState: existing}
		}
		if existing.ExpiresAt.After(now) && existing.OwnerID != req.OwnerID {
			return JobLockDecision{Acquired: false, Reason: "held_by_other", NewState: existing}
		}
		// Same owner renewing is ok
	}

	st := &JobLockState{
		JobName:        req.JobName,
		OwnerID:        req.OwnerID,
		AcquiredAt:     now,
		ExpiresAt:      now.Add(req.TTL),
		IdempotencyKey: req.IdempotencyKey,
		RunCount:       1,
	}
	if existing != nil {
		st.RunCount = existing.RunCount + 1
	}
	return JobLockDecision{Acquired: true, Reason: "acquired", NewState: st}
}

// JobRunRecord is an audit-safe (no PII) structured log line for job outcomes.
type JobRunRecord struct {
	TS             time.Time `json:"ts"`
	JobName        string    `json:"job_name"`
	OwnerID        string    `json:"owner_id"`
	Outcome        string    `json:"outcome"` // success | failure | skipped_lock | skipped_idempotent
	DurationMS     int64     `json:"duration_ms"`
	ErrorClass     string    `json:"error_class,omitempty"` // no raw secrets/PII
	IdempotencyKey string    `json:"idempotency_key,omitempty"`
	Attempt        int       `json:"attempt"`
	FormulaVersion string    `json:"formula_version"`
}

// RetryPolicy simple exponential backoff parameters.
type RetryPolicy struct {
	MaxAttempts int
	BaseDelay   time.Duration
	MaxDelay    time.Duration
}

// DefaultJobRetry is used by background runners.
func DefaultJobRetry() RetryPolicy {
	return RetryPolicy{MaxAttempts: 3, BaseDelay: time.Second, MaxDelay: 30 * time.Second}
}

// NextRetryDelay returns delay for 1-based attempt, or 0 if no more retries.
func NextRetryDelay(p RetryPolicy, attempt int) time.Duration {
	if attempt < 1 || attempt >= p.MaxAttempts {
		return 0
	}
	d := p.BaseDelay * time.Duration(1<<uint(attempt-1))
	if d > p.MaxDelay {
		d = p.MaxDelay
	}
	return d
}

// ---- Backup integrity (backup-v1) ----

const BackupMetaVersion = "backup-v1"

// Default RPO/RTO targets (documented; ops may override).
const (
	BackupRPO = 24 * time.Hour // daily backup acceptable
	BackupRTO = 4 * time.Hour  // restore within 4h target
	BackupRetentionDays = 30
)

// BackupManifest is stored alongside encrypted payload (JSON, not secret).
type BackupManifest struct {
	Version        string    `json:"version"`
	FileName       string    `json:"file_name"`
	CreatedAt      time.Time `json:"created_at"`
	PayloadSHA256  string    `json:"payload_sha256"` // sha256 of ciphertext
	PlainSHA256    string    `json:"plain_sha256"`   // sha256 of decrypted dump (for restore verify)
	SizeBytes      int64     `json:"size_bytes"`
	SchemaHint     string    `json:"schema_hint,omitempty"` // e.g. migrate version
	RPO            string    `json:"rpo"`
	RTO            string    `json:"rto"`
	RetentionDays  int       `json:"retention_days"`
	Verified       bool      `json:"verified"` // true only after restore rehearsal success
	VerifiedAt     *time.Time `json:"verified_at,omitempty"`
	VerifyTarget   string    `json:"verify_target,omitempty"` // e.g. isolated db name
}

// SHA256Hex of data.
func SHA256Hex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

// BuildBackupManifest constructs metadata after encrypt.
func BuildBackupManifest(fileName string, ciphertext, plaintext []byte, schemaHint string, now time.Time) BackupManifest {
	if now.IsZero() {
		now = time.Now().UTC()
	}
	return BackupManifest{
		Version:       BackupMetaVersion,
		FileName:      fileName,
		CreatedAt:     now.UTC(),
		PayloadSHA256: SHA256Hex(ciphertext),
		PlainSHA256:   SHA256Hex(plaintext),
		SizeBytes:     int64(len(ciphertext)),
		SchemaHint:    schemaHint,
		RPO:           BackupRPO.String(),
		RTO:           BackupRTO.String(),
		RetentionDays: BackupRetentionDays,
		Verified:      false,
	}
}

// VerifyBackupChecksums checks ciphertext and optional plaintext hashes.
func VerifyBackupChecksums(m BackupManifest, ciphertext, plaintext []byte) error {
	if m.PayloadSHA256 != "" && SHA256Hex(ciphertext) != m.PayloadSHA256 {
		return fmt.Errorf("ciphertext checksum mismatch")
	}
	if plaintext != nil && m.PlainSHA256 != "" && SHA256Hex(plaintext) != m.PlainSHA256 {
		return fmt.Errorf("plaintext checksum mismatch")
	}
	return nil
}

// MarkBackupVerified returns a copy flagged after successful isolated restore.
func MarkBackupVerified(m BackupManifest, target string, at time.Time) BackupManifest {
	if at.IsZero() {
		at = time.Now().UTC()
	}
	m.Verified = true
	m.VerifiedAt = &at
	m.VerifyTarget = target
	return m
}

// SelectBackupsForRetention keeps newest keepN and those within retention window.
func SelectBackupsForRetention(manifests []BackupManifest, now time.Time, keepMin int) (keep, purge []BackupManifest) {
	if now.IsZero() {
		now = time.Now().UTC()
	}
	if keepMin < 1 {
		keepMin = 3
	}
	sorted := append([]BackupManifest(nil), manifests...)
	sort.Slice(sorted, func(i, j int) bool {
		return sorted[i].CreatedAt.After(sorted[j].CreatedAt)
	})
	cutoff := now.AddDate(0, 0, -BackupRetentionDays)
	for i, m := range sorted {
		if i < keepMin || m.CreatedAt.After(cutoff) || m.Verified {
			// always keep verified restore-proof samples a bit longer — still within list
			keep = append(keep, m)
		} else {
			purge = append(purge, m)
		}
	}
	return keep, purge
}

// ManifestJSON stable serialization for side-car files.
func ManifestJSON(m BackupManifest) ([]byte, error) {
	return json.MarshalIndent(m, "", "  ")
}
