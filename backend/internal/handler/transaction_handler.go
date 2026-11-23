package handler

import (
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/go-playground/validator/v10"

	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/middleware"
	"github.com/user/financial-os/internal/service"
)

type TransactionHandler struct {
	txService         service.TransactionService
	accountService    service.AccountService
	householdResolver HouseholdOwnerResolver
}

func NewTransactionHandler(txService service.TransactionService) *TransactionHandler {
	return &TransactionHandler{txService: txService}
}

func (h *TransactionHandler) WithHouseholdAccess(
	accountService service.AccountService,
	resolver HouseholdOwnerResolver,
) *TransactionHandler {
	h.accountService = accountService
	h.householdResolver = resolver
	return h
}

func (h *TransactionHandler) resolveHouseholdOwner(c *gin.Context) (string, bool, bool) {
	userID := c.GetString("user_id")
	role := c.GetString("role")
	if role != "spouse_co_owner" && role != "spouse_viewer" {
		return userID, false, true
	}
	if h.householdResolver == nil {
		return userID, role == "spouse_co_owner", true
	}
	ownerID, err := h.householdResolver(c.Request.Context(), userID, role)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{
			"error": gin.H{"code": "FORBIDDEN", "message": err.Error()},
		})
		return "", role == "spouse_co_owner", false
	}
	return ownerID, role == "spouse_co_owner", true
}

func (h *TransactionHandler) ensureSharedAccountForCoOwner(c *gin.Context, ownerID, accountID string) bool {
	if h.accountService == nil {
		c.JSON(http.StatusForbidden, gin.H{
			"error": gin.H{"code": "FORBIDDEN", "message": "Account access service unavailable"},
		})
		return false
	}
	acc, err := h.accountService.GetAccountByID(c.Request.Context(), accountID, ownerID)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{
			"error": gin.H{"code": "FORBIDDEN", "message": "Selected account not accessible in household"},
		})
		return false
	}
	if !acc.IsShared {
		c.JSON(http.StatusForbidden, gin.H{
			"error": gin.H{"code": "FORBIDDEN", "message": "Spouse co-owner can only record transactions on shared joint accounts"},
		})
		return false
	}
	return true
}

func (h *TransactionHandler) RegisterRoutes(rg *gin.RouterGroup) {
	txGroup := rg.Group("/transactions")
	txGroup.Use(middleware.AuthMiddleware())
	{
		// Read routes
		txGroup.GET("", h.List)
		txGroup.GET("/summary", h.Summary)
		txGroup.GET("/attachments/:attachmentId/download", h.DownloadAttachment)
		txGroup.GET("/:id", h.Detail)

		// Owner & spouse_co_owner (co-owner gated to is_shared=true accounts)
		txGroup.POST("", middleware.RoleMiddleware("owner", "spouse_co_owner"), h.Create)
		txGroup.PUT("/:id", middleware.RoleMiddleware("owner", "spouse_co_owner"), h.Update)
		txGroup.POST("/:id/split", middleware.RoleMiddleware("owner", "spouse_co_owner"), h.Split)
		txGroup.POST("/upload", middleware.RoleMiddleware("owner", "spouse_co_owner"), h.UploadDocument)
		txGroup.PUT("/confirm-bulk", middleware.RoleMiddleware("owner", "spouse_co_owner"), h.ConfirmBulkDrafts)
		txGroup.PUT("/confirm/:id", middleware.RoleMiddleware("owner", "spouse_co_owner"), h.ConfirmDraft)

		// Owner-only destructive / attachment mutations
		txGroup.DELETE("/:id", middleware.RoleMiddleware("owner"), h.Delete)
		txGroup.POST("/:id/attachments", middleware.RoleMiddleware("owner", "spouse_co_owner"), h.UploadAttachment)
	}
}

func (h *TransactionHandler) List(c *gin.Context) {
	userID, _, ok := h.resolveHouseholdOwner(c)
	if !ok {
		return
	}

	// Parse page and page size
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "15"))
	sortField := c.DefaultQuery("sort_by", "date")
	sortOrder := c.DefaultQuery("sort_order", "desc")

	// Parse filters
	filters := make(map[string]interface{})
	if val := c.Query("type"); val != "" {
		filters["type"] = val
	}
	if val := c.Query("category_id"); val != "" {
		filters["category_id"] = val
	}
	if val := c.Query("account_id"); val != "" {
		filters["account_id"] = val
	}
	if val := c.Query("date_from"); val != "" {
		if t, err := time.Parse("2006-01-02", val); err == nil {
			filters["date_from"] = t
		}
	}
	if val := c.Query("date_to"); val != "" {
		if t, err := time.Parse("2006-01-02", val); err == nil {
			filters["date_to"] = t
		}
	}
	if val := c.Query("amount_min"); val != "" {
		if amt, err := strconv.ParseFloat(val, 64); err == nil {
			filters["amount_min"] = amt
		}
	}
	if val := c.Query("amount_max"); val != "" {
		if amt, err := strconv.ParseFloat(val, 64); err == nil {
			filters["amount_max"] = amt
		}
	}
	if val := c.Query("search"); val != "" {
		filters["search"] = val
	}
	if val := c.Query("status"); val != "" {
		filters["status"] = val
	}
	if val := c.Query("source"); val != "" {
		filters["source"] = val
	}

	res, err := h.txService.GetTransactions(c.Request.Context(), userID, filters, page, pageSize, sortField, sortOrder)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{
				"code":    "INTERNAL_SERVER_ERROR",
				"message": err.Error(),
			},
		})
		return
	}

	c.JSON(http.StatusOK, res)
}

func (h *TransactionHandler) Summary(c *gin.Context) {
	userID, _, ok := h.resolveHouseholdOwner(c)
	if !ok {
		return
	}
	dateFrom := c.Query("date_from")
	dateTo := c.Query("date_to")

	res, err := h.txService.GetTransactionSummary(c.Request.Context(), userID, dateFrom, dateTo)
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

func (h *TransactionHandler) Detail(c *gin.Context) {
	txID := c.Param("id")
	userID, _, ok := h.resolveHouseholdOwner(c)
	if !ok {
		return
	}

	res, err := h.txService.GetTransactionByID(c.Request.Context(), txID, userID)
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

func (h *TransactionHandler) Create(c *gin.Context) {
	userID, isCoOwner, ok := h.resolveHouseholdOwner(c)
	if !ok {
		return
	}
	ip := c.ClientIP()
	ua := c.Request.UserAgent()

	var req dto.CreateTransactionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		h.handleValidationError(c, err)
		return
	}

	if isCoOwner {
		if !h.ensureSharedAccountForCoOwner(c, userID, req.AccountID) {
			return
		}
		if req.Type == "transfer" && req.TargetAccountID != nil && !h.ensureSharedAccountForCoOwner(c, userID, *req.TargetAccountID) {
			return
		}
	}

	res, err := h.txService.CreateTransaction(c.Request.Context(), userID, req, &ip, &ua)
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
		"message": "Transaction created successfully",
		"data":    res,
	})
}

func (h *TransactionHandler) Update(c *gin.Context) {
	txID := c.Param("id")
	userID, isCoOwner, ok := h.resolveHouseholdOwner(c)
	if !ok {
		return
	}
	ip := c.ClientIP()
	ua := c.Request.UserAgent()

	var req dto.UpdateTransactionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		h.handleValidationError(c, err)
		return
	}

	if isCoOwner && !h.ensureSharedAccountForCoOwner(c, userID, req.AccountID) {
		return
	}

	res, err := h.txService.UpdateTransaction(c.Request.Context(), txID, userID, req, &ip, &ua)
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
		"message": "Transaction updated successfully",
		"data":    res,
	})
}

func (h *TransactionHandler) Delete(c *gin.Context) {
	txID := c.Param("id")
	userID := c.GetString("user_id")
	ip := c.ClientIP()
	ua := c.Request.UserAgent()

	err := h.txService.DeleteTransaction(c.Request.Context(), txID, userID, &ip, &ua)
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
		"message": "Transaction deleted successfully",
	})
}

func (h *TransactionHandler) DownloadAttachment(c *gin.Context) {
	userID := c.GetString("user_id")
	attachmentID := c.Param("attachmentId")

	attachment, err := h.txService.GetAttachmentForDownload(c.Request.Context(), userID, attachmentID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": gin.H{"code": "NOT_FOUND", "message": "Attachment not found"}})
		return
	}

	c.FileAttachment(attachment.FilePath, attachment.FileName)
}

func (h *TransactionHandler) UploadAttachment(c *gin.Context) {
	txID := c.Param("id")
	userID, _, ok := h.resolveHouseholdOwner(c)
	if !ok {
		return
	}

	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{
				"code":    "BAD_REQUEST",
				"message": "File is required in 'file' field",
			},
		})
		return
	}

	src, err := file.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{
				"code":    "INTERNAL_SERVER_ERROR",
				"message": err.Error(),
			},
		})
		return
	}
	defer src.Close()

	data := make([]byte, file.Size)
	_, err = src.Read(data)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{
				"code":    "INTERNAL_SERVER_ERROR",
				"message": err.Error(),
			},
		})
		return
	}

	res, err := h.txService.UploadAttachment(c.Request.Context(), txID, userID, file.Filename, data, file.Header.Get("Content-Type"), int(file.Size))
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
		"message": "Attachment uploaded successfully",
		"data":    res,
	})
}

func (h *TransactionHandler) Split(c *gin.Context) {
	id := c.Param("id")
	userID, _, ok := h.resolveHouseholdOwner(c)
	if !ok {
		return
	}

	var req dto.SplitTransactionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		h.handleValidationError(c, err)
		return
	}

	ip := c.ClientIP()
	ua := c.Request.UserAgent()

	res, err := h.txService.SplitTransaction(c.Request.Context(), id, userID, req, &ip, &ua)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{"code": "BAD_REQUEST", "message": err.Error()},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Transaction split successfully",
		"data":    res,
	})
}

func (h *TransactionHandler) handleValidationError(c *gin.Context, err error) {
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

func (h *TransactionHandler) UploadDocument(c *gin.Context) {
	userID, _, ok := h.resolveHouseholdOwner(c)
	if !ok {
		return
	}

	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{"code": "BAD_REQUEST", "message": "File is required"},
		})
		return
	}
	defer file.Close()

	// Read file bytes
	fileBytes, err := io.ReadAll(file)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": "Failed to read file"},
		})
		return
	}

	res, err := h.txService.UploadAndParse(c.Request.Context(), userID, header.Filename, fileBytes)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "File processed successfully",
		"data":    res,
	})
}

func (h *TransactionHandler) ConfirmDraft(c *gin.Context) {
	userID, isCoOwner, ok := h.resolveHouseholdOwner(c)
	if !ok {
		return
	}
	draftTxID := c.Param("id")

	var req dto.ConfirmDraftTransactionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		h.handleValidationError(c, err)
		return
	}

	if isCoOwner && !h.ensureSharedAccountForCoOwner(c, userID, req.AccountID) {
		return
	}

	ip := c.ClientIP()
	ua := c.Request.UserAgent()

	res, err := h.txService.ConfirmParsedTransaction(c.Request.Context(), userID, draftTxID, req, &ip, &ua)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Draft transaction confirmed successfully",
		"data":    res,
	})
}

func (h *TransactionHandler) ConfirmBulkDrafts(c *gin.Context) {
	userID, isCoOwner, ok := h.resolveHouseholdOwner(c)
	if !ok {
		return
	}

	var req dto.BulkConfirmDraftsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		h.handleValidationError(c, err)
		return
	}

	if isCoOwner {
		for _, item := range req.Drafts {
			if !h.ensureSharedAccountForCoOwner(c, userID, item.AccountID) {
				return
			}
		}
	}

	ip := c.ClientIP()
	ua := c.Request.UserAgent()

	res, err := h.txService.BulkConfirmParsedTransactions(c.Request.Context(), userID, req, &ip, &ua)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{"code": "BAD_REQUEST", "message": err.Error()},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":         "Draft transactions confirmed successfully",
		"confirmed_count": len(res),
		"data":            res,
	})
}
