package service

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/user/financial-os/internal/dto"
)

type DocumentService interface {
	UploadDocument(ctx context.Context, userID, fileName string, fileData []byte, fileType string, fileSize int, entityType string, entityID string, tags []string, description string) (*dto.DocumentResponse, error)
	ListDocuments(ctx context.Context, userID string, entityType string, tag string) ([]dto.DocumentResponse, error)
	GetDocumentByID(ctx context.Context, userID string, id string) (*dto.DocumentResponse, error)
	DeleteDocument(ctx context.Context, userID string, id string) error
	LinkDocument(ctx context.Context, userID, id, entityType, entityID string) error
}

type documentService struct {
	dbPool *pgxpool.Pool
}

func NewDocumentService(dbPool *pgxpool.Pool) DocumentService {
	return &documentService{dbPool: dbPool}
}

func (s *documentService) resolveOwnerID(ctx context.Context, userID string) (string, error) {
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

func (s *documentService) UploadDocument(ctx context.Context, userID, fileName string, fileData []byte, fileType string, fileSize int, entityType string, entityID string, tags []string, description string) (*dto.DocumentResponse, error) {
	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	// Create uploads directory if it doesn't exist
	uploadsDir := "/app/uploads"
	if _, err := os.Stat(uploadsDir); os.IsNotExist(err) {
		err = os.MkdirAll(uploadsDir, os.ModePerm)
		if err != nil {
			return nil, fmt.Errorf("failed to create upload directory: %w", err)
		}
	}

	// Create unique file name
	uniqueID := uuid.New().String()
	ext := filepath.Ext(fileName)
	uniqueFileName := fmt.Sprintf("doc_%s%s", uniqueID, ext)
	filePath := filepath.Join(uploadsDir, uniqueFileName)

	// Write file to disk
	err = os.WriteFile(filePath, fileData, 0644)
	if err != nil {
		return nil, fmt.Errorf("failed to write file to disk: %w", err)
	}

	var linkedID interface{}
	if entityID != "" {
		linkedID = entityID
	}

	var docID string
	var createdAt, updatedAt time.Time

	err = s.dbPool.QueryRow(ctx, `
		INSERT INTO documents (user_id, file_name, file_path, file_type, file_size, linked_entity_type, linked_entity_id, tags, description)
		VALUES ($1, $2, $3, $4, $5, $6, $7::uuid, $8, $9)
		RETURNING id, created_at, updated_at
	`, ownerID, uniqueFileName, filePath, fileType, fileSize, entityType, linkedID, tags, description).Scan(&docID, &createdAt, &updatedAt)

	if err != nil {
		os.Remove(filePath) // clean up file on DB error
		return nil, fmt.Errorf("failed to save document to DB: %w", err)
	}

	// Create Audit Log
	newVal := map[string]interface{}{
		"file_name":          uniqueFileName,
		"linked_entity_type": entityType,
		"linked_entity_id":   entityID,
		"tags":               tags,
	}
	_, _ = s.dbPool.Exec(ctx, `
		INSERT INTO audit_logs (user_id, entity_type, entity_id, action, new_value)
		VALUES ($1, 'document', $2::uuid, 'create', $3)
	`, ownerID, docID, newVal)

	var resID *string
	if entityID != "" {
		resID = &entityID
	}

	return &dto.DocumentResponse{
		ID:                 docID,
		UserID:             ownerID,
		FileName:           uniqueFileName,
		FilePath:           filePath,
		FileURL:            fmt.Sprintf("/uploads/%s", uniqueFileName),
		FileType:           fileType,
		FileSize:           fileSize,
		LinkedEntityType:   entityType,
		LinkedEntityID:     resID,
		Tags:               tags,
		Description:        description,
		CreatedAt:          createdAt,
		UpdatedAt:          updatedAt,
		FormattedCreatedAt: createdAt.Format("02 Jan 2006, 15:04"),
	}, nil
}

func (s *documentService) ListDocuments(ctx context.Context, userID string, entityType string, tag string) ([]dto.DocumentResponse, error) {
	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	query := `
		SELECT id, user_id, file_name, file_path, file_type, file_size, 
		       COALESCE(linked_entity_type, ''), COALESCE(linked_entity_id::text, ''), 
		       tags, COALESCE(description, ''), created_at, updated_at
		FROM documents
		WHERE user_id = $1 AND deleted_at IS NULL
	`
	args := []interface{}{ownerID}
	argIdx := 2

	if entityType != "" {
		query += fmt.Sprintf(" AND linked_entity_type = $%d", argIdx)
		args = append(args, entityType)
		argIdx++
	}

	if tag != "" {
		query += fmt.Sprintf(" AND $%d = ANY(tags)", argIdx)
		args = append(args, tag)
		argIdx++
	}

	query += " ORDER BY created_at DESC"

	rows, err := s.dbPool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	docs := make([]dto.DocumentResponse, 0)
	for rows.Next() {
		var d dto.DocumentResponse
		var linkedType, linkedIDStr string
		var tags []string
		err = rows.Scan(
			&d.ID, &d.UserID, &d.FileName, &d.FilePath, &d.FileType, &d.FileSize,
			&linkedType, &linkedIDStr, &tags, &d.Description, &d.CreatedAt, &d.UpdatedAt,
		)
		if err == nil {
			d.FileURL = fmt.Sprintf("/uploads/%s", d.FileName)
			d.LinkedEntityType = linkedType
			if linkedIDStr != "" {
				d.LinkedEntityID = &linkedIDStr
			}
			d.Tags = tags
			d.FormattedCreatedAt = d.CreatedAt.Format("02 Jan 2006, 15:04")
			docs = append(docs, d)
		}
	}
	return docs, nil
}

func (s *documentService) GetDocumentByID(ctx context.Context, userID string, id string) (*dto.DocumentResponse, error) {
	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	var d dto.DocumentResponse
	var linkedType, linkedIDStr string
	var tags []string
	err = s.dbPool.QueryRow(ctx, `
		SELECT id, user_id, file_name, file_path, file_type, file_size, 
		       COALESCE(linked_entity_type, ''), COALESCE(linked_entity_id::text, ''), 
		       tags, COALESCE(description, ''), created_at, updated_at
		FROM documents
		WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
	`, id, ownerID).Scan(
		&d.ID, &d.UserID, &d.FileName, &d.FilePath, &d.FileType, &d.FileSize,
		&linkedType, &linkedIDStr, &tags, &d.Description, &d.CreatedAt, &d.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, errors.New("document not found")
		}
		return nil, err
	}

	d.FileURL = fmt.Sprintf("/uploads/%s", d.FileName)
	d.LinkedEntityType = linkedType
	if linkedIDStr != "" {
		d.LinkedEntityID = &linkedIDStr
	}
	d.Tags = tags
	d.FormattedCreatedAt = d.CreatedAt.Format("02 Jan 2006, 15:04")
	return &d, nil
}

func (s *documentService) DeleteDocument(ctx context.Context, userID string, id string) error {
	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	doc, err := s.GetDocumentByID(ctx, ownerID, id)
	if err != nil {
		return err
	}

	// Soft delete in DB
	_, err = s.dbPool.Exec(ctx, `
		UPDATE documents SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1 AND user_id = $2
	`, id, ownerID)
	if err != nil {
		return err
	}

	// Delete from local disk
	os.Remove(doc.FilePath)

	// Create Audit Log
	_, _ = s.dbPool.Exec(ctx, `
		INSERT INTO audit_logs (user_id, entity_type, entity_id, action, old_value)
		VALUES ($1, 'document', $2::uuid, 'delete', $3)
	`, ownerID, id, doc)

	return nil
}

func (s *documentService) LinkDocument(ctx context.Context, userID, id, entityType, entityID string) error {
	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	doc, err := s.GetDocumentByID(ctx, ownerID, id)
	if err != nil {
		return err
	}

	var linkedID interface{}
	if entityID != "" {
		linkedID = entityID
	}

	var linkedType interface{}
	if entityType != "" {
		linkedType = entityType
	}

	_, err = s.dbPool.Exec(ctx, `
		UPDATE documents
		SET linked_entity_type = $1, linked_entity_id = $2::uuid, updated_at = NOW()
		WHERE id = $3 AND user_id = $4
	`, linkedType, linkedID, id, ownerID)
	if err != nil {
		return err
	}

	// Create Audit Log
	newVal := map[string]interface{}{
		"linked_entity_type": entityType,
		"linked_entity_id":   entityID,
	}
	_, _ = s.dbPool.Exec(ctx, `
		INSERT INTO audit_logs (user_id, entity_type, entity_id, action, old_value, new_value)
		VALUES ($1, 'document', $2::uuid, 'update', $3, $4)
	`, ownerID, id, doc, newVal)

	return nil
}
