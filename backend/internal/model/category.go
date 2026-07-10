package model

import "time"

type Category struct {
	ID        string     `json:"id" db:"id"`
	UserID    *string    `json:"user_id,omitempty" db:"user_id"`
	ParentID  *string    `json:"parent_id,omitempty" db:"parent_id"`
	Name      string     `json:"name" db:"name"`
	Type      string     `json:"type" db:"type"` // income, expense
	Icon      *string    `json:"icon,omitempty" db:"icon"`
	Color     *string    `json:"color,omitempty" db:"color"`
	IsSystem  bool       `json:"is_system" db:"is_system"`
	SortOrder int        `json:"sort_order" db:"sort_order"`
	CreatedAt time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt time.Time  `json:"updated_at" db:"updated_at"`
	DeletedAt *time.Time `json:"-" db:"deleted_at"`
}
