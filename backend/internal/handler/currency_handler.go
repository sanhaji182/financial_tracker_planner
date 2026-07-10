package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/middleware"
	"github.com/user/financial-os/internal/service"
)

// CurrencyHandler manages REST endpoints for multi-currency exchange rates
type CurrencyHandler struct {
	currencyService service.CurrencyService
}

// NewCurrencyHandler creates a new CurrencyHandler
func NewCurrencyHandler(currencyService service.CurrencyService) *CurrencyHandler {
	return &CurrencyHandler{currencyService: currencyService}
}

// RegisterRoutes registers routes with route groups
func (h *CurrencyHandler) RegisterRoutes(rg *gin.RouterGroup) {
	group := rg.Group("/currencies")
	group.Use(middleware.AuthMiddleware())
	{
		// GET /api/v1/currencies
		group.GET("", h.ListCurrencies)
		// PUT /api/v1/currencies/:code (Owner only)
		group.PUT("/:code", middleware.RoleMiddleware("owner"), h.UpdateExchangeRate)
	}
}

// ListCurrencies returns all currency conversion rates
func (h *CurrencyHandler) ListCurrencies(c *gin.Context) {
	res, err := h.currencyService.ListCurrencies(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()},
		})
		return
	}

	c.JSON(http.StatusOK, res)
}

// UpdateExchangeRate edits a specific exchange rate
func (h *CurrencyHandler) UpdateExchangeRate(c *gin.Context) {
	code := c.Param("code")

	var req dto.UpdateCurrencyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		// Attempt parsing as raw numeric query if JSON binding failed (supporting multiple formats)
		rawRate := c.Query("rate")
		parsedRate, convErr := strconv.ParseFloat(rawRate, 64)
		if convErr != nil || parsedRate <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": gin.H{"code": "BAD_REQUEST", "message": "Exchange rate must be positive number"},
			})
			return
		}
		req.ExchangeRateToIDR = parsedRate
	}

	err := h.currencyService.UpdateExchangeRate(c.Request.Context(), code, req.ExchangeRateToIDR)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Exchange rate updated successfully",
	})
}
