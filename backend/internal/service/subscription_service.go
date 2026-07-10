package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/model"
)

type SubscriptionService interface {
	CreateSubscription(ctx context.Context, userID string, req *dto.CreateSubscriptionRequest) (*dto.SubscriptionResponse, error)
	GetSubscriptionByID(ctx context.Context, userID string, id string) (*dto.SubscriptionResponse, error)
	UpdateSubscription(ctx context.Context, userID string, id string, req *dto.UpdateSubscriptionRequest) error
	DeleteSubscription(ctx context.Context, userID string, id string) error
	ListSubscriptions(ctx context.Context, userID string) ([]dto.SubscriptionResponse, error)
	GetSubscriptionSummary(ctx context.Context, userID string) (*dto.SubscriptionSummaryResponse, error)
}

type subscriptionService struct {
	dbPool *pgxpool.Pool
}

func NewSubscriptionService(dbPool *pgxpool.Pool) SubscriptionService {
	return &subscriptionService{dbPool: dbPool}
}

func (s *subscriptionService) resolveOwnerID(ctx context.Context, userID string) (string, error) {
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

func (s *subscriptionService) checkWriteAccess(ctx context.Context, userID string) error {
	var role string
	err := s.dbPool.QueryRow(ctx, "SELECT role FROM users WHERE id = $1", userID).Scan(&role)
	if err != nil {
		return err
	}
	if role == "spouse_viewer" {
		return errors.New("unauthorized: spouse has read-only access to subscriptions")
	}
	return nil
}

func (s *subscriptionService) calculateMonthlyCost(amount float64, freq string) float64 {
	switch freq {
	case "yearly":
		return amount / 12
	case "weekly":
		return amount * 52 / 12
	default: // monthly
		return amount
	}
}

func (s *subscriptionService) CreateSubscription(ctx context.Context, userID string, req *dto.CreateSubscriptionRequest) (*dto.SubscriptionResponse, error) {
	if err := s.checkWriteAccess(ctx, userID); err != nil {
		return nil, err
	}

	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	var nextRenewal *time.Time
	if req.NextRenewalDate != "" {
		t, err := time.Parse("2006-01-02", req.NextRenewalDate)
		if err != nil {
			return nil, fmt.Errorf("invalid next_renewal_date format: %w", err)
		}
		nextRenewal = &t
	}

	var lastUsed *time.Time
	if req.LastUsedDate != "" {
		t, err := time.Parse("2006-01-02", req.LastUsedDate)
		if err != nil {
			return nil, fmt.Errorf("invalid last_used_date format: %w", err)
		}
		lastUsed = &t
	}

	var categoryID *string
	if req.CategoryID != "" {
		categoryID = &req.CategoryID
	}

	currency := "IDR"
	if req.Currency != "" {
		currency = req.Currency
	}

	isActive := true
	if req.IsActive != nil {
		isActive = *req.IsActive
	}

	autoRenew := true
	if req.AutoRenew != nil {
		autoRenew = *req.AutoRenew
	}

	var sub model.Subscription
	sub.UserID = ownerID
	sub.Name = req.Name
	if req.Provider != "" {
		sub.Provider = &req.Provider
	}
	sub.Amount = req.Amount
	sub.Currency = currency
	sub.Frequency = req.Frequency
	sub.CategoryID = categoryID
	sub.NextRenewalDate = nextRenewal
	sub.LastUsedDate = lastUsed
	sub.IsActive = isActive
	sub.AutoRenew = autoRenew
	if req.Notes != "" {
		sub.Notes = &req.Notes
	}

	err = s.dbPool.QueryRow(ctx, `
		INSERT INTO subscriptions (user_id, name, provider, amount, currency, frequency, category_id, next_renewal_date, last_used_date, is_active, auto_renew, notes)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
		RETURNING id, created_at, updated_at
	`, sub.UserID, sub.Name, sub.Provider, sub.Amount, sub.Currency, sub.Frequency, sub.CategoryID, sub.NextRenewalDate, sub.LastUsedDate, sub.IsActive, sub.AutoRenew, sub.Notes).Scan(&sub.ID, &sub.CreatedAt, &sub.UpdatedAt)

	if err != nil {
		return nil, fmt.Errorf("failed to create subscription: %w", err)
	}

	// Trigger Audit trail log
	_, _ = s.dbPool.Exec(ctx, `
		INSERT INTO audit_logs (user_id, entity_type, entity_id, action, new_value)
		VALUES ($1, 'subscription', $2::uuid, 'create', $3)
	`, ownerID, sub.ID, req)

	return s.GetSubscriptionByID(ctx, userID, sub.ID)
}

func (s *subscriptionService) GetSubscriptionByID(ctx context.Context, userID string, id string) (*dto.SubscriptionResponse, error) {
	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	var sub model.Subscription
	err = s.dbPool.QueryRow(ctx, `
		SELECT id, user_id, name, provider, amount, currency, frequency, category_id, next_renewal_date, last_used_date, is_active, auto_renew, notes, created_at, updated_at
		FROM subscriptions WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
	`, id, ownerID).Scan(
		&sub.ID, &sub.UserID, &sub.Name, &sub.Provider, &sub.Amount, &sub.Currency, &sub.Frequency, &sub.CategoryID, &sub.NextRenewalDate, &sub.LastUsedDate, &sub.IsActive, &sub.AutoRenew, &sub.Notes, &sub.CreatedAt, &sub.UpdatedAt,
	)

	if err != nil {
		return nil, err
	}

	// Fetch category name
	categoryName := "Lainnya"
	if sub.CategoryID != nil {
		_ = s.dbPool.QueryRow(ctx, "SELECT name FROM categories WHERE id = $1", *sub.CategoryID).Scan(&categoryName)
	}

	// Calculate warnings
	var unusedWarning bool = false
	var daysUnused int = 0
	var warningMsg string = ""

	if sub.IsActive && sub.LastUsedDate != nil {
		daysUnused = int(time.Since(*sub.LastUsedDate).Hours() / 24)
		if daysUnused > 60 {
			unusedWarning = true
			monthlyAmount := s.calculateMonthlyCost(sub.Amount, sub.Frequency)
			warningMsg = fmt.Sprintf("Subscription %s belum digunakan 60+ hari. Biaya Rp %.0f/bulan. Pertimbangkan cancel.", sub.Name, monthlyAmount)
		}
	}

	var nextRenewalStr *string
	if sub.NextRenewalDate != nil {
		ds := sub.NextRenewalDate.Format("2006-01-02")
		nextRenewalStr = &ds
	}

	var lastUsedStr *string
	if sub.LastUsedDate != nil {
		ds := sub.LastUsedDate.Format("2006-01-02")
		lastUsedStr = &ds
	}

	providerVal := ""
	if sub.Provider != nil {
		providerVal = *sub.Provider
	}
	notesVal := ""
	if sub.Notes != nil {
		notesVal = *sub.Notes
	}

	return &dto.SubscriptionResponse{
		ID:              sub.ID,
		UserID:          sub.UserID,
		Name:            sub.Name,
		Provider:        providerVal,
		Amount:          sub.Amount,
		Currency:        sub.Currency,
		Frequency:       sub.Frequency,
		CategoryID:      sub.CategoryID,
		CategoryName:    categoryName,
		NextRenewalDate: nextRenewalStr,
		LastUsedDate:    lastUsedStr,
		IsActive:        sub.IsActive,
		AutoRenew:       sub.AutoRenew,
		Notes:           notesVal,
		UnusedWarning:   unusedWarning,
		DaysUnused:      daysUnused,
		WarningMessage:  warningMsg,
		CreatedAt:       sub.CreatedAt,
		UpdatedAt:       sub.UpdatedAt,
	}, nil
}

func (s *subscriptionService) ListSubscriptions(ctx context.Context, userID string) ([]dto.SubscriptionResponse, error) {
	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	rows, err := s.dbPool.Query(ctx, `
		SELECT id FROM subscriptions WHERE user_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC
	`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var res []dto.SubscriptionResponse
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err == nil {
			subRes, err := s.GetSubscriptionByID(ctx, userID, id)
			if err == nil {
				res = append(res, *subRes)
			}
		}
	}

	return res, nil
}

func (s *subscriptionService) UpdateSubscription(ctx context.Context, userID string, id string, req *dto.UpdateSubscriptionRequest) error {
	if err := s.checkWriteAccess(ctx, userID); err != nil {
		return err
	}

	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	// Fetch old
	var sub model.Subscription
	err = s.dbPool.QueryRow(ctx, `
		SELECT name, provider, amount, currency, frequency, category_id, next_renewal_date, last_used_date, is_active, auto_renew, notes
		FROM subscriptions WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
	`, id, ownerID).Scan(
		&sub.Name, &sub.Provider, &sub.Amount, &sub.Currency, &sub.Frequency, &sub.CategoryID, &sub.NextRenewalDate, &sub.LastUsedDate, &sub.IsActive, &sub.AutoRenew, &sub.Notes,
	)
	if err != nil {
		return err
	}

	if req.Name != nil {
		sub.Name = *req.Name
	}
	if req.Provider != nil {
		sub.Provider = req.Provider
	}
	if req.Amount != nil {
		sub.Amount = *req.Amount
	}
	if req.Currency != nil {
		sub.Currency = *req.Currency
	}
	if req.Frequency != nil {
		sub.Frequency = *req.Frequency
	}
	if req.CategoryID != nil {
		if *req.CategoryID == "" {
			sub.CategoryID = nil
		} else {
			sub.CategoryID = req.CategoryID
		}
	}
	if req.NextRenewalDate != nil {
		if *req.NextRenewalDate == "" {
			sub.NextRenewalDate = nil
		} else {
			t, err := time.Parse("2006-01-02", *req.NextRenewalDate)
			if err != nil {
				return fmt.Errorf("invalid next_renewal_date format: %w", err)
			}
			sub.NextRenewalDate = &t
		}
	}
	if req.LastUsedDate != nil {
		if *req.LastUsedDate == "" {
			sub.LastUsedDate = nil
		} else {
			t, err := time.Parse("2006-01-02", *req.LastUsedDate)
			if err != nil {
				return fmt.Errorf("invalid last_used_date format: %w", err)
			}
			sub.LastUsedDate = &t
		}
	}
	if req.IsActive != nil {
		sub.IsActive = *req.IsActive
	}
	if req.AutoRenew != nil {
		sub.AutoRenew = *req.AutoRenew
	}
	if req.Notes != nil {
		sub.Notes = req.Notes
	}

	_, err = s.dbPool.Exec(ctx, `
		UPDATE subscriptions
		SET name = $1, provider = $2, amount = $3, currency = $4, frequency = $5, category_id = $6, next_renewal_date = $7, last_used_date = $8, is_active = $9, auto_renew = $10, notes = $11, updated_at = NOW()
		WHERE id = $12 AND user_id = $13 AND deleted_at IS NULL
	`, sub.Name, sub.Provider, sub.Amount, sub.Currency, sub.Frequency, sub.CategoryID, sub.NextRenewalDate, sub.LastUsedDate, sub.IsActive, sub.AutoRenew, sub.Notes, id, ownerID)

	if err != nil {
		return fmt.Errorf("failed to update subscription: %w", err)
	}

	// Trigger Audit trail log
	_, _ = s.dbPool.Exec(ctx, `
		INSERT INTO audit_logs (user_id, entity_type, entity_id, action, new_value)
		VALUES ($1, 'subscription', $2::uuid, 'update', $3)
	`, ownerID, id, req)

	return nil
}

func (s *subscriptionService) DeleteSubscription(ctx context.Context, userID string, id string) error {
	if err := s.checkWriteAccess(ctx, userID); err != nil {
		return err
	}

	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	_, err = s.dbPool.Exec(ctx, `
		UPDATE subscriptions SET deleted_at = NOW() WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
	`, id, ownerID)

	if err != nil {
		return err
	}

	// Trigger Audit trail log
	_, _ = s.dbPool.Exec(ctx, `
		INSERT INTO audit_logs (user_id, entity_type, entity_id, action, new_value)
		VALUES ($1, 'subscription', $2::uuid, 'delete', NULL)
	`, ownerID, id)

	return nil
}

func (s *subscriptionService) GetSubscriptionSummary(ctx context.Context, userID string) (*dto.SubscriptionSummaryResponse, error) {
	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	rows, err := s.dbPool.Query(ctx, `
		SELECT id, name, amount, frequency, last_used_date, is_active
		FROM subscriptions
		WHERE user_id = $1 AND deleted_at IS NULL
	`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var totalMonthly float64 = 0
	var activeCount int = 0
	warnings := []dto.SubscriptionWarningItem{}

	for rows.Next() {
		var id, name, frequency string
		var amount float64
		var lastUsed *time.Time
		var isActive bool

		err := rows.Scan(&id, &name, &amount, &frequency, &lastUsed, &isActive)
		if err == nil {
			if isActive {
				activeCount++
				monthly := s.calculateMonthlyCost(amount, frequency)
				totalMonthly += monthly

				// Unused Warning detection
				if lastUsed != nil {
					daysUnused := int(time.Since(*lastUsed).Hours() / 24)
					if daysUnused > 60 {
						msg := fmt.Sprintf("Subscription %s belum digunakan 60+ hari. Biaya Rp %.0f/bulan. Pertimbangkan cancel.", name, monthly)
						warnings = append(warnings, dto.SubscriptionWarningItem{
							SubscriptionID: id,
							Name:           name,
							Amount:         amount,
							Frequency:      frequency,
							DaysUnused:     daysUnused,
							Message:        msg,
						})
					}
				}
			}
		}
	}

	return &dto.SubscriptionSummaryResponse{
		TotalMonthlyCost: totalMonthly,
		ActiveCount:      activeCount,
		Warnings:         warnings,
	}, nil
}
