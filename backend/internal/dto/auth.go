package dto

import (
	"github.com/user/financial-os/internal/model"
)

type RegisterRequest struct {
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required,min=8"`
	Name     string `json:"name" binding:"required"`
}

type LoginRequest struct {
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required"`
}

type AuthResponse struct {
	AccessToken  string             `json:"access_token"`
	RefreshToken string             `json:"refresh_token"`
	User         model.UserResponse `json:"user"`
}

type InviteSpouseRequest struct {
	Email string `json:"email" binding:"required,email"`
	Role  string `json:"role" binding:"omitempty,oneof=spouse_viewer spouse_co_owner"`
}

type InviteLink struct {
	Email      string `json:"email"`
	InviteLink string `json:"invite_link"`
	Token      string `json:"token"`
	Role       string `json:"role,omitempty"`
}

type ChangePasswordRequest struct {
	OldPassword string `json:"old_password" binding:"required"`
	NewPassword string `json:"new_password" binding:"required,min=8"`
}

type DeleteAccountRequest struct {
	Password string `json:"password" binding:"required"`
}
