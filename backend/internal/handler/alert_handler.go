package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/user/financial-os/internal/middleware"
	"github.com/user/financial-os/internal/service"
)

type AlertHandler struct {
	alertService service.AlertService
}

func NewAlertHandler(alertService service.AlertService) *AlertHandler {
	return &AlertHandler{alertService: alertService}
}

func (h *AlertHandler) RegisterRoutes(rg *gin.RouterGroup) {
	alertGroup := rg.Group("/alerts")
	alertGroup.Use(middleware.AuthMiddleware())
	{
		alertGroup.GET("", h.GetAlerts)
		alertGroup.GET("/unread-count", h.GetUnreadCount)
		alertGroup.PUT("/:id/read", h.MarkAsRead)
		alertGroup.PUT("/mark-all-read", h.MarkAllAsRead)
		alertGroup.DELETE("/:id", h.DismissAlert)
	}
}

func (h *AlertHandler) GetAlerts(c *gin.Context) {
	userID := c.GetString("user_id")
	severity := c.Query("severity")
	alertType := c.Query("type")
	unreadOnly := c.Query("unread") == "true"

	res, err := h.alertService.GetAlerts(c.Request.Context(), userID, severity, alertType, unreadOnly)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": res})
}

func (h *AlertHandler) GetUnreadCount(c *gin.Context) {
	userID := c.GetString("user_id")
	count, err := h.alertService.GetUnreadCount(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()},
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"unread_count": count}})
}

func (h *AlertHandler) MarkAsRead(c *gin.Context) {
	userID := c.GetString("user_id")
	alertID := c.Param("id")

	if err := h.alertService.MarkAsRead(c.Request.Context(), userID, alertID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()},
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Alert marked as read"})
}

func (h *AlertHandler) MarkAllAsRead(c *gin.Context) {
	userID := c.GetString("user_id")

	if err := h.alertService.MarkAllAsRead(c.Request.Context(), userID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()},
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "All alerts marked as read"})
}

func (h *AlertHandler) DismissAlert(c *gin.Context) {
	userID := c.GetString("user_id")
	alertID := c.Param("id")

	if err := h.alertService.DismissAlert(c.Request.Context(), userID, alertID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()},
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Alert dismissed"})
}
