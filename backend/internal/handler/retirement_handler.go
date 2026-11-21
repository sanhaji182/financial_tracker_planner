package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/middleware"
	"github.com/user/financial-os/internal/service"
)

type RetirementHandler struct {
	svc service.RetirementService
}

func NewRetirementHandler(svc service.RetirementService) *RetirementHandler {
	return &RetirementHandler{svc: svc}
}

func (h *RetirementHandler) RegisterRoutes(rg *gin.RouterGroup) {
	g := rg.Group("/retirement")
	g.Use(middleware.AuthMiddleware())
	{
		g.GET("/education", h.GetEducation)
		g.PUT("/profile", middleware.RoleMiddleware("owner"), h.UpdateProfile)
	}
}

func (h *RetirementHandler) GetEducation(c *gin.Context) {
	userID := c.GetString("user_id")
	res, err := h.svc.GetEducation(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()}})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": res})
}

func (h *RetirementHandler) UpdateProfile(c *gin.Context) {
	userID := c.GetString("user_id")
	var req dto.UpdateRetirementProfileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": gin.H{"code": "VALIDATION_ERROR", "message": err.Error()}})
		return
	}
	if err := h.svc.UpdateProfile(c.Request.Context(), userID, &req); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()}})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Retirement profile updated"})
}
