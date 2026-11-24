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

type stubDebtRepo struct{}

func (r *stubDebtRepo) Create(_ context.Context, d *model.Debt) (*model.Debt, error) { return d, nil }
func (r *stubDebtRepo) GetAllByUser(_ context.Context, _ string) ([]model.Debt, error) {
	return nil, nil
}
func (r *stubDebtRepo) GetByID(_ context.Context, _ string) (*model.Debt, error) {
	return nil, errors.New("not found")
}
func (r *stubDebtRepo) Update(_ context.Context, _ *model.Debt) error     { return nil }
func (r *stubDebtRepo) SoftDelete(_ context.Context, _ string) error     { return nil }
func (r *stubDebtRepo) GetPaymentsByDebt(_ context.Context, _ string) ([]model.DebtPayment, error) {
	return nil, nil
}
func (r *stubDebtRepo) CreatePayment(_ context.Context, p *model.DebtPayment, _ *model.Transaction, _ string) (*model.DebtPayment, error) {
	return p, nil
}
func (r *stubDebtRepo) GetSummaryByUser(_ context.Context, _ string) (*model.DebtSummary, error) {
	return &model.DebtSummary{}, nil
}

type stubScanAIService struct {
	settings *model.AISettings
	apiKey   string
}

func (s *stubScanAIService) GetSettings(_ context.Context, _ string) (*dto.AISettingsResponse, error) {
	return &dto.AISettingsResponse{}, nil
}
func (s *stubScanAIService) UpdateSettings(_ context.Context, _ string, _ *dto.UpdateAISettingsRequest) error {
	return nil
}
func (s *stubScanAIService) GetSettingsRaw(_ context.Context, _ string) (*model.AISettings, error) {
	return s.settings, nil
}
func (s *stubScanAIService) GetAPIKey(_ context.Context, _ string) (string, error) {
	return s.apiKey, nil
}
func (s *stubScanAIService) CallWorkerAI(_ context.Context, _ string, _ string, _ interface{}, _ interface{}) error {
	return nil
}
func (s *stubScanAIService) StreamWorkerAI(_ context.Context, _ string, _ string, _ interface{}, _ http.ResponseWriter) error {
	return nil
}
func (s *stubScanAIService) TranscribeVoiceWorker(_ context.Context, _ string, _ []byte, _, _, _ string) (*dto.VoiceTranscribeResponse, error) {
	return &dto.VoiceTranscribeResponse{}, nil
}
func (s *stubScanAIService) DetectAnomalies(_ context.Context, _ string) (*dto.AnomalyCheckResponse, error) {
	return &dto.AnomalyCheckResponse{}, nil
}

func TestSnapshotScanServices(t *testing.T) {
	var seenAIProvider, seenAIModel, seenAIKey, seenPassword string

	worker := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seenAIProvider = r.Header.Get("X-AI-Provider")
		seenAIModel = r.Header.Get("X-AI-Model")
		seenAIKey = r.Header.Get("X-AI-API-Key")
		if err := r.ParseMultipartForm(10 << 20); err == nil {
			seenPassword = r.FormValue("pdf_password")
		}

		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/parse/debt-snapshot":
			if seenPassword == "" && r.FormValue("pdf_password") == "" {
				// Return password required when filename starts with "locked"
				if _, fh, _ := r.FormFile("file"); fh != nil && fh.Filename == "locked.pdf" {
					w.WriteHeader(http.StatusUnprocessableEntity)
					_ = json.NewEncoder(w).Encode(map[string]interface{}{
						"detail": map[string]string{
							"code":    "PDF_PASSWORD_REQUIRED",
							"message": "PDF ini dilindungi password.",
						},
					})
					return
				}
			}
			minPay := 650000.0
			dueDay := 5
			tenor := 4
			_ = json.NewEncoder(w).Encode(dto.DebtScanResponse{
				Mode:              "debt",
				Engine:            "ai_vision (gemini)",
				ExtractionMethod:  "image_ocr",
				OverallConfidence: 0.94,
				ParsedDebt: &dto.DebtScanParsedData{
					Name:               "SPayLater",
					Type:               "installment",
					Creditor:           "Shopee / SPayLater",
					OriginalAmount:     2450000,
					OutstandingBalance: 2450000,
					MinimumPayment:     &minPay,
					DueDay:             &dueDay,
					TenorMonths:        &tenor,
					Currency:           "IDR",
				},
			})
		case "/parse/debt-payment":
			_ = json.NewEncoder(w).Encode(dto.DebtScanResponse{
				Mode:              "payment",
				Engine:            "tesseract (ind+eng)",
				ExtractionMethod:  "image_ocr",
				OverallConfidence: 0.88,
				ParsedPayment: &dto.DebtPaymentScanParsedData{
					Amount:            650000,
					PaymentDate:       "2026-11-21",
					SourceAccountHint: "BCA",
					CreditorHint:      "SPayLater",
					ReferenceNumber:   "REF123",
				},
			})
		case "/parse/account-snapshot":
			_ = json.NewEncoder(w).Encode(dto.AccountScanResponse{
				Engine:            "tesseract (ind+eng)",
				ExtractionMethod:  "image_ocr",
				OverallConfidence: 0.9,
				ParsedAccount: &dto.AccountScanParsedData{
					Name:          "BCA ••••5678",
					Type:          "bank",
					BankProvider:  "BCA",
					AccountNumber: "8012345678",
					Balance:       15750000,
					BalanceDate:   "2026-11-21",
					Currency:      "IDR",
				},
			})
		}
	}))
	defer worker.Close()
	t.Setenv("WORKER_URL", worker.URL)

	provBCA := "BCA"
	maskedBCA := "****5678"
	accRepo := &stubAccRepo{
		accounts: []model.Account{
			{
				ID:                  "acc-bca-1",
				UserID:              "user-1",
				Name:                "BCA Utama",
				Type:                "bank",
				BankProvider:        &provBCA,
				AccountNumberMasked: &maskedBCA,
				IsActive:            true,
				CreatedAt:           time.Now(),
				UpdatedAt:           time.Now(),
			},
		},
	}
	aiSvc := &stubScanAIService{
		settings: &model.AISettings{AIEnabled: true, AIProvider: "gemini", AIModel: "gemini-2.5-flash"},
		apiKey:   "secret-gemini-key",
	}

	debtSvc := NewDebtService(&stubDebtRepo{}, accRepo, &stubCatRepo{}, aiSvc)
	accountSvc := NewAccountService(accRepo, aiSvc)

	t.Run("ScanDebtDocument debt mode forwards AI headers", func(t *testing.T) {
		res, err := debtSvc.ScanDebtDocument(context.Background(), "user-1", "spay.png", []byte("\x89PNG\r\n\x1a\nfake"), "debt", "")
		if err != nil {
			t.Fatalf("ScanDebtDocument failed: %v", err)
		}
		if seenAIProvider != "gemini" || seenAIModel != "gemini-2.5-flash" || seenAIKey != "secret-gemini-key" {
			t.Fatalf("expected AI headers forwarded, got provider=%q model=%q key=%q", seenAIProvider, seenAIModel, seenAIKey)
		}
		if res.ParsedDebt == nil || res.ParsedDebt.OutstandingBalance != 2450000 {
			t.Fatalf("unexpected parsed debt: %+v", res.ParsedDebt)
		}
	})

	t.Run("ScanDebtDocument payment mode resolves matched account", func(t *testing.T) {
		res, err := debtSvc.ScanDebtDocument(context.Background(), "user-1", "pay.png", []byte("\x89PNG\r\n\x1a\nfake"), "payment", "")
		if err != nil {
			t.Fatalf("ScanDebtDocument payment failed: %v", err)
		}
		if res.ParsedPayment == nil || res.ParsedPayment.MatchedAccountID != "acc-bca-1" {
			t.Fatalf("expected matched_account_id acc-bca-1, got %+v", res.ParsedPayment)
		}
	})

	t.Run("ScanDebtDocument maps 422 PDF_PASSWORD_REQUIRED to WorkerScanError", func(t *testing.T) {
		_, err := debtSvc.ScanDebtDocument(context.Background(), "user-1", "locked.pdf", []byte("%PDF-1.4"), "debt", "")
		var scanErr *WorkerScanError
		if !errors.As(err, &scanErr) || scanErr.StatusCode != http.StatusUnprocessableEntity || scanErr.Code != "PDF_PASSWORD_REQUIRED" {
			t.Fatalf("expected 422 WorkerScanError PDF_PASSWORD_REQUIRED, got %v", err)
		}
	})

	t.Run("ScanAccountDocument matches account by masked digits and rejects invalid extension", func(t *testing.T) {
		res, err := accountSvc.ScanAccountDocument(context.Background(), "user-1", "bca.png", []byte("\x89PNG\r\n\x1a\nfake"), "")
		if err != nil {
			t.Fatalf("ScanAccountDocument failed: %v", err)
		}
		if res.MatchedAccountID != "acc-bca-1" || res.ParsedAccount.Balance != 15750000 {
			t.Fatalf("unexpected account scan result: %+v", res)
		}

		_, badErr := accountSvc.ScanAccountDocument(context.Background(), "user-1", "bad.txt", []byte("plain text"), "")
		var scanErr *WorkerScanError
		if !errors.As(badErr, &scanErr) || scanErr.StatusCode != http.StatusBadRequest {
			t.Fatalf("expected 400 invalid file error, got %v", badErr)
		}
	})
}
