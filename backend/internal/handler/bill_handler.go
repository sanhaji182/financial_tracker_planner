package handler

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/middleware"
	"github.com/user/financial-os/internal/service"
)

type BillHandler struct {
	billService service.BillService
}

func NewBillHandler(billService service.BillService) *BillHandler {
	return &BillHandler{billService: billService}
}

func (h *BillHandler) RegisterRoutes(rg *gin.RouterGroup) {
	billsGroup := rg.Group("/bills")
	billsGroup.Use(middleware.AuthMiddleware())
	{
		// Owner-only mutative actions
		billsGroup.POST("", middleware.RoleMiddleware("owner"), h.CreateBill)
		billsGroup.PUT("/:id", middleware.RoleMiddleware("owner"), h.UpdateBill)
		billsGroup.DELETE("/:id", middleware.RoleMiddleware("owner"), h.DeleteBill)
		billsGroup.POST("/:id/payments", middleware.RoleMiddleware("owner"), h.PayBill)

		// Shared read actions
		billsGroup.GET("", h.ListBills)
		billsGroup.GET("/:id", h.GetBillByID)
		billsGroup.GET("/upcoming", h.GetUpcomingBills)
		billsGroup.GET("/monthly-commitment", h.GetMonthlyCommitment)
	}
}

func (h *BillHandler) CreateBill(c *gin.Context) {
	userID := c.GetString("user_id")

	var req dto.CreateBillRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{
				"code":    "VALIDATION_ERROR",
				"message": err.Error(),
			},
		})
		return
	}

	res, err := h.billService.CreateBill(c.Request.Context(), userID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{
				"code":    "INTERNAL_SERVER_ERROR",
				"message": err.Error(),
			},
		})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"data":    res,
		"message": "Bill created successfully",
	})
}

func (h *BillHandler) UpdateBill(c *gin.Context) {
	id := c.Param("id")

	var req dto.UpdateBillRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{
				"code":    "VALIDATION_ERROR",
				"message": err.Error(),
			},
		})
		return
	}

	err := h.billService.UpdateBill(c.Request.Context(), id, req)
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
		"message": "Bill updated successfully",
	})
}

func (h *BillHandler) DeleteBill(c *gin.Context) {
	id := c.Param("id")

	err := h.billService.DeleteBill(c.Request.Context(), id)
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
		"message": "Bill soft deleted successfully",
	})
}

func (h *BillHandler) ListBills(c *gin.Context) {
	userID := c.GetString("user_id")
	status := c.Query("status")
	month := c.Query("month") // YYYY-MM



	res, err := h.billService.ListBills(c.Request.Context(), userID, status, month)
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

func (h *BillHandler) GetBillByID(c *gin.Context) {
	id := c.Param("id")

	res, err := h.billService.GetBillByID(c.Request.Context(), id)
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

func (h *BillHandler) PayBill(c *gin.Context) {
	id := c.Param("id")

	var req dto.PayBillRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{
				"code":    "VALIDATION_ERROR",
				"message": err.Error(),
			},
		})
		return
	}

	res, err := h.billService.PayBill(c.Request.Context(), id, req)
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
		"data":    res,
		"message": "Bill payment recorded successfully",
	})
}

func (h *BillHandler) GetUpcomingBills(c *gin.Context) {
	userID := c.GetString("user_id")
	daysStr := c.DefaultQuery("days", "7")
	days, err := strconv.Atoi(daysStr)
	if err != nil {
		days = 7
	}

	res, err := h.billService.GetUpcomingBills(c.Request.Context(), userID, days)
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

func (h *BillHandler) GetMonthlyCommitment(c *gin.Context) {
	userID := c.GetString("user_id")
	month := c.Query("month") // YYYY-MM
	if month == "" {
		month = time.Now().Format("2006-01")
	}

	res, err := h.billService.GetMonthlyCommitment(c.Request.Context(), userID, month)
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
