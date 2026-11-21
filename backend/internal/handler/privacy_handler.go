package handler

import (
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/middleware"
	"github.com/user/financial-os/internal/service"
)

type PrivacyHandler struct {
	svc service.PrivacyService
}

func NewPrivacyHandler(svc service.PrivacyService) *PrivacyHandler {
	return &PrivacyHandler{svc: svc}
}

func (h *PrivacyHandler) RegisterRoutes(rg *gin.RouterGroup) {
	g := rg.Group("/privacy")
	g.Use(middleware.AuthMiddleware())
	{
		g.GET("/policy", h.GetPolicy)
		g.PUT("/ai-consent", middleware.RoleMiddleware("owner"), h.SetConsent)
		g.POST("/redact", h.Redact)
		g.GET("/export", middleware.RoleMiddleware("owner"), h.Export)
		g.POST("/delete", middleware.RoleMiddleware("owner"), h.Delete)
	}
}

func (h *PrivacyHandler) GetPolicy(c *gin.Context) {
	userID := c.GetString("user_id")
	res, err := h.svc.GetPolicy(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()}})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": res})
}

func (h *PrivacyHandler) SetConsent(c *gin.Context) {
	userID := c.GetString("user_id")
	var req dto.UpdateAIConsentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": gin.H{"code": "VALIDATION_ERROR", "message": err.Error()}})
		return
	}
	if err := h.svc.SetAIConsent(c.Request.Context(), userID, req.Granted); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()}})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "AI consent updated", "granted": req.Granted})
}

func (h *PrivacyHandler) Redact(c *gin.Context) {
	userID := c.GetString("user_id")
	var req dto.RedactRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": gin.H{"code": "VALIDATION_ERROR", "message": err.Error()}})
		return
	}
	res, err := h.svc.Redact(c.Request.Context(), userID, req.Text)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()}})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": res})
}

func (h *PrivacyHandler) Export(c *gin.Context) {
	userID := c.GetString("user_id")
	data, err := h.svc.ExportHousehold(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()}})
		return
	}
	fileName := fmt.Sprintf("household_export_%s.json", time.Now().Format("20060102"))
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%s", fileName))
	c.Data(http.StatusOK, "application/json", data)
}

func (h *PrivacyHandler) Delete(c *gin.Context) {
	userID := c.GetString("user_id")
	var req dto.DeleteHouseholdRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": gin.H{"code": "VALIDATION_ERROR", "message": err.Error()}})
		return
	}
	plan, err := h.svc.DeleteHousehold(c.Request.Context(), userID, req.ConfirmationPhrase)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": gin.H{"code": "BAD_REQUEST", "message": err.Error()}})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": plan})
}
