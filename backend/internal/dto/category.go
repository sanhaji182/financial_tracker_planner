package dto

import (
	"time"

	"github.com/user/financial-os/internal/model"
)

type CreateCategoryRequest struct {
	Name     string  `json:"name" binding:"required"`
	Type     string  `json:"type" binding:"required,oneof=income expense"`
	Icon     *string `json:"icon"`
	Color    *string `json:"color"`
	ParentID *string `json:"parent_id"`
}

type UpdateCategoryRequest struct {
	Name  string  `json:"name" binding:"required"`
	Icon  *string `json:"icon"`
	Color *string `json:"color"`
}

type CategoryResponse struct {
	ID        string    `json:"id"`
	UserID    *string   `json:"user_id,omitempty"`
	ParentID  *string   `json:"parent_id,omitempty"`
	Name      string    `json:"name"`
	Type      string    `json:"type"`
	Icon      *string   `json:"icon,omitempty"`
	Color     *string   `json:"color,omitempty"`
	IsSystem  bool      `json:"is_system"`
	SortOrder int       `json:"sort_order"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func ToCategoryResponse(c *model.Category) CategoryResponse {
	return CategoryResponse{
		ID:        c.ID,
		UserID:    c.UserID,
		ParentID:  c.ParentID,
		Name:      c.Name,
		Type:      c.Type,
		Icon:      c.Icon,
		Color:     c.Color,
		IsSystem:  c.IsSystem,
		SortOrder: c.SortOrder,
		CreatedAt: c.CreatedAt,
		UpdatedAt: c.UpdatedAt,
	}
}
