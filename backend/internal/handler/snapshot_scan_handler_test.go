package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/service"
	"github.com/user/financial-os/internal/util"
)

type mockDebtScanService struct {
	lastMode     string
	lastPassword string
	returnErr    error
}

func (m *mockDebtScanService) CreateDebt(_ context.Context, _ string, _ dto.CreateDebtRequest) (*dto.DebtResponse, error) {
	return &dto.DebtResponse{}, nil
}
func (m *mockDebtScanService) GetDebts(_ context.Context, _ string) ([]dto.DebtResponse, error) {
	return nil, nil
}
func (m *mockDebtScanService) GetDebtByID(_ context.Context, _ string, _ string) (*dto.DebtResponse, error) {
	return &dto.DebtResponse{}, nil
}
func (m *mockDebtScanService) UpdateDebt(_ context.Context, _ string, _ string, _ dto.UpdateDebtRequest) (*dto.DebtResponse, error) {
	return &dto.DebtResponse{}, nil
}
func (m *mockDebtScanService) DeleteDebt(_ context.Context, _ string, _ string) error { return nil }
func (m *mockDebtScanService) RecordPayment(_ context.Context, _ string, _ string, _ dto.RecordDebtPaymentRequest) (*dto.DebtPaymentResponse, error) {
	return &dto.DebtPaymentResponse{}, nil
}
func (m *mockDebtScanService) GetDebtSummary(_ context.Context, _ string) (*dto.DebtSummaryResponse, error) {
	return &dto.DebtSummaryResponse{}, nil
}
func (m *mockDebtScanService) SimulateAvalanche(_ context.Context, _ string, _ float64) (*dto.AvalancheSimulationResponse, error) {
	return &dto.AvalancheSimulationResponse{}, nil
}
func (m *mockDebtScanService) ScanDebtDocument(_ context.Context, _ string, _ string, _ []byte, mode string, pdfPassword string) (*dto.DebtScanResponse, error) {
	m.lastMode = mode
	m.lastPassword = pdfPassword
	if m.returnErr != nil {
		return nil, m.returnErr
	}
	return &dto.DebtScanResponse{
		Mode:              mode,
		Engine:            "tesseract (ind+eng)",
		OverallConfidence: 0.9,
		ParsedDebt: &dto.DebtScanParsedData{
			Name:               "SPayLater",
			Type:               "installment",
			Creditor:           "Shopee / SPayLater",
			OriginalAmount:     1200000,
			OutstandingBalance: 1200000,
			Currency:           "IDR",
		},
	}, nil
}

type mockAccountScanService struct {
	lastPassword string
	returnErr    error
}

func (m *mockAccountScanService) CreateAccount(_ context.Context, _ string, _ dto.CreateAccountRequest) (*dto.AccountResponse, error) {
	return &dto.AccountResponse{}, nil
}
func (m *mockAccountScanService) GetAccounts(_ context.Context, _ string) ([]dto.AccountResponse, error) {
	return nil, nil
}
func (m *mockAccountScanService) GetAccountByID(_ context.Context, _ string, _ string) (*dto.AccountResponse, error) {
	return &dto.AccountResponse{}, nil
}
func (m *mockAccountScanService) UpdateAccount(_ context.Context, _ string, _ string, _ dto.UpdateAccountRequest) (*dto.AccountResponse, error) {
	return &dto.AccountResponse{}, nil
}
func (m *mockAccountScanService) DeleteAccount(_ context.Context, _ string, _ string) error { return nil }
func (m *mockAccountScanService) GetAccountSummary(_ context.Context, _ string) (*dto.AccountSummaryResponse, error) {
	return &dto.AccountSummaryResponse{}, nil
}
func (m *mockAccountScanService) ScanAccountDocument(_ context.Context, _ string, _ string, _ []byte, pdfPassword string) (*dto.AccountScanResponse, error) {
	m.lastPassword = pdfPassword
	if m.returnErr != nil {
		return nil, m.returnErr
	}
	return &dto.AccountScanResponse{
		Engine:            "tesseract (ind+eng)",
		OverallConfidence: 0.92,
		MatchedAccountID:  "acc-1",
		ParsedAccount: &dto.AccountScanParsedData{
			Name:         "BCA",
			Type:         "bank",
			BankProvider: "BCA",
			Balance:      5500000,
			Currency:     "IDR",
		},
	}, nil
}

func buildMultipartUpload(t *testing.T, fieldName, fileName string, content []byte, extraFields map[string]string) (*bytes.Buffer, string) {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	fw, err := w.CreateFormFile(fieldName, fileName)
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	if _, err := fw.Write(content); err != nil {
		t.Fatalf("write file: %v", err)
	}
	for k, v := range extraFields {
		_ = w.WriteField(k, v)
	}
	_ = w.Close()
	return &buf, w.FormDataContentType()
}

func TestDebtAndAccountScanHandlers(t *testing.T) {
	gin.SetMode(gin.TestMode)
	debtSvc := &mockDebtScanService{}
	accSvc := &mockAccountScanService{}

	r := gin.New()
	v1 := r.Group("/api/v1")
	NewDebtHandler(debtSvc).RegisterRoutes(v1)
	NewAccountHandler(accSvc).RegisterRoutes(v1)

	token, err := util.GenerateAccessToken("user-1", "owner", "owner@example.com")
	if err != nil {
		t.Fatalf("generate token: %v", err)
	}

	t.Run("POST /debts/scan returns 200 and parses mode", func(t *testing.T) {
		body, ct := buildMultipartUpload(t, "file", "spay.png", []byte("\x89PNG\r\n\x1a\nimg"), map[string]string{"mode": "debt"})
		req := httptest.NewRequest(http.MethodPost, "/api/v1/debts/scan", body)
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", ct)
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
		}
		if debtSvc.lastMode != "debt" {
			t.Fatalf("expected mode debt, got %s", debtSvc.lastMode)
		}
	})

	t.Run("POST /debts/scan passes through 422 PDF_PASSWORD_REQUIRED", func(t *testing.T) {
		debtSvc.returnErr = &service.WorkerScanError{
			StatusCode: http.StatusUnprocessableEntity,
			Code:       "PDF_PASSWORD_REQUIRED",
			Message:    "PDF ini dilindungi password.",
		}
		defer func() { debtSvc.returnErr = nil }()

		body, ct := buildMultipartUpload(t, "file", "cc.pdf", []byte("%PDF-1.4"), nil)
		req := httptest.NewRequest(http.MethodPost, "/api/v1/debts/scan", body)
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", ct)
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)

		if rec.Code != http.StatusUnprocessableEntity {
			t.Fatalf("expected 422, got %d: %s", rec.Code, rec.Body.String())
		}
		var errResp struct {
			Error struct {
				Code string `json:"code"`
			} `json:"error"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &errResp); err != nil {
			t.Fatalf("unmarshal err: %v", err)
		}
		if errResp.Error.Code != "PDF_PASSWORD_REQUIRED" {
			t.Fatalf("expected PDF_PASSWORD_REQUIRED, got %s", errResp.Error.Code)
		}
	})

	t.Run("POST /accounts/scan returns 200 and forwards pdf_password", func(t *testing.T) {
		body, ct := buildMultipartUpload(t, "file", "bca.pdf", []byte("%PDF-1.4"), map[string]string{"pdf_password": "19900101"})
		req := httptest.NewRequest(http.MethodPost, "/api/v1/accounts/scan", body)
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", ct)
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
		}
		if accSvc.lastPassword != "19900101" {
			t.Fatalf("expected pdf_password forwarded, got %q", accSvc.lastPassword)
		}
	})
}
