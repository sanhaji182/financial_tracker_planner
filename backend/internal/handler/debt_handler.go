package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/go-playground/validator/v10"

	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/middleware"
	"github.com/user/financial-os/internal/service"
)

type DebtHandler struct {
	debtService service.DebtService
}

func NewDebtHandler(debtService service.DebtService) *DebtHandler {
	return &DebtHandler{debtService: debtService}
}

func (h *DebtHandler) RegisterRoutes(rg *gin.RouterGroup) {
	debtsGroup := rg.Group("/debts")
	debtsGroup.Use(middleware.AuthMiddleware())
	{
		// All users (owner and spouse) can view debt listings, summaries and simulations
		debtsGroup.GET("", h.List)
		debtsGroup.GET("/summary", h.Summary)
		debtsGroup.GET("/avalanche", h.SimulateAvalanche)
		debtsGroup.GET("/:id", h.Detail)

		// Owner only mutations
		debtsGroup.POST("", middleware.RoleMiddleware("owner"), h.Create)
		debtsGroup.PUT("/:id", middleware.RoleMiddleware("owner"), h.Update)
		debtsGroup.DELETE("/:id", middleware.RoleMiddleware("owner"), h.Delete)
		debtsGroup.POST("/:id/payments", middleware.RoleMiddleware("owner"), h.RecordPayment)
	}
}

func (h *DebtHandler) List(c *gin.Context) {
	userID := c.GetString("user_id")

	res, err := h.debtService.GetDebts(c.Request.Context(), userID)
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

func (h *DebtHandler) Summary(c *gin.Context) {
	userID := c.GetString("user_id")

	res, err := h.debtService.GetDebtSummary(c.Request.Context(), userID)
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

func (h *DebtHandler) Detail(c *gin.Context) {
	debtID := c.Param("id")
	userID := c.GetString("user_id")

	res, err := h.debtService.GetDebtByID(c.Request.Context(), debtID, userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"error": gin.H{
				"code":    "NOT_FOUND",
				"message": err.Error(),
			},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"data": res,
	})
}

func (h *DebtHandler) Create(c *gin.Context) {
	userID := c.GetString("user_id")

	var req dto.CreateDebtRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		h.handleValidationError(c, err)
		return
	}

	res, err := h.debtService.CreateDebt(c.Request.Context(), userID, req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{
				"code":    "BAD_REQUEST",
				"message": err.Error(),
			},
		})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"message": "Debt created successfully",
		"data":    res,
	})
}

func (h *DebtHandler) Update(c *gin.Context) {
	debtID := c.Param("id")
	userID := c.GetString("user_id")

	var req dto.UpdateDebtRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		h.handleValidationError(c, err)
		return
	}

	res, err := h.debtService.UpdateDebt(c.Request.Context(), debtID, userID, req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{
				"code":    "BAD_REQUEST",
				"message": err.Error(),
			},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Debt updated successfully",
		"data":    res,
	})
}

func (h *DebtHandler) Delete(c *gin.Context) {
	debtID := c.Param("id")
	userID := c.GetString("user_id")

	err := h.debtService.DeleteDebt(c.Request.Context(), debtID, userID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{
				"code":    "BAD_REQUEST",
				"message": err.Error(),
			},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Debt deleted successfully",
	})
}

func (h *DebtHandler) RecordPayment(c *gin.Context) {
	debtID := c.Param("id")
	userID := c.GetString("user_id")

	var req dto.RecordDebtPaymentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		h.handleValidationError(c, err)
		return
	}

	res, err := h.debtService.RecordPayment(c.Request.Context(), debtID, userID, req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{
				"code":    "BAD_REQUEST",
				"message": err.Error(),
			},
		})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"message": "Debt payment recorded successfully",
		"data":    res,
	})
}

func (h *DebtHandler) SimulateAvalanche(c *gin.Context) {
	userID := c.GetString("user_id")

	extraStr := c.Query("extra")
	var extra float64
	if extraStr != "" {
		val, err := strconv.ParseFloat(extraStr, 64)
		if err == nil {
			extra = val
		}
	}

	res, err := h.debtService.SimulateAvalanche(c.Request.Context(), userID, extra)
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

func (h *DebtHandler) handleValidationError(c *gin.Context, err error) {
	var details []gin.H

	if verrs, ok := err.(validator.ValidationErrors); ok {
		for _, f := range verrs {
			details = append(details, gin.H{
				"field":  f.Field(),
				"reason": f.Tag(),
			})
		}
	}

	c.JSON(http.StatusUnprocessableEntity, gin.H{
		"error": gin.H{
			"code":    "VALIDATION_ERROR",
			"message": "Input validation failed",
			"details": details,
		},
	})
}
