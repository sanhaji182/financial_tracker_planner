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
	"github.com/user/financial-os/internal/util"
)

func setupApprovalTestRouter(store *MemoryApprovalStore, createdCalls *int) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	v1 := r.Group("/api/v1")

	ownerID := "11111111-1111-1111-1111-111111111111"
	resolver := func(_ context.Context, userID, role string) (string, error) {
		if role == "spouse_co_owner" || role == "spouse_viewer" {
			return ownerID, nil
		}
		return userID, nil
	}
	txCreator := func(_ context.Context, _ string, req dto.CreateTransactionRequest) (*dto.TransactionResponse, error) {
		*createdCalls++
		return &dto.TransactionResponse{
			ID:     "tx-approved-001",
			Amount: req.Amount,
		}, nil
	}

	h := NewApprovalHandler(store, resolver, nil, nil, txCreator)
	h.RegisterRoutes(v1)
	return r
}

func TestApprovalHandlerWorkflow(t *testing.T) {
	store := NewMemoryApprovalStore()
	createdCalls := 0
	r := setupApprovalTestRouter(store, &createdCalls)

	ownerID := "11111111-1111-1111-1111-111111111111"
	spouseID := "22222222-2222-2222-2222-222222222222"
	ownerToken, _ := util.GenerateAccessToken(ownerID, "owner", "owner@keluarga.id")
	coOwnerToken, _ := util.GenerateAccessToken(spouseID, "spouse_co_owner", "istri@keluarga.id")

	// 1. Owner updates threshold to Rp 1.000.000
	setReq := httptest.NewRequest(http.MethodPut, "/api/v1/approvals/settings", bytes.NewBufferString(`{"threshold_idr":1000000}`))
	setReq.Header.Set("Authorization", "Bearer "+ownerToken)
	setReq.Header.Set("Content-Type", "application/json")
	setRec := httptest.NewRecorder()
	r.ServeHTTP(setRec, setReq)
	if setRec.Code != http.StatusOK {
		t.Fatalf("expected 200 setting threshold, got %d: %s", setRec.Code, setRec.Body.String())
	}

	// 2. Co-owner creates a pending spending approval request
	createReq := httptest.NewRequest(http.MethodPost, "/api/v1/approvals", bytes.NewBufferString(`{
		"account_id": "acc-shared-bca",
		"tx_type": "expense",
		"amount": 1750000,
		"description": "Beli Kulkas Hemat Listrik"
	}`))
	createReq.Header.Set("Authorization", "Bearer "+coOwnerToken)
	createReq.Header.Set("Content-Type", "application/json")
	createRec := httptest.NewRecorder()
	r.ServeHTTP(createRec, createReq)
	if createRec.Code != http.StatusCreated {
		t.Fatalf("expected 201 creating approval, got %d: %s", createRec.Code, createRec.Body.String())
	}

	var createPayload struct {
		Data TransactionApproval `json:"data"`
	}
	if err := json.Unmarshal(createRec.Body.Bytes(), &createPayload); err != nil {
		t.Fatalf("unmarshal create failed: %v", err)
	}
	approvalID := createPayload.Data.ID
	if approvalID == "" || createPayload.Data.Status != "pending" || createPayload.Data.Amount != int64(1750000) {
		t.Fatalf("expected pending approval ID with int64 amount 1750000, got %+v", createPayload.Data)
	}

	// Fractional currency amount must be rejected -> 400
	fracReq := httptest.NewRequest(http.MethodPost, "/api/v1/approvals", bytes.NewBufferString(`{
		"account_id": "acc-shared-bca",
		"tx_type": "expense",
		"amount": 1750000.5,
		"description": "Nominal pecahan ilegal"
	}`))
	fracReq.Header.Set("Authorization", "Bearer "+coOwnerToken)
	fracReq.Header.Set("Content-Type", "application/json")
	fracRec := httptest.NewRecorder()
	r.ServeHTTP(fracRec, fracReq)
	if fracRec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 on fractional approval amount, got %d: %s", fracRec.Code, fracRec.Body.String())
	}

	// 3. Co-owner cannot self-approve their own request -> 403
	selfApproveReq := httptest.NewRequest(http.MethodPost, "/api/v1/approvals/"+approvalID+"/approve", bytes.NewBufferString(`{}`))
	selfApproveReq.Header.Set("Authorization", "Bearer "+coOwnerToken)
	selfApproveReq.Header.Set("Content-Type", "application/json")
	selfApproveRec := httptest.NewRecorder()
	r.ServeHTTP(selfApproveRec, selfApproveReq)
	if selfApproveRec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 on self-approval by co-owner, got %d", selfApproveRec.Code)
	}

	// 4. Owner approves -> invokes txCreator and marks approved
	appReq := httptest.NewRequest(http.MethodPost, "/api/v1/approvals/"+approvalID+"/approve", bytes.NewBufferString(`{"review_note":"Setuju, memang perlu"}`))
	appReq.Header.Set("Authorization", "Bearer "+ownerToken)
	appReq.Header.Set("Content-Type", "application/json")
	appRec := httptest.NewRecorder()
	r.ServeHTTP(appRec, appReq)
	if appRec.Code != http.StatusOK {
		t.Fatalf("expected 200 on owner approval, got %d: %s", appRec.Code, appRec.Body.String())
	}
	if createdCalls != 1 {
		t.Fatalf("expected txCreator to be called once, got %d", createdCalls)
	}

	var appPayload struct {
		Data TransactionApproval `json:"data"`
	}
	_ = json.Unmarshal(appRec.Body.Bytes(), &appPayload)
	if appPayload.Data.Status != "approved" || appPayload.Data.TransactionID == nil || *appPayload.Data.TransactionID != "tx-approved-001" {
		t.Fatalf("unexpected approved payload: %+v", appPayload.Data)
	}

	// 5. Second approval & reject flow
	createReq2 := httptest.NewRequest(http.MethodPost, "/api/v1/approvals", bytes.NewBufferString(`{
		"account_id": "acc-shared-bca",
		"amount": 2500000,
		"description": "Upgrade Sofa"
	}`))
	createReq2.Header.Set("Authorization", "Bearer "+coOwnerToken)
	createReq2.Header.Set("Content-Type", "application/json")
	createRec2 := httptest.NewRecorder()
	r.ServeHTTP(createRec2, createReq2)
	var createPayload2 struct {
		Data TransactionApproval `json:"data"`
	}
	_ = json.Unmarshal(createRec2.Body.Bytes(), &createPayload2)

	rejReq := httptest.NewRequest(http.MethodPost, "/api/v1/approvals/"+createPayload2.Data.ID+"/reject", bytes.NewBufferString(`{"review_note":"Tunda bulan depan"}`))
	rejReq.Header.Set("Authorization", "Bearer "+ownerToken)
	rejReq.Header.Set("Content-Type", "application/json")
	rejRec := httptest.NewRecorder()
	r.ServeHTTP(rejRec, rejReq)
	if rejRec.Code != http.StatusOK {
		t.Fatalf("expected 200 rejecting approval, got %d", rejRec.Code)
	}
	if createdCalls != 1 {
		t.Fatalf("reject must not create transaction, calls=%d", createdCalls)
	}
}
