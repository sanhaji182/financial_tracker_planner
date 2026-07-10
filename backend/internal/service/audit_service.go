package service

import (
	"context"
	"time"

	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/model"
	"github.com/user/financial-os/internal/repository"
)

type AuditService interface {
	CreateAuditLog(ctx context.Context, userID, entityType, entityID, action string, oldValue, newValue interface{}, ip, ua *string) error
	GetAuditLogs(ctx context.Context, entityType, entityID string) ([]dto.AuditLogResponse, error)
	GetGlobalAuditLogs(ctx context.Context, userID string, entityType string, dateFrom, dateTo *time.Time, targetUserID string) ([]dto.AuditLogResponse, error)
}

type auditService struct {
	txRepo repository.TransactionRepository
}

func NewAuditService(txRepo repository.TransactionRepository) AuditService {
	return &auditService{txRepo: txRepo}
}

func (s *auditService) resolveOwnerID(ctx context.Context, userID string) (string, error) {
	// Query user detail directly using a quick QueryRow via database connection
	// Wait, to keep it clean we can use user_repo or raw db pool. But let's check
	// if we can resolve owner ID using the raw db pool. But auditService only has txRepo.
	// Oh, txRepo internally has DB pool but does not expose it. However, s.GetGlobalAuditLogs
	// can query resolved owner inside the repository!
	// So we don't need resolveOwnerID here. We can delegate ownerID resolution inside GetGlobalAuditLogs!
	return userID, nil
}

func (s *auditService) CreateAuditLog(ctx context.Context, userID, entityType, entityID, action string, oldValue, newValue interface{}, ip, ua *string) error {
	log := &model.AuditLog{
		UserID:     userID,
		EntityType: entityType,
		EntityID:   entityID,
		Action:     action,
		OldValue:   oldValue,
		NewValue:   newValue,
		IPAddress:  ip,
		UserAgent:  ua,
	}
	return s.txRepo.CreateAuditLog(ctx, log)
}

func (s *auditService) GetAuditLogs(ctx context.Context, entityType, entityID string) ([]dto.AuditLogResponse, error) {
	logs, err := s.txRepo.GetAuditLogs(ctx, entityType, entityID)
	if err != nil {
		return nil, err
	}

	res := make([]dto.AuditLogResponse, len(logs))
	for i, l := range logs {
		res[i] = dto.AuditLogResponse{
			ID:                 l.ID,
			UserID:             l.UserID,
			UserName:           l.UserName,
			UserRole:           l.UserRole,
			EntityType:         l.EntityType,
			EntityID:           l.EntityID,
			Action:             l.Action,
			OldValue:           l.OldValue,
			NewValue:           l.NewValue,
			CreatedAt:          l.CreatedAt,
			FormattedCreatedAt: l.CreatedAt.Format("02 Jan 2006, 15:04"),
		}
	}
	return res, nil
}

func (s *auditService) GetGlobalAuditLogs(ctx context.Context, userID string, entityType string, dateFrom, dateTo *time.Time, targetUserID string) ([]dto.AuditLogResponse, error) {
	// Let's resolve the owner ID inside the service layer by fetching it from DB or delegation.
	// Wait, we can find the owner ID by a simple query.
	// Let's see: we can query the users table using s.txRepo's db? But txRepo does not expose db.
	// However, we can also resolve ownerID inside GetGlobalAuditLogs repository method!
	// Yes! In GetGlobalAuditLogs repository implementation, we can do:
	//   l.user_id = $1 OR u.invited_by = $1 OR l.user_id = (SELECT invited_by FROM users WHERE id = $1)
	// That is extremely clever! It means if user is spouse, l.user_id = (invited_by) will match the owner.
	// So we can just pass the original userID directly!
	// Let's verify that. If userID is spouse_viewer, they were invited by owner. So they can view owner's and spouse's logs.
	// Let's update repository's GetGlobalAuditLogs to handle spouse resolver:
	//   WHERE (l.user_id = $1 OR u.invited_by = $1 OR l.user_id = (SELECT COALESCE(invited_by, '00000000-0000-0000-0000-000000000000'::uuid) FROM users WHERE id = $1))
	// This is perfect!

	logs, err := s.txRepo.GetGlobalAuditLogs(ctx, userID, entityType, dateFrom, dateTo, targetUserID)
	if err != nil {
		return nil, err
	}

	res := make([]dto.AuditLogResponse, len(logs))
	for i, l := range logs {
		res[i] = dto.AuditLogResponse{
			ID:                 l.ID,
			UserID:             l.UserID,
			UserName:           l.UserName,
			UserRole:           l.UserRole,
			EntityType:         l.EntityType,
			EntityID:           l.EntityID,
			Action:             l.Action,
			OldValue:           l.OldValue,
			NewValue:           l.NewValue,
			CreatedAt:          l.CreatedAt,
			FormattedCreatedAt: l.CreatedAt.Format("02 Jan 2006, 15:04"),
		}
	}
	return res, nil
}
