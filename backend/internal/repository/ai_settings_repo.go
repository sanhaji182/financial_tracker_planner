package repository

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/user/financial-os/internal/model"
)

type AISettingsRepository interface {
	GetByUserID(ctx context.Context, userID string) (*model.AISettings, error)
	Update(ctx context.Context, settings *model.AISettings) error
	GetVaultReference(ctx context.Context, userID string, refType string) (*model.VaultReference, error)
	SaveVaultReference(ctx context.Context, ref *model.VaultReference) error
	GetOwnerID(ctx context.Context, userID string) (string, error)
	GetRecentTransactions(ctx context.Context, userID string) ([]map[string]interface{}, error)
	GetCategoryAverages(ctx context.Context, userID string) ([]map[string]interface{}, error)
	CreateAlert(ctx context.Context, userID, alertType, severity, title, message, entityType, entityID string) error
}

type pgAISettingsRepository struct {
	db *pgxpool.Pool
}

func NewAISettingsRepository(db *pgxpool.Pool) AISettingsRepository {
	return &pgAISettingsRepository{db: db}
}

func (r *pgAISettingsRepository) GetByUserID(ctx context.Context, userID string) (*model.AISettings, error) {
	query := `
		SELECT id, user_id, ai_enabled, ai_provider, ai_model, 
		       ocr_escalation_enabled, auto_categorization_enabled, 
		       advisor_enabled, anomaly_detection_enabled, created_at, updated_at
		FROM ai_settings
		WHERE user_id = $1
	`
	var s model.AISettings
	err := r.db.QueryRow(ctx, query, userID).Scan(
		&s.ID,
		&s.UserID,
		&s.AIEnabled,
		&s.AIProvider,
		&s.AIModel,
		&s.OCREscalationEnabled,
		&s.AutoCategorizationEnabled,
		&s.AdvisorEnabled,
		&s.AnomalyDetectionEnabled,
		&s.CreatedAt,
		&s.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// If not found, return a default struct with default values but without saving yet
			return &model.AISettings{
				UserID:                    userID,
				AIEnabled:                 false,
				AIProvider:                "local",
				AIModel:                   "default",
				OCREscalationEnabled:      false,
				AutoCategorizationEnabled: false,
				AdvisorEnabled:            false,
				AnomalyDetectionEnabled:   false,
			}, nil
		}
		return nil, err
	}
	return &s, nil
}

func (r *pgAISettingsRepository) Update(ctx context.Context, s *model.AISettings) error {
	query := `
		INSERT INTO ai_settings (
			user_id, ai_enabled, ai_provider, ai_model, 
			ocr_escalation_enabled, auto_categorization_enabled, 
			advisor_enabled, anomaly_detection_enabled, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
		ON CONFLICT (user_id) DO UPDATE SET
			ai_enabled = EXCLUDED.ai_enabled,
			ai_provider = EXCLUDED.ai_provider,
			ai_model = EXCLUDED.ai_model,
			ocr_escalation_enabled = EXCLUDED.ocr_escalation_enabled,
			auto_categorization_enabled = EXCLUDED.auto_categorization_enabled,
			advisor_enabled = EXCLUDED.advisor_enabled,
			anomaly_detection_enabled = EXCLUDED.anomaly_detection_enabled,
			updated_at = NOW()
	`
	_, err := r.db.Exec(ctx, query,
		s.UserID,
		s.AIEnabled,
		s.AIProvider,
		s.AIModel,
		s.OCREscalationEnabled,
		s.AutoCategorizationEnabled,
		s.AdvisorEnabled,
		s.AnomalyDetectionEnabled,
	)
	return err
}

func (r *pgAISettingsRepository) GetVaultReference(ctx context.Context, userID string, refType string) (*model.VaultReference, error) {
	query := `
		SELECT id, user_id, name, vault_item_id, type, linked_entity_type, linked_entity_id, notes, created_at, updated_at
		FROM vault_references
		WHERE user_id = $1 AND type = $2
	`
	var ref model.VaultReference
	err := r.db.QueryRow(ctx, query, userID, refType).Scan(
		&ref.ID,
		&ref.UserID,
		&ref.Name,
		&ref.VaultItemID,
		&ref.Type,
		&ref.LinkedEntityType,
		&ref.LinkedEntityID,
		&ref.Notes,
		&ref.CreatedAt,
		&ref.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil // Not found is fine
		}
		return nil, err
	}
	return &ref, nil
}

func (r *pgAISettingsRepository) SaveVaultReference(ctx context.Context, ref *model.VaultReference) error {
	query := `
		INSERT INTO vault_references (
			user_id, name, vault_item_id, type, linked_entity_type, linked_entity_id, notes, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
		ON CONFLICT (id) DO UPDATE SET
			name = EXCLUDED.name,
			vault_item_id = EXCLUDED.vault_item_id,
			linked_entity_type = EXCLUDED.linked_entity_type,
			linked_entity_id = EXCLUDED.linked_entity_id,
			notes = EXCLUDED.notes,
			updated_at = NOW()
	`
	_, err := r.db.Exec(ctx, query,
		ref.UserID,
		ref.Name,
		ref.VaultItemID,
		ref.Type,
		ref.LinkedEntityType,
		ref.LinkedEntityID,
		ref.Notes,
	)
	return err
}

func (r *pgAISettingsRepository) GetOwnerID(ctx context.Context, userID string) (string, error) {
	var role string
	var invitedBy *string

	err := r.db.QueryRow(ctx, `
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

func (r *pgAISettingsRepository) GetRecentTransactions(ctx context.Context, userID string) ([]map[string]interface{}, error) {
	query := `
		SELECT t.id, t.amount, t.date::text, COALESCE(t.description, '') as description, COALESCE(c.name, 'Uncategorized') as category 
		FROM transactions t 
		LEFT JOIN categories c ON t.category_id = c.id 
		WHERE t.user_id = $1 AND t.status = 'confirmed' AND t.date > NOW() - INTERVAL '30 days'
		ORDER BY t.date DESC
	`
	rows, err := r.db.Query(ctx, query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []map[string]interface{}
	for rows.Next() {
		var id, date, description, category string
		var amount float64
		if err := rows.Scan(&id, &amount, &date, &description, &category); err != nil {
			return nil, err
		}
		result = append(result, map[string]interface{}{
			"id":          id,
			"amount":      amount,
			"date":        date,
			"description": description,
			"category":    category,
		})
	}
	return result, nil
}

func (r *pgAISettingsRepository) GetCategoryAverages(ctx context.Context, userID string) ([]map[string]interface{}, error) {
	query := `
		SELECT COALESCE(c.name, 'Uncategorized') as category, AVG(t.amount)::float8 as average 
		FROM transactions t 
		LEFT JOIN categories c ON t.category_id = c.id 
		WHERE t.user_id = $1 AND t.status = 'confirmed' 
		GROUP BY c.name
	`
	rows, err := r.db.Query(ctx, query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []map[string]interface{}
	for rows.Next() {
		var category string
		var average float64
		if err := rows.Scan(&category, &average); err != nil {
			return nil, err
		}
		result = append(result, map[string]interface{}{
			"category": category,
			"average":  average,
		})
	}
	return result, nil
}

func (r *pgAISettingsRepository) CreateAlert(ctx context.Context, userID, alertType, severity, title, message, entityType, entityID string) error {
	var entityIDArg interface{}
	if entityID != "" {
		entityIDArg = entityID
	}
	expiresAt := time.Now().Add(30 * 24 * time.Hour) // expires in 30 days

	query := `
		INSERT INTO alerts (user_id, type, severity, title, message, entity_type, entity_id, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7::uuid, $8)
	`
	_, err := r.db.Exec(ctx, query, userID, alertType, severity, title, message, entityType, entityIDArg, expiresAt)
	return err
}
