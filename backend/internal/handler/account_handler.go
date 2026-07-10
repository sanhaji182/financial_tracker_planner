package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/go-playground/validator/v10"

	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/middleware"
	"github.com/user/financial-os/internal/service"
)

type AccountHandler struct {
	accountService service.AccountService
}

func NewAccountHandler(accountService service.AccountService) *AccountHandler {
	return &AccountHandler{accountService: accountService}
}

func (h *AccountHandler) RegisterRoutes(rg *gin.RouterGroup) {
	// Protected owner-only routes
	accountsGroup := rg.Group("/accounts")
	accountsGroup.Use(middleware.AuthMiddleware())
	accountsGroup.Use(middleware.RoleMiddleware("owner"))
	{
		accountsGroup.GET("", h.List)
		accountsGroup.GET("/summary", h.Summary)
		accountsGroup.GET("/:id", h.Detail)
		accountsGroup.POST("", h.Create)
		accountsGroup.PUT("/:id", h.Update)
		accountsGroup.DELETE("/:id", h.Delete)
	}
}

func (h *AccountHandler) List(c *gin.Context) {
	userID := c.GetString("user_id")

	res, err := h.accountService.GetAccounts(c.Request.Context(), userID)
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

func (h *AccountHandler) Summary(c *gin.Context) {
	userID := c.GetString("user_id")

	res, err := h.accountService.GetAccountSummary(c.Request.Context(), userID)
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

func (h *AccountHandler) Detail(c *gin.Context) {
	accountID := c.Param("id")
	userID := c.GetString("user_id")

	res, err := h.accountService.GetAccountByID(c.Request.Context(), accountID, userID)
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

func (h *AccountHandler) Create(c *gin.Context) {
	userID := c.GetString("user_id")

	var req dto.CreateAccountRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		h.handleValidationError(c, err)
		return
	}

	res, err := h.accountService.CreateAccount(c.Request.Context(), userID, req)
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
		"message": "Account created successfully",
		"data":    res,
	})
}

func (h *AccountHandler) Update(c *gin.Context) {
	accountID := c.Param("id")
	userID := c.GetString("user_id")

	var req dto.UpdateAccountRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		h.handleValidationError(c, err)
		return
	}

	res, err := h.accountService.UpdateAccount(c.Request.Context(), accountID, userID, req)
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
		"message": "Account updated successfully",
		"data":    res,
	})
}

func (h *AccountHandler) Delete(c *gin.Context) {
	accountID := c.Param("id")
	userID := c.GetString("user_id")

	err := h.accountService.DeleteAccount(c.Request.Context(), accountID, userID)
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
		"message": "Account deleted successfully",
	})
}

func (h *AccountHandler) handleValidationError(c *gin.Context, err error) {
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
