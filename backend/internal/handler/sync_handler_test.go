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

func setupSyncTestRouter(store *MemorySyncStore) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	v1 := r.Group("/api/v1")
	h := NewSyncHandler(store)
	h.RegisterRoutes(v1)
	return r
}

func TestE2EESyncHandlerPushPullAndConflict(t *testing.T) {
	store := NewMemorySyncStore()
	ownerID := "11111111-1111-1111-1111-111111111111"
	spouseID := "22222222-2222-2222-2222-222222222222"
	store.LinkSpouse(spouseID, ownerID)

	ownerToken, err := util.GenerateAccessToken(ownerID, "owner", "owner@test.id")
	if err != nil {
		t.Fatalf("failed to generate owner token: %v", err)
	}
	spouseToken, err := util.GenerateAccessToken(spouseID, "spouse_viewer", "spouse@test.id")
	if err != nil {
		t.Fatalf("failed to generate spouse token: %v", err)
	}

	r := setupSyncTestRouter(store)

	// 1. Owner pushes initial E2EE envelope (base_revision = 0 -> revision 1)
	pushBody, _ := json.Marshal(UpsertSyncEnvelopeRequest{
		BaseRevision:  0,
		CiphertextB64: "cipher-v1",
		IVB64:         "iv-12bytes-v1",
		SaltB64:       "salt-16bytes-v1",
		KDFIterations: 100000,
		DeviceID:      "pixel-owner",
	})
	req1 := httptest.NewRequest(http.MethodPut, "/api/v1/sync/envelope", bytes.NewReader(pushBody))
	req1.Header.Set("Authorization", "Bearer "+ownerToken)
	req1.Header.Set("Content-Type", "application/json")
	w1 := httptest.NewRecorder()
	r.ServeHTTP(w1, req1)
	if w1.Code != http.StatusOK {
		t.Fatalf("expected 200 on initial push, got %d: %s", w1.Code, w1.Body.String())
	}

	// 2. Spouse pulls the shared household E2EE envelope
	reqGet := httptest.NewRequest(http.MethodGet, "/api/v1/sync/envelope", nil)
	reqGet.Header.Set("Authorization", "Bearer "+spouseToken)
	wGet := httptest.NewRecorder()
	r.ServeHTTP(wGet, reqGet)
	if wGet.Code != http.StatusOK {
		t.Fatalf("expected 200 on spouse pull, got %d", wGet.Code)
	}
	var getRes struct {
		Data SyncEnvelope `json:"data"`
	}
	if err := json.Unmarshal(wGet.Body.Bytes(), &getRes); err != nil {
		t.Fatalf("failed to decode pull response: %v", err)
	}
	if getRes.Data.Revision != 1 || getRes.Data.CiphertextB64 != "cipher-v1" {
		t.Fatalf("unexpected envelope pulled by spouse: %+v", getRes.Data)
	}

	// 3. Stale push with base_revision = 0 must return 409 SYNC_CONFLICT with current envelope
	staleBody, _ := json.Marshal(UpsertSyncEnvelopeRequest{
		BaseRevision:  0,
		CiphertextB64: "stale-overwrite",
		IVB64:         "iv-stale",
		SaltB64:       "salt-stale",
		DeviceID:      "pixel-spouse",
	})
	reqConflict := httptest.NewRequest(http.MethodPut, "/api/v1/sync/envelope", bytes.NewReader(staleBody))
	reqConflict.Header.Set("Authorization", "Bearer "+spouseToken)
	reqConflict.Header.Set("Content-Type", "application/json")
	wConflict := httptest.NewRecorder()
	r.ServeHTTP(wConflict, reqConflict)
	if wConflict.Code != http.StatusConflict {
		t.Fatalf("expected 409 Conflict on stale base_revision, got %d", wConflict.Code)
	}

	// 4. Merged push with base_revision = 1 succeeds cleanly -> revision 2
	mergedBody, _ := json.Marshal(UpsertSyncEnvelopeRequest{
		BaseRevision:  1,
		CiphertextB64: "cipher-v2-merged",
		IVB64:         "iv-v2",
		SaltB64:       "salt-v2",
		DeviceID:      "pixel-spouse",
	})
	reqOk2 := httptest.NewRequest(http.MethodPut, "/api/v1/sync/envelope", bytes.NewReader(mergedBody))
	reqOk2.Header.Set("Authorization", "Bearer "+spouseToken)
	reqOk2.Header.Set("Content-Type", "application/json")
	wOk2 := httptest.NewRecorder()
	r.ServeHTTP(wOk2, reqOk2)
	if wOk2.Code != http.StatusOK {
		t.Fatalf("expected 200 on merged push, got %d: %s", wOk2.Code, wOk2.Body.String())
	}
	var push2Res struct {
		Data SyncEnvelope `json:"data"`
	}
	_ = json.Unmarshal(wOk2.Body.Bytes(), &push2Res)
	if push2Res.Data.Revision != 2 || push2Res.Data.CiphertextB64 != "cipher-v2-merged" {
		t.Fatalf("expected revision 2 merged ciphertext, got %+v", push2Res.Data)
	}

	// 5. spouse_co_owner can also pull shared household E2EE envelope
	coOwnerID := "33333333-3333-3333-3333-333333333333"
	store.LinkSpouse(coOwnerID, ownerID)
	coOwnerToken, err := util.GenerateAccessToken(coOwnerID, "spouse_co_owner", "copilot@test.id")
	if err != nil {
		t.Fatalf("failed to generate co-owner token: %v", err)
	}
	reqCoGet := httptest.NewRequest(http.MethodGet, "/api/v1/sync/envelope", nil)
	reqCoGet.Header.Set("Authorization", "Bearer "+coOwnerToken)
	wCoGet := httptest.NewRecorder()
	r.ServeHTTP(wCoGet, reqCoGet)
	if wCoGet.Code != http.StatusOK {
		t.Fatalf("expected 200 on spouse_co_owner E2EE pull, got %d", wCoGet.Code)
	}
}
