package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/middleware"
	"github.com/user/financial-os/internal/service"
)

type SubscriptionHandler struct {
	subService service.SubscriptionService
}

func NewSubscriptionHandler(subService service.SubscriptionService) *SubscriptionHandler {
	return &SubscriptionHandler{subService: subService}
}

func (h *SubscriptionHandler) RegisterRoutes(rg *gin.RouterGroup) {
	group := rg.Group("/subscriptions")
	group.Use(middleware.AuthMiddleware())
	{
		group.GET("/summary", h.GetSubscriptionSummary)
		group.POST("", middleware.RoleMiddleware("owner"), h.CreateSubscription)
		group.GET("", h.ListSubscriptions)
		group.GET("/:id", h.GetSubscriptionByID)
		group.PUT("/:id", middleware.RoleMiddleware("owner"), h.UpdateSubscription)
		group.DELETE("/:id", middleware.RoleMiddleware("owner"), h.DeleteSubscription)
	}
}

func (h *SubscriptionHandler) CreateSubscription(c *gin.Context) {
	userID := c.GetString("user_id")

	var req dto.CreateSubscriptionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{"code": "BAD_REQUEST", "message": err.Error()},
		})
		return
	}

	resp, err := h.subService.CreateSubscription(c.Request.Context(), userID, &req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()},
		})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"data": resp})
}

func (h *SubscriptionHandler) GetSubscriptionByID(c *gin.Context) {
	userID := c.GetString("user_id")
	id := c.Param("id")

	resp, err := h.subService.GetSubscriptionByID(c.Request.Context(), userID, id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"error": gin.H{"code": "NOT_FOUND", "message": err.Error()},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": resp})
}

func (h *SubscriptionHandler) UpdateSubscription(c *gin.Context) {
	userID := c.GetString("user_id")
	id := c.Param("id")

	var req dto.UpdateSubscriptionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{"code": "BAD_REQUEST", "message": err.Error()},
		})
		return
	}

	err := h.subService.UpdateSubscription(c.Request.Context(), userID, id, &req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Subscription updated successfully"})
}

func (h *SubscriptionHandler) DeleteSubscription(c *gin.Context) {
	userID := c.GetString("user_id")
	id := c.Param("id")

	err := h.subService.DeleteSubscription(c.Request.Context(), userID, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Subscription deleted successfully"})
}

func (h *SubscriptionHandler) ListSubscriptions(c *gin.Context) {
	userID := c.GetString("user_id")

	resp, err := h.subService.ListSubscriptions(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": resp})
}

func (h *SubscriptionHandler) GetSubscriptionSummary(c *gin.Context) {
	userID := c.GetString("user_id")

	resp, err := h.subService.GetSubscriptionSummary(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": resp})
}
