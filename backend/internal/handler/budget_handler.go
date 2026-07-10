package handler

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/middleware"
	"github.com/user/financial-os/internal/service"
)

type BudgetHandler struct {
	budgetService service.BudgetService
}

func NewBudgetHandler(budgetService service.BudgetService) *BudgetHandler {
	return &BudgetHandler{budgetService: budgetService}
}

func (h *BudgetHandler) RegisterRoutes(rg *gin.RouterGroup) {
	budgetGroup := rg.Group("/budgets")
	budgetGroup.Use(middleware.AuthMiddleware())
	{
		budgetGroup.GET("", h.GetBudgets)
		budgetGroup.POST("", h.SetBudget)
		budgetGroup.PUT("/:id", h.UpdateBudget)
		budgetGroup.DELETE("/:id", h.DeleteBudget)
		budgetGroup.POST("/copy", h.CopyFromPreviousMonth)
		budgetGroup.GET("/summary", h.GetBudgetSummary)
	}
}

func (h *BudgetHandler) GetBudgets(c *gin.Context) {
	userID := c.GetString("user_id")
	month := c.Query("month")
	if month == "" {
		month = time.Now().Format("2006-01")
	}

	res, err := h.budgetService.GetBudgets(c.Request.Context(), userID, month)
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

func (h *BudgetHandler) SetBudget(c *gin.Context) {
	userID := c.GetString("user_id")

	var req dto.BudgetRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{
				"code":    "BAD_REQUEST",
				"message": err.Error(),
			},
		})
		return
	}

	res, err := h.budgetService.SetBudget(c.Request.Context(), userID, &req)
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
		"message": "Budget registered successfully",
		"data":    res,
	})
}

func (h *BudgetHandler) UpdateBudget(c *gin.Context) {
	userID := c.GetString("user_id")
	id := c.Param("id")

	var req dto.UpdateBudgetRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{
				"code":    "BAD_REQUEST",
				"message": err.Error(),
			},
		})
		return
	}

	res, err := h.budgetService.UpdateBudget(c.Request.Context(), userID, id, &req)
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
		"message": "Budget updated successfully",
		"data":    res,
	})
}

func (h *BudgetHandler) DeleteBudget(c *gin.Context) {
	userID := c.GetString("user_id")
	id := c.Param("id")

	err := h.budgetService.DeleteBudget(c.Request.Context(), userID, id)
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
		"message": "Budget deleted successfully",
	})
}

func (h *BudgetHandler) CopyFromPreviousMonth(c *gin.Context) {
	userID := c.GetString("user_id")
	fromMonth := c.Query("from")
	toMonth := c.Query("to")

	if fromMonth == "" || toMonth == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{
				"code":    "BAD_REQUEST",
				"message": "both 'from' and 'to' month parameters are required",
			},
		})
		return
	}

	err := h.budgetService.CopyFromPreviousMonth(c.Request.Context(), userID, fromMonth, toMonth)
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
		"message": "Budgets copied successfully from previous month",
	})
}

func (h *BudgetHandler) GetBudgetSummary(c *gin.Context) {
	userID := c.GetString("user_id")
	month := c.Query("month")
	if month == "" {
		month = time.Now().Format("2006-01")
	}

	res, err := h.budgetService.GetBudgetSummary(c.Request.Context(), userID, month)
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
