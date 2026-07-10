package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/go-playground/validator/v10"

	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/middleware"
	"github.com/user/financial-os/internal/service"
)

type CategoryHandler struct {
	categoryService service.CategoryService
}

func NewCategoryHandler(categoryService service.CategoryService) *CategoryHandler {
	return &CategoryHandler{categoryService: categoryService}
}

func (h *CategoryHandler) RegisterRoutes(rg *gin.RouterGroup) {
	categoriesGroup := rg.Group("/categories")
	categoriesGroup.Use(middleware.AuthMiddleware())
	{
		// Both roles can read categories
		categoriesGroup.GET("", h.List)
		categoriesGroup.GET("/:id", h.Detail)

		// Only owner can create, edit, or delete categories
		categoriesGroup.POST("", middleware.RoleMiddleware("owner"), h.Create)
		categoriesGroup.PUT("/:id", middleware.RoleMiddleware("owner"), h.Update)
		categoriesGroup.DELETE("/:id", middleware.RoleMiddleware("owner"), h.Delete)
	}
}

func (h *CategoryHandler) List(c *gin.Context) {
	userID := c.GetString("user_id")

	res, err := h.categoryService.GetCategories(c.Request.Context(), userID)
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

func (h *CategoryHandler) Detail(c *gin.Context) {
	categoryID := c.Param("id")
	userID := c.GetString("user_id")

	res, err := h.categoryService.GetCategoryByID(c.Request.Context(), categoryID, userID)
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

func (h *CategoryHandler) Create(c *gin.Context) {
	userID := c.GetString("user_id")

	var req dto.CreateCategoryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		h.handleValidationError(c, err)
		return
	}

	res, err := h.categoryService.CreateCategory(c.Request.Context(), userID, req)
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
		"message": "Category created successfully",
		"data":    res,
	})
}

func (h *CategoryHandler) Update(c *gin.Context) {
	categoryID := c.Param("id")
	userID := c.GetString("user_id")

	var req dto.UpdateCategoryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		h.handleValidationError(c, err)
		return
	}

	res, err := h.categoryService.UpdateCategory(c.Request.Context(), categoryID, userID, req)
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
		"message": "Category updated successfully",
		"data":    res,
	})
}

func (h *CategoryHandler) Delete(c *gin.Context) {
	categoryID := c.Param("id")
	userID := c.GetString("user_id")

	err := h.categoryService.DeleteCategory(c.Request.Context(), categoryID, userID)
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
		"message": "Category deleted successfully",
	})
}

func (h *CategoryHandler) handleValidationError(c *gin.Context, err error) {
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
