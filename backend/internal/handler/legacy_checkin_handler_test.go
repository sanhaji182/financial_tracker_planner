package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/user/financial-os/internal/service"
	"github.com/user/financial-os/internal/util"
)

type spyEmailService struct {
	configured bool
	sent       []service.EmailMessage
}

func (s *spyEmailService) IsConfigured() bool   { return s.configured }
func (s *spyEmailService) ProviderName() string { return "smtp" }
func (s *spyEmailService) SendEmail(_ context.Context, msg service.EmailMessage) error {
	s.sent = append(s.sent, msg)
	return nil
}

type spyLegacyTelegram struct {
	replies []string
	global  []string
}

func (s *spyLegacyTelegram) SendMessage(title, msg, hint string) error {
	s.global = append(s.global, title+": "+msg+" "+hint)
	return nil
}
func (s *spyLegacyTelegram) SendReplyToChat(chatID, text string) error {
	s.replies = append(s.replies, chatID+":"+text)
	return nil
}
func (s *spyLegacyTelegram) DownloadFile(_ string) ([]byte, string, error) { return nil, "", nil }

func TestLegacyCheckInStateMachineAndClaimPortal(t *testing.T) {
	gin.SetMode(gin.TestMode)
	store := NewMemoryLegacyCheckInStore()
	ownerID := "11111111-1111-1111-1111-111111111111"
	store.SeedUser(ownerID, "pemilik@keluarga.id", "Budi Santoso", "777888999")
	store.SeedInventory(ownerID, "BCA Utama: Rp 25.000.000\nAntam 10g: Rp 15.850.000")

	emailSpy := &spyEmailService{configured: true}
	tgSpy := &spyLegacyTelegram{}

	baseTime := time.Date(2026, 11, 1, 9, 0, 0, 0, time.FixedZone("WIB", 7*3600))
	curTime := baseTime

	h := NewLegacyCheckInHandler(store, emailSpy, tgSpy, nil)
	h.nowFn = func() time.Time { return curTime }

	r := gin.New()
	h.RegisterRoutes(r.Group("/api/v1"))

	ownerToken, _ := util.GenerateAccessToken(ownerID, "owner", "pemilik@keluarga.id")

	// 1. Save 1 beneficiary
	benBody, _ := json.Marshal(map[string]interface{}{
		"beneficiaries": []map[string]string{
			{
				"name":             "Siti Aminah",
				"relationship":     "Istri",
				"email":            "istri@keluarga.id",
				"telegram_chat_id": "555666777",
			},
		},
	})
	benReq := httptest.NewRequest(http.MethodPut, "/api/v1/legacy-checkin/beneficiaries", bytes.NewReader(benBody))
	benReq.Header.Set("Authorization", "Bearer "+ownerToken)
	benReq.Header.Set("Content-Type", "application/json")
	benRec := httptest.NewRecorder()
	r.ServeHTTP(benRec, benReq)
	if benRec.Code != http.StatusOK {
		t.Fatalf("expected 200 saving beneficiaries, got %d: %s", benRec.Code, benRec.Body.String())
	}

	// 2. Arm daily check-in (1 day interval, 2 day grace period, reminder 20:00 WIB)
	cfgBody, _ := json.Marshal(map[string]interface{}{
		"enabled":               true,
		"interval_days":         1,
		"grace_period_days":     2,
		"reminder_hour":         20,
		"timezone":              "Asia/Jakarta",
		"delivery_mode":         "e2ee_portal",
		"owner_notify_email":    true,
		"owner_notify_telegram": true,
		"encrypted_package_json": map[string]interface{}{
			"v":              1,
			"ciphertext_b64": "ZW5jcnlwdGVkLXdhc2lhdA==",
			"iv_b64":         "aXYxMjM=",
			"salt_b64":       "c2FsdDEyMw==",
			"kdf_iterations": 100000,
			"updated_at":     baseTime.Format(time.RFC3339),
		},
	})
	cfgReq := httptest.NewRequest(http.MethodPut, "/api/v1/legacy-checkin/config", bytes.NewReader(cfgBody))
	cfgReq.Header.Set("Authorization", "Bearer "+ownerToken)
	cfgReq.Header.Set("Content-Type", "application/json")
	cfgRec := httptest.NewRecorder()
	r.ServeHTTP(cfgRec, cfgReq)
	if cfgRec.Code != http.StatusOK {
		t.Fatalf("expected 200 arming config, got %d: %s", cfgRec.Code, cfgRec.Body.String())
	}

	// 3. Test dry-run alert endpoint sends email & telegram cleanly without triggering
	testReq := httptest.NewRequest(http.MethodPost, "/api/v1/legacy-checkin/test-alert", bytes.NewBufferString(`{}`))
	testReq.Header.Set("Authorization", "Bearer "+ownerToken)
	testRec := httptest.NewRecorder()
	r.ServeHTTP(testRec, testReq)
	if testRec.Code != http.StatusOK || len(emailSpy.sent) != 1 || len(tgSpy.replies) != 1 {
		t.Fatalf("expected test alert to send 1 email & 1 tg reply, code=%d emails=%d tg=%d", testRec.Code, len(emailSpy.sent), len(tgSpy.replies))
	}

	// 4. Advance clock past due date (1 day later, 21:00 WIB) -> moves to grace_period and alerts owner
	curTime = baseTime.Add(25 * time.Hour)
	if err := h.EvaluateDueSchedules(context.Background()); err != nil {
		t.Fatalf("EvaluateDueSchedules(grace) failed: %v", err)
	}
	cfgAfterGrace, _ := store.GetConfig(context.Background(), ownerID)
	if cfgAfterGrace.Status != "grace_period" {
		t.Fatalf("expected grace_period after missing 1-day check-in, got %s", cfgAfterGrace.Status)
	}
	if len(emailSpy.sent) != 2 || emailSpy.sent[1].To != "pemilik@keluarga.id" {
		t.Fatalf("expected grace warning email to owner, got %+v", emailSpy.sent)
	}

	// 5. Owner calls Check-In during grace_period -> cancels grace period & resets timer!
	ciReq := httptest.NewRequest(http.MethodPost, "/api/v1/legacy-checkin/checkin", bytes.NewBufferString(`{}`))
	ciReq.Header.Set("Authorization", "Bearer "+ownerToken)
	ciRec := httptest.NewRecorder()
	r.ServeHTTP(ciRec, ciReq)
	if ciRec.Code != http.StatusOK {
		t.Fatalf("expected 200 manual check-in, got %d: %s", ciRec.Code, ciRec.Body.String())
	}
	cfgAfterCheckin, _ := store.GetConfig(context.Background(), ownerID)
	if cfgAfterCheckin.Status != "active" || cfgAfterCheckin.GraceStartedAt != nil {
		t.Fatalf("expected active status and cleared grace period after check-in, got %+v", cfgAfterCheckin)
	}

	// 6. Test pause mode freezes timer across 10 days
	pauseReq := httptest.NewRequest(http.MethodPost, "/api/v1/legacy-checkin/pause", bytes.NewBufferString(`{"paused":true}`))
	pauseReq.Header.Set("Authorization", "Bearer "+ownerToken)
	pauseReq.Header.Set("Content-Type", "application/json")
	pauseRec := httptest.NewRecorder()
	r.ServeHTTP(pauseRec, pauseReq)
	if pauseRec.Code != http.StatusOK {
		t.Fatalf("expected 200 pause, got %d", pauseRec.Code)
	}
	curTime = curTime.Add(10 * 24 * time.Hour)
	_ = h.EvaluateDueSchedules(context.Background())
	cfgPaused, _ := store.GetConfig(context.Background(), ownerID)
	if cfgPaused.Status != "paused" {
		t.Fatalf("expected paused config to stay frozen, got %s", cfgPaused.Status)
	}

	// Resume cleanly resets timer
	resumeReq := httptest.NewRequest(http.MethodPost, "/api/v1/legacy-checkin/pause", bytes.NewBufferString(`{"paused":false}`))
	resumeReq.Header.Set("Authorization", "Bearer "+ownerToken)
	resumeReq.Header.Set("Content-Type", "application/json")
	resumeRec := httptest.NewRecorder()
	r.ServeHTTP(resumeRec, resumeReq)
	if resumeRec.Code != http.StatusOK {
		t.Fatalf("expected 200 resume, got %d", resumeRec.Code)
	}

	// 7. Advance 1 day + 1 hour (grace starts), then 2 more days -> trigger release & send claim email!
	curTime = curTime.Add(25 * time.Hour)
	_ = h.EvaluateDueSchedules(context.Background())
	curTime = curTime.Add(49 * time.Hour)
	_ = h.EvaluateDueSchedules(context.Background())

	cfgTriggered, _ := store.GetConfig(context.Background(), ownerID)
	if cfgTriggered.Status != "triggered" {
		t.Fatalf("expected triggered status after grace elapsed, got %s", cfgTriggered.Status)
	}

	lastEmail := emailSpy.sent[len(emailSpy.sent)-1]
	if lastEmail.To != "istri@keluarga.id" || !strings.Contains(lastEmail.TextBody, "/legacy-claim/") {
		t.Fatalf("expected beneficiary claim email with /legacy-claim/ link, got %+v", lastEmail)
	}

	// Extract token from email body and verify ClaimLegacyPackage returns encrypted package!
	idx := strings.Index(lastEmail.TextBody, "/legacy-claim/")
	rest := lastEmail.TextBody[idx+len("/legacy-claim/"):]
	rawToken := strings.Fields(rest)[0]

	claimReq := httptest.NewRequest(http.MethodGet, "/api/v1/legacy-claim/"+rawToken, nil)
	claimRec := httptest.NewRecorder()
	r.ServeHTTP(claimRec, claimReq)
	if claimRec.Code != http.StatusOK {
		t.Fatalf("expected 200 public legacy claim, got %d: %s", claimRec.Code, claimRec.Body.String())
	}
	var claimResp struct {
		Data struct {
			OwnerName        string `json:"owner_name"`
			BeneficiaryName  string `json:"beneficiary_name"`
			EncryptedPackage struct {
				CiphertextB64 string `json:"ciphertext_b64"`
			} `json:"encrypted_package_json"`
		} `json:"data"`
	}
	_ = json.Unmarshal(claimRec.Body.Bytes(), &claimResp)
	if claimResp.Data.OwnerName != "Budi Santoso" || claimResp.Data.EncryptedPackage.CiphertextB64 != "ZW5jcnlwdGVkLXdhc2lhdA==" {
		t.Fatalf("unexpected claim payload: %+v", claimResp.Data)
	}
}
