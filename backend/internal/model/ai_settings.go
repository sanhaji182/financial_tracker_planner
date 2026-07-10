package model

import "time"

type AISettings struct {
	ID                        string    `json:"id" db:"id"`
	UserID                    string    `json:"user_id" db:"user_id"`
	AIEnabled                 bool      `json:"ai_enabled" db:"ai_enabled"`
	AIProvider                string    `json:"ai_provider" db:"ai_provider"`
	AIModel                   string    `json:"ai_model" db:"ai_model"`
	OCREscalationEnabled      bool      `json:"ocr_escalation_enabled" db:"ocr_escalation_enabled"`
	AutoCategorizationEnabled bool      `json:"auto_categorization_enabled" db:"auto_categorization_enabled"`
	AdvisorEnabled            bool      `json:"advisor_enabled" db:"advisor_enabled"`
	AnomalyDetectionEnabled   bool      `json:"anomaly_detection_enabled" db:"anomaly_detection_enabled"`
	CreatedAt                 time.Time `json:"created_at" db:"created_at"`
	UpdatedAt                 time.Time `json:"updated_at" db:"updated_at"`
}

type VaultReference struct {
	ID               string    `json:"id" db:"id"`
	UserID           string    `json:"user_id" db:"user_id"`
	Name             string    `json:"name" db:"name"`
	VaultItemID      string    `json:"vault_item_id" db:"vault_item_id"`
	Type             string    `json:"type" db:"type"` // "api_key", "password", etc.
	LinkedEntityType *string   `json:"linked_entity_type" db:"linked_entity_type"`
	LinkedEntityID   *string   `json:"linked_entity_id" db:"linked_entity_id"`
	Notes            *string   `json:"notes" db:"notes"`
	CreatedAt        time.Time `json:"created_at" db:"created_at"`
	UpdatedAt        time.Time `json:"updated_at" db:"updated_at"`
}
