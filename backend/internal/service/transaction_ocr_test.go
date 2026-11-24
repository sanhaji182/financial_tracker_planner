package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/model"
)

type stubTxRepo struct {
	txs         map[string]*model.Transaction
	attachments []*model.TransactionAttachment
	seq         int
}

func (r *stubTxRepo) Create(_ context.Context, tx *model.Transaction, _ []model.TransactionSplit, _ *model.AuditLog) (*model.Transaction, error) {
	r.seq++
	copied := *tx
	if copied.ID == "" {
		copied.ID = "tx-draft-" + string(rune('0'+r.seq))
	}
	r.txs[copied.ID] = &copied
	return &copied, nil
}
func (r *stubTxRepo) GetByID(_ context.Context, id string) (*model.Transaction, error) {
	if tx, ok := r.txs[id]; ok {
		copied := *tx
		return &copied, nil
	}
	return nil, errors.New("not found")
}
func (r *stubTxRepo) GetAll(_ context.Context, _ string, _ map[string]interface{}, _, _ int, _, _ string) ([]model.Transaction, int64, error) {
	return nil, 0, nil
}
func (r *stubTxRepo) Update(_ context.Context, tx *model.Transaction, _ model.Transaction, _ *model.AuditLog) error {
	copied := *tx
	r.txs[copied.ID] = &copied
	return nil
}
func (r *stubTxRepo) SoftDelete(_ context.Context, _ string, _ *model.AuditLog) error { return nil }
func (r *stubTxRepo) GetSummary(_ context.Context, _ string, _, _ time.Time) (*model.TransactionSummary, error) {
	return &model.TransactionSummary{}, nil
}
func (r *stubTxRepo) SaveAttachment(_ context.Context, att *model.TransactionAttachment) (*model.TransactionAttachment, error) {
	copied := *att
	copied.ID = "att-1"
	r.attachments = append(r.attachments, &copied)
	return &copied, nil
}
func (r *stubTxRepo) GetAttachmentByID(_ context.Context, _ string, _ string) (*model.TransactionAttachment, error) {
	return nil, errors.New("not found")
}
func (r *stubTxRepo) DeleteAttachment(_ context.Context, _ string) error { return nil }
func (r *stubTxRepo) CreateAuditLog(_ context.Context, _ *model.AuditLog) error { return nil }
func (r *stubTxRepo) GetAuditLogs(_ context.Context, _, _ string) ([]model.AuditLog, error) { return nil, nil }
func (r *stubTxRepo) SplitTransaction(_ context.Context, _ string, _ []model.TransactionSplit, _ *model.AuditLog) error {
	return nil
}
func (r *stubTxRepo) GetGlobalAuditLogs(_ context.Context, _, _ string, _, _ *time.Time, _ string) ([]model.AuditLog, error) {
	return nil, nil
}

type stubAccRepo struct {
	accounts []model.Account
}

func (r *stubAccRepo) Create(_ context.Context, a *model.Account) (*model.Account, error) { return a, nil }
func (r *stubAccRepo) GetByID(_ context.Context, id string) (*model.Account, error) {
	for _, a := range r.accounts {
		if a.ID == id {
			copied := a
			return &copied, nil
		}
	}
	return nil, errors.New("account not found")
}
func (r *stubAccRepo) GetAllByUser(_ context.Context, _ string) ([]model.Account, error) {
	return r.accounts, nil
}
func (r *stubAccRepo) Update(_ context.Context, _ *model.Account) error { return nil }
func (r *stubAccRepo) SoftDelete(_ context.Context, _ string) error     { return nil }
func (r *stubAccRepo) GetSummaryByUser(_ context.Context, _ string) (*model.AccountSummary, error) {
	return &model.AccountSummary{}, nil
}
func (r *stubAccRepo) UpdateBalance(_ context.Context, _ string, _ float64) error { return nil }
func (r *stubAccRepo) HasActiveTransactions(_ context.Context, _ string) (bool, error) { return false, nil }

type stubCatRepo struct{}

func (r *stubCatRepo) GetAll(_ context.Context, _ string) ([]model.Category, error) { return nil, nil }
func (r *stubCatRepo) GetByID(_ context.Context, _ string) (*model.Category, error) {
	return &model.Category{ID: "cat-1", IsSystem: true}, nil
}
func (r *stubCatRepo) Create(_ context.Context, c *model.Category) (*model.Category, error) { return c, nil }
func (r *stubCatRepo) Update(_ context.Context, _ *model.Category) error { return nil }
func (r *stubCatRepo) SoftDelete(_ context.Context, _ string) error     { return nil }

type stubAIService struct {
	settings *model.AISettings
}

func (s *stubAIService) GetSettings(_ context.Context, _ string) (*dto.AISettingsResponse, error) {
	return &dto.AISettingsResponse{}, nil
}
func (s *stubAIService) UpdateSettings(_ context.Context, _ string, _ *dto.UpdateAISettingsRequest) error {
	return nil
}
func (s *stubAIService) GetSettingsRaw(_ context.Context, _ string) (*model.AISettings, error) {
	return s.settings, nil
}
func (s *stubAIService) GetAPIKey(_ context.Context, _ string) (string, error) { return "key", nil }
func (s *stubAIService) CallWorkerAI(_ context.Context, _ string, endpoint string, _ interface{}, respTarget interface{}) error {
	if endpoint == "/ai/enhance-ocr" {
		target := respTarget.(*dto.OCRResponse)
		*target = dto.OCRResponse{
			RawText:           "INDOMARET\nTOTAL 45.000",
			Engine:            "ai_vision (gemini)",
			OverallConfidence: 0.95,
			ParsedData: dto.ParsedOCRData{
				MerchantName:  "Indomaret",
				Date:          "2026-11-21",
				Total:         45000,
				PaymentMethod: "qris",
			},
		}
	}
	return nil
}
func (s *stubAIService) StreamWorkerAI(_ context.Context, _ string, _ string, _ interface{}, _ http.ResponseWriter) error {
	return nil
}
func (s *stubAIService) TranscribeVoiceWorker(_ context.Context, _ string, _ []byte, _, _, _ string) (*dto.VoiceTranscribeResponse, error) {
	return &dto.VoiceTranscribeResponse{}, nil
}
func (s *stubAIService) DetectAnomalies(_ context.Context, _ string) (*dto.AnomalyCheckResponse, error) {
	return &dto.AnomalyCheckResponse{}, nil
}

func TestTransactionOCRFullPipeline(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("UPLOADS_DIR", tmpDir)

	worker := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/ocr/receipt" {
			_ = json.NewEncoder(w).Encode(dto.OCRResponse{
				RawText:           "UNKNOWN\n0",
				Engine:            "tesseract (ind+eng)",
				OverallConfidence: 0.45,
				NeedsReview:       true,
				ParsedData: dto.ParsedOCRData{
					MerchantName: "Struk",
					Date:         "",
					Total:        0,
				},
			})
			return
		}
		if r.URL.Path == "/parse/pdf-statement" {
			_ = json.NewEncoder(w).Encode(dto.PDFStatementResponse{
				BankDetected:     "BCA",
				Period:           "Nov 2026",
				ExtractionMethod: "scanned_pdf_ocr",
				Confidence:       0.8,
				Transactions: []dto.ParsedPDFTransaction{
					{Date: "2026-11-21", Description: "QRIS KOPI", Debit: 25000},
					{Date: "2026-11-22", Description: "TRANSFER MASUK", Credit: 100000},
				},
			})
		}
	}))
	defer worker.Close()
	t.Setenv("WORKER_URL", worker.URL)

	t.Run("OCR with total=0 uses positive draft amount, valid source, and auto-attaches receipt", func(t *testing.T) {
		txRepo := &stubTxRepo{txs: map[string]*model.Transaction{}}
		accRepo := &stubAccRepo{accounts: []model.Account{{ID: "acc-1", UserID: "user-1", IsActive: true}}}
		aiSvc := &stubAIService{
			settings: &model.AISettings{AIEnabled: false},
		}
		svc := NewTransactionService(txRepo, accRepo, &stubCatRepo{}, aiSvc)

		res, err := svc.UploadAndParse(context.Background(), "user-1", "struk.png", []byte("\x89PNG\r\n\x1a\nimg"))
		if err != nil {
			t.Fatalf("UploadAndParse failed: %v", err)
		}
		if res.DraftTransactionID == "" || res.AttachmentID == "" {
			t.Fatalf("expected DraftTransactionID and AttachmentID, got %+v", res)
		}
		if res.ParsedOCR == nil || res.ParsedOCR.ParsedData.Total != 0 {
			t.Fatalf("expected ParsedOCR total to stay 0 for user review")
		}
		if txRepo.txs[res.DraftTransactionID].Amount != 1 {
			t.Fatalf("expected DB draft amount clamped to 1 (>0 CHECK), got %v", txRepo.txs[res.DraftTransactionID].Amount)
		}
		if len(txRepo.attachments) != 1 || txRepo.attachments[0].TransactionID != res.DraftTransactionID {
			t.Fatalf("expected attachment saved for draft")
		}
	})

	t.Run("AI escalation writes source=ai_suggested (DB CHECK safe)", func(t *testing.T) {
		txRepo := &stubTxRepo{txs: map[string]*model.Transaction{}}
		accRepo := &stubAccRepo{accounts: []model.Account{{ID: "acc-1", UserID: "user-1", IsActive: true}}}
		aiSvc := &stubAIService{
			settings: &model.AISettings{AIEnabled: true, OCREscalationEnabled: true, AIProvider: "gemini"},
		}
		svc := NewTransactionService(txRepo, accRepo, &stubCatRepo{}, aiSvc)

		res, err := svc.UploadAndParse(context.Background(), "user-1", "struk.png", []byte("\x89PNG\r\n\x1a\nimg"))
		if err != nil {
			t.Fatalf("UploadAndParse failed: %v", err)
		}
		if txRepo.txs[res.DraftTransactionID].Source != "ai_suggested" {
			t.Fatalf("expected source ai_suggested, got %s", txRepo.txs[res.DraftTransactionID].Source)
		}
	})

	t.Run("PDF statement returns draft IDs and BulkConfirm confirms multiple rows", func(t *testing.T) {
		txRepo := &stubTxRepo{txs: map[string]*model.Transaction{}}
		accRepo := &stubAccRepo{accounts: []model.Account{{ID: "acc-1", UserID: "user-1", IsActive: true}}}
		svc := NewTransactionService(txRepo, accRepo, &stubCatRepo{}, &stubAIService{settings: &model.AISettings{}})

		res, err := svc.UploadAndParse(context.Background(), "user-1", "mutasi.pdf", []byte("%PDF-1.4"))
		if err != nil {
			t.Fatalf("PDF UploadAndParse failed: %v", err)
		}
		if len(res.DraftTransactionIDs) != 2 || res.ParsedPDF == nil || res.ParsedPDF.Transactions[0].DraftID == "" {
			t.Fatalf("expected 2 draft IDs in PDF response, got %+v", res)
		}

		confirmed, err := svc.BulkConfirmParsedTransactions(context.Background(), "user-1", dto.BulkConfirmDraftsRequest{
			Drafts: []dto.BulkConfirmDraftItem{
				{ID: res.DraftTransactionIDs[0], AccountID: "acc-1"},
				{ID: res.DraftTransactionIDs[1], AccountID: "acc-1"},
			},
		}, nil, nil)
		if err != nil {
			t.Fatalf("BulkConfirm failed: %v", err)
		}
		if len(confirmed) != 2 || confirmed[0].Status != "confirmed" || confirmed[1].Status != "confirmed" {
			t.Fatalf("expected 2 confirmed transactions, got %+v", confirmed)
		}
	})
}
