package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/go-playground/validator/v10"

	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/middleware"
	"github.com/user/financial-os/internal/service"
)

type AssetHandler struct {
	assetService service.AssetService
}

func NewAssetHandler(assetService service.AssetService) *AssetHandler {
	return &AssetHandler{assetService: assetService}
}

func (h *AssetHandler) RegisterRoutes(rg *gin.RouterGroup) {
	assetsGroup := rg.Group("/assets")
	assetsGroup.Use(middleware.AuthMiddleware())
	{
		// Both roles can read assets
		assetsGroup.GET("", h.List)
		assetsGroup.GET("/summary", h.Summary)
		assetsGroup.GET("/:id", h.Detail)

		// Only owner can mutate assets
		assetsGroup.POST("", middleware.RoleMiddleware("owner"), h.Create)
		assetsGroup.PUT("/:id", middleware.RoleMiddleware("owner"), h.Update)
		assetsGroup.DELETE("/:id", middleware.RoleMiddleware("owner"), h.Delete)
		assetsGroup.POST("/:id/valuations", middleware.RoleMiddleware("owner"), h.AddValuation)
	}
}

func (h *AssetHandler) List(c *gin.Context) {
	userID := c.GetString("user_id")

	var typeFilter *string
	if val := c.Query("type"); val != "" {
		typeFilter = &val
	}

	var isSharedFilter *bool
	if val := c.Query("is_shared"); val != "" {
		b, err := strconv.ParseBool(val)
		if err == nil {
			isSharedFilter = &b
		}
	}

	res, err := h.assetService.GetAssets(c.Request.Context(), userID, typeFilter, isSharedFilter)
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

func (h *AssetHandler) Summary(c *gin.Context) {
	userID := c.GetString("user_id")

	res, err := h.assetService.GetAssetSummary(c.Request.Context(), userID)
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

func (h *AssetHandler) Detail(c *gin.Context) {
	assetID := c.Param("id")
	userID := c.GetString("user_id")

	res, err := h.assetService.GetAssetByID(c.Request.Context(), assetID, userID)
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

func (h *AssetHandler) Create(c *gin.Context) {
	userID := c.GetString("user_id")

	var req dto.CreateAssetRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		h.handleValidationError(c, err)
		return
	}

	res, err := h.assetService.CreateAsset(c.Request.Context(), userID, req)
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
		"message": "Asset created successfully",
		"data":    res,
	})
}

func (h *AssetHandler) Update(c *gin.Context) {
	assetID := c.Param("id")
	userID := c.GetString("user_id")

	var req dto.UpdateAssetRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		h.handleValidationError(c, err)
		return
	}

	res, err := h.assetService.UpdateAsset(c.Request.Context(), assetID, userID, req)
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
		"message": "Asset updated successfully",
		"data":    res,
	})
}

func (h *AssetHandler) Delete(c *gin.Context) {
	assetID := c.Param("id")
	userID := c.GetString("user_id")

	err := h.assetService.DeleteAsset(c.Request.Context(), assetID, userID)
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
		"message": "Asset deleted successfully",
	})
}

func (h *AssetHandler) AddValuation(c *gin.Context) {
	assetID := c.Param("id")
	userID := c.GetString("user_id")

	var req dto.CreateValuationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		h.handleValidationError(c, err)
		return
	}

	res, err := h.assetService.AddValuation(c.Request.Context(), assetID, userID, req)
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
		"message": "Asset valuation added successfully",
		"data":    res,
	})
}

func (h *AssetHandler) handleValidationError(c *gin.Context, err error) {
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
