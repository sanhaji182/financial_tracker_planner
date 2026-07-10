package model

import "time"

type TaskChecklist struct {
	ID          string     `json:"id" db:"id"`
	UserID      string     `json:"user_id" db:"user_id"`
	Title       string     `json:"title" db:"title"`
	Description *string    `json:"description,omitempty" db:"description"`
	DueDate     *time.Time `json:"due_date,omitempty" db:"due_date"`
	Frequency   string     `json:"frequency" db:"frequency"` // once, monthly, quarterly, yearly
	Category    *string    `json:"category,omitempty" db:"category"`
	Status      string     `json:"status" db:"status"` // pending, completed, overdue, skipped
	CompletedAt *time.Time `json:"completed_at,omitempty" db:"completed_at"`
	CreatedAt   time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at" db:"updated_at"`
	DeletedAt   *time.Time `json:"-" db:"deleted_at"`
}
