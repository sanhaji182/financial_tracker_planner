package dto

import (
	"fmt"
	"time"

	"github.com/user/financial-os/internal/model"
)

type CreateTransactionRequest struct {
	Date            time.Time                      `json:"date" binding:"required"`
	Amount          float64                        `json:"amount" binding:"required,gt=0"`
	Type            string                         `json:"type" binding:"required,oneof=income expense transfer"`
	AccountID       string                         `json:"account_id" binding:"required"`
	TargetAccountID *string                        `json:"target_account_id"`
	CategoryID      *string                        `json:"category_id"`
	Description     *string                        `json:"description"`
	Notes           *string                        `json:"notes"`
	Tags            []string                       `json:"tags"`
	Splits          []CreateTransactionSplitRequest `json:"splits"`
}

type CreateTransactionSplitRequest struct {
	CategoryID  string  `json:"category_id" binding:"required"`
	Amount      float64 `json:"amount" binding:"required,gt=0"`
	Description *string `json:"description"`
}

type UpdateTransactionRequest struct {
	Date            time.Time `json:"date" binding:"required"`
	Amount          float64   `json:"amount" binding:"required,gt=0"`
	Type            string    `json:"type" binding:"required,oneof=income expense transfer"`
	AccountID       string    `json:"account_id" binding:"required"`
	TargetAccountID *string   `json:"target_account_id"`
	CategoryID      *string   `json:"category_id"`
	Description     *string   `json:"description"`
	Notes           *string   `json:"notes"`
	Tags            []string  `json:"tags"`
}

type TransactionResponse struct {
	ID                string                        `json:"id"`
	UserID            string                        `json:"user_id"`
	AccountID         string                        `json:"account_id"`
	AccountName       string                        `json:"account_name,omitempty"`
	TargetAccountID   *string                       `json:"target_account_id,omitempty"`
	TargetAccountName *string                       `json:"target_account_name,omitempty"`
	CategoryID        *string                       `json:"category_id,omitempty"`
	CategoryName      *string                       `json:"category_name,omitempty"`
	CategoryIcon      *string                       `json:"category_icon,omitempty"`
	CategoryColor     *string                       `json:"category_color,omitempty"`
	Type              string                        `json:"type"` // income, expense, transfer
	Amount            float64                       `json:"amount"`
	FormattedAmount   string                        `json:"formatted_amount"`
	Date              time.Time                     `json:"date"`
	Description       *string                       `json:"description,omitempty"`
	Notes             *string                       `json:"notes,omitempty"`
	IsSplit           bool                          `json:"is_split"`
	Source            string                        `json:"source"`
	Status            string                        `json:"status"`
	Reconciled        bool                          `json:"reconciled"`
	Currency          string                        `json:"currency"`
	Tags              []string                      `json:"tags,omitempty"`
	CreatedAt         time.Time                     `json:"created_at"`
	UpdatedAt         time.Time                     `json:"updated_at"`
	Splits            []TransactionSplitResponse    `json:"splits,omitempty"`
	Attachments       []TransactionAttachmentResponse `json:"attachments,omitempty"`
	AuditLogs         []AuditLogResponse            `json:"audit_logs,omitempty"`
}

type TransactionSplitResponse struct {
	ID              string  `json:"id"`
	CategoryID      string  `json:"category_id"`
	CategoryName    string  `json:"category_name,omitempty"`
	Amount          float64 `json:"amount"`
	FormattedAmount string  `json:"formatted_amount"`
	Description     *string `json:"description,omitempty"`
}

type TransactionAttachmentResponse struct {
	ID        string    `json:"id"`
	FileName  string    `json:"file_name"`
	FilePath  string    `json:"file_path"`
	FileURL   string    `json:"file_url"`
	FileType  *string   `json:"file_type,omitempty"`
	FileSize  *int      `json:"file_size,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

type AuditLogResponse struct {
	ID         string      `json:"id"`
	UserID     string      `json:"user_id"`
	UserName   string      `json:"user_name"`
	UserRole   string      `json:"user_role"`
	EntityType string      `json:"entity_type"`
	EntityID   string      `json:"entity_id"`
	Action     string      `json:"action"`
	OldValue   interface{} `json:"old_value,omitempty"`
	NewValue   interface{} `json:"new_value,omitempty"`
	CreatedAt  time.Time   `json:"created_at"`
	FormattedCreatedAt string `json:"formatted_created_at"`
}

type TransactionSummaryResponse struct {
	TotalIncome          float64 `json:"total_income"`
	FormattedTotalIncome string  `json:"formatted_total_income"`
	TotalExpense         float64 `json:"total_expense"`
	FormattedTotalExpense string  `json:"formatted_total_expense"`
	Net                  float64 `json:"net"`
	FormattedNet         string  `json:"formatted_net"`
}

type PaginationMetadata struct {
	CurrentPage int   `json:"current_page"`
	PageSize    int   `json:"page_size"`
	TotalItems  int64 `json:"total_items"`
	TotalPages  int   `json:"total_pages"`
}

type TransactionListResponse struct {
	Data       []TransactionResponse `json:"data"`
	Pagination PaginationMetadata    `json:"pagination"`
}

func ToTransactionResponse(t *model.Transaction) TransactionResponse {
	splitsRes := make([]TransactionSplitResponse, len(t.Splits))
	for i, s := range t.Splits {
		splitsRes[i] = TransactionSplitResponse{
			ID:              s.ID,
			CategoryID:      s.CategoryID,
			CategoryName:    s.CategoryName,
			Amount:          s.Amount,
			FormattedAmount: FormatRupiah(s.Amount),
			Description:     s.Description,
		}
	}

	attachmentsRes := make([]TransactionAttachmentResponse, len(t.Attachments))
	for i, a := range t.Attachments {
		attachmentsRes[i] = TransactionAttachmentResponse{
			ID:        a.ID,
			FileName:  a.FileName,
			FilePath:  a.FilePath,
			FileURL:   fmt.Sprintf("/uploads/%s", a.FileName), // serve static files via Gin
			FileType:  a.FileType,
			FileSize:  a.FileSize,
			CreatedAt: a.CreatedAt,
		}
	}

	auditLogsRes := make([]AuditLogResponse, len(t.AuditLogs))
	for i, l := range t.AuditLogs {
		auditLogsRes[i] = AuditLogResponse{
			ID:                 l.ID,
			UserID:             l.UserID,
			UserName:           l.UserName,
			UserRole:           l.UserRole,
			EntityType:         l.EntityType,
			EntityID:           l.EntityID,
			Action:             l.Action,
			OldValue:           l.OldValue,
			NewValue:           l.NewValue,
			CreatedAt:          l.CreatedAt,
			FormattedCreatedAt: l.CreatedAt.Format("02 Jan 2026, 15:04"),
		}
	}

	return TransactionResponse{
		ID:                t.ID,
		UserID:            t.UserID,
		AccountID:         t.AccountID,
		AccountName:       t.AccountName,
		TargetAccountID:   t.TargetAccountID,
		TargetAccountName: t.TargetAccountName,
		CategoryID:        t.CategoryID,
		CategoryName:      t.CategoryName,
		CategoryIcon:      t.CategoryIcon,
		CategoryColor:     t.CategoryColor,
		Type:              t.Type,
		Amount:            t.Amount,
		FormattedAmount:   FormatRupiah(t.Amount),
		Date:              t.Date,
		Description:       t.Description,
		Notes:             t.Notes,
		IsSplit:           t.IsSplit,
		Source:            t.Source,
		Status:            t.Status,
		Reconciled:        t.Reconciled,
		Currency:          t.Currency,
		Tags:              t.Tags,
		CreatedAt:         t.CreatedAt,
		UpdatedAt:         t.UpdatedAt,
		Splits:            splitsRes,
		Attachments:       attachmentsRes,
		AuditLogs:         auditLogsRes,
	}
}

func ToTransactionSummaryResponse(s *model.TransactionSummary) TransactionSummaryResponse {
	return TransactionSummaryResponse{
		TotalIncome:          s.TotalIncome,
		FormattedTotalIncome: FormatRupiah(s.TotalIncome),
		TotalExpense:         s.TotalExpense,
		FormattedTotalExpense: FormatRupiah(s.TotalExpense),
		Net:                  s.Net,
		FormattedNet:         FormatRupiah(s.Net),
	}
}

type SplitTransactionRequest struct {
	Splits []CreateTransactionSplitRequest `json:"splits" binding:"required,dive"`
}

type ParsedOCRItem struct {
	Name     string  `json:"name"`
	Quantity int     `json:"quantity"`
	Price    float64 `json:"price"`
	Total    float64 `json:"total"`
}

type ParsedOCRData struct {
	MerchantName  string          `json:"merchant_name"`
	Date          string          `json:"date"`
	Items         []ParsedOCRItem `json:"items"`
	Total         float64         `json:"total"`
	PaymentMethod string          `json:"payment_method"`
}

type OCRResponse struct {
	ParsedData        ParsedOCRData      `json:"parsed_data"`
	ConfidenceScores  map[string]float64 `json:"confidence_scores"`
	OverallConfidence float64            `json:"overall_confidence"`
	NeedsReview       bool               `json:"needs_review"`
}

type ParsedPDFTransaction struct {
	Date        string  `json:"date"`
	Description string  `json:"description"`
	Debit       float64 `json:"debit"`
	Credit      float64 `json:"credit"`
	Balance     float64 `json:"balance"`
}

type PDFStatementResponse struct {
	BankDetected string                 `json:"bank_detected"`
	Period       string                 `json:"period"`
	Transactions []ParsedPDFTransaction `json:"transactions"`
	Confidence   float64                `json:"confidence"`
}

type DocumentUploadParseResponse struct {
	Type               string                `json:"type"` // "ocr" or "pdf_parse"
	DraftTransactionID string                `json:"draft_transaction_id,omitempty"`
	ParsedOCR          *OCRResponse          `json:"parsed_ocr,omitempty"`
	ParsedPDF          *PDFStatementResponse `json:"parsed_pdf,omitempty"`
	SuggestedCategoryID       string  `json:"suggested_category_id,omitempty"`
	SuggestedCategoryName     string  `json:"suggested_category_name,omitempty"`
	SuggestedCategoryConfidence float64 `json:"suggested_category_confidence,omitempty"`
}

type ConfirmDraftTransactionRequest struct {
	Date        time.Time `json:"date" binding:"required"`
	Amount      float64   `json:"amount" binding:"required,gt=0"`
	Type        string    `json:"type" binding:"required,oneof=income expense transfer"`
	AccountID   string    `json:"account_id" binding:"required"`
	CategoryID  *string   `json:"category_id"`
	Description *string   `json:"description"`
	Notes       *string   `json:"notes"`
	Source      string    `json:"source" binding:"required,oneof=ocr pdf_parse"`
}
