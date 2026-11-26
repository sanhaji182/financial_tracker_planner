package dto

import "time"

// AIChatMessageRecord represents a persisted cross-device chat turn with AI Advisor.
type AIChatMessageRecord struct {
	ID               string                 `json:"id"`
	ClientMessageID  string                 `json:"client_message_id,omitempty"`
	Role             string                 `json:"role"`
	Content          string                 `json:"content"`
	Actions          []AgenticActionDTO     `json:"actions,omitempty"`
	SuggestedReplies []string               `json:"suggested_replies,omitempty"`
	ImagePreview     string                 `json:"image_preview,omitempty"`
	AttachmentsMeta  []map[string]string    `json:"attachments_meta,omitempty"`
	CreatedAt        time.Time              `json:"created_at"`
	UpdatedAt        time.Time              `json:"updated_at"`
}

// AILearnedRuleDTO stores a user-taught preference mapping (merchant/keyword -> category/account).
type AILearnedRuleDTO struct {
	ID           string `json:"id"`
	Keyword      string `json:"keyword"`
	CategoryName string `json:"category_name,omitempty"`
	AccountName  string `json:"account_name,omitempty"`
	Type         string `json:"type,omitempty"`
	UseCount     int    `json:"use_count"`
	UpdatedAt    string `json:"updated_at"`
}

// AIAdvisorMemoryDTO captures durable learned memory synchronized across user devices.
type AIAdvisorMemoryDTO struct {
	LearnedRules            []AILearnedRuleDTO `json:"learned_rules"`
	CustomNotes             []string           `json:"custom_notes"`
	PreferredPaymentAccount string             `json:"preferred_payment_account"`
	UpdatedAt               string             `json:"updated_at"`
}

// AIDailyBriefingDTO represents a generated proactive daily advisor briefing & delivery status.
type AIDailyBriefingDTO struct {
	ID               string    `json:"id"`
	OwnerID          string    `json:"owner_id"`
	BriefingDate     string    `json:"briefing_date"`
	Severity         string    `json:"severity"`
	Title            string    `json:"title"`
	Summary          string    `json:"summary"`
	Highlights       []string  `json:"highlights"`
	NotifiedEmail    bool      `json:"notified_email"`
	NotifiedTelegram bool      `json:"notified_telegram"`
	CreatedAt        time.Time `json:"created_at"`
}

// AIChatHistoryResponse wraps persisted chat history and memory in one payload for device hydration.
type AIChatHistoryResponse struct {
	Messages []AIChatMessageRecord `json:"messages"`
	Memory   AIAdvisorMemoryDTO    `json:"memory"`
}
