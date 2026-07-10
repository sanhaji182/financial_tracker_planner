package handler

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/user/financial-os/internal/middleware"
	"github.com/user/financial-os/internal/service"
)

type ForecastHandler struct {
	forecastService service.ForecastService
}

func NewForecastHandler(forecastService service.ForecastService) *ForecastHandler {
	return &ForecastHandler{forecastService: forecastService}
}

func (h *ForecastHandler) RegisterRoutes(rg *gin.RouterGroup) {
	forecastGroup := rg.Group("/forecast")
	forecastGroup.Use(middleware.AuthMiddleware())
	{
		forecastGroup.GET("/monthly", h.GetMonthlyForecast)
		forecastGroup.GET("/daily", h.GetDailyProjections)
	}
}

func (h *ForecastHandler) GetMonthlyForecast(c *gin.Context) {
	userID := c.GetString("user_id")
	month := c.Query("month")
	if month == "" {
		month = time.Now().Format("2006-01")
	}

	res, err := h.forecastService.CalculateMonthlyForecast(c.Request.Context(), userID, month)
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

func (h *ForecastHandler) GetDailyProjections(c *gin.Context) {
	userID := c.GetString("user_id")
	month := c.Query("month")
	if month == "" {
		month = time.Now().Format("2006-01")
	}

	res, err := h.forecastService.GetDailyProjections(c.Request.Context(), userID, month)
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
