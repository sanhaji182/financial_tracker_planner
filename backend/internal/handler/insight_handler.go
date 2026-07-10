package handler

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/user/financial-os/internal/middleware"
	"github.com/user/financial-os/internal/service"
)

// InsightHandler handles monthly insight endpoints
type InsightHandler struct {
	insightService service.InsightService
}

// NewInsightHandler creates a new InsightHandler
func NewInsightHandler(insightService service.InsightService) *InsightHandler {
	return &InsightHandler{insightService: insightService}
}

// RegisterRoutes registers insight API routes
func (h *InsightHandler) RegisterRoutes(rg *gin.RouterGroup) {
	group := rg.Group("/insights")
	group.Use(middleware.AuthMiddleware())
	{
		// GET /api/v1/insights?month=2026-07
		group.GET("", h.GetInsights)
		// POST /api/v1/insights/generate?month=2026-07
		group.POST("/generate", middleware.RoleMiddleware("owner"), h.GenerateInsights)
	}
}

// GetInsights returns insights for a given month (auto-generates if none exist)
func (h *InsightHandler) GetInsights(c *gin.Context) {
	userID := c.GetString("user_id")

	month := c.Query("month")
	if month == "" {
		month = time.Now().Format("2006-01")
	}

	resp, err := h.insightService.GetInsights(c.Request.Context(), userID, month)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()},
		})
		return
	}

	c.JSON(http.StatusOK, resp)
}

// GenerateInsights manually triggers insight regeneration for a given month
func (h *InsightHandler) GenerateInsights(c *gin.Context) {
	userID := c.GetString("user_id")

	month := c.Query("month")
	if month == "" {
		month = time.Now().Format("2006-01")
	}

	resp, err := h.insightService.GenerateInsights(c.Request.Context(), userID, month)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()},
		})
		return
	}

	c.JSON(http.StatusOK, resp)
}
