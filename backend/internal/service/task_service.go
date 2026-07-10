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

type TaskService interface {
	CreateTask(ctx context.Context, userID string, req *dto.CreateTaskRequest) (*dto.TaskChecklistResponse, error)
	GetTaskByID(ctx context.Context, userID string, id string) (*dto.TaskChecklistResponse, error)
	UpdateTask(ctx context.Context, userID string, id string, req *dto.UpdateTaskRequest) error
	DeleteTask(ctx context.Context, userID string, id string) error
	ListTasks(ctx context.Context, userID string, status string, dateFrom string, dateTo string, frequency string) ([]dto.TaskChecklistResponse, error)
	RunAutoOverdue(ctx context.Context) (int64, error)
}

type taskService struct {
	dbPool *pgxpool.Pool
}

func NewTaskService(dbPool *pgxpool.Pool) TaskService {
	return &taskService{dbPool: dbPool}
}

func (s *taskService) resolveOwnerID(ctx context.Context, userID string) (string, error) {
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

func (s *taskService) CreateTask(ctx context.Context, userID string, req *dto.CreateTaskRequest) (*dto.TaskChecklistResponse, error) {
	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	var parsedDueDate *time.Time
	if req.DueDate != "" {
		parsed, err := time.Parse("2006-01-02", req.DueDate)
		if err != nil {
			return nil, fmt.Errorf("invalid due_date format: %w", err)
		}
		parsedDueDate = &parsed
	}

	var t model.TaskChecklist
	t.UserID = ownerID
	t.Title = req.Title
	if req.Description != "" {
		t.Description = &req.Description
	}
	t.DueDate = parsedDueDate
	t.Frequency = req.Frequency
	if t.Frequency == "" {
		t.Frequency = "once"
	}
	if req.Category != "" {
		t.Category = &req.Category
	}
	t.Status = "pending"

	// If due date is already passed and task is created, let's mark it overdue immediately
	if t.DueDate != nil && t.DueDate.Before(time.Now().Truncate(24*time.Hour)) {
		t.Status = "overdue"
	}

	err = s.dbPool.QueryRow(ctx, `
		INSERT INTO task_checklists (user_id, title, description, due_date, frequency, category, status)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id, created_at
	`, t.UserID, t.Title, t.Description, t.DueDate, t.Frequency, t.Category, t.Status).Scan(&t.ID, &t.CreatedAt)

	if err != nil {
		return nil, fmt.Errorf("failed to save task: %w", err)
	}

	// Trigger Audit Trail Log
	_, _ = s.dbPool.Exec(ctx, `
		INSERT INTO audit_logs (user_id, entity_type, entity_id, action, new_value)
		VALUES ($1, 'task', $2::uuid, 'create', $3)
	`, ownerID, t.ID, req)

	return s.GetTaskByID(ctx, ownerID, t.ID)
}

func (s *taskService) GetTaskByID(ctx context.Context, userID string, id string) (*dto.TaskChecklistResponse, error) {
	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	var t model.TaskChecklist
	var desc, category *string
	var dueDate *time.Time
	err = s.dbPool.QueryRow(ctx, `
		SELECT id, user_id, title, description, due_date, frequency, category, status, completed_at, created_at
		FROM task_checklists
		WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
	`, id, ownerID).Scan(&t.ID, &t.UserID, &t.Title, &desc, &dueDate, &t.Frequency, &category, &t.Status, &t.CompletedAt, &t.CreatedAt)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, errors.New("task not found")
		}
		return nil, err
	}

	descStr := ""
	if desc != nil {
		descStr = *desc
	}
	catStr := ""
	if category != nil {
		catStr = *category
	}

	var dueDateStr *string
	if dueDate != nil {
		str := dueDate.Format("2006-01-02")
		dueDateStr = &str
	}

	return &dto.TaskChecklistResponse{
		ID:          t.ID,
		UserID:      t.UserID,
		Title:       t.Title,
		Description: descStr,
		DueDate:     dueDateStr,
		Frequency:   t.Frequency,
		Category:    catStr,
		Status:      t.Status,
		CompletedAt: t.CompletedAt,
		CreatedAt:   t.CreatedAt,
	}, nil
}

func (s *taskService) UpdateTask(ctx context.Context, userID string, id string, req *dto.UpdateTaskRequest) error {
	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	oldTask, err := s.GetTaskByID(ctx, ownerID, id)
	if err != nil {
		return err
	}

	var parsedDueDate interface{}
	if req.DueDate != nil {
		if *req.DueDate != "" {
			parsed, err := time.Parse("2006-01-02", *req.DueDate)
			if err != nil {
				return fmt.Errorf("invalid due_date format: %w", err)
			}
			parsedDueDate = parsed
		} else {
			parsedDueDate = nil
		}
	}

	var completedAtVal interface{}
	if req.Status != nil {
		if *req.Status == "completed" {
			nowVal := time.Now()
			completedAtVal = &nowVal
		} else if *req.Status == "pending" {
			completedAtVal = nil
		}
	}

	// Update query
	query := `
		UPDATE task_checklists
		SET title = COALESCE($1, title),
		    description = COALESCE($2, description),
		    due_date = COALESCE($3, due_date),
		    frequency = COALESCE($4, frequency),
		    category = COALESCE($5, category),
		    status = COALESCE($6, status),
		    completed_at = COALESCE($7, completed_at),
		    updated_at = NOW()
		WHERE id = $8 AND user_id = $9 AND deleted_at IS NULL
	`
	_, err = s.dbPool.Exec(ctx, query, req.Title, req.Description, parsedDueDate, req.Frequency, req.Category, req.Status, completedAtVal, id, ownerID)
	if err != nil {
		return err
	}

	// Trigger Audit Trail Log
	_, _ = s.dbPool.Exec(ctx, `
		INSERT INTO audit_logs (user_id, entity_type, entity_id, action, old_value, new_value)
		VALUES ($1, 'task', $2::uuid, 'update', $3, $4)
	`, ownerID, id, oldTask, req)

	return nil
}

func (s *taskService) DeleteTask(ctx context.Context, userID string, id string) error {
	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	oldTask, err := s.GetTaskByID(ctx, ownerID, id)
	if err != nil {
		return err
	}

	_, err = s.dbPool.Exec(ctx, `
		UPDATE task_checklists SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1 AND user_id = $2
	`, id, ownerID)
	if err != nil {
		return err
	}

	// Trigger Audit Trail Log
	_, _ = s.dbPool.Exec(ctx, `
		INSERT INTO audit_logs (user_id, entity_type, entity_id, action, old_value)
		VALUES ($1, 'task', $2::uuid, 'delete', $3)
	`, ownerID, id, oldTask)

	return nil
}

func (s *taskService) ListTasks(ctx context.Context, userID string, status string, dateFrom string, dateTo string, frequency string) ([]dto.TaskChecklistResponse, error) {
	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	query := `
		SELECT id, user_id, title, description, due_date, frequency, category, status, completed_at, created_at
		FROM task_checklists
		WHERE user_id = $1 AND deleted_at IS NULL
	`
	args := []interface{}{ownerID}
	argIdx := 2

	if status != "" {
		query += fmt.Sprintf(" AND status = $%d", argIdx)
		args = append(args, status)
		argIdx++
	}

	if frequency != "" {
		query += fmt.Sprintf(" AND frequency = $%d", argIdx)
		args = append(args, frequency)
		argIdx++
	}

	if dateFrom != "" {
		parsedDate, err := time.Parse("2006-01-02", dateFrom)
		if err == nil {
			query += fmt.Sprintf(" AND due_date >= $%d", argIdx)
			args = append(args, parsedDate)
			argIdx++
		}
	}

	if dateTo != "" {
		parsedDate, err := time.Parse("2006-01-02", dateTo)
		if err == nil {
			query += fmt.Sprintf(" AND due_date <= $%d", argIdx)
			args = append(args, parsedDate)
			argIdx++
		}
	}

	query += " ORDER BY due_date ASC NULLS LAST, created_at DESC"

	rows, err := s.dbPool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := make([]dto.TaskChecklistResponse, 0)
	for rows.Next() {
		var t model.TaskChecklist
		var desc, category *string
		var dueDate *time.Time
		err = rows.Scan(&t.ID, &t.UserID, &t.Title, &desc, &dueDate, &t.Frequency, &category, &t.Status, &t.CompletedAt, &t.CreatedAt)
		if err == nil {
			descStr := ""
			if desc != nil {
				descStr = *desc
			}
			catStr := ""
			if category != nil {
				catStr = *category
			}
			var dueDateStr *string
			if dueDate != nil {
				str := dueDate.Format("2006-01-02")
				dueDateStr = &str
			}
			list = append(list, dto.TaskChecklistResponse{
				ID:          t.ID,
				UserID:      t.UserID,
				Title:       t.Title,
				Description: descStr,
				DueDate:     dueDateStr,
				Frequency:   t.Frequency,
				Category:    catStr,
				Status:      t.Status,
				CompletedAt: t.CompletedAt,
				CreatedAt:   t.CreatedAt,
			})
		}
	}

	return list, nil
}

func (s *taskService) RunAutoOverdue(ctx context.Context) (int64, error) {
	// Auto overdue: marks tasks WHERE due_date < today AND status='pending' -> 'overdue'
	res, err := s.dbPool.Exec(ctx, `
		UPDATE task_checklists
		SET status = 'overdue', updated_at = NOW()
		WHERE due_date < CURRENT_DATE AND status = 'pending' AND deleted_at IS NULL
	`)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected(), nil
}
