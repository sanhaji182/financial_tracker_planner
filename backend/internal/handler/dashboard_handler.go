package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/user/financial-os/internal/middleware"
	"github.com/user/financial-os/internal/service"
)

type DashboardHandler struct {
	dashboardService service.DashboardService
}

func NewDashboardHandler(dashboardService service.DashboardService) *DashboardHandler {
	return &DashboardHandler{dashboardService: dashboardService}
}

func (h *DashboardHandler) RegisterRoutes(rg *gin.RouterGroup) {
	dashboardGroup := rg.Group("/dashboard")
	dashboardGroup.Use(middleware.AuthMiddleware())
	{
		dashboardGroup.GET("", h.GetDashboard)
	}
}

func (h *DashboardHandler) GetDashboard(c *gin.Context) {
	userID := c.GetString("user_id")

	res, err := h.dashboardService.GetDashboardData(c.Request.Context(), userID)
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
