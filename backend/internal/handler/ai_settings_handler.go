package handler

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/middleware"
	"github.com/user/financial-os/internal/service"
)

type AISettingsHandler struct {
	aiService        service.AISettingsService
	dashboardService service.DashboardService
	efService        service.EFService
	budgetService    service.BudgetService
	auditService     service.AuditService
}

func NewAISettingsHandler(
	aiService service.AISettingsService,
	dashboardService service.DashboardService,
	efService service.EFService,
	budgetService service.BudgetService,
	auditService service.AuditService,
) *AISettingsHandler {
	return &AISettingsHandler{
		aiService:        aiService,
		dashboardService: dashboardService,
		efService:        efService,
		budgetService:    budgetService,
		auditService:     auditService,
	}
}

func (h *AISettingsHandler) RegisterRoutes(rg *gin.RouterGroup) {
	aiGroup := rg.Group("/settings/ai")
	aiGroup.Use(middleware.AuthMiddleware())
	{
		// Only owner can view or edit AI settings
		aiGroup.GET("", middleware.RoleMiddleware("owner"), h.GetSettings)
		aiGroup.PUT("", middleware.RoleMiddleware("owner"), h.UpdateSettings)
	}

	chatGroup := rg.Group("/ai")
	chatGroup.Use(middleware.AuthMiddleware())
	{
		// Both owner and spouse can chat with advisor
		chatGroup.POST("/chat", middleware.RoleMiddleware("owner", "spouse_viewer"), h.Chat)
		// Only owner can trigger manual anomaly detection
		chatGroup.POST("/detect-anomaly", middleware.RoleMiddleware("owner"), h.DetectAnomaly)
	}
}

func (h *AISettingsHandler) GetSettings(c *gin.Context) {
	userID := c.GetString("user_id")

	res, err := h.aiService.GetSettings(c.Request.Context(), userID)
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
		"data": res,
	})
}

func (h *AISettingsHandler) UpdateSettings(c *gin.Context) {
	userID := c.GetString("user_id")

	var req dto.UpdateAISettingsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{
				"code":    "BAD_REQUEST",
				"message": err.Error(),
			},
		})
		return
	}

	// Fetch old settings for audit log
	oldSettings, _ := h.aiService.GetSettings(c.Request.Context(), userID)

	err := h.aiService.UpdateSettings(c.Request.Context(), userID, &req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{
				"code":    "INTERNAL_SERVER_ERROR",
				"message": err.Error(),
			},
		})
		return
	}

	// Create audit log
	ip := c.ClientIP()
	ua := c.Request.UserAgent()
	_ = h.auditService.CreateAuditLog(
		c.Request.Context(),
		userID,
		"ai_settings",
		userID,
		"update",
		oldSettings,
		req,
		&ip,
		&ua,
	)

	c.JSON(http.StatusOK, gin.H{
		"message": "AI settings updated successfully",
	})
}

func (h *AISettingsHandler) Chat(c *gin.Context) {
	userID := c.GetString("user_id")

	var req dto.AIChatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{
				"code":    "BAD_REQUEST",
				"message": err.Error(),
			},
		})
		return
	}

	// 1. Gather dashboard, ef and budget context for the AI
	ctx := c.Request.Context()
	
	// Fetch dashboard summary
	dashboard, err := h.dashboardService.GetDashboardData(ctx, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{
				"code":    "INTERNAL_SERVER_ERROR",
				"message": "Failed to fetch dashboard data: " + err.Error(),
			},
		})
		return
	}

	// Fetch Emergency Fund status
	efSummary, _ := h.efService.GetEFSummary(ctx, userID)

	// Fetch Budget summary for the current month
	currentMonth := time.Now().Format("2006-01")
	budgetSummary, _ := h.budgetService.GetBudgetSummary(ctx, userID, currentMonth)

	// Construct context block
	workerContext := map[string]interface{}{
		"dashboard":      dashboard,
		"emergency_fund": efSummary,
		"budget":         budgetSummary,
	}

	// 2. Prepare worker payload
	workerPayload := map[string]interface{}{
		"message": req.Message,
		"context": workerContext,
	}

	// 3. Call Worker
	var workerResp dto.AIChatResponse
	err = h.aiService.CallWorkerAI(ctx, userID, "/ai/chat", workerPayload, &workerResp)
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
		"data": workerResp,
	})
}

func (h *AISettingsHandler) DetectAnomaly(c *gin.Context) {
	userID := c.GetString("user_id")

	res, err := h.aiService.DetectAnomalies(c.Request.Context(), userID)
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
		"data": res,
	})
}
