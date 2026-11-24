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
	"github.com/user/financial-os/internal/model"
	"github.com/user/financial-os/internal/util"
)

type spySpouseAIService struct {
	capturedUserID      string
	capturedContextJSON string
}

func (s *spySpouseAIService) GetSettings(_ context.Context, _ string) (*dto.AISettingsResponse, error) {
	return &dto.AISettingsResponse{}, nil
}
func (s *spySpouseAIService) UpdateSettings(_ context.Context, _ string, _ *dto.UpdateAISettingsRequest) error {
	return nil
}
func (s *spySpouseAIService) GetSettingsRaw(_ context.Context, _ string) (*model.AISettings, error) {
	return &model.AISettings{AIProvider: "local"}, nil
}
func (s *spySpouseAIService) GetAPIKey(_ context.Context, _ string) (string, error) { return "", nil }
func (s *spySpouseAIService) CallWorkerAI(_ context.Context, _ string, _ string, _ interface{}, _ interface{}) error {
	return nil
}
func (s *spySpouseAIService) StreamWorkerAI(_ context.Context, _ string, _ string, _ interface{}, _ http.ResponseWriter) error {
	return nil
}
func (s *spySpouseAIService) TranscribeVoiceWorker(_ context.Context, userID string, _ []byte, _, _, contextJSON string) (*dto.VoiceTranscribeResponse, error) {
	s.capturedUserID = userID
	s.capturedContextJSON = contextJSON
	return &dto.VoiceTranscribeResponse{
		Transcript:   "Kopi 32rb BCA Bersama",
		Provider:     "local",
		ParsedAmount: 32000,
	}, nil
}
func (s *spySpouseAIService) DetectAnomalies(_ context.Context, _ string) (*dto.AnomalyCheckResponse, error) {
	return &dto.AnomalyCheckResponse{}, nil
}

type stubHouseholdAccountService struct {
	accountsByUser map[string][]dto.AccountResponse
}

func (s *stubHouseholdAccountService) CreateAccount(_ context.Context, _ string, _ dto.CreateAccountRequest) (*dto.AccountResponse, error) {
	return nil, nil
}
func (s *stubHouseholdAccountService) GetAccounts(_ context.Context, userID string) ([]dto.AccountResponse, error) {
	return s.accountsByUser[userID], nil
}
func (s *stubHouseholdAccountService) GetAccountByID(_ context.Context, _ string, _ string) (*dto.AccountResponse, error) {
	return nil, nil
}
func (s *stubHouseholdAccountService) UpdateAccount(_ context.Context, _ string, _ string, _ dto.UpdateAccountRequest) (*dto.AccountResponse, error) {
	return nil, nil
}
func (s *stubHouseholdAccountService) DeleteAccount(_ context.Context, _ string, _ string) error {
	return nil
}
func (s *stubHouseholdAccountService) GetAccountSummary(_ context.Context, _ string) (*dto.AccountSummaryResponse, error) {
	return nil, nil
}
func (s *stubHouseholdAccountService) ScanAccountDocument(_ context.Context, _ string, _ string, _ []byte, _ string) (*dto.AccountScanResponse, error) {
	return nil, nil
}

type stubHouseholdCategoryService struct{}

func (s *stubHouseholdCategoryService) CreateCategory(_ context.Context, _ string, _ dto.CreateCategoryRequest) (*dto.CategoryResponse, error) {
	return nil, nil
}
func (s *stubHouseholdCategoryService) GetCategories(_ context.Context, _ string) ([]dto.CategoryResponse, error) {
	return []dto.CategoryResponse{{ID: "cat-makan", Name: "Makan & Minum", Type: "expense"}}, nil
}
func (s *stubHouseholdCategoryService) GetCategoryByID(_ context.Context, _ string, _ string) (*dto.CategoryResponse, error) {
	return nil, nil
}
func (s *stubHouseholdCategoryService) UpdateCategory(_ context.Context, _ string, _ string, _ dto.UpdateCategoryRequest) (*dto.CategoryResponse, error) {
	return nil, nil
}
func (s *stubHouseholdCategoryService) DeleteCategory(_ context.Context, _ string, _ string) error {
	return nil
}

func TestAISettingsHandlerSpouseVoiceNoteResolvesHouseholdAndFiltersSharedAccounts(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ownerID := "11111111-1111-1111-1111-111111111111"
	spouseID := "22222222-2222-2222-2222-222222222222"

	spyAI := &spySpouseAIService{}
	accSvc := &stubHouseholdAccountService{
		accountsByUser: map[string][]dto.AccountResponse{
			ownerID: {
				{ID: "acc-shared-bca", Name: "BCA Bersama", Type: "bank", IsActive: true, IsShared: true},
				{ID: "acc-private-owner", Name: "Rekening Pribadi Owner", Type: "bank", IsActive: true, IsShared: false},
			},
		},
	}

	h := NewAISettingsHandler(spyAI, nil, nil, nil, nil).
		WithCatalogServices(accSvc, &stubHouseholdCategoryService{}).
		WithHouseholdResolver(func(_ context.Context, userID, role string) (string, error) {
			if userID == spouseID && role == "spouse_co_owner" {
				return ownerID, nil
			}
			return userID, nil
		})

	r := gin.New()
	h.RegisterRoutes(r.Group("/api/v1"))

	spouseToken, err := util.GenerateAccessToken(spouseID, "spouse_co_owner", "spouse@keluarga.id")
	if err != nil {
		t.Fatalf("failed to generate spouse token: %v", err)
	}

	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	fw, err := mw.CreateFormFile("audio", "note.webm")
	if err != nil {
		t.Fatalf("CreateFormFile failed: %v", err)
	}
	_, _ = fw.Write([]byte("mock-audio-bytes"))
	_ = mw.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/voice-note", &body)
	req.Header.Set("Authorization", "Bearer "+spouseToken)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 voice-note for spouse_co_owner, got %d: %s", rec.Code, rec.Body.String())
	}
	if spyAI.capturedUserID != ownerID {
		t.Fatalf("expected TranscribeVoiceWorker to use household ownerID %s, got %s", ownerID, spyAI.capturedUserID)
	}

	var parsedCtx struct {
		Accounts []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"accounts"`
		Categories []struct {
			ID string `json:"id"`
		} `json:"categories"`
	}
	if err := json.Unmarshal([]byte(spyAI.capturedContextJSON), &parsedCtx); err != nil {
		t.Fatalf("failed to parse contextJSON: %v", err)
	}
	if len(parsedCtx.Accounts) != 1 || parsedCtx.Accounts[0].ID != "acc-shared-bca" {
		t.Fatalf("expected only shared account acc-shared-bca in spouse AI context, got %+v", parsedCtx.Accounts)
	}
	if len(parsedCtx.Categories) != 1 || parsedCtx.Categories[0].ID != "cat-makan" {
		t.Fatalf("expected household categories for spouse AI context, got %+v", parsedCtx.Categories)
	}
}
