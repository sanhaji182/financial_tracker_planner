package model

import "time"

type HouseholdNote struct {
	ID        string     `json:"id" db:"id"`
	UserID    string     `json:"user_id" db:"user_id"`
	Title     string     `json:"title" db:"title"`
	Content   *string    `json:"content,omitempty" db:"content"`
	Tags      []string   `json:"tags" db:"tags"`
	NoteDate  time.Time  `json:"note_date" db:"note_date"`
	CreatedAt time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt time.Time  `json:"updated_at" db:"updated_at"`
	DeletedAt *time.Time `json:"-" db:"deleted_at"`
}
