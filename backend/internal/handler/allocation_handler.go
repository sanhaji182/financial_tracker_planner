package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/user/financial-os/internal/middleware"
	"github.com/user/financial-os/internal/service"
)

type AllocationHandler struct {
	allocationService service.AllocationService
}

func NewAllocationHandler(allocationService service.AllocationService) *AllocationHandler {
	return &AllocationHandler{allocationService: allocationService}
}

func (h *AllocationHandler) RegisterRoutes(rg *gin.RouterGroup) {
	allocGroup := rg.Group("/allocation-advice")
	allocGroup.Use(middleware.AuthMiddleware())
	{
		allocGroup.GET("", h.GetAllocationAdvice)
	}
}

func (h *AllocationHandler) GetAllocationAdvice(c *gin.Context) {
	userID := c.GetString("user_id")

	res, err := h.allocationService.GetAllocationAdvice(c.Request.Context(), userID)
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
