package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"mime/multipart"
	"net/http"
	"os"
	"time"

	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/model"
	"github.com/user/financial-os/internal/repository"
)

type AISettingsService interface {
	GetSettings(ctx context.Context, userID string) (*dto.AISettingsResponse, error)
	UpdateSettings(ctx context.Context, userID string, req *dto.UpdateAISettingsRequest) error
	GetSettingsRaw(ctx context.Context, userID string) (*model.AISettings, error)
	GetAPIKey(ctx context.Context, userID string) (string, error)
	CallWorkerAI(ctx context.Context, userID string, endpoint string, reqBody interface{}, respTarget interface{}) error
	StreamWorkerAI(ctx context.Context, userID string, endpoint string, reqBody interface{}, dst http.ResponseWriter) error
	TranscribeVoiceWorker(ctx context.Context, userID string, audioBytes []byte, filename, mimeType, contextJSON string) (*dto.VoiceTranscribeResponse, error)
	DetectAnomalies(ctx context.Context, userID string) (*dto.AnomalyCheckResponse, error)
}

type aiSettingsService struct {
	repo         repository.AISettingsRepository
	vaultService VaultService
}

func NewAISettingsService(repo repository.AISettingsRepository, vaultService VaultService) AISettingsService {
	return &aiSettingsService{
		repo:         repo,
		vaultService: vaultService,
	}
}

func (s *aiSettingsService) GetSettings(ctx context.Context, userID string) (*dto.AISettingsResponse, error) {
	ownerID, err := s.repo.GetOwnerID(ctx, userID)
	if err != nil {
		return nil, err
	}

	settings, err := s.repo.GetByUserID(ctx, ownerID)
	if err != nil {
		return nil, err
	}

	ref, err := s.repo.GetVaultReference(ctx, ownerID, "api_key")
	if err != nil {
		return nil, err
	}
	hasKey := ref != nil && ref.VaultItemID != ""

	resp := dto.ToAISettingsResponse(settings, hasKey)
	return &resp, nil
}

func (s *aiSettingsService) GetSettingsRaw(ctx context.Context, userID string) (*model.AISettings, error) {
	ownerID, err := s.repo.GetOwnerID(ctx, userID)
	if err != nil {
		return nil, err
	}
	return s.repo.GetByUserID(ctx, ownerID)
}

func (s *aiSettingsService) UpdateSettings(ctx context.Context, userID string, req *dto.UpdateAISettingsRequest) error {
	ownerID, err := s.repo.GetOwnerID(ctx, userID)
	if err != nil {
		return err
	}

	settings, err := s.repo.GetByUserID(ctx, ownerID)
	if err != nil {
		return err
	}

	settings.AIEnabled = req.AIEnabled
	settings.AIProvider = req.AIProvider
	settings.AIModel = req.AIModel
	settings.OCREscalationEnabled = req.OCREscalationEnabled
	settings.AutoCategorizationEnabled = req.AutoCategorizationEnabled
	settings.AdvisorEnabled = req.AdvisorEnabled
	settings.AnomalyDetectionEnabled = req.AnomalyDetectionEnabled

	// If API Key is provided, store in vault and create/update vault reference
	if req.APIKey != "" {
		vaultItemID, err := s.vaultService.StoreSecret(ctx, req.APIKey)
		if err != nil {
			return fmt.Errorf("failed to save API key to vault: %w", err)
		}

		existingRef, err := s.repo.GetVaultReference(ctx, ownerID, "api_key")
		if err != nil {
			return err
		}

		if existingRef != nil {
			existingRef.VaultItemID = vaultItemID
			if err := s.repo.SaveVaultReference(ctx, existingRef); err != nil {
				return fmt.Errorf("failed to update vault reference: %w", err)
			}
		} else {
			notes := "Stored API Key for AI features"
			newRef := &model.VaultReference{
				UserID:      ownerID,
				Name:        "AI API Key",
				VaultItemID: vaultItemID,
				Type:        "api_key",
				Notes:       &notes,
			}
			if err := s.repo.SaveVaultReference(ctx, newRef); err != nil {
				return fmt.Errorf("failed to create vault reference: %w", err)
			}
		}
	}

	return s.repo.Update(ctx, settings)
}

func (s *aiSettingsService) GetAPIKey(ctx context.Context, userID string) (string, error) {
	ownerID, err := s.repo.GetOwnerID(ctx, userID)
	if err != nil {
		return "", err
	}

	ref, err := s.repo.GetVaultReference(ctx, ownerID, "api_key")
	if err != nil {
		return "", err
	}
	if ref == nil || ref.VaultItemID == "" {
		return "", nil
	}
	return s.vaultService.RetrieveSecret(ctx, ref.VaultItemID)
}

func (s *aiSettingsService) resolveWorkerConfig(ctx context.Context, userID string, requireEnabled bool) (*model.AISettings, string, string, error) {
	ownerID, err := s.repo.GetOwnerID(ctx, userID)
	if err != nil {
		return nil, "", "", err
	}

	settings, err := s.repo.GetByUserID(ctx, ownerID)
	if err != nil {
		return nil, "", "", err
	}

	if requireEnabled && !settings.AIEnabled {
		return nil, "", "", errors.New("AI features are disabled by user")
	}

	apiKey := ""
	if settings.AIEnabled {
		apiKey, err = s.GetAPIKey(ctx, ownerID)
		if err != nil {
			return nil, "", "", err
		}
	}

	workerURL := os.Getenv("WORKER_URL")
	if workerURL == "" {
		workerURL = "http://localhost:8081"
	}
	return settings, apiKey, workerURL, nil
}

func applyWorkerHeaders(req *http.Request, settings *model.AISettings, apiKey string) {
	if workerSecret := os.Getenv("WORKER_SECRET"); workerSecret != "" {
		req.Header.Set("X-Worker-Secret", workerSecret)
	}
	provider := "local"
	modelName := "default"
	if settings != nil && settings.AIEnabled {
		req.Header.Set("X-AI-Enabled", "true")
		if settings.AIProvider != "" {
			provider = settings.AIProvider
		}
		if settings.AIModel != "" {
			modelName = settings.AIModel
		}
	} else {
		req.Header.Set("X-AI-Enabled", "false")
	}
	req.Header.Set("X-AI-Provider", provider)
	req.Header.Set("X-AI-Model", modelName)
	if apiKey != "" {
		req.Header.Set("X-AI-API-Key", apiKey)
	}
}

func (s *aiSettingsService) CallWorkerAI(ctx context.Context, userID string, endpoint string, reqBody interface{}, respTarget interface{}) error {
	settings, apiKey, workerURL, err := s.resolveWorkerConfig(ctx, userID, true)
	if err != nil {
		return err
	}
	targetURL := workerURL + endpoint

	var bodyBytes []byte
	if reqBody != nil {
		bodyBytes, err = json.Marshal(reqBody)
		if err != nil {
			return fmt.Errorf("failed to serialize request body: %w", err)
		}
	}

	req, err := http.NewRequestWithContext(ctx, "POST", targetURL, bytes.NewReader(bodyBytes))
	if err != nil {
		return fmt.Errorf("failed to create HTTP request to worker: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	applyWorkerHeaders(req, settings, apiKey)

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to call worker service: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBytes, _ := ioReadAll(resp.Body)
		return fmt.Errorf("worker service returned error status %d: %s", resp.StatusCode, string(respBytes))
	}

	if respTarget != nil {
		if err := json.NewDecoder(resp.Body).Decode(respTarget); err != nil {
			return fmt.Errorf("failed to decode worker response: %w", err)
		}
	}

	return nil
}

func (s *aiSettingsService) StreamWorkerAI(ctx context.Context, userID string, endpoint string, reqBody interface{}, dst http.ResponseWriter) error {
	settings, apiKey, workerURL, err := s.resolveWorkerConfig(ctx, userID, true)
	if err != nil {
		return err
	}

	bodyBytes, err := json.Marshal(reqBody)
	if err != nil {
		return fmt.Errorf("failed to serialize stream body: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", workerURL+endpoint, bytes.NewReader(bodyBytes))
	if err != nil {
		return fmt.Errorf("failed to create stream request to worker: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	applyWorkerHeaders(req, settings, apiKey)

	client := &http.Client{Timeout: 90 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to connect to worker stream: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBytes, _ := ioReadAll(resp.Body)
		return fmt.Errorf("worker stream error status %d: %s", resp.StatusCode, string(respBytes))
	}

	flusher, _ := dst.(http.Flusher)
	buf := make([]byte, 2048)
	for {
		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			if _, writeErr := dst.Write(buf[:n]); writeErr != nil {
				return writeErr
			}
			if flusher != nil {
				flusher.Flush()
			}
		}
		if readErr != nil {
			break
		}
	}
	return nil
}

func (s *aiSettingsService) TranscribeVoiceWorker(
	ctx context.Context,
	userID string,
	audioBytes []byte,
	filename, mimeType, contextJSON string,
) (*dto.VoiceTranscribeResponse, error) {
	settings, apiKey, workerURL, err := s.resolveWorkerConfig(ctx, userID, false)
	if err != nil {
		return nil, err
	}

	if filename == "" {
		filename = "voice-note.webm"
	}

	var formBuf bytes.Buffer
	mw := multipart.NewWriter(&formBuf)
	fw, err := mw.CreateFormFile("file", filename)
	if err != nil {
		return nil, err
	}
	if _, err := fw.Write(audioBytes); err != nil {
		return nil, err
	}
	if contextJSON != "" {
		_ = mw.WriteField("context_json", contextJSON)
	}
	if err := mw.Close(); err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", workerURL+"/ai/transcribe-voice", &formBuf)
	if err != nil {
		return nil, fmt.Errorf("failed to create voice transcribe request: %w", err)
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	if mimeType != "" {
		req.Header.Set("X-Audio-Mime-Type", mimeType)
	}
	applyWorkerHeaders(req, settings, apiKey)

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to reach voice transcription worker: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBytes, _ := ioReadAll(resp.Body)
		return nil, fmt.Errorf("worker voice error %d: %s", resp.StatusCode, string(respBytes))
	}

	var out dto.VoiceTranscribeResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, fmt.Errorf("failed to decode voice response: %w", err)
	}
	return &out, nil
}

func (s *aiSettingsService) DetectAnomalies(ctx context.Context, userID string) (*dto.AnomalyCheckResponse, error) {
	ownerID, err := s.repo.GetOwnerID(ctx, userID)
	if err != nil {
		return nil, err
	}

	// 1. Fetch recent transactions and category averages
	recentTx, err := s.repo.GetRecentTransactions(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch recent transactions: %w", err)
	}

	catAverages, err := s.repo.GetCategoryAverages(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch category averages: %w", err)
	}

	// 2. Prepare payload for worker
	payload := map[string]interface{}{
		"recent_transactions": recentTx,
		"category_averages":   catAverages,
	}

	// 3. Define response structure from worker
	type workerAnomaly struct {
		TransactionID string `json:"transaction_id"`
		Reason        string `json:"reason"`
	}
	type workerAnomalyResp struct {
		Anomalies []workerAnomaly `json:"anomalies"`
	}

	var workerResp workerAnomalyResp
	err = s.CallWorkerAI(ctx, ownerID, "/ai/detect-anomaly", payload, &workerResp)
	if err != nil {
		return nil, err
	}

	// 4. Create in-app alerts for each anomaly
	var createdAlerts []string
	for _, anomaly := range workerResp.Anomalies {
		title := "Transaksi Tidak Wajar Terdeteksi"
		msg := "🤖 Saran AI — " + anomaly.Reason

		alertErr := s.repo.CreateAlert(
			ctx,
			ownerID,
			"anomaly",
			"warning",
			title,
			msg,
			"transaction",
			anomaly.TransactionID,
		)
		if alertErr == nil {
			createdAlerts = append(createdAlerts, fmt.Sprintf("Alert created for transaction %s: %s", anomaly.TransactionID, anomaly.Reason))
		}
	}

	return &dto.AnomalyCheckResponse{
		AnomaliesCount: len(workerResp.Anomalies),
		AlertsCreated:  createdAlerts,
	}, nil
}

// helper since io.ReadAll can be imported or mock wrapper
func ioReadAll(r ioReader) ([]byte, error) {
	var buf bytes.Buffer
	_, err := buf.ReadFrom(r)
	return buf.Bytes(), err
}

type ioReader interface {
	Read(p []byte) (n int, err error)
}
