package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/user/financial-os/internal/middleware"
	"github.com/user/financial-os/internal/service"
)

type DataQualityHandler struct {
	svc service.DataQualityService
}

func NewDataQualityHandler(svc service.DataQualityService) *DataQualityHandler {
	return &DataQualityHandler{svc: svc}
}

func (h *DataQualityHandler) RegisterRoutes(rg *gin.RouterGroup) {
	g := rg.Group("/data-quality")
	g.Use(middleware.AuthMiddleware())
	{
		g.GET("", h.GetDataQuality)
	}
}

func (h *DataQualityHandler) GetDataQuality(c *gin.Context) {
	userID := c.GetString("user_id")
	res, err := h.svc.GetDataQuality(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{
				"code":    "INTERNAL_SERVER_ERROR",
				"message": err.Error(),
			},
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": res})
}
