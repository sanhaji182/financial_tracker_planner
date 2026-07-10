package dto

import "time"

type DocumentResponse struct {
	ID                 string     `json:"id"`
	UserID             string     `json:"user_id"`
	FileName           string     `json:"file_name"`
	FilePath           string     `json:"file_path"`
	FileURL            string     `json:"file_url"`
	FileType           string     `json:"file_type"`
	FileSize           int        `json:"file_size"`
	LinkedEntityType   string     `json:"linked_entity_type,omitempty"`
	LinkedEntityID     *string    `json:"linked_entity_id,omitempty"`
	Tags               []string   `json:"tags,omitempty"`
	Description        string     `json:"description,omitempty"`
	CreatedAt          time.Time  `json:"created_at"`
	UpdatedAt          time.Time  `json:"updated_at"`
	FormattedCreatedAt string     `json:"formatted_created_at"`
}

type CreateDocumentRequest struct {
	LinkedEntityType string   `json:"linked_entity_type"`
	LinkedEntityID   string   `json:"linked_entity_id"`
	Tags             []string `json:"tags"`
	Description      string   `json:"description"`
}
