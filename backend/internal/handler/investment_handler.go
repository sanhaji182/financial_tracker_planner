package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/user/financial-os/internal/middleware"
	"github.com/user/financial-os/internal/service"
)

type InvestmentHandler struct {
	investmentService service.InvestmentService
}

func NewInvestmentHandler(investmentService service.InvestmentService) *InvestmentHandler {
	return &InvestmentHandler{investmentService: investmentService}
}

func (h *InvestmentHandler) RegisterRoutes(rg *gin.RouterGroup) {
	invGroup := rg.Group("/investment")
	invGroup.Use(middleware.AuthMiddleware())
	{
		invGroup.GET("/summary", h.GetInvestmentSummary)
	}
}

func (h *InvestmentHandler) GetInvestmentSummary(c *gin.Context) {
	userID := c.GetString("user_id")

	res, err := h.investmentService.GetInvestmentSummary(c.Request.Context(), userID)
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
