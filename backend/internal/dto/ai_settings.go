package dto

import "github.com/user/financial-os/internal/model"

type AISettingsResponse struct {
	AIEnabled                 bool   `json:"ai_enabled"`
	AIProvider                string `json:"ai_provider"`
	AIModel                   string `json:"ai_model"`
	OCREscalationEnabled      bool   `json:"ocr_escalation_enabled"`
	AutoCategorizationEnabled bool   `json:"auto_categorization_enabled"`
	AdvisorEnabled            bool   `json:"advisor_enabled"`
	AnomalyDetectionEnabled   bool   `json:"anomaly_detection_enabled"`
	HasAPIKey                 bool   `json:"has_api_key"`
}

type UpdateAISettingsRequest struct {
	AIEnabled                 bool   `json:"ai_enabled"`
	AIProvider                string `json:"ai_provider" binding:"required,oneof=openai anthropic local"`
	AIModel                   string `json:"ai_model" binding:"required"`
	OCREscalationEnabled      bool   `json:"ocr_escalation_enabled"`
	AutoCategorizationEnabled bool   `json:"auto_categorization_enabled"`
	AdvisorEnabled            bool   `json:"advisor_enabled"`
	AnomalyDetectionEnabled   bool   `json:"anomaly_detection_enabled"`
	APIKey                    string `json:"api_key"` // Optional
}

type AIChatRequest struct {
	Message string `json:"message" binding:"required"`
}

type AIChatResponse struct {
	Response string `json:"response"`
	Reason   string `json:"reason"`
}

type AnomalyCheckResponse struct {
	AnomaliesCount int      `json:"anomalies_count"`
	AlertsCreated  []string `json:"alerts_created"`
}

func ToAISettingsResponse(s *model.AISettings, hasKey bool) AISettingsResponse {
	return AISettingsResponse{
		AIEnabled:                 s.AIEnabled,
		AIProvider:                s.AIProvider,
		AIModel:                   s.AIModel,
		OCREscalationEnabled:      s.OCREscalationEnabled,
		AutoCategorizationEnabled: s.AutoCategorizationEnabled,
		AdvisorEnabled:            s.AdvisorEnabled,
		AnomalyDetectionEnabled:   s.AnomalyDetectionEnabled,
		HasAPIKey:                 hasKey,
	}
}
