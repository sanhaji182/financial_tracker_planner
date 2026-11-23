package handler

import (
	"context"
	"errors"
	"io"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/go-playground/validator/v10"

	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/middleware"
	"github.com/user/financial-os/internal/service"
)

type HouseholdOwnerResolver func(ctx context.Context, userID, role string) (string, error)

type AccountHandler struct {
	accountService    service.AccountService
	householdResolver HouseholdOwnerResolver
}

func NewAccountHandler(accountService service.AccountService) *AccountHandler {
	return &AccountHandler{accountService: accountService}
}

func (h *AccountHandler) WithHouseholdResolver(resolver HouseholdOwnerResolver) *AccountHandler {
	h.householdResolver = resolver
	return h
}

func (h *AccountHandler) RegisterRoutes(rg *gin.RouterGroup) {
	accountsGroup := rg.Group("/accounts")
	accountsGroup.Use(middleware.AuthMiddleware())
	{
		// Read routes: owner + spouse_co_owner (filtered to is_shared=true for co-owner)
		accountsGroup.GET("", middleware.RoleMiddleware("owner", "spouse_co_owner"), h.List)
		accountsGroup.GET("/summary", middleware.RoleMiddleware("owner", "spouse_co_owner"), h.Summary)
		accountsGroup.GET("/:id", middleware.RoleMiddleware("owner", "spouse_co_owner"), h.Detail)

		// Structural write routes: owner only
		accountsGroup.POST("", middleware.RoleMiddleware("owner"), h.Create)
		accountsGroup.POST("/scan", middleware.RoleMiddleware("owner"), h.ScanDocument)
		accountsGroup.PUT("/:id", middleware.RoleMiddleware("owner"), h.Update)
		accountsGroup.DELETE("/:id", middleware.RoleMiddleware("owner"), h.Delete)
	}
}

func (h *AccountHandler) resolveAccountOwner(c *gin.Context) (string, bool, bool) {
	userID := c.GetString("user_id")
	role := c.GetString("role")
	if role != "spouse_co_owner" {
		return userID, false, true
	}
	if h.householdResolver == nil {
		c.JSON(http.StatusForbidden, gin.H{
			"error": gin.H{"code": "FORBIDDEN", "message": "Household resolver not configured"},
		})
		return "", true, false
	}
	ownerID, err := h.householdResolver(c.Request.Context(), userID, role)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{
			"error": gin.H{"code": "FORBIDDEN", "message": err.Error()},
		})
		return "", true, false
	}
	return ownerID, true, true
}

func (h *AccountHandler) List(c *gin.Context) {
	ownerID, isCoOwner, ok := h.resolveAccountOwner(c)
	if !ok {
		return
	}

	res, err := h.accountService.GetAccounts(c.Request.Context(), ownerID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{
				"code":    "INTERNAL_SERVER_ERROR",
				"message": err.Error(),
			},
		})
		return
	}

	if isCoOwner {
		sharedOnly := make([]dto.AccountResponse, 0)
		for _, a := range res {
			if a.IsShared {
				sharedOnly = append(sharedOnly, a)
			}
		}
		res = sharedOnly
	}

	c.JSON(http.StatusOK, gin.H{
		"data": res,
	})
}

func (h *AccountHandler) Summary(c *gin.Context) {
	ownerID, isCoOwner, ok := h.resolveAccountOwner(c)
	if !ok {
		return
	}

	if isCoOwner {
		accs, err := h.accountService.GetAccounts(c.Request.Context(), ownerID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()},
			})
			return
		}
		var sum dto.AccountSummaryResponse
		for _, a := range accs {
			if !a.IsShared || !a.IsActive {
				continue
			}
			switch a.Type {
			case "bank":
				sum.TotalBank += a.Balance
			case "e_wallet":
				sum.TotalEWallet += a.Balance
			case "cash":
				sum.TotalCash += a.Balance
			case "investment":
				sum.TotalInvestment += a.Balance
			case "deposit":
				sum.TotalDeposit += a.Balance
			}
			sum.GrandTotal += a.Balance
		}
		sum.FormattedTotalBank = dto.FormatRupiah(sum.TotalBank)
		sum.FormattedTotalEWallet = dto.FormatRupiah(sum.TotalEWallet)
		sum.FormattedTotalCash = dto.FormatRupiah(sum.TotalCash)
		sum.FormattedTotalInvestment = dto.FormatRupiah(sum.TotalInvestment)
		sum.FormattedTotalDeposit = dto.FormatRupiah(sum.TotalDeposit)
		sum.FormattedGrandTotal = dto.FormatRupiah(sum.GrandTotal)
		c.JSON(http.StatusOK, gin.H{"data": sum})
		return
	}

	res, err := h.accountService.GetAccountSummary(c.Request.Context(), ownerID)
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
	ownerID, isCoOwner, ok := h.resolveAccountOwner(c)
	if !ok {
		return
	}

	res, err := h.accountService.GetAccountByID(c.Request.Context(), accountID, ownerID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"error": gin.H{
				"code":    "NOT_FOUND",
				"message": err.Error(),
			},
		})
		return
	}

	if isCoOwner && !res.IsShared {
		c.JSON(http.StatusForbidden, gin.H{
			"error": gin.H{
				"code":    "FORBIDDEN",
				"message": "Private personal accounts are restricted from spouse co-owner access",
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

func (h *AccountHandler) ScanDocument(c *gin.Context) {
	userID := c.GetString("user_id")

	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{"code": "BAD_REQUEST", "message": "File is required"},
		})
		return
	}
	defer file.Close()

	fileBytes, err := io.ReadAll(io.LimitReader(file, service.MaxScanFileSize+1))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": "Failed to read file"},
		})
		return
	}
	if len(fileBytes) > service.MaxScanFileSize {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{
			"error": gin.H{"code": "FILE_TOO_LARGE", "message": "Ukuran file melebihi batas maksimal 10MB."},
		})
		return
	}

	pdfPassword := c.PostForm("pdf_password")

	res, err := h.accountService.ScanAccountDocument(c.Request.Context(), userID, header.Filename, fileBytes, pdfPassword)
	if err != nil {
		var scanErr *service.WorkerScanError
		if errors.As(err, &scanErr) {
			c.JSON(scanErr.StatusCode, gin.H{
				"error": gin.H{"code": scanErr.Code, "message": scanErr.Message},
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Document scanned successfully",
		"data":    res,
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
