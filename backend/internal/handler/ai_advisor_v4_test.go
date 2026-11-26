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
	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/model"
	"github.com/user/financial-os/internal/service"
)

type spyV4AIService struct {
	capturedPayloads []map[string]interface{}
}

func (s *spyV4AIService) GetSettings(_ context.Context, _ string) (*dto.AISettingsResponse, error) {
	return &dto.AISettingsResponse{AdvisorEnabled: true, AIEnabled: true, AIProvider: "local"}, nil
}
func (s *spyV4AIService) UpdateSettings(_ context.Context, _ string, _ *dto.UpdateAISettingsRequest) error {
	return nil
}
func (s *spyV4AIService) GetSettingsRaw(_ context.Context, _ string) (*model.AISettings, error) {
	return &model.AISettings{AIProvider: "local", AdvisorEnabled: true, AIEnabled: true}, nil
}
func (s *spyV4AIService) GetAPIKey(_ context.Context, _ string) (string, error) { return "", nil }
func (s *spyV4AIService) CallWorkerAI(_ context.Context, _ string, _ string, payload interface{}, result interface{}) error {
	b, _ := json.Marshal(payload)
	var m map[string]interface{}
	_ = json.Unmarshal(b, &m)
	s.capturedPayloads = append(s.capturedPayloads, m)

	if out, ok := result.(*dto.AIChatResponse); ok {
		*out = dto.AIChatResponse{
			Response:         "Siap, preferensi & ringkasan V4 berhasil dianalisis.",
			Reason:           "v4-test-stub",
			SuggestedReplies: []string{"Cek kuota jajan harian bulan ini"},
		}
	}
	return nil
}
func (s *spyV4AIService) StreamWorkerAI(_ context.Context, _ string, _ string, _ interface{}, _ http.ResponseWriter) error {
	return nil
}
func (s *spyV4AIService) TranscribeVoiceWorker(_ context.Context, _ string, _ []byte, _, _, _ string) (*dto.VoiceTranscribeResponse, error) {
	return &dto.VoiceTranscribeResponse{}, nil
}
func (s *spyV4AIService) DetectAnomalies(_ context.Context, _ string) (*dto.AnomalyCheckResponse, error) {
	return &dto.AnomalyCheckResponse{}, nil
}

type stubV4DashboardService struct {
	resp *dto.DashboardResponse
}

func (s *stubV4DashboardService) GetDashboardData(_ context.Context, _ string) (*dto.DashboardResponse, error) {
	return s.resp, nil
}
func (s *stubV4DashboardService) InvalidateCache(_ context.Context, _ string) error { return nil }

type stubV4EFService struct {
	resp *dto.EFSummaryResponse
}

func (s *stubV4EFService) GetEFSummary(_ context.Context, _ string) (*dto.EFSummaryResponse, error) {
	return s.resp, nil
}
func (s *stubV4EFService) UpdateEFConfig(_ context.Context, _ string, _ *dto.UpdateEFConfigRequest) error {
	return nil
}

type stubV4BudgetService struct {
	summary *dto.BudgetSummaryResponse
}

func (s *stubV4BudgetService) SetBudget(_ context.Context, _ string, _ *dto.BudgetRequest) (*dto.BudgetDto, error) {
	return nil, nil
}
func (s *stubV4BudgetService) UpdateBudget(_ context.Context, _ string, _ string, _ *dto.UpdateBudgetRequest) (*dto.BudgetDto, error) {
	return nil, nil
}
func (s *stubV4BudgetService) DeleteBudget(_ context.Context, _ string, _ string) error { return nil }
func (s *stubV4BudgetService) GetBudgets(_ context.Context, _ string, _ string) ([]dto.BudgetDto, error) {
	return nil, nil
}
func (s *stubV4BudgetService) GetBudgetSummary(_ context.Context, _ string, _ string) (*dto.BudgetSummaryResponse, error) {
	return s.summary, nil
}
func (s *stubV4BudgetService) CopyFromPreviousMonth(_ context.Context, _ string, _ string, _ string) error {
	return nil
}

type spyV4EmailService struct {
	configured bool
	sent       []service.EmailMessage
}

func (s *spyV4EmailService) IsConfigured() bool    { return s.configured }
func (s *spyV4EmailService) ProviderName() string  { return "smtp" }
func (s *spyV4EmailService) SendEmail(_ context.Context, msg service.EmailMessage) error {
	s.sent = append(s.sent, msg)
	return nil
}

type spyV4TelegramService struct {
	alerts  []string
	replies []string
}

func (s *spyV4TelegramService) SendMessage(title, message, _ string) error {
	s.alerts = append(s.alerts, title+": "+message)
	return nil
}
func (s *spyV4TelegramService) SendReplyToChat(chatID, text string) error {
	s.replies = append(s.replies, chatID+"|"+text)
	return nil
}
func (s *spyV4TelegramService) DownloadFile(_ string) ([]byte, string, error) {
	return nil, "", nil
}

func buildV4TestRouter(h *AISettingsHandler, userID, role string) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", userID)
		c.Set("role", role)
		c.Next()
	})
	api := r.Group("/api/v1")
	h.RegisterRoutes(api)
	return r
}

func TestAIAdvisorV4ChatHistoryAndMemorySync(t *testing.T) {
	spyAI := &spyV4AIService{}
	store := NewMemoryAIAdvisorStateStore()
	h := NewAISettingsHandler(
		spyAI,
		&stubV4DashboardService{resp: &dto.DashboardResponse{
			CashAvailable:    dto.MoneyValue{Value: 8_000_000},
			SafeToSpend:      dto.MoneyValue{Value: 5_000_000},
			ForecastEndMonth: dto.MoneyValue{Value: 3_000_000},
			HealthScore:      dto.HealthScoreDto{Score: 84},
		}},
		&stubV4EFService{resp: &dto.EFSummaryResponse{CoverageMonths: 4, TargetAmount: dto.MoneyValue{Value: 20_000_000}}},
		&stubV4BudgetService{summary: &dto.BudgetSummaryResponse{TotalBudget: dto.MoneyValue{Value: 5_000_000}}},
		nil,
	).WithCatalogServices(&stubHouseholdAccountService{}, &stubHouseholdCategoryService{}).
		WithStateAndNotifyServices(store, nil, nil)

	// Test routes without AuthMiddleware blocking unit test context
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", "owner-v4")
		c.Set("role", "owner")
		c.Next()
	})
	r.GET("/ai/history", h.GetChatHistory)
	r.DELETE("/ai/history", h.ClearChatHistory)
	r.GET("/ai/memory", h.GetAdvisorMemory)
	r.PUT("/ai/memory", h.UpdateAdvisorMemory)
	r.DELETE("/ai/memory", h.ClearAdvisorMemory)
	r.POST("/ai/chat", h.Chat)
	r.GET("/ai/briefing", h.GetDailyBriefing)

	// 1. Save learned memory across devices
	memBody := `{"learned_rules":[{"keyword":"kopi","category_name":"Makanan & Minuman","account_name":"BCA Utama","type":"expense"}],"custom_notes":["Gaji tgl 25"],"preferred_payment_account":"BCA Utama"}`
	req := httptest.NewRequest(http.MethodPut, "/ai/memory", strings.NewReader(memBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 on PUT /ai/memory, got %d: %s", w.Code, w.Body.String())
	}

	// 2. Chat with explicit "ingat ..." instruction -> auto-hydrates preferences & captures note
	chatBody, _ := json.Marshal(dto.AIChatRequest{Message: "ingat bayar internet tiap tanggal 10"})
	req2 := httptest.NewRequest(http.MethodPost, "/ai/chat", bytes.NewReader(chatBody))
	req2.Header.Set("Content-Type", "application/json")
	w2 := httptest.NewRecorder()
	r.ServeHTTP(w2, req2)
	if w2.Code != http.StatusOK {
		t.Fatalf("expected 200 on POST /ai/chat, got %d: %s", w2.Code, w2.Body.String())
	}

	// Verify GET /ai/history persisted both user & assistant messages and memory captured explicit note
	wHist := httptest.NewRecorder()
	r.ServeHTTP(wHist, httptest.NewRequest(http.MethodGet, "/ai/history", nil))
	if wHist.Code != http.StatusOK {
		t.Fatalf("expected 200 on GET /ai/history, got %d", wHist.Code)
	}
	var histWrap struct {
		Data dto.AIChatHistoryResponse `json:"data"`
	}
	if err := json.Unmarshal(wHist.Body.Bytes(), &histWrap); err != nil {
		t.Fatalf("failed decoding /ai/history response: %v", err)
	}
	if len(histWrap.Data.Messages) != 2 {
		t.Fatalf("expected 2 persisted chat messages, got %d", len(histWrap.Data.Messages))
	}
	if len(histWrap.Data.Memory.CustomNotes) < 2 {
		t.Fatalf("expected explicit note captured alongside synced note, got %+v", histWrap.Data.Memory.CustomNotes)
	}

	// 3. Second chat turn with empty client history -> server auto-hydrates prior 2 turns into worker payload
	chatBody2, _ := json.Marshal(dto.AIChatRequest{Message: "lanjutkan cek budget"})
	req3 := httptest.NewRequest(http.MethodPost, "/ai/chat", bytes.NewReader(chatBody2))
	req3.Header.Set("Content-Type", "application/json")
	w3 := httptest.NewRecorder()
	r.ServeHTTP(w3, req3)
	if w3.Code != http.StatusOK {
		t.Fatalf("expected 200 on 2nd chat, got %d", w3.Code)
	}
	if len(spyAI.capturedPayloads) != 2 {
		t.Fatalf("expected 2 worker payloads, got %d", len(spyAI.capturedPayloads))
	}
	rawHist, _ := spyAI.capturedPayloads[1]["history"].([]interface{})
	if len(rawHist) != 2 {
		t.Fatalf("expected 2 server-hydrated history turns in worker payload, got %d", len(rawHist))
	}

	// 4. DELETE /ai/history and /ai/memory clear state cleanly
	wDel := httptest.NewRecorder()
	r.ServeHTTP(wDel, httptest.NewRequest(http.MethodDelete, "/ai/history", nil))
	if wDel.Code != http.StatusOK {
		t.Fatalf("expected 200 on DELETE /ai/history, got %d", wDel.Code)
	}
	wHistAfter := httptest.NewRecorder()
	r.ServeHTTP(wHistAfter, httptest.NewRequest(http.MethodGet, "/ai/history", nil))
	_ = json.Unmarshal(wHistAfter.Body.Bytes(), &histWrap)
	if len(histWrap.Data.Messages) != 0 {
		t.Fatalf("expected 0 messages after clear, got %d", len(histWrap.Data.Messages))
	}
}

func TestAIAdvisorV4ProactiveBriefingIdempotencyAndChannels(t *testing.T) {
	store := NewMemoryAIAdvisorStateStore(BriefingRecipient{
		OwnerID:        "owner-v4-brief",
		Email:          "keluarga@example.com",
		Name:           "Budi",
		TelegramChatID: "tg-9988",
	})
	emailSpy := &spyV4EmailService{configured: true}
	tgSpy := &spyV4TelegramService{}

	h := NewAISettingsHandler(
		&spyV4AIService{},
		&stubV4DashboardService{resp: &dto.DashboardResponse{
			CashAvailable:    dto.MoneyValue{Value: 1_000_000},
			SafeToSpend:      dto.MoneyValue{Value: 0},
			ForecastEndMonth: dto.MoneyValue{Value: -500_000},
			DTIRatio:         38.5,
			HealthScore:      dto.HealthScoreDto{Score: 54},
			UpcomingBills: []dto.UpcomingBillDto{
				{ID: "b1", Name: "Listrik PLN", Amount: 1_500_000, DueDate: time.Now().Add(48 * time.Hour), DaysRemaining: 2},
			},
		}},
		&stubV4EFService{resp: &dto.EFSummaryResponse{CoverageMonths: 1.5, TargetAmount: dto.MoneyValue{Value: 25_000_000}}},
		&stubV4BudgetService{summary: &dto.BudgetSummaryResponse{CategoriesOver: 2, TotalSpent: dto.MoneyValue{Value: 5_200_000}}},
		nil,
	).WithStateAndNotifyServices(store, emailSpy, tgSpy)

	if err := h.EvaluateDueDailyBriefings(context.Background()); err != nil {
		t.Fatalf("first EvaluateDueDailyBriefings failed: %v", err)
	}
	// Second run on the same UTC date must be idempotent (no duplicate alerts, emails, or Telegram spam)
	if err := h.EvaluateDueDailyBriefings(context.Background()); err != nil {
		t.Fatalf("second EvaluateDueDailyBriefings failed: %v", err)
	}

	if len(emailSpy.sent) != 1 || emailSpy.sent[0].To != "keluarga@example.com" {
		t.Fatalf("expected exactly 1 daily briefing email to keluarga@example.com, got %+v", emailSpy.sent)
	}
	if len(tgSpy.replies) != 1 || !strings.HasPrefix(tgSpy.replies[0], "tg-9988|") {
		t.Fatalf("expected exactly 1 Telegram briefing reply to tg-9988, got %+v", tgSpy.replies)
	}
	if store.AlertsCount("owner-v4-brief") != 1 {
		t.Fatalf("expected exactly 1 daily briefing alert in store, got %d", store.AlertsCount("owner-v4-brief"))
	}

	briefing, err := store.GetLatestBriefing(context.Background(), "owner-v4-brief")
	if err != nil || briefing == nil {
		t.Fatalf("expected stored daily briefing, err=%v", err)
	}
	if briefing.Severity != "danger" {
		t.Fatalf("expected danger severity for negative forecast & cash crunch, got %s", briefing.Severity)
	}
	if !briefing.NotifiedEmail || !briefing.NotifiedTelegram {
		t.Fatalf("expected NotifiedEmail and NotifiedTelegram true, got email=%v tg=%v", briefing.NotifiedEmail, briefing.NotifiedTelegram)
	}
}
