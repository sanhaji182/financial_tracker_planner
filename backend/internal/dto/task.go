package dto

import "time"

type TaskChecklistResponse struct {
	ID          string     `json:"id"`
	UserID      string     `json:"user_id"`
	Title       string     `json:"title"`
	Description string     `json:"description"`
	DueDate     *string    `json:"due_date"` // YYYY-MM-DD
	Frequency   string     `json:"frequency"`
	Category    string     `json:"category"`
	Status      string     `json:"status"` // pending, completed, overdue, skipped
	CompletedAt *time.Time `json:"completed_at"`
	CreatedAt   time.Time  `json:"created_at"`
}

type CreateTaskRequest struct {
	Title       string  `json:"title" binding:"required"`
	Description string  `json:"description"`
	DueDate     string  `json:"due_date"` // YYYY-MM-DD
	Frequency   string  `json:"frequency"` // once, monthly, quarterly, yearly
	Category    string  `json:"category"`
}

type UpdateTaskRequest struct {
	Title       *string `json:"title"`
	Description *string `json:"description"`
	DueDate     *string `json:"due_date"` // YYYY-MM-DD
	Frequency   *string `json:"frequency"`
	Category    *string `json:"category"`
	Status      *string `json:"status"`
}
