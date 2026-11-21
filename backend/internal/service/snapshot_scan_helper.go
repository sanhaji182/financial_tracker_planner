package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode"

	"github.com/user/financial-os/internal/model"
)

const MaxScanFileSize = 10 * 1024 * 1024

// WorkerScanError represents a structured error returned during document scanning.
type WorkerScanError struct {
	StatusCode int
	Code       string
	Message    string
}

func (e *WorkerScanError) Error() string {
	return e.Message
}

func validateScanFile(fileName string, fileBytes []byte) error {
	if len(fileBytes) == 0 {
		return &WorkerScanError{
			StatusCode: http.StatusBadRequest,
			Code:       "BAD_REQUEST",
			Message:    "File tidak boleh kosong.",
		}
	}
	if len(fileBytes) > MaxScanFileSize {
		return &WorkerScanError{
			StatusCode: http.StatusRequestEntityTooLarge,
			Code:       "FILE_TOO_LARGE",
			Message:    "Ukuran file melebihi batas maksimal 10MB.",
		}
	}

	ext := strings.ToLower(filepath.Ext(fileName))
	switch ext {
	case ".png", ".jpg", ".jpeg", ".webp", ".pdf":
		return nil
	}

	if hasValidScanMagicBytes(fileBytes) {
		return nil
	}

	return &WorkerScanError{
		StatusCode: http.StatusBadRequest,
		Code:       "INVALID_FILE_TYPE",
		Message:    "Format berkas tidak didukung. Gunakan PNG, JPG, JPEG, WEBP, atau PDF.",
	}
}

func hasValidScanMagicBytes(b []byte) bool {
	if len(b) >= 4 && bytes.Equal(b[:4], []byte("%PDF")) {
		return true
	}
	if len(b) >= 8 && bytes.Equal(b[:8], []byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a}) {
		return true
	}
	if len(b) >= 3 && b[0] == 0xff && b[1] == 0xd8 && b[2] == 0xff {
		return true
	}
	if len(b) >= 12 && bytes.Equal(b[:4], []byte("RIFF")) && bytes.Equal(b[8:12], []byte("WEBP")) {
		return true
	}
	return false
}

func callWorkerSnapshotMultipart(
	ctx context.Context,
	userID string,
	aiService AISettingsService,
	endpoint string,
	fileName string,
	fileBytes []byte,
	pdfPassword string,
	respTarget interface{},
) error {
	workerURL := os.Getenv("WORKER_URL")
	if workerURL == "" {
		workerURL = "http://localhost:8081"
	}
	targetURL := strings.TrimRight(workerURL, "/") + endpoint

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	if fileName == "" {
		fileName = "document.png"
	}
	part, err := writer.CreateFormFile("file", filepath.Base(fileName))
	if err != nil {
		return &WorkerScanError{
			StatusCode: http.StatusInternalServerError,
			Code:       "INTERNAL_SERVER_ERROR",
			Message:    fmt.Sprintf("failed to create multipart form: %v", err),
		}
	}
	if _, err := io.Copy(part, bytes.NewReader(fileBytes)); err != nil {
		return &WorkerScanError{
			StatusCode: http.StatusInternalServerError,
			Code:       "INTERNAL_SERVER_ERROR",
			Message:    fmt.Sprintf("failed to write multipart file: %v", err),
		}
	}
	if pdfPassword != "" {
		if err := writer.WriteField("pdf_password", pdfPassword); err != nil {
			return &WorkerScanError{
				StatusCode: http.StatusInternalServerError,
				Code:       "INTERNAL_SERVER_ERROR",
				Message:    "failed to attach pdf password field",
			}
		}
	}
	_ = writer.Close()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, targetURL, body)
	if err != nil {
		return &WorkerScanError{
			StatusCode: http.StatusInternalServerError,
			Code:       "INTERNAL_SERVER_ERROR",
			Message:    fmt.Sprintf("failed to create worker request: %v", err),
		}
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	if workerSecret := os.Getenv("WORKER_SECRET"); workerSecret != "" {
		req.Header.Set("X-Worker-Secret", workerSecret)
	}

	if aiService != nil {
		settings, err := aiService.GetSettingsRaw(ctx, userID)
		if err == nil && settings != nil && settings.AIEnabled {
			req.Header.Set("X-AI-Provider", settings.AIProvider)
			req.Header.Set("X-AI-Model", settings.AIModel)
			if apiKey, keyErr := aiService.GetAPIKey(ctx, userID); keyErr == nil && apiKey != "" {
				req.Header.Set("X-AI-API-Key", apiKey)
			}
		}
	}

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return &WorkerScanError{
			StatusCode: http.StatusBadGateway,
			Code:       "WORKER_UNAVAILABLE",
			Message:    "Layanan pemindaian dokumen sedang tidak terjangkau. Coba lagi sebentar.",
		}
	}
	defer resp.Body.Close()

	respBytes, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return parseWorkerErrorResponse(resp.StatusCode, respBytes)
	}

	if respTarget != nil {
		if err := json.Unmarshal(respBytes, respTarget); err != nil {
			return &WorkerScanError{
				StatusCode: http.StatusBadGateway,
				Code:       "WORKER_INVALID_RESPONSE",
				Message:    fmt.Sprintf("failed to decode worker response: %v", err),
			}
		}
	}

	return nil
}

func parseWorkerErrorResponse(statusCode int, body []byte) *WorkerScanError {
	var parsed struct {
		Detail interface{} `json:"detail"`
	}
	code := "WORKER_ERROR"
	msg := "Gagal memproses dokumen pada layanan pemindaian."

	if err := json.Unmarshal(body, &parsed); err == nil && parsed.Detail != nil {
		switch d := parsed.Detail.(type) {
		case map[string]interface{}:
			if c, ok := d["code"].(string); ok && c != "" {
				code = c
			}
			if m, ok := d["message"].(string); ok && m != "" {
				msg = m
			}
		case string:
			if d != "" {
				msg = d
			}
		}
	}

	switch statusCode {
	case http.StatusUnprocessableEntity:
		if code == "WORKER_ERROR" {
			code = "UNPROCESSABLE_ENTITY"
		}
		return &WorkerScanError{
			StatusCode: http.StatusUnprocessableEntity,
			Code:       code,
			Message:    msg,
		}
	case http.StatusBadRequest:
		return &WorkerScanError{
			StatusCode: http.StatusBadRequest,
			Code:       "BAD_REQUEST",
			Message:    msg,
		}
	case http.StatusRequestEntityTooLarge:
		return &WorkerScanError{
			StatusCode: http.StatusRequestEntityTooLarge,
			Code:       "FILE_TOO_LARGE",
			Message:    msg,
		}
	default:
		return &WorkerScanError{
			StatusCode: http.StatusBadGateway,
			Code:       code,
			Message:    msg,
		}
	}
}

func extractDigits(s string) string {
	var b strings.Builder
	for _, r := range s {
		if unicode.IsDigit(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func matchUserAccount(accounts []model.Account, bankProvider, accountNumber, accountName string) (string, string) {
	var active []model.Account
	for _, acc := range accounts {
		if acc.IsActive {
			active = append(active, acc)
		}
	}
	if len(active) == 0 {
		active = accounts
	}

	// 1. Match by trailing 4 digits of account number
	digits := extractDigits(accountNumber)
	if len(digits) >= 4 {
		last4 := digits[len(digits)-4:]
		for _, acc := range active {
			if acc.AccountNumberMasked != nil {
				accDigits := extractDigits(*acc.AccountNumberMasked)
				if len(accDigits) >= 4 && accDigits[len(accDigits)-4:] == last4 {
					return acc.ID, acc.Name
				}
			}
		}
	}

	// 2. Match by bank_provider (exact then substring against BankProvider or Name)
	provLower := strings.ToLower(strings.TrimSpace(bankProvider))
	if provLower != "" {
		for _, acc := range active {
			if acc.BankProvider != nil && strings.EqualFold(strings.TrimSpace(*acc.BankProvider), provLower) {
				return acc.ID, acc.Name
			}
		}
		for _, acc := range active {
			if acc.BankProvider != nil {
				bp := strings.ToLower(*acc.BankProvider)
				if strings.Contains(bp, provLower) || strings.Contains(provLower, bp) {
					return acc.ID, acc.Name
				}
			}
			if strings.Contains(strings.ToLower(acc.Name), provLower) {
				return acc.ID, acc.Name
			}
		}
	}

	// 3. Match by accountName substring
	nameLower := strings.ToLower(strings.TrimSpace(accountName))
	if len(nameLower) >= 3 {
		for _, acc := range active {
			accNameLower := strings.ToLower(acc.Name)
			if strings.Contains(accNameLower, nameLower) || strings.Contains(nameLower, accNameLower) {
				return acc.ID, acc.Name
			}
		}
	}

	return "", ""
}
