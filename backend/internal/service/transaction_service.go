package service

import (
	"bytes"
	"context"
	"encoding/json"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"math"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/model"
	"github.com/user/financial-os/internal/repository"
)

type TransactionService interface {
	CreateTransaction(ctx context.Context, userID string, req dto.CreateTransactionRequest, ip, ua *string) (*dto.TransactionResponse, error)
	GetTransactions(ctx context.Context, userID string, filters map[string]interface{}, page, pageSize int, sortField, sortOrder string) (*dto.TransactionListResponse, error)
	GetTransactionByID(ctx context.Context, transactionID string, userID string) (*dto.TransactionResponse, error)
	UpdateTransaction(ctx context.Context, transactionID string, userID string, req dto.UpdateTransactionRequest, ip, ua *string) (*dto.TransactionResponse, error)
	DeleteTransaction(ctx context.Context, transactionID string, userID string, ip, ua *string) error
	GetTransactionSummary(ctx context.Context, userID string, dateFromStr, dateToStr string) (*dto.TransactionSummaryResponse, error)
	UploadAttachment(ctx context.Context, transactionID string, userID string, fileName string, fileData []byte, fileType string, fileSize int) (*dto.TransactionAttachmentResponse, error)
	SplitTransaction(ctx context.Context, transactionID string, userID string, req dto.SplitTransactionRequest, ip, ua *string) (*dto.TransactionResponse, error)
	UploadAndParse(ctx context.Context, userID string, fileName string, fileBytes []byte) (*dto.DocumentUploadParseResponse, error)
	ConfirmParsedTransaction(ctx context.Context, userID string, draftTxID string, req dto.ConfirmDraftTransactionRequest, ip, ua *string) (*dto.TransactionResponse, error)
}

type transactionService struct {
	txRepo       repository.TransactionRepository
	accountRepo  repository.AccountRepository
	categoryRepo repository.CategoryRepository
	aiService    AISettingsService
}

func NewTransactionService(
	txRepo repository.TransactionRepository,
	accountRepo repository.AccountRepository,
	categoryRepo repository.CategoryRepository,
	aiService AISettingsService,
) TransactionService {
	return &transactionService{
		txRepo:       txRepo,
		accountRepo:  accountRepo,
		categoryRepo: categoryRepo,
		aiService:    aiService,
	}
}

func (s *transactionService) CreateTransaction(ctx context.Context, userID string, req dto.CreateTransactionRequest, ip, ua *string) (*dto.TransactionResponse, error) {
	// 1. Account existence validation
	acc, err := s.accountRepo.GetByID(ctx, req.AccountID)
	if err != nil {
		return nil, errors.New("source account not found")
	}
	if acc.UserID != userID {
		return nil, errors.New("unauthorized account access")
	}

	// 2. Target account validation (if transfer)
	if req.Type == "transfer" {
		if req.TargetAccountID == nil || *req.TargetAccountID == "" {
			return nil, errors.New("target account is required for transfer transactions")
		}
		targetAcc, err := s.accountRepo.GetByID(ctx, *req.TargetAccountID)
		if err != nil {
			return nil, errors.New("target account not found")
		}
		if targetAcc.UserID != userID {
			return nil, errors.New("unauthorized target account access")
		}
	} else {
		// Category validation (if not transfer)
		if req.CategoryID == nil || *req.CategoryID == "" {
			return nil, errors.New("category is required for income/expense transactions")
		}
		cat, err := s.categoryRepo.GetByID(ctx, *req.CategoryID)
		if err != nil {
			return nil, errors.New("category not found")
		}
		if cat.UserID != nil && *cat.UserID != userID {
			return nil, errors.New("unauthorized category access")
		}
	}

	// 3. Validation for split transaction amounts
	isSplit := len(req.Splits) > 0
	var modelSplits []model.TransactionSplit
	if isSplit {
		var sumSplit float64
		for _, sp := range req.Splits {
			sumSplit += sp.Amount
			modelSplits = append(modelSplits, model.TransactionSplit{
				CategoryID:  sp.CategoryID,
				Amount:      sp.Amount,
				Description: sp.Description,
			})
		}
		if sumSplit != req.Amount {
			return nil, errors.New("sum of split amounts must equal transaction total amount")
		}
	}

	newTx := &model.Transaction{
		UserID:          userID,
		AccountID:       req.AccountID,
		TargetAccountID: req.TargetAccountID,
		CategoryID:      req.CategoryID,
		Type:            req.Type,
		Amount:          req.Amount,
		Date:            req.Date,
		Description:     req.Description,
		Notes:           req.Notes,
		IsSplit:         isSplit,
		Source:          "manual",
		Status:          "confirmed",
		Reconciled:      false,
		Currency:        "IDR",
		ExchangeRate:    1.0,
		Tags:            req.Tags,
	}

	auditLog := &model.AuditLog{
		UserID:     userID,
		EntityType: "transaction",
		Action:     "create",
		IPAddress:  ip,
		UserAgent:  ua,
	}

	created, err := s.txRepo.Create(ctx, newTx, modelSplits, auditLog)
	if err != nil {
		return nil, err
	}

	// Fetch again to fill joined names
	detailed, err := s.txRepo.GetByID(ctx, created.ID)
	if err != nil {
		res := dto.ToTransactionResponse(created)
		return &res, nil
	}

	res := dto.ToTransactionResponse(detailed)
	return &res, nil
}

func (s *transactionService) GetTransactions(ctx context.Context, userID string, filters map[string]interface{}, page, pageSize int, sortField, sortOrder string) (*dto.TransactionListResponse, error) {
	list, total, err := s.txRepo.GetAll(ctx, userID, filters, page, pageSize, sortField, sortOrder)
	if err != nil {
		return nil, err
	}

	resList := make([]dto.TransactionResponse, len(list))
	for i, t := range list {
		resList[i] = dto.ToTransactionResponse(&t)
	}

	totalPages := 0
	if pageSize > 0 {
		totalPages = int((total + int64(pageSize) - 1) / int64(pageSize))
	}

	return &dto.TransactionListResponse{
		Data: resList,
		Pagination: dto.PaginationMetadata{
			CurrentPage: page,
			PageSize:    pageSize,
			TotalItems:  total,
			TotalPages:  totalPages,
		},
	}, nil
}

func (s *transactionService) GetTransactionByID(ctx context.Context, transactionID string, userID string) (*dto.TransactionResponse, error) {
	t, err := s.txRepo.GetByID(ctx, transactionID)
	if err != nil {
		return nil, err
	}

	if t.UserID != userID {
		return nil, errors.New("unauthorized to view this transaction")
	}

	res := dto.ToTransactionResponse(t)
	return &res, nil
}

func (s *transactionService) UpdateTransaction(ctx context.Context, transactionID string, userID string, req dto.UpdateTransactionRequest, ip, ua *string) (*dto.TransactionResponse, error) {
	// 1. Fetch old transaction
	oldTx, err := s.txRepo.GetByID(ctx, transactionID)
	if err != nil {
		return nil, err
	}

	if oldTx.UserID != userID {
		return nil, errors.New("unauthorized to update this transaction")
	}

	// 2. Validate new account exists
	newAcc, err := s.accountRepo.GetByID(ctx, req.AccountID)
	if err != nil {
		return nil, errors.New("account not found")
	}
	if newAcc.UserID != userID {
		return nil, errors.New("unauthorized new account access")
	}

	// 3. Validate target account (if transfer)
	if req.Type == "transfer" {
		if req.TargetAccountID == nil || *req.TargetAccountID == "" {
			return nil, errors.New("target account is required for transfer transactions")
		}
		targetAcc, err := s.accountRepo.GetByID(ctx, *req.TargetAccountID)
		if err != nil {
			return nil, errors.New("target account not found")
		}
		if targetAcc.UserID != userID {
			return nil, errors.New("unauthorized target account access")
		}
	} else {
		if req.CategoryID == nil || *req.CategoryID == "" {
			return nil, errors.New("category is required for income/expense transactions")
		}
		cat, err := s.categoryRepo.GetByID(ctx, *req.CategoryID)
		if err != nil {
			return nil, errors.New("category not found")
		}
		if cat.UserID != nil && *cat.UserID != userID {
			return nil, errors.New("unauthorized category access")
		}
	}

	// Create updated transaction model
	updated := &model.Transaction{
		ID:              transactionID,
		UserID:          userID,
		AccountID:       req.AccountID,
		TargetAccountID: req.TargetAccountID,
		CategoryID:      req.CategoryID,
		Type:            req.Type,
		Amount:          req.Amount,
		Date:            req.Date,
		Description:     req.Description,
		Notes:           req.Notes,
		Tags:            req.Tags,
		Status:          oldTx.Status,
		Reconciled:      oldTx.Reconciled,
	}

	auditLog := &model.AuditLog{
		UserID:     userID,
		EntityType: "transaction",
		EntityID:   transactionID,
		Action:     "update",
		IPAddress:  ip,
		UserAgent:  ua,
	}

	err = s.txRepo.Update(ctx, updated, *oldTx, auditLog)
	if err != nil {
		return nil, err
	}

	detailed, err := s.txRepo.GetByID(ctx, transactionID)
	if err != nil {
		res := dto.ToTransactionResponse(updated)
		return &res, nil
	}

	res := dto.ToTransactionResponse(detailed)
	return &res, nil
}

func (s *transactionService) DeleteTransaction(ctx context.Context, transactionID string, userID string, ip, ua *string) error {
	t, err := s.txRepo.GetByID(ctx, transactionID)
	if err != nil {
		return err
	}

	if t.UserID != userID {
		return errors.New("unauthorized to delete this transaction")
	}

	auditLog := &model.AuditLog{
		UserID:     userID,
		EntityType: "transaction",
		EntityID:   transactionID,
		Action:     "delete",
		IPAddress:  ip,
		UserAgent:  ua,
	}

	return s.txRepo.SoftDelete(ctx, transactionID, auditLog)
}

func (s *transactionService) GetTransactionSummary(ctx context.Context, userID string, dateFromStr, dateToStr string) (*dto.TransactionSummaryResponse, error) {
	now := time.Now()
	// Parse range defaults to this month
	dateFrom := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	dateTo := dateFrom.AddDate(0, 1, 0).Add(-time.Nanosecond)

	if dateFromStr != "" {
		if t, err := time.Parse("2006-01-02", dateFromStr); err == nil {
			dateFrom = time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
		}
	}
	if dateToStr != "" {
		if t, err := time.Parse("2006-01-02", dateToStr); err == nil {
			dateTo = time.Date(t.Year(), t.Month(), t.Day(), 23, 59, 59, 999999999, time.UTC)
		}
	}

	summary, err := s.txRepo.GetSummary(ctx, userID, dateFrom, dateTo)
	if err != nil {
		return nil, err
	}

	res := dto.ToTransactionSummaryResponse(summary)
	return &res, nil
}

func (s *transactionService) UploadAttachment(ctx context.Context, transactionID string, userID string, fileName string, fileData []byte, fileType string, fileSize int) (*dto.TransactionAttachmentResponse, error) {
	// Verify transaction belongs to user
	t, err := s.txRepo.GetByID(ctx, transactionID)
	if err != nil {
		return nil, err
	}
	if t.UserID != userID {
		return nil, errors.New("unauthorized transaction attachment upload")
	}

	// Create uploads directory if it doesn't exist
	uploadsDir := "/app/uploads"
	if _, err := os.Stat(uploadsDir); os.IsNotExist(err) {
		err = os.MkdirAll(uploadsDir, os.ModePerm)
		if err != nil {
			return nil, fmt.Errorf("failed to create upload directory: %w", err)
		}
	}

	// Create unique file name
	uniqueID := uuid.New().String()
	ext := filepath.Ext(fileName)
	uniqueFileName := fmt.Sprintf("%s_%s%s", transactionID, uniqueID, ext)
	filePath := filepath.Join(uploadsDir, uniqueFileName)

	// Write file to disk
	err = os.WriteFile(filePath, fileData, 0644)
	if err != nil {
		return nil, fmt.Errorf("failed to write file to disk: %w", err)
	}

	// Save to DB
	att := &model.TransactionAttachment{
		TransactionID: transactionID,
		FileName:      uniqueFileName,
		FilePath:      filePath,
		FileType:      &fileType,
		FileSize:      &fileSize,
	}

	saved, err := s.txRepo.SaveAttachment(ctx, att)
	if err != nil {
		// Clean up file if DB save fails
		os.Remove(filePath)
		return nil, err
	}

	res := &dto.TransactionAttachmentResponse{
		ID:        saved.ID,
		FileName:  saved.FileName,
		FilePath:  saved.FilePath,
		FileURL:   fmt.Sprintf("/uploads/%s", saved.FileName),
		FileType:  saved.FileType,
		FileSize:  saved.FileSize,
		CreatedAt: saved.CreatedAt,
	}

	// Add audit log for attachment upload
	auditLog := &model.AuditLog{
		UserID:     userID,
		EntityType: "transaction",
		EntityID:   transactionID,
		Action:     "upload_attachment",
		NewValue:   res,
	}
	_ = s.txRepo.CreateAuditLog(ctx, auditLog)

	return res, nil
}

func (s *transactionService) SplitTransaction(ctx context.Context, transactionID string, userID string, req dto.SplitTransactionRequest, ip, ua *string) (*dto.TransactionResponse, error) {
	// 1. Get original transaction
	tx, err := s.txRepo.GetByID(ctx, transactionID)
	if err != nil {
		return nil, err
	}

	if tx.UserID != userID {
		return nil, errors.New("unauthorized to split this transaction")
	}

	if tx.Type == "transfer" {
		return nil, errors.New("transfer transactions cannot be split")
	}

	// 2. Validate sum of split amounts equals transaction amount
	var splitSum float64
	for _, split := range req.Splits {
		splitSum += split.Amount
	}

	// Deal with float precision issues within 0.01 tolerance
	if math.Abs(splitSum-tx.Amount) > 0.01 {
		return nil, fmt.Errorf("total split amount (%f) must equal transaction amount (%f)", splitSum, tx.Amount)
	}

	// 3. Validate categories exist
	modelSplits := make([]model.TransactionSplit, len(req.Splits))
	for i, split := range req.Splits {
		cat, err := s.categoryRepo.GetByID(ctx, split.CategoryID)
		if err != nil {
			return nil, fmt.Errorf("category not found: %s", split.CategoryID)
		}
		if !cat.IsSystem && (cat.UserID == nil || *cat.UserID != userID) {
			return nil, errors.New("unauthorized category access")
		}

		modelSplits[i] = model.TransactionSplit{
			TransactionID: transactionID,
			CategoryID:    split.CategoryID,
			Amount:        split.Amount,
			Description:   split.Description,
		}
	}

	// 4. Construct audit log
	auditLog := &model.AuditLog{
		UserID:     userID,
		EntityType: "transaction",
		EntityID:   transactionID,
		Action:     "split",
		OldValue:   map[string]interface{}{"is_split": tx.IsSplit, "category_id": tx.CategoryID, "amount": tx.Amount},
		NewValue:   map[string]interface{}{"is_split": true, "splits": req.Splits},
		IPAddress:  ip,
		UserAgent:  ua,
	}

	// 5. Save splits & update transaction
	err = s.txRepo.SplitTransaction(ctx, transactionID, modelSplits, auditLog)
	if err != nil {
		return nil, err
	}

	return s.GetTransactionByID(ctx, transactionID, userID)
}

func (s *transactionService) UploadAndParse(ctx context.Context, userID string, fileName string, fileBytes []byte) (*dto.DocumentUploadParseResponse, error) {
	// 1. Create uploads folder if it doesn't exist
	uploadsDir := "uploads"
	if err := os.MkdirAll(uploadsDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create uploads folder: %w", err)
	}

	// 2. Generate secure name and save file
	ext := filepath.Ext(fileName)
	uniqueName := fmt.Sprintf("%d-%s%s", time.Now().UnixNano(), uuid.New().String()[:8], ext)
	filePath := filepath.Join(uploadsDir, uniqueName)
	if err := os.WriteFile(filePath, fileBytes, 0644); err != nil {
		return nil, fmt.Errorf("failed to save file: %w", err)
	}

	// 3. Determine parser endpoint based on extension
	isPDF := strings.ToLower(ext) == ".pdf"
	workerURL := os.Getenv("WORKER_URL")
	if workerURL == "" {
		workerURL = "http://localhost:8081"
	}
	
	endpoint := "/ocr/receipt"
	if isPDF {
		endpoint = "/parse/pdf-statement"
	}
	targetURL := workerURL + endpoint

	// 4. Construct multipart request to FastAPI worker
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	part, err := writer.CreateFormFile("file", uniqueName)
	if err != nil {
		return nil, fmt.Errorf("failed to create multipart form: %w", err)
	}
	if _, err := io.Copy(part, bytes.NewReader(fileBytes)); err != nil {
		return nil, fmt.Errorf("failed to write multipart file: %w", err)
	}
	_ = writer.Close()

	req, err := http.NewRequestWithContext(ctx, "POST", targetURL, body)
	if err != nil {
		return nil, fmt.Errorf("failed to create HTTP request to worker: %w", err)
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to call worker service: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBytes, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("worker service returned error status %d: %s", resp.StatusCode, string(respBytes))
	}

	// 5. Query first active account as fallback or default
	accounts, err := s.accountRepo.GetAllByUser(ctx, userID)
	defaultAccountID := ""
	if err == nil && len(accounts) > 0 {
		for _, acc := range accounts {
			if acc.IsActive {
				defaultAccountID = acc.ID
				break
			}
		}
	}

	// 6. Handle parsed response
	var response dto.DocumentUploadParseResponse
	if isPDF {
		response.Type = "pdf_parse"
		var pdfRes dto.PDFStatementResponse
		if err := json.NewDecoder(resp.Body).Decode(&pdfRes); err != nil {
			return nil, fmt.Errorf("failed to decode worker PDF response: %w", err)
		}
		response.ParsedPDF = &pdfRes

		// Find BNI, BCA, Mandiri, BRI account if bank_detected matches
		targetAccountID := defaultAccountID
		for _, acc := range accounts {
			if acc.BankProvider != nil && strings.EqualFold(*acc.BankProvider, pdfRes.BankDetected) {
				targetAccountID = acc.ID
				break
			}
		}

		// Insert statement lines as draft transactions with status='pending_review'
		for _, item := range pdfRes.Transactions {
			txDate, parseErr := time.Parse("2006-01-02", item.Date)
			if parseErr != nil {
				txDate = time.Now()
			}
			
			txType := "expense"
			txAmount := item.Debit
			if item.Credit > 0 {
				txType = "income"
				txAmount = item.Credit
			}

			if txAmount <= 0 {
				continue
			}

			desc := item.Description
			draftTx := &model.Transaction{
				UserID:       userID,
				AccountID:    targetAccountID,
				Type:         txType,
				Amount:       txAmount,
				Date:         txDate,
				Description:  &desc,
				Status:       "pending_review",
				Source:       "pdf_parse",
				Currency:     "IDR",
				ExchangeRate: 1.0,
			}
			// Write directly to DB via repository without updating account balance
			_, _ = s.txRepo.Create(ctx, draftTx, nil, nil)
		}
	} else {
		response.Type = "ocr"
		var ocrRes dto.OCRResponse
		if err := json.NewDecoder(resp.Body).Decode(&ocrRes); err != nil {
			return nil, fmt.Errorf("failed to decode worker OCR response: %w", err)
		}

		// Hybrid OCR Escalation
		aiSet, err := s.aiService.GetSettingsRaw(ctx, userID)
		source := "ocr"
		if err == nil && aiSet.AIEnabled && aiSet.OCREscalationEnabled && ocrRes.OverallConfidence < 0.7 {
			base64Str := base64.StdEncoding.EncodeToString(fileBytes)
			escalationPayload := map[string]interface{}{
				"ocr_result":   ocrRes,
				"image_base64": base64Str,
				"filename":     fileName,
			}

			var enhancedRes dto.OCRResponse
			enhanceErr := s.aiService.CallWorkerAI(ctx, userID, "/ai/enhance-ocr", escalationPayload, &enhancedRes)
			if enhanceErr == nil {
				ocrRes = enhancedRes
				source = "ai_enhanced"
			}
		}
		response.ParsedOCR = &ocrRes

		// Parse OCR date
		txDate, parseErr := time.Parse("2006-01-02", ocrRes.ParsedData.Date)
		if parseErr != nil {
			txDate = time.Now()
		}

		desc := ocrRes.ParsedData.MerchantName

		// Auto-Categorization
		var suggestedCatID, suggestedCatName string
		var suggestedConfidence float64

		if err == nil && aiSet.AIEnabled && aiSet.AutoCategorizationEnabled {
			allCats, catErr := s.categoryRepo.GetAll(ctx, userID)
			if catErr == nil && len(allCats) > 0 {
				var availableCategories []map[string]string
				for _, c := range allCats {
					availableCategories = append(availableCategories, map[string]string{
						"id":   c.ID,
						"name": c.Name,
					})
				}

				catPayload := map[string]interface{}{
					"description":          desc,
					"amount":               ocrRes.ParsedData.Total,
					"merchant":             ocrRes.ParsedData.MerchantName,
					"available_categories": availableCategories,
				}

				type catSuggestion struct {
					CategoryID   string  `json:"category_id"`
					CategoryName string  `json:"category_name"`
					Confidence   float64 `json:"confidence"`
				}
				var suggestion catSuggestion
				sugErr := s.aiService.CallWorkerAI(ctx, userID, "/ai/categorize", catPayload, &suggestion)
				if sugErr == nil {
					suggestedCatID = suggestion.CategoryID
					suggestedCatName = suggestion.CategoryName
					suggestedConfidence = suggestion.Confidence
				}
			}
		}

		response.SuggestedCategoryID = suggestedCatID
		response.SuggestedCategoryName = suggestedCatName
		response.SuggestedCategoryConfidence = suggestedConfidence

		draftTx := &model.Transaction{
			UserID:       userID,
			AccountID:    defaultAccountID,
			Type:         "expense",
			Amount:       ocrRes.ParsedData.Total,
			Date:         txDate,
			Description:  &desc,
			Status:       "pending_review",
			Source:       source,
			Currency:     "IDR",
			ExchangeRate: 1.0,
		}

		if suggestedCatID != "" {
			draftTx.CategoryID = &suggestedCatID
		}
		
		createdDraft, createErr := s.txRepo.Create(ctx, draftTx, nil, nil)
		if createErr == nil {
			response.DraftTransactionID = createdDraft.ID
		}
	}

	return &response, nil
}

func (s *transactionService) ConfirmParsedTransaction(ctx context.Context, userID string, draftTxID string, req dto.ConfirmDraftTransactionRequest, ip, ua *string) (*dto.TransactionResponse, error) {
	// 1. Fetch existing draft
	oldTx, err := s.txRepo.GetByID(ctx, draftTxID)
	if err != nil {
		return nil, fmt.Errorf("draft transaction not found: %w", err)
	}

	if oldTx.UserID != userID {
		return nil, errors.New("unauthorized to confirm this transaction")
	}

	if oldTx.Status != "pending_review" {
		return nil, errors.New("transaction is not in pending_review status")
	}

	// 2. Validate selected account
	acc, err := s.accountRepo.GetByID(ctx, req.AccountID)
	if err != nil {
		return nil, errors.New("selected account not found")
	}
	if acc.UserID != userID {
		return nil, errors.New("unauthorized account access")
	}

	// 3. Validate category if provided
	if req.CategoryID != nil && *req.CategoryID != "" {
		cat, err := s.categoryRepo.GetByID(ctx, *req.CategoryID)
		if err != nil {
			return nil, errors.New("selected category not found")
		}
		if cat.UserID != nil && *cat.UserID != userID {
			return nil, errors.New("unauthorized category access")
		}
	}

	// 4. Update model fields for confirmation
	updatedTx := *oldTx
	updatedTx.Date = req.Date
	updatedTx.Amount = req.Amount
	updatedTx.Type = req.Type
	updatedTx.AccountID = req.AccountID
	updatedTx.CategoryID = req.CategoryID
	updatedTx.Description = req.Description
	updatedTx.Notes = req.Notes
	updatedTx.Status = "confirmed"
	updatedTx.Source = req.Source

	// 5. Construct audit log
	auditLog := &model.AuditLog{
		UserID:     userID,
		EntityType: "transaction",
		EntityID:   draftTxID,
		Action:     "confirm_draft",
		IPAddress:  ip,
		UserAgent:  ua,
	}

	// 6. Perform DB update (this triggers account balance updates in repo since new status is "confirmed")
	if err := s.txRepo.Update(ctx, &updatedTx, *oldTx, auditLog); err != nil {
		return nil, fmt.Errorf("failed to save confirmed transaction: %w", err)
	}

	// 7. Get final transaction response
	confirmedTx, err := s.txRepo.GetByID(ctx, draftTxID)
	if err != nil {
		res := dto.ToTransactionResponse(&updatedTx)
		return &res, nil
	}

	res := dto.ToTransactionResponse(confirmedTx)
	return &res, nil
}
