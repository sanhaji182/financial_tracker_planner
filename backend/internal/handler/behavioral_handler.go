package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/middleware"
	"github.com/user/financial-os/internal/service"
)

type BehavioralHandler struct {
	svc service.BehavioralService
}

func NewBehavioralHandler(svc service.BehavioralService) *BehavioralHandler {
	return &BehavioralHandler{svc: svc}
}

func (h *BehavioralHandler) RegisterRoutes(rg *gin.RouterGroup) {
	g := rg.Group("/review")
	g.Use(middleware.AuthMiddleware())
	{
		g.GET("/monthly", h.GetMonthly)
		g.PUT("/monthly/item", middleware.RoleMiddleware("owner"), h.UpdateItem)
	}
}

func (h *BehavioralHandler) GetMonthly(c *gin.Context) {
	userID := c.GetString("user_id")
	month := c.Query("month")
	res, err := h.svc.GetMonthlyReview(c.Request.Context(), userID, month)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()}})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": res})
}

func (h *BehavioralHandler) UpdateItem(c *gin.Context) {
	userID := c.GetString("user_id")
	month := c.Query("month")
	var req dto.UpdateReviewItemRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": gin.H{"code": "VALIDATION_ERROR", "message": err.Error()}})
		return
	}
	if err := h.svc.UpdateItemStatus(c.Request.Context(), userID, month, req.ItemID, req.Status); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": gin.H{"code": "BAD_REQUEST", "message": err.Error()}})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Review item updated"})
}
