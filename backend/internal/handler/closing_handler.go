package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/middleware"
	"github.com/user/financial-os/internal/service"
)

type ClosingHandler struct {
	closingService service.ClosingService
}

func NewClosingHandler(closingService service.ClosingService) *ClosingHandler {
	return &ClosingHandler{closingService: closingService}
}

func (h *ClosingHandler) RegisterRoutes(rg *gin.RouterGroup) {
	closingGroup := rg.Group("/monthly-closing")
	closingGroup.Use(middleware.AuthMiddleware())
	{
		closingGroup.POST("/generate", h.GenerateClosing)
		closingGroup.GET("", h.ListClosings)
		closingGroup.GET("/:month", h.GetClosingDetail)
	}
}

func (h *ClosingHandler) GenerateClosing(c *gin.Context) {
	userID := c.GetString("user_id")

	var req dto.MonthlyClosingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{
				"code":    "BAD_REQUEST",
				"message": err.Error(),
			},
		})
		return
	}

	res, err := h.closingService.GenerateClosing(c.Request.Context(), userID, &req)
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
		"message": "Monthly closing report generated successfully",
		"data":    res,
	})
}

func (h *ClosingHandler) ListClosings(c *gin.Context) {
	userID := c.GetString("user_id")

	res, err := h.closingService.ListClosings(c.Request.Context(), userID)
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

func (h *ClosingHandler) GetClosingDetail(c *gin.Context) {
	userID := c.GetString("user_id")
	month := c.Param("month")

	res, err := h.closingService.GetClosingDetail(c.Request.Context(), userID, month)
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
