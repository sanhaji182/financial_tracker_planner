package handler

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/model"
	"github.com/user/financial-os/internal/util"
)

type fakeTelegramBot struct {
	audioBytes []byte
	filePath   string
	replies    []string
}

func (f *fakeTelegramBot) SendMessage(_, _, _ string) error { return nil }
func (f *fakeTelegramBot) SendReplyToChat(_, text string) error {
	f.replies = append(f.replies, text)
	return nil
}
func (f *fakeTelegramBot) DownloadFile(_ string) ([]byte, string, error) {
	return f.audioBytes, f.filePath, nil
}

type fakeVoiceAIService struct {
	transcript string
}

func (f *fakeVoiceAIService) GetSettings(_ context.Context, _ string) (*dto.AISettingsResponse, error) {
	return &dto.AISettingsResponse{}, nil
}
func (f *fakeVoiceAIService) UpdateSettings(_ context.Context, _ string, _ *dto.UpdateAISettingsRequest) error {
	return nil
}
func (f *fakeVoiceAIService) GetSettingsRaw(_ context.Context, _ string) (*model.AISettings, error) {
	return &model.AISettings{AIProvider: "local"}, nil
}
func (f *fakeVoiceAIService) GetAPIKey(_ context.Context, _ string) (string, error) { return "", nil }
func (f *fakeVoiceAIService) CallWorkerAI(_ context.Context, _ string, _ string, _ interface{}, _ interface{}) error {
	return nil
}
func (f *fakeVoiceAIService) StreamWorkerAI(_ context.Context, _ string, _ string, _ interface{}, _ http.ResponseWriter) error {
	return nil
}
func (f *fakeVoiceAIService) TranscribeVoiceWorker(_ context.Context, _ string, _ []byte, _, _, _ string) (*dto.VoiceTranscribeResponse, error) {
	return &dto.VoiceTranscribeResponse{
		Transcript:   f.transcript,
		Provider:     "openai",
		ParsedAmount: 100000,
	}, nil
}
func (f *fakeVoiceAIService) DetectAnomalies(_ context.Context, _ string) (*dto.AnomalyCheckResponse, error) {
	return &dto.AnomalyCheckResponse{}, nil
}

func signEmailWebhookRequest(secret string, ts int64, body []byte) (string, string) {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(strconv.FormatInt(ts, 10)))
	_, _ = mac.Write([]byte("."))
	_, _ = mac.Write(body)
	return "sha256=" + hex.EncodeToString(mac.Sum(nil)), strconv.FormatInt(ts, 10)
}

func TestChannelInboundHandlerFailClosedWhenSecretsUnset(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Setenv("TELEGRAM_WEBHOOK_SECRET", "")
	t.Setenv("EMAIL_WEBHOOK_SECRET", "")

	store := NewMemoryChannelStore()
	r := gin.New()
	v1 := r.Group("/api/v1")
	h := NewChannelInboundHandler(store, nil, &fakeTelegramBot{}, nil, nil)
	h.RegisterRoutes(v1)

	tgReq := httptest.NewRequest(http.MethodPost, "/api/v1/webhooks/telegram", bytes.NewBufferString(`{"update_id":1}`))
	tgReq.Header.Set("Content-Type", "application/json")
	tgRec := httptest.NewRecorder()
	r.ServeHTTP(tgRec, tgReq)
	if tgRec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 fail-closed when TELEGRAM_WEBHOOK_SECRET unset, got %d: %s", tgRec.Code, tgRec.Body.String())
	}

	emReq := httptest.NewRequest(http.MethodPost, "/api/v1/webhooks/email/anytoken", bytes.NewBufferString(`{"subject":"test"}`))
	emReq.Header.Set("Content-Type", "application/json")
	emRec := httptest.NewRecorder()
	r.ServeHTTP(emRec, emReq)
	if emRec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 fail-closed when EMAIL_WEBHOOK_SECRET unset, got %d: %s", emRec.Code, emRec.Body.String())
	}
}

func TestChannelInboundHandlerTelegramAndEmail(t *testing.T) {
	gin.SetMode(gin.TestMode)
	const tgSecret = "tg-webhook-secret-test-999"
	const emailSecret = "email-webhook-secret-test-999"

	store := NewMemoryChannelStore()
	ownerID := "11111111-1111-1111-1111-111111111111"
	ownerToken, _ := util.GenerateAccessToken(ownerID, "owner", "owner@keluarga.id")

	type recordedTx struct {
		Amount float64
		Type   string
		Desc   string
		Source string
	}
	var recorded []recordedTx
	txCreator := func(_ context.Context, _ string, amount float64, txType, description, _, _, source string) (string, error) {
		recorded = append(recorded, recordedTx{Amount: amount, Type: txType, Desc: description, Source: source})
		return "tx-inbound-01", nil
	}

	fakeTg := &fakeTelegramBot{
		audioBytes: []byte("ogg-voice-note-bytes"),
		filePath:   "voice/file_99.ogg",
	}
	fakeAI := &fakeVoiceAIService{
		transcript: "Beli bensin Pertamax 100rb BCA",
	}

	r := gin.New()
	v1 := r.Group("/api/v1")
	checkInCalled := false
	h := NewChannelInboundHandler(store, nil, fakeTg, txCreator, nil).
		WithAIService(fakeAI).
		WithWebhookSecrets(tgSecret, emailSecret).
		WithLegacyCheckIn(func(_ context.Context, gotOwnerID string) (string, error) {
			if gotOwnerID == ownerID {
				checkInCalled = true
			}
			return "02 Des 2026 09:00 WIB", nil
		}).
		WithReceiptOCR(func(_ context.Context, imageBytes []byte, _ string) (string, float64, string, error) {
			if len(imageBytes) == 0 {
				return "", 0, "", nil
			}
			return "Alfamart Kemang", 68500, "2026-11-23", nil
		})
	h.RegisterRoutes(v1)

	// 1. Check status creates inbound email address automatically
	statusReq := httptest.NewRequest(http.MethodGet, "/api/v1/channels", nil)
	statusReq.Header.Set("Authorization", "Bearer "+ownerToken)
	statusRec := httptest.NewRecorder()
	r.ServeHTTP(statusRec, statusReq)
	if statusRec.Code != http.StatusOK {
		t.Fatalf("expected 200 GET /channels, got %d: %s", statusRec.Code, statusRec.Body.String())
	}
	var statusPayload struct {
		Data struct {
			InboundEmailToken string `json:"inbound_email_token"`
		} `json:"data"`
	}
	_ = json.Unmarshal(statusRec.Body.Bytes(), &statusPayload)
	if statusPayload.Data.InboundEmailToken == "" {
		t.Fatalf("expected non-empty inbound_email_token")
	}

	// 2. Generate Telegram link code
	codeReq := httptest.NewRequest(http.MethodPost, "/api/v1/channels/telegram/link-code", nil)
	codeReq.Header.Set("Authorization", "Bearer "+ownerToken)
	codeRec := httptest.NewRecorder()
	r.ServeHTTP(codeRec, codeReq)
	if codeRec.Code != http.StatusOK {
		t.Fatalf("expected 200 link-code, got %d", codeRec.Code)
	}
	var codePayload struct {
		Data struct {
			Code string `json:"code"`
		} `json:"data"`
	}
	_ = json.Unmarshal(codeRec.Body.Bytes(), &codePayload)

	// 3a. Telegram webhook MUST reject missing or invalid header even if secret appears in URL path
	pairBody, _ := json.Marshal(map[string]interface{}{
		"update_id": 1001,
		"message": map[string]interface{}{
			"chat": map[string]interface{}{"id": 987654321},
			"text": "/link " + codePayload.Data.Code,
		},
	})
	noHeaderReq := httptest.NewRequest(http.MethodPost, "/api/v1/webhooks/telegram/"+tgSecret, bytes.NewReader(pairBody))
	noHeaderReq.Header.Set("Content-Type", "application/json")
	noHeaderRec := httptest.NewRecorder()
	r.ServeHTTP(noHeaderRec, noHeaderReq)
	if noHeaderRec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 when X-Telegram-Bot-Api-Secret-Token missing, got %d: %s", noHeaderRec.Code, noHeaderRec.Body.String())
	}

	wrongHeaderReq := httptest.NewRequest(http.MethodPost, "/api/v1/webhooks/telegram", bytes.NewReader(pairBody))
	wrongHeaderReq.Header.Set("Content-Type", "application/json")
	wrongHeaderReq.Header.Set("X-Telegram-Bot-Api-Secret-Token", "wrong-secret")
	wrongHeaderRec := httptest.NewRecorder()
	r.ServeHTTP(wrongHeaderRec, wrongHeaderReq)
	if wrongHeaderRec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 when X-Telegram-Bot-Api-Secret-Token wrong, got %d", wrongHeaderRec.Code)
	}

	// 3b. Pair via Telegram webhook with valid X-Telegram-Bot-Api-Secret-Token header
	pairReq := httptest.NewRequest(http.MethodPost, "/api/v1/webhooks/telegram", bytes.NewReader(pairBody))
	pairReq.Header.Set("Content-Type", "application/json")
	pairReq.Header.Set("X-Telegram-Bot-Api-Secret-Token", tgSecret)
	pairRec := httptest.NewRecorder()
	r.ServeHTTP(pairRec, pairReq)
	if pairRec.Code != http.StatusOK {
		t.Fatalf("expected 200 webhook /link, got %d: %s", pairRec.Code, pairRec.Body.String())
	}

	// 4. Send Telegram text command -> creates transaction
	msgBody, _ := json.Marshal(map[string]interface{}{
		"update_id": 1002,
		"message": map[string]interface{}{
			"chat": map[string]interface{}{"id": 987654321},
			"text": "Kopi Kenangan 32rb pakai GoPay",
		},
	})
	msgReq := httptest.NewRequest(http.MethodPost, "/api/v1/webhooks/telegram", bytes.NewReader(msgBody))
	msgReq.Header.Set("Content-Type", "application/json")
	msgReq.Header.Set("X-Telegram-Bot-Api-Secret-Token", tgSecret)
	msgRec := httptest.NewRecorder()
	r.ServeHTTP(msgRec, msgReq)
	if msgRec.Code != http.StatusOK {
		t.Fatalf("expected 200 telegram tx webhook, got %d", msgRec.Code)
	}
	if len(recorded) != 1 || recorded[0].Amount != 32000 || recorded[0].Type != "expense" {
		t.Fatalf("expected 32000 expense from Telegram, got %+v", recorded)
	}

	// 5. Email webhook inbound security + valid HMAC flow
	emailBody, _ := json.Marshal(map[string]string{
		"subject":   "Notifikasi QRIS BCA",
		"sender":    "alerts@bca.co.id",
		"body_text": "Pembayaran QRIS Indomaret Rp 45.000 berhasil via BCA",
	})
	emailURL := "/api/v1/webhooks/email/" + statusPayload.Data.InboundEmailToken

	// 5a. Missing signature -> 401
	unauthEmailReq := httptest.NewRequest(http.MethodPost, emailURL, bytes.NewReader(emailBody))
	unauthEmailReq.Header.Set("Content-Type", "application/json")
	unauthEmailRec := httptest.NewRecorder()
	r.ServeHTTP(unauthEmailRec, unauthEmailReq)
	if unauthEmailRec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 on unsigned email webhook, got %d: %s", unauthEmailRec.Code, unauthEmailRec.Body.String())
	}

	// 5b. Bad signature -> 401
	badSig, freshTS := signEmailWebhookRequest("wrong-email-secret", time.Now().Unix(), emailBody)
	badSigReq := httptest.NewRequest(http.MethodPost, emailURL, bytes.NewReader(emailBody))
	badSigReq.Header.Set("Content-Type", "application/json")
	badSigReq.Header.Set("X-Email-Webhook-Signature", badSig)
	badSigReq.Header.Set("X-Email-Webhook-Timestamp", freshTS)
	badSigRec := httptest.NewRecorder()
	r.ServeHTTP(badSigRec, badSigReq)
	if badSigRec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 on invalid HMAC email webhook, got %d", badSigRec.Code)
	}

	// 5c. Expired timestamp (> 5 minutes) -> 401
	staleSig, staleTS := signEmailWebhookRequest(emailSecret, time.Now().Add(-10*time.Minute).Unix(), emailBody)
	staleReq := httptest.NewRequest(http.MethodPost, emailURL, bytes.NewReader(emailBody))
	staleReq.Header.Set("Content-Type", "application/json")
	staleReq.Header.Set("X-Email-Webhook-Signature", staleSig)
	staleReq.Header.Set("X-Email-Webhook-Timestamp", staleTS)
	staleRec := httptest.NewRecorder()
	r.ServeHTTP(staleRec, staleReq)
	if staleRec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 on expired timestamp email webhook, got %d", staleRec.Code)
	}

	// 5d. Valid HMAC + fresh timestamp -> 200
	validSig, validTS := signEmailWebhookRequest(emailSecret, time.Now().Unix(), emailBody)
	emailReq := httptest.NewRequest(http.MethodPost, emailURL, bytes.NewReader(emailBody))
	emailReq.Header.Set("Content-Type", "application/json")
	emailReq.Header.Set("X-Email-Webhook-Signature", validSig)
	emailReq.Header.Set("X-Email-Webhook-Timestamp", validTS)
	emailRec := httptest.NewRecorder()
	r.ServeHTTP(emailRec, emailReq)
	if emailRec.Code != http.StatusOK {
		t.Fatalf("expected 200 email webhook, got %d: %s", emailRec.Code, emailRec.Body.String())
	}
	if len(recorded) != 2 || recorded[1].Amount != 45000 || recorded[1].Source != "pdf_parse" {
		t.Fatalf("expected second recorded tx 45000 pdf_parse from email, got %+v", recorded)
	}

	// 6. Send Telegram voice note -> transcribes & creates 100000 expense
	voiceBody, _ := json.Marshal(map[string]interface{}{
		"update_id": 1003,
		"message": map[string]interface{}{
			"chat": map[string]interface{}{"id": 987654321},
			"voice": map[string]interface{}{
				"file_id":   "AwACAgIAAxkBAAIB",
				"mime_type": "audio/ogg",
			},
		},
	})
	voiceReq := httptest.NewRequest(http.MethodPost, "/api/v1/webhooks/telegram", bytes.NewReader(voiceBody))
	voiceReq.Header.Set("Content-Type", "application/json")
	voiceReq.Header.Set("X-Telegram-Bot-Api-Secret-Token", tgSecret)
	voiceRec := httptest.NewRecorder()
	r.ServeHTTP(voiceRec, voiceReq)
	if voiceRec.Code != http.StatusOK {
		t.Fatalf("expected 200 telegram voice webhook, got %d: %s", voiceRec.Code, voiceRec.Body.String())
	}
	if len(recorded) != 3 || recorded[2].Amount != 100000 || !strings.Contains(strings.ToLower(recorded[2].Desc), "pertamax") {
		t.Fatalf("expected third recorded tx 100000 Pertamax from voice note, got %+v", recorded)
	}
	lastReply := fakeTg.replies[len(fakeTg.replies)-1]
	if !strings.Contains(lastReply, "Transkrip") {
		t.Fatalf("expected transcript echo in Telegram reply, got %q", lastReply)
	}

	// 7. Send Telegram photo receipt -> OCR creates expense transaction
	photoBody, _ := json.Marshal(map[string]interface{}{
		"update_id": 1004,
		"message": map[string]interface{}{
			"chat": map[string]interface{}{"id": 987654321},
			"photo": []map[string]string{
				{"file_id": "AgAC-small"},
				{"file_id": "AgAC-large"},
			},
		},
	})
	photoReq := httptest.NewRequest(http.MethodPost, "/api/v1/webhooks/telegram", bytes.NewReader(photoBody))
	photoReq.Header.Set("Content-Type", "application/json")
	photoReq.Header.Set("X-Telegram-Bot-Api-Secret-Token", tgSecret)
	photoRec := httptest.NewRecorder()
	r.ServeHTTP(photoRec, photoReq)
	if photoRec.Code != http.StatusOK {
		t.Fatalf("expected 200 telegram photo webhook, got %d: %s", photoRec.Code, photoRec.Body.String())
	}
	if len(recorded) != 4 || recorded[3].Amount != 68500 || recorded[3].Source != "ocr" || recorded[3].Desc != "Alfamart Kemang" {
		t.Fatalf("expected fourth recorded tx 68500 ocr Alfamart Kemang from photo, got %+v", recorded)
	}
	photoReply := fakeTg.replies[len(fakeTg.replies)-1]
	if !strings.Contains(photoReply, "Struk terbaca otomatis!") {
		t.Fatalf("expected photo OCR reply, got %q", photoReply)
	}

	// 8. Send `/checkin` Telegram command -> invokes legacy check-in reset
	ciBody, _ := json.Marshal(map[string]interface{}{
		"update_id": 1005,
		"message": map[string]interface{}{
			"chat": map[string]interface{}{"id": 987654321},
			"text": "/checkin",
		},
	})
	ciReq := httptest.NewRequest(http.MethodPost, "/api/v1/webhooks/telegram", bytes.NewReader(ciBody))
	ciReq.Header.Set("Content-Type", "application/json")
	ciReq.Header.Set("X-Telegram-Bot-Api-Secret-Token", tgSecret)
	ciRec := httptest.NewRecorder()
	r.ServeHTTP(ciRec, ciReq)
	if ciRec.Code != http.StatusOK || !checkInCalled {
		t.Fatalf("expected /checkin telegram webhook to trigger callback, code=%d called=%v", ciRec.Code, checkInCalled)
	}
	ciReply := fakeTg.replies[len(fakeTg.replies)-1]
	if !strings.Contains(ciReply, "Check-In Darurat Berhasil!") {
		t.Fatalf("expected check-in confirmation reply, got %q", ciReply)
	}
}
