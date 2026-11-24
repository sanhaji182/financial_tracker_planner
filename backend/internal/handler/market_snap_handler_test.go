package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/user/financial-os/internal/util"
)

func TestMarketPricesAndSNAPBIRoutes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	v1 := r.Group("/api/v1")

	h := NewMarketSnapHandler()
	h.disableLive = true // Keep unit test deterministic & offline-safe
	h.RegisterRoutes(v1)

	ownerToken, _ := util.GenerateAccessToken("11111111-1111-1111-1111-111111111111", "owner", "owner@keluarga.id")

	// 1. GET /market/prices
	pxReq := httptest.NewRequest(http.MethodGet, "/api/v1/market/prices", nil)
	pxReq.Header.Set("Authorization", "Bearer "+ownerToken)
	pxRec := httptest.NewRecorder()
	r.ServeHTTP(pxRec, pxReq)
	if pxRec.Code != http.StatusOK {
		t.Fatalf("expected 200 GET /market/prices, got %d: %s", pxRec.Code, pxRec.Body.String())
	}
	var pxPayload struct {
		Data MarketPricesPayload `json:"data"`
	}
	if err := json.Unmarshal(pxRec.Body.Bytes(), &pxPayload); err != nil {
		t.Fatalf("unmarshal market prices failed: %v", err)
	}
	if pxPayload.Data.GoldAntamPerGramIDR <= 0 || pxPayload.Data.USDIDR <= 0 || pxPayload.Data.IDXPrices["BBCA"] <= 0 {
		t.Fatalf("unexpected market prices payload: %+v", pxPayload.Data)
	}

	// 2. GET /connectors/snap-bi/status
	stReq := httptest.NewRequest(http.MethodGet, "/api/v1/connectors/snap-bi/status", nil)
	stReq.Header.Set("Authorization", "Bearer "+ownerToken)
	stRec := httptest.NewRecorder()
	r.ServeHTTP(stRec, stReq)
	if stRec.Code != http.StatusOK {
		t.Fatalf("expected 200 GET snap-bi/status, got %d", stRec.Code)
	}

	// 3. POST /connectors/snap-bi/sync
	syncReq := httptest.NewRequest(http.MethodPost, "/api/v1/connectors/snap-bi/sync", bytes.NewBufferString(`{"bank_name":"BCA SNAP","account_no":"888001122"}`))
	syncReq.Header.Set("Authorization", "Bearer "+ownerToken)
	syncReq.Header.Set("Content-Type", "application/json")
	syncRec := httptest.NewRecorder()
	r.ServeHTTP(syncRec, syncReq)
	if syncRec.Code != http.StatusOK {
		t.Fatalf("expected 200 POST snap-bi/sync, got %d: %s", syncRec.Code, syncRec.Body.String())
	}
	var syncPayload struct {
		Data struct {
			Provider     string        `json:"provider"`
			Transactions []interface{} `json:"transactions"`
		} `json:"data"`
	}
	_ = json.Unmarshal(syncRec.Body.Bytes(), &syncPayload)
	if syncPayload.Data.Provider != "BCA SNAP" || len(syncPayload.Data.Transactions) < 2 {
		t.Fatalf("unexpected SNAP sync output: %+v", syncPayload.Data)
	}
}
