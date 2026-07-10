package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/middleware"
	"github.com/user/financial-os/internal/service"
)

// AutomationRuleHandler manages REST endpoints for automation rule setups
type AutomationRuleHandler struct {
	ruleService service.AutomationRuleService
}

// NewAutomationRuleHandler creates a new AutomationRuleHandler
func NewAutomationRuleHandler(ruleService service.AutomationRuleService) *AutomationRuleHandler {
	return &AutomationRuleHandler{ruleService: ruleService}
}

// RegisterRoutes registers endpoints in router group
func (h *AutomationRuleHandler) RegisterRoutes(rg *gin.RouterGroup) {
	group := rg.Group("/automation-rules")
	group.Use(middleware.AuthMiddleware())
	{
		// GET /api/v1/automation-rules (Owner & Spouse)
		group.GET("", h.GetRules)
		// POST /api/v1/automation-rules (Owner only)
		group.POST("", middleware.RoleMiddleware("owner"), h.CreateRule)
		// PUT /api/v1/automation-rules/:id (Owner only)
		group.PUT("/:id", middleware.RoleMiddleware("owner"), h.UpdateRule)
		// DELETE /api/v1/automation-rules/:id (Owner only)
		group.DELETE("/:id", middleware.RoleMiddleware("owner"), h.DeleteRule)
		// POST /api/v1/automation-rules/evaluate (Owner only)
		group.POST("/evaluate", middleware.RoleMiddleware("owner"), h.EvaluateRules)
	}
}

// GetRules lists all registered rules
func (h *AutomationRuleHandler) GetRules(c *gin.Context) {
	userID := c.GetString("user_id")

	res, err := h.ruleService.GetRules(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": res})
}

// CreateRule inserts a new rule template
func (h *AutomationRuleHandler) CreateRule(c *gin.Context) {
	userID := c.GetString("user_id")

	var req dto.CreateAutomationRuleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{"code": "BAD_REQUEST", "message": err.Error()},
		})
		return
	}

	res, err := h.ruleService.CreateRule(c.Request.Context(), userID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()},
		})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"data": res})
}

// UpdateRule edits rule status or parameters
func (h *AutomationRuleHandler) UpdateRule(c *gin.Context) {
	userID := c.GetString("user_id")
	id := c.Param("id")

	var req dto.UpdateAutomationRuleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{"code": "BAD_REQUEST", "message": err.Error()},
		})
		return
	}

	res, err := h.ruleService.UpdateRule(c.Request.Context(), userID, id, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": res})
}

// DeleteRule removes a rule configuration
func (h *AutomationRuleHandler) DeleteRule(c *gin.Context) {
	userID := c.GetString("user_id")
	id := c.Param("id")

	err := h.ruleService.DeleteRule(c.Request.Context(), userID, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Automation rule deleted successfully",
	})
}

// EvaluateRules manual triggers rule engine scan
func (h *AutomationRuleHandler) EvaluateRules(c *gin.Context) {
	err := h.ruleService.EvaluateRules(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Automation rules evaluation completed successfully",
	})
}
