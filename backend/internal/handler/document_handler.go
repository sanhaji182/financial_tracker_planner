package handler

import (
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/user/financial-os/internal/middleware"
	"github.com/user/financial-os/internal/service"
)

type DocumentHandler struct {
	docService service.DocumentService
}

func NewDocumentHandler(docService service.DocumentService) *DocumentHandler {
	return &DocumentHandler{docService: docService}
}

func (h *DocumentHandler) RegisterRoutes(rg *gin.RouterGroup) {
	docGroup := rg.Group("/documents")
	docGroup.Use(middleware.AuthMiddleware())
	{
		docGroup.POST("", middleware.RoleMiddleware("owner"), h.UploadDocument)
		docGroup.GET("", h.ListDocuments)
		docGroup.GET("/:id/download", h.DownloadDocument)
		docGroup.DELETE("/:id", middleware.RoleMiddleware("owner"), h.DeleteDocument)
		docGroup.PUT("/:id/link", middleware.RoleMiddleware("owner"), h.LinkDocument)
	}
}

func (h *DocumentHandler) UploadDocument(c *gin.Context) {
	userID := c.GetString("user_id")

	// Get entity type, entity id, tags, and description from multipart form
	entityType := c.PostForm("linked_entity_type")
	entityID := c.PostForm("linked_entity_id")
	description := c.PostForm("description")

	var tags []string
	if tagsStr := c.PostForm("tags"); tagsStr != "" {
		for _, t := range strings.Split(tagsStr, ",") {
			trimmed := strings.TrimSpace(t)
			if trimmed != "" {
				tags = append(tags, trimmed)
			}
		}
	}

	// Parse file
	file, fileHeader, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{"code": "BAD_REQUEST", "message": "File is required"},
		})
		return
	}
	defer file.Close()

	// Max 10MB
	if fileHeader.Size > 10*1024*1024 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{"code": "BAD_REQUEST", "message": "File size exceeds 10MB limit"},
		})
		return
	}

	fileBytes, err := io.ReadAll(file)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": "Failed to read file"},
		})
		return
	}

	fileType := fileHeader.Header.Get("Content-Type")

	res, err := h.docService.UploadDocument(
		c.Request.Context(),
		userID,
		fileHeader.Filename,
		fileBytes,
		fileType,
		int(fileHeader.Size),
		entityType,
		entityID,
		tags,
		description,
	)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Document uploaded successfully",
		"data":    res,
	})
}

func (h *DocumentHandler) ListDocuments(c *gin.Context) {
	userID := c.GetString("user_id")
	entityType := c.Query("linked_entity_type")
	tag := c.Query("tag")

	res, err := h.docService.ListDocuments(c.Request.Context(), userID, entityType, tag)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": res})
}

func (h *DocumentHandler) DownloadDocument(c *gin.Context) {
	userID := c.GetString("user_id")
	id := c.Param("id")

	doc, err := h.docService.GetDocumentByID(c.Request.Context(), userID, id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"error": gin.H{"code": "NOT_FOUND", "message": err.Error()},
		})
		return
	}

	c.FileAttachment(doc.FilePath, doc.FileName)
}

func (h *DocumentHandler) DeleteDocument(c *gin.Context) {
	userID := c.GetString("user_id")
	id := c.Param("id")

	err := h.docService.DeleteDocument(c.Request.Context(), userID, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Document deleted successfully"})
}

func (h *DocumentHandler) LinkDocument(c *gin.Context) {
	userID := c.GetString("user_id")
	id := c.Param("id")

	var req struct {
		LinkedEntityType string `json:"linked_entity_type"`
		LinkedEntityID   string `json:"linked_entity_id"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{"code": "BAD_REQUEST", "message": err.Error()},
		})
		return
	}

	err := h.docService.LinkDocument(c.Request.Context(), userID, id, req.LinkedEntityType, req.LinkedEntityID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Document linked successfully"})
}
