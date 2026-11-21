package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/model"
	"github.com/user/financial-os/internal/util"
)

type mockTxService struct {
	bulkCalled bool
	bulkItems  []dto.BulkConfirmDraftItem
}

func (m *mockTxService) CreateTransaction(_ context.Context, _ string, _ dto.CreateTransactionRequest, _, _ *string) (*dto.TransactionResponse, error) {
	return &dto.TransactionResponse{}, nil
}
func (m *mockTxService) GetTransactions(_ context.Context, _ string, _ map[string]interface{}, _, _ int, _, _ string) (*dto.TransactionListResponse, error) {
	return &dto.TransactionListResponse{}, nil
}
func (m *mockTxService) GetTransactionByID(_ context.Context, _ string, _ string) (*dto.TransactionResponse, error) {
	return &dto.TransactionResponse{}, nil
}
func (m *mockTxService) UpdateTransaction(_ context.Context, _ string, _ string, _ dto.UpdateTransactionRequest, _, _ *string) (*dto.TransactionResponse, error) {
	return &dto.TransactionResponse{}, nil
}
func (m *mockTxService) DeleteTransaction(_ context.Context, _ string, _ string, _, _ *string) error {
	return nil
}
func (m *mockTxService) GetTransactionSummary(_ context.Context, _ string, _, _ string) (*dto.TransactionSummaryResponse, error) {
	return &dto.TransactionSummaryResponse{}, nil
}
func (m *mockTxService) UploadAttachment(_ context.Context, _ string, _ string, _ string, _ []byte, _ string, _ int) (*dto.TransactionAttachmentResponse, error) {
	return &dto.TransactionAttachmentResponse{}, nil
}
func (m *mockTxService) GetAttachmentForDownload(_ context.Context, _ string, _ string) (*model.TransactionAttachment, error) {
	return &model.TransactionAttachment{}, nil
}
func (m *mockTxService) SplitTransaction(_ context.Context, _ string, _ string, _ dto.SplitTransactionRequest, _, _ *string) (*dto.TransactionResponse, error) {
	return &dto.TransactionResponse{}, nil
}
func (m *mockTxService) UploadAndParse(_ context.Context, _ string, _ string, _ []byte) (*dto.DocumentUploadParseResponse, error) {
	return &dto.DocumentUploadParseResponse{}, nil
}
func (m *mockTxService) ConfirmParsedTransaction(_ context.Context, _ string, _ string, _ dto.ConfirmDraftTransactionRequest, _, _ *string) (*dto.TransactionResponse, error) {
	return &dto.TransactionResponse{}, nil
}
func (m *mockTxService) BulkConfirmParsedTransactions(_ context.Context, _ string, req dto.BulkConfirmDraftsRequest, _, _ *string) ([]dto.TransactionResponse, error) {
	m.bulkCalled = true
	m.bulkItems = req.Drafts
	res := make([]dto.TransactionResponse, len(req.Drafts))
	for i, d := range req.Drafts {
		res[i] = dto.TransactionResponse{ID: d.ID, AccountID: d.AccountID, Status: "confirmed"}
	}
	return res, nil
}

func TestTransactionConfirmBulkAndGeminiDTO(t *testing.T) {
	gin.SetMode(gin.TestMode)
	svc := &mockTxService{}
	r := gin.New()
	h := NewTransactionHandler(svc)
	h.RegisterRoutes(r.Group("/api/v1"))

	token, err := util.GenerateAccessToken("user-1", "owner", "owner@example.com")
	if err != nil {
		t.Fatalf("failed to generate token: %v", err)
	}

	t.Run("PUT /transactions/confirm-bulk confirms drafts", func(t *testing.T) {
		body := `{"drafts":[{"id":"draft-1","account_id":"acc-1"},{"id":"draft-2","account_id":"acc-1"}]}`
		req := httptest.NewRequest(http.MethodPut, "/api/v1/transactions/confirm-bulk", bytes.NewBufferString(body))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
		}
		if !svc.bulkCalled || len(svc.bulkItems) != 2 {
			t.Fatalf("expected BulkConfirmParsedTransactions called with 2 items")
		}

		var payload struct {
			ConfirmedCount int `json:"confirmed_count"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
			t.Fatalf("unmarshal failed: %v", err)
		}
		if payload.ConfirmedCount != 2 {
			t.Fatalf("expected confirmed_count 2, got %d", payload.ConfirmedCount)
		}
	})

	t.Run("UpdateAISettingsRequest binds gemini provider", func(t *testing.T) {
		aiRouter := gin.New()
		aiRouter.PUT("/ai", func(c *gin.Context) {
			var req dto.UpdateAISettingsRequest
			if err := c.ShouldBindJSON(&req); err != nil {
				c.Status(http.StatusUnprocessableEntity)
				return
			}
			c.Status(http.StatusOK)
		})

		req := httptest.NewRequest(http.MethodPut, "/ai", bytes.NewBufferString(`{"ai_enabled":true,"ai_provider":"gemini","ai_model":"gemini-2.5-flash"}`))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		aiRouter.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected gemini provider to validate (200), got %d", rec.Code)
		}
	})
}
