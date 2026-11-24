package service

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

type TelegramService interface {
	SendMessage(title, message, actionHint string) error
	SendReplyToChat(chatID, text string) error
	DownloadFile(fileID string) ([]byte, string, error)
}

type telegramService struct {
	botToken string
	chatID   string
	client   *http.Client
}

func NewTelegramService() TelegramService {
	return &telegramService{
		botToken: os.Getenv("TELEGRAM_BOT_TOKEN"),
		chatID:   os.Getenv("TELEGRAM_CHAT_ID"),
		client:   &http.Client{Timeout: 10 * time.Second},
	}
}

func (s *telegramService) SendMessage(title, message, actionHint string) error {
	if s.botToken == "" || s.chatID == "" {
		return nil
	}

	text := fmt.Sprintf("⚠️ *%s*\n%s\n_%s_", title, message, actionHint)
	return s.SendReplyToChat(s.chatID, text)
}

func (s *telegramService) SendReplyToChat(chatID, text string) error {
	if s.botToken == "" || strings.TrimSpace(chatID) == "" || strings.TrimSpace(text) == "" {
		return nil
	}

	payload := map[string]interface{}{
		"chat_id":    strings.TrimSpace(chatID),
		"text":       text,
		"parse_mode": "Markdown",
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal telegram payload: %w", err)
	}

	url := fmt.Sprintf("https://api.telegram.org/bot%s/sendMessage", s.botToken)
	resp, err := s.client.Post(url, "application/json", bytes.NewBuffer(body))
	if err != nil {
		return fmt.Errorf("failed to send telegram message: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("telegram API returned status: %d", resp.StatusCode)
	}
	return nil
}

func (s *telegramService) DownloadFile(fileID string) ([]byte, string, error) {
	if s.botToken == "" {
		return nil, "", errors.New("TELEGRAM_BOT_TOKEN belum dikonfigurasi")
	}
	if strings.TrimSpace(fileID) == "" {
		return nil, "", errors.New("file_id telegram kosong")
	}

	metaURL := fmt.Sprintf("https://api.telegram.org/bot%s/getFile?file_id=%s", s.botToken, strings.TrimSpace(fileID))
	metaResp, err := s.client.Get(metaURL)
	if err != nil {
		return nil, "", fmt.Errorf("gagal mengambil metadata file telegram: %w", err)
	}
	defer metaResp.Body.Close()

	var meta struct {
		OK     bool `json:"ok"`
		Result struct {
			FilePath string `json:"file_path"`
		} `json:"result"`
	}
	if err := json.NewDecoder(metaResp.Body).Decode(&meta); err != nil || !meta.OK || meta.Result.FilePath == "" {
		return nil, "", errors.New("telegram getFile gagal mendapatkan file_path")
	}

	dlURL := fmt.Sprintf("https://api.telegram.org/file/bot%s/%s", s.botToken, meta.Result.FilePath)
	fileResp, err := s.client.Get(dlURL)
	if err != nil {
		return nil, "", fmt.Errorf("gagal mengunduh file telegram: %w", err)
	}
	defer fileResp.Body.Close()

	if fileResp.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("telegram file download returned %d", fileResp.StatusCode)
	}

	data, err := io.ReadAll(io.LimitReader(fileResp.Body, 10*1024*1024))
	if err != nil {
		return nil, "", err
	}
	return data, meta.Result.FilePath, nil
}
