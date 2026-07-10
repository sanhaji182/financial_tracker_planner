package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/user/financial-os/internal/middleware"
	"github.com/user/financial-os/internal/service"
)

type SharedViewHandler struct {
	sharedViewService service.SharedViewService
}

func NewSharedViewHandler(sharedViewService service.SharedViewService) *SharedViewHandler {
	return &SharedViewHandler{sharedViewService: sharedViewService}
}

func (h *SharedViewHandler) RegisterRoutes(rg *gin.RouterGroup) {
	sharedGroup := rg.Group("/shared-view")
	sharedGroup.Use(middleware.AuthMiddleware())
	// Allow both spouse_viewer and owner for easy preview/testing
	sharedGroup.Use(middleware.RoleMiddleware("spouse_viewer", "owner"))
	{
		sharedGroup.GET("/summary", h.GetSummary)
		sharedGroup.GET("/assets", h.GetAssets)
		sharedGroup.GET("/debts", h.GetDebts)
		sharedGroup.GET("/bills", h.GetBills)
	}
}

func (h *SharedViewHandler) GetSummary(c *gin.Context) {
	userID := c.GetString("user_id")

	res, err := h.sharedViewService.GetSharedSummary(c.Request.Context(), userID)
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

func (h *SharedViewHandler) GetAssets(c *gin.Context) {
	userID := c.GetString("user_id")

	res, err := h.sharedViewService.GetSharedAssets(c.Request.Context(), userID)
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

func (h *SharedViewHandler) GetDebts(c *gin.Context) {
	userID := c.GetString("user_id")

	res, err := h.sharedViewService.GetSharedDebts(c.Request.Context(), userID)
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

func (h *SharedViewHandler) GetBills(c *gin.Context) {
	userID := c.GetString("user_id")

	res, err := h.sharedViewService.GetSharedBills(c.Request.Context(), userID)
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
