package handler

import (
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/go-playground/validator/v10"

	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/middleware"
	"github.com/user/financial-os/internal/service"
)

type AuthHandler struct {
	authService service.AuthService
}

func NewAuthHandler(authService service.AuthService) *AuthHandler {
	return &AuthHandler{authService: authService}
}

// RegisterRoutes mounts auth endpoints on the provided group.
// Callers should pass a group already rooted at /auth (with rate limiting applied).
func (h *AuthHandler) RegisterRoutes(authGroup *gin.RouterGroup) {
	// Public (rate-limited by caller)
	authGroup.POST("/register", h.Register)
	authGroup.POST("/login", h.Login)
	authGroup.POST("/refresh", h.Refresh)
	authGroup.POST("/register-spouse", h.RegisterSpouse) // Token passed in query or body

	// Protected routes
	authGroup.POST("/logout", middleware.AuthMiddleware(), h.Logout)
	authGroup.POST("/invite-spouse", middleware.AuthMiddleware(), middleware.RoleMiddleware("owner"), h.InviteSpouse)
	authGroup.PUT("/change-password", middleware.AuthMiddleware(), h.ChangePassword)
	authGroup.GET("/me", middleware.AuthMiddleware(), h.GetMe)
}

func (h *AuthHandler) Register(c *gin.Context) {
	var req dto.RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		h.handleValidationError(c, err)
		return
	}

	res, err := h.authService.Register(c.Request.Context(), req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{
				"code":    "BAD_REQUEST",
				"message": err.Error(),
			},
		})
		return
	}

	h.setRefreshTokenCookie(c, res.RefreshToken)
	c.JSON(http.StatusCreated, gin.H{
		"message": "User registered successfully",
		"data":    authResponseData(res),
	})
}

func (h *AuthHandler) Login(c *gin.Context) {
	var req dto.LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		h.handleValidationError(c, err)
		return
	}

	res, err := h.authService.Login(c.Request.Context(), req)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": gin.H{
				"code":    "UNAUTHORIZED",
				"message": err.Error(),
			},
		})
		return
	}

	h.setRefreshTokenCookie(c, res.RefreshToken)
	c.JSON(http.StatusOK, gin.H{
		"message": "Login successful",
		"data":    authResponseData(res),
	})
}

func (h *AuthHandler) Refresh(c *gin.Context) {
	// Try to get refresh token from cookie first, then fall back to JSON body
	refreshToken, err := c.Cookie("refresh_token")
	if err != nil {
		var req struct {
			RefreshToken string `json:"refresh_token" binding:"required"`
		}
		if bindErr := c.ShouldBindJSON(&req); bindErr != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": gin.H{
					"code":    "BAD_REQUEST",
					"message": "Refresh token is required via cookie or request body",
				},
			})
			return
		}
		refreshToken = req.RefreshToken
	}

	res, err := h.authService.RefreshToken(c.Request.Context(), refreshToken)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": gin.H{
				"code":    "UNAUTHORIZED",
				"message": err.Error(),
			},
		})
		return
	}

	h.setRefreshTokenCookie(c, res.RefreshToken)
	c.JSON(http.StatusOK, gin.H{
		"message": "Token refreshed successfully",
		"data":    authResponseData(res),
	})
}

func (h *AuthHandler) Logout(c *gin.Context) {
	refreshToken, err := c.Cookie("refresh_token")
	if err != nil {
		var req struct {
			RefreshToken string `json:"refresh_token" binding:"required"`
		}
		if bindErr := c.ShouldBindJSON(&req); bindErr != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": gin.H{
					"code":    "BAD_REQUEST",
					"message": "Refresh token is required via cookie or request body",
				},
			})
			return
		}
		refreshToken = req.RefreshToken
	}

	err = h.authService.Logout(c.Request.Context(), refreshToken)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{
				"code":    "BAD_REQUEST",
				"message": err.Error(),
			},
		})
		return
	}

	h.clearRefreshTokenCookie(c)
	c.JSON(http.StatusOK, gin.H{
		"message": "Logout successful",
	})
}

func (h *AuthHandler) InviteSpouse(c *gin.Context) {
	ownerID := c.GetString("user_id")

	var req dto.InviteSpouseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		h.handleValidationError(c, err)
		return
	}

	inviteLink, err := h.authService.InviteSpouse(c.Request.Context(), ownerID, req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{
				"code":    "BAD_REQUEST",
				"message": err.Error(),
			},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Spouse invited successfully",
		"data":    inviteLink,
	})
}

func (h *AuthHandler) RegisterSpouse(c *gin.Context) {
	inviteToken := c.Query("token")

	var req struct {
		InviteToken string `json:"invite_token"`
		dto.RegisterRequest
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		h.handleValidationError(c, err)
		return
	}

	// Use token from JSON if query is empty
	token := inviteToken
	if token == "" {
		token = req.InviteToken
	}

	if token == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{
				"code":    "BAD_REQUEST",
				"message": "Invitation token is required",
			},
		})
		return
	}

	res, err := h.authService.RegisterSpouse(c.Request.Context(), token, req.RegisterRequest)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{
				"code":    "BAD_REQUEST",
				"message": err.Error(),
			},
		})
		return
	}

	h.setRefreshTokenCookie(c, res.RefreshToken)
	c.JSON(http.StatusCreated, gin.H{
		"message": "Spouse registered successfully",
		"data":    authResponseData(res),
	})
}

func (h *AuthHandler) ChangePassword(c *gin.Context) {
	userID := c.GetString("user_id")

	var req dto.ChangePasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		h.handleValidationError(c, err)
		return
	}

	err := h.authService.ChangePassword(c.Request.Context(), userID, req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{
				"code":    "BAD_REQUEST",
				"message": err.Error(),
			},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Password changed successfully",
	})
}

func (h *AuthHandler) GetMe(c *gin.Context) {
	userID := c.GetString("user_id")
	user, err := h.authService.GetMe(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{
				"code":    "INTERNAL_SERVER_ERROR",
				"message": err.Error(),
			},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"data": user.ToResponse(),
	})
}

// helper to set httpOnly cookie for refresh token
func authResponseData(res *dto.AuthResponse) gin.H {
	return gin.H{
		"access_token": res.AccessToken,
		"user":         res.User,
	}
}

func (h *AuthHandler) setRefreshTokenCookie(c *gin.Context, token string) {
	maxAge := int(7 * 24 * time.Hour / time.Second)
	secure := os.Getenv("APP_ENV") == "production"
	c.SetCookie("refresh_token", token, maxAge, "/api/v1/auth", "", secure, true)
}

func (h *AuthHandler) clearRefreshTokenCookie(c *gin.Context) {
	secure := os.Getenv("APP_ENV") == "production"
	c.SetCookie("refresh_token", "", -1, "/api/v1/auth", "", secure, true)
}

// formats validation errors according to standard REST/API conventions
func (h *AuthHandler) handleValidationError(c *gin.Context, err error) {
	var details []gin.H

	if verrs, ok := err.(validator.ValidationErrors); ok {
		for _, f := range verrs {
			details = append(details, gin.H{
				"field":  f.Field(),
				"reason": f.Tag(),
			})
		}
	}

	c.JSON(http.StatusUnprocessableEntity, gin.H{
		"error": gin.H{
			"code":    "VALIDATION_ERROR",
			"message": "Input validation failed",
			"details": details,
		},
	})
}
