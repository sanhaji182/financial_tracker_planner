package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/middleware"
	"github.com/user/financial-os/internal/service"
)

type JournalHandler struct {
	journalService service.JournalService
}

func NewJournalHandler(journalService service.JournalService) *JournalHandler {
	return &JournalHandler{journalService: journalService}
}

func (h *JournalHandler) RegisterRoutes(rg *gin.RouterGroup) {
	group := rg.Group("/journal")
	group.Use(middleware.AuthMiddleware())
	{
		group.POST("", middleware.RoleMiddleware("owner"), h.CreateJournal)
		group.GET("", h.ListJournals)
		group.GET("/:id", h.GetJournalByID)
		group.PUT("/:id", middleware.RoleMiddleware("owner"), h.UpdateJournal)
		group.DELETE("/:id", middleware.RoleMiddleware("owner"), h.DeleteJournal)
	}
}

func (h *JournalHandler) CreateJournal(c *gin.Context) {
	userID := c.GetString("user_id")

	var req dto.CreateHouseholdNoteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{"code": "BAD_REQUEST", "message": err.Error()},
		})
		return
	}

	resp, err := h.journalService.CreateJournal(c.Request.Context(), userID, &req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()},
		})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"data": resp})
}

func (h *JournalHandler) GetJournalByID(c *gin.Context) {
	userID := c.GetString("user_id")
	id := c.Param("id")

	resp, err := h.journalService.GetJournalByID(c.Request.Context(), userID, id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"error": gin.H{"code": "NOT_FOUND", "message": err.Error()},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": resp})
}

func (h *JournalHandler) UpdateJournal(c *gin.Context) {
	userID := c.GetString("user_id")
	id := c.Param("id")

	var req dto.UpdateHouseholdNoteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{"code": "BAD_REQUEST", "message": err.Error()},
		})
		return
	}

	err := h.journalService.UpdateJournal(c.Request.Context(), userID, id, &req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Journal note updated successfully"})
}

func (h *JournalHandler) DeleteJournal(c *gin.Context) {
	userID := c.GetString("user_id")
	id := c.Param("id")

	err := h.journalService.DeleteJournal(c.Request.Context(), userID, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Journal note deleted successfully"})
}

func (h *JournalHandler) ListJournals(c *gin.Context) {
	userID := c.GetString("user_id")
	search := c.Query("search")
	tag := c.Query("tag")
	dateFrom := c.Query("date_from")
	dateTo := c.Query("date_to")

	resp, err := h.journalService.ListJournals(c.Request.Context(), userID, search, tag, dateFrom, dateTo)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": resp})
}
