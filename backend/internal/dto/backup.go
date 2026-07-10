package dto

type BackupResponse struct {
	FileName  string `json:"file_name"`
	Size      int64  `json:"size"`
	CreatedAt string `json:"created_at"`
}
