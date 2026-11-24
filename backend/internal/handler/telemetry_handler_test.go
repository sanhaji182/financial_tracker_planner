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

func TestTelemetryHandlerReportAndDiagnostics(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	v1 := r.Group("/api/v1")

	store := NewMemoryTelemetryStore()
	h := NewTelemetryHandler(store, nil)
	h.RegisterRoutes(v1)

	repReq := httptest.NewRequest(http.MethodPost, "/api/v1/telemetry/client-error", bytes.NewBufferString(`{
		"platform": "android",
		"app_version": "2026.11.23",
		"message": "ML Kit timeout on blurry thermal receipt",
		"route": "/transactions/upload"
	}`))
	repReq.Header.Set("Content-Type", "application/json")
	repRec := httptest.NewRecorder()
	r.ServeHTTP(repRec, repReq)
	if repRec.Code != http.StatusAccepted {
		t.Fatalf("expected 202 client-error, got %d: %s", repRec.Code, repRec.Body.String())
	}

	ownerToken, _ := util.GenerateAccessToken("11111111-1111-1111-1111-111111111111", "owner", "owner@keluarga.id")
	diagReq := httptest.NewRequest(http.MethodGet, "/api/v1/telemetry/diagnostics", nil)
	diagReq.Header.Set("Authorization", "Bearer "+ownerToken)
	diagRec := httptest.NewRecorder()
	r.ServeHTTP(diagRec, diagReq)
	if diagRec.Code != http.StatusOK {
		t.Fatalf("expected 200 diagnostics, got %d: %s", diagRec.Code, diagRec.Body.String())
	}

	var payload struct {
		Data struct {
			RecentErrorsCount int                `json:"recent_errors_count"`
			RecentErrors      []ClientErrorEvent `json:"recent_errors"`
		} `json:"data"`
	}
	_ = json.Unmarshal(diagRec.Body.Bytes(), &payload)
	if payload.Data.RecentErrorsCount != 1 || len(payload.Data.RecentErrors) != 1 {
		t.Fatalf("expected 1 telemetry event, got %+v", payload.Data)
	}
}
