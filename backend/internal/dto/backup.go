package dto

// BackupResponse is one encrypted backup artifact + DR metadata.
type BackupResponse struct {
	FileName  string `json:"file_name"`
	Size      int64  `json:"size"`
	CreatedAt string `json:"created_at"`
	// DR / integrity (backup-v1)
	PayloadSHA256 string `json:"payload_sha256,omitempty"`
	PlainSHA256   string `json:"plain_sha256,omitempty"`
	SchemaHint    string `json:"schema_hint,omitempty"`
	RPO           string `json:"rpo,omitempty"`
	RTO           string `json:"rto,omitempty"`
	RetentionDays int    `json:"retention_days,omitempty"`
	Verified      bool   `json:"verified"`
	VerifiedAt    string `json:"verified_at,omitempty"`
	VerifyTarget  string `json:"verify_target,omitempty"`
	ManifestFile  string `json:"manifest_file,omitempty"`
	Version       string `json:"version,omitempty"`
}

// BackupVerifyRequest triggers isolated restore rehearsal.
type BackupVerifyRequest struct {
	FileName     string `json:"file_name" binding:"required"`
	TargetDBName string `json:"target_db_name"` // default: <db>_restore_test
}
