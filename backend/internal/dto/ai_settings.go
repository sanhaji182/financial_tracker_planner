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
	AIProvider                string `json:"ai_provider" binding:"required,oneof=openai anthropic gemini local"`
	AIModel                   string `json:"ai_model" binding:"required"`
	OCREscalationEnabled      bool   `json:"ocr_escalation_enabled"`
	AutoCategorizationEnabled bool   `json:"auto_categorization_enabled"`
	AdvisorEnabled            bool   `json:"advisor_enabled"`
	AnomalyDetectionEnabled   bool   `json:"anomaly_detection_enabled"`
	APIKey                    string `json:"api_key"` // Optional
}

type AIChatTurn struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type AIChatAttachment struct {
	Name       string `json:"name"`
	MimeType   string `json:"mime_type"`
	DataBase64 string `json:"data_base64"`
}

type AIChatRequest struct {
	Message     string                 `json:"message"`
	History     []AIChatTurn           `json:"history,omitempty"`
	Attachments []AIChatAttachment     `json:"attachments,omitempty"`
	Preferences map[string]interface{} `json:"preferences,omitempty"`
}

type VoiceTranscribeResponse struct {
	Transcript            string             `json:"transcript"`
	Provider              string             `json:"provider"`
	NeedsManualTranscript bool               `json:"needs_manual_transcript"`
	ParsedAmount          float64            `json:"parsed_amount"`
	ProposedActions       []AgenticActionDTO `json:"proposed_actions,omitempty"`
}

type AgenticActionDTO struct {
	ID      string                 `json:"id"`
	Type    string                 `json:"type"`
	Title   string                 `json:"title"`
	Summary string                 `json:"summary"`
	Payload map[string]interface{} `json:"payload"`
}

type AIChatResponse struct {
	Response         string             `json:"response"`
	Reason           string             `json:"reason"`
	ProposedActions  []AgenticActionDTO `json:"proposed_actions,omitempty"`
	SuggestedReplies []string           `json:"suggested_replies,omitempty"`
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
