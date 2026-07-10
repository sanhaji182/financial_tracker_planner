package service

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/user/financial-os/internal/dto"
)

type AlertService interface {
	GetAlerts(ctx context.Context, userID string, severity, alertType string, unreadOnly bool) (*dto.AlertListResponse, error)
	GetUnreadCount(ctx context.Context, userID string) (int, error)
	MarkAsRead(ctx context.Context, userID, alertID string) error
	MarkAllAsRead(ctx context.Context, userID string) error
	DismissAlert(ctx context.Context, userID, alertID string) error
}

type alertService struct {
	dbPool *pgxpool.Pool
}

func NewAlertService(dbPool *pgxpool.Pool) AlertService {
	return &alertService{dbPool: dbPool}
}

func (s *alertService) resolveOwnerID(ctx context.Context, userID string) (string, error) {
	var role string
	var invitedBy *string
	err := s.dbPool.QueryRow(ctx, `
		SELECT role, invited_by FROM users WHERE id = $1 AND is_active = true
	`, userID).Scan(&role, &invitedBy)
	if err != nil {
		return "", err
	}
	if role == "spouse_viewer" && invitedBy != nil && *invitedBy != "" {
		return *invitedBy, nil
	}
	return userID, nil
}

func (s *alertService) GetAlerts(ctx context.Context, userID string, severity, alertType string, unreadOnly bool) (*dto.AlertListResponse, error) {
	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	query := `
		SELECT id, type, severity, title, message,
		       COALESCE(action_url, ''), COALESCE(action_label, ''),
		       COALESCE(entity_type, ''), COALESCE(entity_id::text, ''),
		       is_read, is_dismissed, expires_at, created_at
		FROM alerts
		WHERE user_id = $1 AND is_dismissed = false
	`
	args := []interface{}{ownerID}
	argIdx := 2

	if severity != "" {
		query += fmt.Sprintf(" AND severity = $%d", argIdx)
		args = append(args, severity)
		argIdx++
	}
	if alertType != "" {
		query += fmt.Sprintf(" AND type = $%d", argIdx)
		args = append(args, alertType)
		argIdx++
	}
	if unreadOnly {
		query += " AND is_read = false"
	}

	query += " ORDER BY CASE severity WHEN 'danger' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END, created_at DESC LIMIT 100"

	rows, err := s.dbPool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	alerts := make([]dto.AlertResponse, 0)
	for rows.Next() {
		var a dto.AlertResponse
		var expiresAt *time.Time
		err = rows.Scan(
			&a.ID, &a.Type, &a.Severity, &a.Title, &a.Message,
			&a.ActionURL, &a.ActionLabel,
			&a.EntityType, &a.EntityID,
			&a.IsRead, &a.IsDismissed, &expiresAt, &a.CreatedAt,
		)
		if err == nil {
			a.ExpiresAt = expiresAt
			a.TimeAgo = timeAgo(a.CreatedAt)
			alerts = append(alerts, a)
		}
	}

	// Unread count
	var unreadCount int
	_ = s.dbPool.QueryRow(ctx, `
		SELECT COUNT(*) FROM alerts WHERE user_id = $1 AND is_read = false AND is_dismissed = false
	`, ownerID).Scan(&unreadCount)

	return &dto.AlertListResponse{
		Alerts:      alerts,
		TotalCount:  len(alerts),
		UnreadCount: unreadCount,
	}, nil
}

func (s *alertService) GetUnreadCount(ctx context.Context, userID string) (int, error) {
	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	var count int
	err = s.dbPool.QueryRow(ctx, `
		SELECT COUNT(*) FROM alerts WHERE user_id = $1 AND is_read = false AND is_dismissed = false
	`, ownerID).Scan(&count)
	return count, err
}

func (s *alertService) MarkAsRead(ctx context.Context, userID, alertID string) error {
	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	_, err = s.dbPool.Exec(ctx, `
		UPDATE alerts SET is_read = true WHERE id = $1 AND user_id = $2
	`, alertID, ownerID)
	return err
}

func (s *alertService) MarkAllAsRead(ctx context.Context, userID string) error {
	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	_, err = s.dbPool.Exec(ctx, `
		UPDATE alerts SET is_read = true WHERE user_id = $1 AND is_dismissed = false
	`, ownerID)
	return err
}

func (s *alertService) DismissAlert(ctx context.Context, userID, alertID string) error {
	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	_, err = s.dbPool.Exec(ctx, `
		UPDATE alerts SET is_dismissed = true, is_read = true WHERE id = $1 AND user_id = $2
	`, alertID, ownerID)
	return err
}

// timeAgo returns human-readable time difference
func timeAgo(t time.Time) string {
	d := time.Since(t)
	switch {
	case d < time.Minute:
		return "baru saja"
	case d < time.Hour:
		return fmt.Sprintf("%d menit yang lalu", int(d.Minutes()))
	case d < 24*time.Hour:
		return fmt.Sprintf("%d jam yang lalu", int(d.Hours()))
	case d < 7*24*time.Hour:
		return fmt.Sprintf("%d hari yang lalu", int(d.Hours()/24))
	default:
		return t.Format("02 Jan 2006")
	}
}
