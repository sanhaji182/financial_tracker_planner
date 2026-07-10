package handler

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/middleware"
	"github.com/user/financial-os/internal/service"
)

// ScenarioHandler handles HTTP requests for What-If scenario simulations
type ScenarioHandler struct {
	scenarioService service.ScenarioService
}

// NewScenarioHandler creates a new ScenarioHandler
func NewScenarioHandler(scenarioService service.ScenarioService) *ScenarioHandler {
	return &ScenarioHandler{scenarioService: scenarioService}
}

// RegisterRoutes registers endpoints with route groups
func (h *ScenarioHandler) RegisterRoutes(rg *gin.RouterGroup) {
	group := rg.Group("/scenarios")
	group.Use(middleware.AuthMiddleware())
	{
		// GET /api/v1/scenarios
		group.GET("", h.GetScenarios)
		// POST /api/v1/scenarios/simulate
		group.POST("/simulate", h.SimulateScenario)
		// POST /api/v1/scenarios (Owner only)
		group.POST("", middleware.RoleMiddleware("owner"), h.SaveScenario)
		// DELETE /api/v1/scenarios/:id (Owner only)
		group.DELETE("/:id", middleware.RoleMiddleware("owner"), h.DeleteScenario)
	}
}

// GetScenarios returns all saved scenario templates
func (h *ScenarioHandler) GetScenarios(c *gin.Context) {
	userID := c.GetString("user_id")

	res, err := h.scenarioService.GetScenarios(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": res})
}

// SimulateScenario runs simulation without storing it
func (h *ScenarioHandler) SimulateScenario(c *gin.Context) {
	userID := c.GetString("user_id")

	var req dto.SimulateScenarioRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{"code": "BAD_REQUEST", "message": err.Error()},
		})
		return
	}

	res, err := h.scenarioService.SimulateScenario(c.Request.Context(), userID, req.Changes)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": res})
}

// SaveScenario saves simulated template
func (h *ScenarioHandler) SaveScenario(c *gin.Context) {
	userID := c.GetString("user_id")

	var req dto.SaveScenarioRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{"code": "BAD_REQUEST", "message": err.Error()},
		})
		return
	}

	res, err := h.scenarioService.SaveScenario(c.Request.Context(), userID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()},
		})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"data": res})
}

// DeleteScenario deletes a saved scenario
func (h *ScenarioHandler) DeleteScenario(c *gin.Context) {
	userID := c.GetString("user_id")
	id := c.Param("id")

	err := h.scenarioService.DeleteScenario(c.Request.Context(), userID, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			c.JSON(http.StatusNotFound, gin.H{
				"error": gin.H{"code": "NOT_FOUND", "message": "Scenario not found or not owned by you"},
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Scenario deleted successfully",
	})
}
