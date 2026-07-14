package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/middleware"
	"github.com/user/financial-os/internal/service"
)

type ProtectionHandler struct {
	protectionService service.ProtectionService
}

func NewProtectionHandler(protectionService service.ProtectionService) *ProtectionHandler {
	return &ProtectionHandler{protectionService: protectionService}
}

func (h *ProtectionHandler) RegisterRoutes(rg *gin.RouterGroup) {
	protectionGroup := rg.Group("/protection")
	protectionGroup.Use(middleware.AuthMiddleware())
	{
		protectionGroup.GET("/assessment", h.GetAssessment)
		protectionGroup.PUT("/profile", middleware.RoleMiddleware("owner"), h.UpdateProfile)
	}
}

func (h *ProtectionHandler) GetAssessment(c *gin.Context) {
	userID := c.GetString("user_id")

	res, err := h.protectionService.GetAssessment(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": res})
}

func (h *ProtectionHandler) UpdateProfile(c *gin.Context) {
	userID := c.GetString("user_id")

	var req dto.UpdateProtectionProfileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{"code": "VALIDATION_ERROR", "message": err.Error()},
		})
		return
	}

	err := h.protectionService.UpdateProfile(c.Request.Context(), userID, &req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Protection profile updated successfully"})
}
