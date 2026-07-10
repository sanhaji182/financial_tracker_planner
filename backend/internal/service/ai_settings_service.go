package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
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

func (s *aiSettingsService) CallWorkerAI(ctx context.Context, userID string, endpoint string, reqBody interface{}, respTarget interface{}) error {
	ownerID, err := s.repo.GetOwnerID(ctx, userID)
	if err != nil {
		return err
	}

	settings, err := s.repo.GetByUserID(ctx, ownerID)
	if err != nil {
		return err
	}

	if !settings.AIEnabled {
		return errors.New("AI features are disabled by user")
	}

	apiKey, err := s.GetAPIKey(ctx, ownerID)
	if err != nil {
		return err
	}

	workerURL := os.Getenv("WORKER_URL")
	if workerURL == "" {
		workerURL = "http://localhost:8081"
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
	req.Header.Set("X-AI-Enabled", "true")
	req.Header.Set("X-AI-Provider", settings.AIProvider)
	req.Header.Set("X-AI-Model", settings.AIModel)
	if apiKey != "" {
		req.Header.Set("X-AI-API-Key", apiKey)
	}

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
