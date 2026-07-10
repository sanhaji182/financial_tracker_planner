package handler

import (
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/user/financial-os/internal/middleware"
	"github.com/user/financial-os/internal/service"
)

type ExportHandler struct {
	exportService service.ExportService
}

func NewExportHandler(exportService service.ExportService) *ExportHandler {
	return &ExportHandler{exportService: exportService}
}

func (h *ExportHandler) RegisterRoutes(rg *gin.RouterGroup) {
	group := rg.Group("/export")
	group.Use(middleware.AuthMiddleware())
	{
		group.GET("/transactions", h.ExportTransactionsCSV)
		group.GET("/monthly-report", h.ExportMonthlyReportPDF)
	}
}

func (h *ExportHandler) ExportTransactionsCSV(c *gin.Context) {
	userID := c.GetString("user_id")
	dateFrom := c.Query("date_from")
	dateTo := c.Query("date_to")
	accountID := c.Query("account_id")

	csvBytes, err := h.exportService.ExportTransactionsCSV(c.Request.Context(), userID, dateFrom, dateTo, accountID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()},
		})
		return
	}

	fileName := fmt.Sprintf("transactions_export_%s.csv", time.Now().Format("20060102"))
	c.Header("Content-Description", "File Transfer")
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%s", fileName))
	c.Data(http.StatusOK, "text/csv", csvBytes)
}

func (h *ExportHandler) ExportMonthlyReportPDF(c *gin.Context) {
	userID := c.GetString("user_id")
	month := c.Query("month") // YYYY-MM

	if month == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{"code": "BAD_REQUEST", "message": "Query param 'month' is required (YYYY-MM)"},
		})
		return
	}

	pdfBytes, err := h.exportService.ExportMonthlyClosingPDF(c.Request.Context(), userID, month)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()},
		})
		return
	}

	fileName := fmt.Sprintf("monthly_closing_report_%s.pdf", month)
	c.Header("Content-Description", "File Transfer")
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%s", fileName))
	c.Data(http.StatusOK, "application/pdf", pdfBytes)
}
