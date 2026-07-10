package handler

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/user/financial-os/internal/middleware"
	"github.com/user/financial-os/internal/service"
)

type AuditHandler struct {
	auditService service.AuditService
}

func NewAuditHandler(auditService service.AuditService) *AuditHandler {
	return &AuditHandler{auditService: auditService}
}

func (h *AuditHandler) RegisterRoutes(rg *gin.RouterGroup) {
	auditGroup := rg.Group("/audit-logs")
	auditGroup.Use(middleware.AuthMiddleware())
	{
		auditGroup.GET("", h.GetGlobalAuditLogs)
		auditGroup.GET("/:entity_type/:entity_id", h.GetEntityAuditLogs)
	}
}

func (h *AuditHandler) GetGlobalAuditLogs(c *gin.Context) {
	userID := c.GetString("user_id")
	entityType := c.Query("entity_type")
	targetUserID := c.Query("user_id")

	var dateFrom, dateTo *time.Time

	if fromStr := c.Query("date_from"); fromStr != "" {
		if t, err := time.Parse("2006-01-02", fromStr); err == nil {
			dateFrom = &t
		}
	}

	if toStr := c.Query("date_to"); toStr != "" {
		if t, err := time.Parse("2006-01-02", toStr); err == nil {
			// Add 23h59m59s to include the entire day
			endOfDay := t.Add(24*time.Hour - time.Second)
			dateTo = &endOfDay
		}
	}

	res, err := h.auditService.GetGlobalAuditLogs(c.Request.Context(), userID, entityType, dateFrom, dateTo, targetUserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": res})
}

func (h *AuditHandler) GetEntityAuditLogs(c *gin.Context) {
	entityType := c.Param("entity_type")
	entityID := c.Param("entity_id")

	res, err := h.auditService.GetAuditLogs(c.Request.Context(), entityType, entityID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": res})
}
