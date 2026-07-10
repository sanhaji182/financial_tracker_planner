package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/middleware"
	"github.com/user/financial-os/internal/service"
)

type GoalHandler struct {
	goalService service.GoalService
}

func NewGoalHandler(goalService service.GoalService) *GoalHandler {
	return &GoalHandler{goalService: goalService}
}

func (h *GoalHandler) RegisterRoutes(rg *gin.RouterGroup) {
	group := rg.Group("/goals")
	group.Use(middleware.AuthMiddleware())
	{
		group.POST("", middleware.RoleMiddleware("owner"), h.CreateGoal)
		group.GET("", h.ListGoals)
		group.GET("/:id", h.GetGoalByID)
		group.PUT("/:id", middleware.RoleMiddleware("owner"), h.UpdateGoal)
		group.DELETE("/:id", middleware.RoleMiddleware("owner"), h.DeleteGoal)
		group.POST("/:id/contribute", middleware.RoleMiddleware("owner"), h.ContributeToGoal)
	}
}

func (h *GoalHandler) CreateGoal(c *gin.Context) {
	userID := c.GetString("user_id")

	var req dto.CreateGoalRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{"code": "BAD_REQUEST", "message": err.Error()},
		})
		return
	}

	resp, err := h.goalService.CreateGoal(c.Request.Context(), userID, &req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()},
		})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"data": resp})
}

func (h *GoalHandler) GetGoalByID(c *gin.Context) {
	userID := c.GetString("user_id")
	id := c.Param("id")

	resp, err := h.goalService.GetGoalByID(c.Request.Context(), userID, id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"error": gin.H{"code": "NOT_FOUND", "message": err.Error()},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": resp})
}

func (h *GoalHandler) UpdateGoal(c *gin.Context) {
	userID := c.GetString("user_id")
	id := c.Param("id")

	var req dto.UpdateGoalRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{"code": "BAD_REQUEST", "message": err.Error()},
		})
		return
	}

	err := h.goalService.UpdateGoal(c.Request.Context(), userID, id, &req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Goal updated successfully"})
}

func (h *GoalHandler) DeleteGoal(c *gin.Context) {
	userID := c.GetString("user_id")
	id := c.Param("id")

	err := h.goalService.DeleteGoal(c.Request.Context(), userID, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Goal deleted successfully"})
}

func (h *GoalHandler) ListGoals(c *gin.Context) {
	userID := c.GetString("user_id")

	resp, err := h.goalService.ListGoals(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": resp})
}

func (h *GoalHandler) ContributeToGoal(c *gin.Context) {
	userID := c.GetString("user_id")
	id := c.Param("id")

	var req dto.GoalContributionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{"code": "BAD_REQUEST", "message": err.Error()},
		})
		return
	}

	err := h.goalService.ContributeToGoal(c.Request.Context(), userID, id, &req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Contribution recorded successfully"})
}
