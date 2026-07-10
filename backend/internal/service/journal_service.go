package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/model"
)

type JournalService interface {
	CreateJournal(ctx context.Context, userID string, req *dto.CreateHouseholdNoteRequest) (*dto.HouseholdNoteResponse, error)
	GetJournalByID(ctx context.Context, userID string, id string) (*dto.HouseholdNoteResponse, error)
	UpdateJournal(ctx context.Context, userID string, id string, req *dto.UpdateHouseholdNoteRequest) error
	DeleteJournal(ctx context.Context, userID string, id string) error
	ListJournals(ctx context.Context, userID string, search string, tag string, dateFrom string, dateTo string) ([]dto.HouseholdNoteResponse, error)
}

type journalService struct {
	dbPool *pgxpool.Pool
}

func NewJournalService(dbPool *pgxpool.Pool) JournalService {
	return &journalService{dbPool: dbPool}
}

func (s *journalService) resolveOwnerID(ctx context.Context, userID string) (string, error) {
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

func (s *journalService) CreateJournal(ctx context.Context, userID string, req *dto.CreateHouseholdNoteRequest) (*dto.HouseholdNoteResponse, error) {
	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	var parsedDate time.Time
	if req.NoteDate != "" {
		parsedDate, err = time.Parse("2006-01-02", req.NoteDate)
		if err != nil {
			return nil, fmt.Errorf("invalid note_date format: %w", err)
		}
	} else {
		parsedDate = time.Now()
	}

	var note model.HouseholdNote
	note.UserID = ownerID
	note.Title = req.Title
	if req.Content != "" {
		note.Content = &req.Content
	}
	note.Tags = req.Tags
	if note.Tags == nil {
		note.Tags = []string{}
	}
	note.NoteDate = parsedDate

	err = s.dbPool.QueryRow(ctx, `
		INSERT INTO household_notes (user_id, title, content, tags, note_date)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, created_at
	`, note.UserID, note.Title, note.Content, note.Tags, note.NoteDate).Scan(&note.ID, &note.CreatedAt)

	if err != nil {
		return nil, fmt.Errorf("failed to save journal note: %w", err)
	}

	contentStr := ""
	if note.Content != nil {
		contentStr = *note.Content
	}

	// Trigger Audit Trail Log
	_, _ = s.dbPool.Exec(ctx, `
		INSERT INTO audit_logs (user_id, entity_type, entity_id, action, new_value)
		VALUES ($1, 'journal', $2::uuid, 'create', $3)
	`, ownerID, note.ID, req)

	return &dto.HouseholdNoteResponse{
		ID:                note.ID,
		UserID:            note.UserID,
		Title:             note.Title,
		Content:           contentStr,
		Tags:              note.Tags,
		NoteDate:          note.NoteDate.Format("2006-01-02"),
		CreatedAt:         note.CreatedAt,
		FormattedNoteDate: note.NoteDate.Format("02 Jan 2006"),
	}, nil
}

func (s *journalService) GetJournalByID(ctx context.Context, userID string, id string) (*dto.HouseholdNoteResponse, error) {
	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	var note model.HouseholdNote
	var content *string
	err = s.dbPool.QueryRow(ctx, `
		SELECT id, user_id, title, content, tags, note_date, created_at
		FROM household_notes
		WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
	`, id, ownerID).Scan(&note.ID, &note.UserID, &note.Title, &content, &note.Tags, &note.NoteDate, &note.CreatedAt)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, errors.New("journal note not found")
		}
		return nil, err
	}

	contentStr := ""
	if content != nil {
		contentStr = *content
	}

	return &dto.HouseholdNoteResponse{
		ID:                note.ID,
		UserID:            note.UserID,
		Title:             note.Title,
		Content:           contentStr,
		Tags:              note.Tags,
		NoteDate:          note.NoteDate.Format("2006-01-02"),
		CreatedAt:         note.CreatedAt,
		FormattedNoteDate: note.NoteDate.Format("02 Jan 2006"),
	}, nil
}

func (s *journalService) UpdateJournal(ctx context.Context, userID string, id string, req *dto.UpdateHouseholdNoteRequest) error {
	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	oldNote, err := s.GetJournalByID(ctx, ownerID, id)
	if err != nil {
		return err
	}

	query := `
		UPDATE household_notes
		SET title = COALESCE($1, title),
		    content = COALESCE($2, content),
		    tags = COALESCE($3, tags),
		    note_date = COALESCE($4, note_date),
		    updated_at = NOW()
		WHERE id = $5 AND user_id = $6 AND deleted_at IS NULL
	`

	var noteDateVal interface{}
	if req.NoteDate != nil {
		parsedDate, err := time.Parse("2006-01-02", *req.NoteDate)
		if err != nil {
			return fmt.Errorf("invalid note_date format: %w", err)
		}
		noteDateVal = parsedDate
	}

	_, err = s.dbPool.Exec(ctx, query, req.Title, req.Content, req.Tags, noteDateVal, id, ownerID)
	if err != nil {
		return err
	}

	// Trigger Audit Trail Log
	_, _ = s.dbPool.Exec(ctx, `
		INSERT INTO audit_logs (user_id, entity_type, entity_id, action, old_value, new_value)
		VALUES ($1, 'journal', $2::uuid, 'update', $3, $4)
	`, ownerID, id, oldNote, req)

	return nil
}

func (s *journalService) DeleteJournal(ctx context.Context, userID string, id string) error {
	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	oldNote, err := s.GetJournalByID(ctx, ownerID, id)
	if err != nil {
		return err
	}

	_, err = s.dbPool.Exec(ctx, `
		UPDATE household_notes SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1 AND user_id = $2
	`, id, ownerID)
	if err != nil {
		return err
	}

	// Trigger Audit Trail Log
	_, _ = s.dbPool.Exec(ctx, `
		INSERT INTO audit_logs (user_id, entity_type, entity_id, action, old_value)
		VALUES ($1, 'journal', $2::uuid, 'delete', $3)
	`, ownerID, id, oldNote)

	return nil
}

func (s *journalService) ListJournals(ctx context.Context, userID string, search string, tag string, dateFrom string, dateTo string) ([]dto.HouseholdNoteResponse, error) {
	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	query := `
		SELECT id, user_id, title, content, tags, note_date, created_at
		FROM household_notes
		WHERE user_id = $1 AND deleted_at IS NULL
	`
	args := []interface{}{ownerID}
	argIdx := 2

	if search != "" {
		query += fmt.Sprintf(" AND (title ILIKE $%d OR content ILIKE $%d)", argIdx, argIdx)
		args = append(args, "%"+search+"%")
		argIdx++
	}

	if tag != "" {
		query += fmt.Sprintf(" AND $%d = ANY(tags)", argIdx)
		args = append(args, tag)
		argIdx++
	}

	if dateFrom != "" {
		parsedDate, err := time.Parse("2006-01-02", dateFrom)
		if err == nil {
			query += fmt.Sprintf(" AND note_date >= $%d", argIdx)
			args = append(args, parsedDate)
			argIdx++
		}
	}

	if dateTo != "" {
		parsedDate, err := time.Parse("2006-01-02", dateTo)
		if err == nil {
			query += fmt.Sprintf(" AND note_date <= $%d", argIdx)
			args = append(args, parsedDate)
			argIdx++
		}
	}

	query += " ORDER BY note_date DESC, created_at DESC"

	rows, err := s.dbPool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := make([]dto.HouseholdNoteResponse, 0)
	for rows.Next() {
		var note model.HouseholdNote
		var content *string
		err = rows.Scan(&note.ID, &note.UserID, &note.Title, &content, &note.Tags, &note.NoteDate, &note.CreatedAt)
		if err == nil {
			contentStr := ""
			if content != nil {
				contentStr = *content
			}
			if note.Tags == nil {
				note.Tags = []string{}
			}
			list = append(list, dto.HouseholdNoteResponse{
				ID:                note.ID,
				UserID:            note.UserID,
				Title:             note.Title,
				Content:           contentStr,
				Tags:              note.Tags,
				NoteDate:          note.NoteDate.Format("2006-01-02"),
				CreatedAt:         note.CreatedAt,
				FormattedNoteDate: note.NoteDate.Format("02 Jan 2006"),
			})
		}
	}

	return list, nil
}
