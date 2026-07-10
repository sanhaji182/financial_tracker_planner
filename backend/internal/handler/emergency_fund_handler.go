package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/middleware"
	"github.com/user/financial-os/internal/service"
)

type EFHandler struct {
	efService service.EFService
}

func NewEFHandler(efService service.EFService) *EFHandler {
	return &EFHandler{efService: efService}
}

func (h *EFHandler) RegisterRoutes(rg *gin.RouterGroup) {
	efGroup := rg.Group("/emergency-fund")
	efGroup.Use(middleware.AuthMiddleware())
	{
		efGroup.GET("/summary", h.GetEFSummary)
		efGroup.PUT("/config", h.UpdateEFConfig)
	}
}

func (h *EFHandler) GetEFSummary(c *gin.Context) {
	userID := c.GetString("user_id")

	res, err := h.efService.GetEFSummary(c.Request.Context(), userID)
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

func (h *EFHandler) UpdateEFConfig(c *gin.Context) {
	userID := c.GetString("user_id")

	var req dto.UpdateEFConfigRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{
				"code":    "BAD_REQUEST",
				"message": err.Error(),
			},
		})
		return
	}

	err := h.efService.UpdateEFConfig(c.Request.Context(), userID, &req)
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
		"message": "Emergency fund config updated successfully",
	})
}
