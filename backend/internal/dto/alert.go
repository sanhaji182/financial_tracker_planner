package dto

import "time"

// AlertResponse adalah representasi alert yang dikembalikan API
type AlertResponse struct {
	ID          string     `json:"id"`
	Type        string     `json:"type"`
	Severity    string     `json:"severity"` // info, warning, danger
	Title       string     `json:"title"`
	Message     string     `json:"message"`
	ActionURL   string     `json:"action_url,omitempty"`
	ActionLabel string     `json:"action_label,omitempty"`
	EntityType  string     `json:"entity_type,omitempty"`
	EntityID    string     `json:"entity_id,omitempty"`
	IsRead      bool       `json:"is_read"`
	IsDismissed bool       `json:"is_dismissed"`
	ExpiresAt   *time.Time `json:"expires_at,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
	TimeAgo     string     `json:"time_ago"`
}

// AlertListResponse adalah halaman paginated alert
type AlertListResponse struct {
	Alerts      []AlertResponse `json:"alerts"`
	TotalCount  int             `json:"total_count"`
	UnreadCount int             `json:"unread_count"`
}

// AlertUnreadCountResponse
type AlertUnreadCountResponse struct {
	UnreadCount int `json:"unread_count"`
}
