package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/middleware"
	"github.com/user/financial-os/internal/service"
)

type ReconciliationHandler struct {
	reconciliationService service.ReconciliationService
}

func NewReconciliationHandler(reconciliationService service.ReconciliationService) *ReconciliationHandler {
	return &ReconciliationHandler{reconciliationService: reconciliationService}
}

func (h *ReconciliationHandler) RegisterRoutes(rg *gin.RouterGroup) {
	reconGroup := rg.Group("/reconciliation")
	reconGroup.Use(middleware.AuthMiddleware())
	{
		reconGroup.POST("/start", h.StartReconciliation)
		reconGroup.POST("/confirm", h.ConfirmReconciliation)
	}
}

func (h *ReconciliationHandler) StartReconciliation(c *gin.Context) {
	userID := c.GetString("user_id")

	var req dto.ReconciliationStartRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{
				"code":    "BAD_REQUEST",
				"message": err.Error(),
			},
		})
		return
	}

	res, err := h.reconciliationService.StartReconciliation(c.Request.Context(), userID, &req)
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

func (h *ReconciliationHandler) ConfirmReconciliation(c *gin.Context) {
	userID := c.GetString("user_id")

	var req dto.ReconciliationConfirmRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{
				"code":    "BAD_REQUEST",
				"message": err.Error(),
			},
		})
		return
	}

	err := h.reconciliationService.ConfirmReconciliation(c.Request.Context(), userID, &req)
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
		"message": "Reconciliation confirmed successfully",
	})
}
