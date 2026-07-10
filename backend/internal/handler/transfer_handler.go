package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/middleware"
	"github.com/user/financial-os/internal/service"
)

type TransferHandler struct {
	transferService service.TransferService
}

func NewTransferHandler(transferService service.TransferService) *TransferHandler {
	return &TransferHandler{transferService: transferService}
}

func (h *TransferHandler) RegisterRoutes(rg *gin.RouterGroup) {
	transferGroup := rg.Group("/transfers")
	transferGroup.Use(middleware.AuthMiddleware())
	{
		transferGroup.POST("", h.CreateTransfer)
		transferGroup.GET("", h.ListTransfers)
	}
}

func (h *TransferHandler) CreateTransfer(c *gin.Context) {
	userID := c.GetString("user_id")

	var req dto.TransferRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{
				"code":    "BAD_REQUEST",
				"message": err.Error(),
			},
		})
		return
	}

	res, err := h.transferService.CreateTransfer(c.Request.Context(), userID, &req)
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
		"message": "Transfer executed successfully",
		"data":    res,
	})
}

func (h *TransferHandler) ListTransfers(c *gin.Context) {
	userID := c.GetString("user_id")

	res, err := h.transferService.ListTransfers(c.Request.Context(), userID)
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
