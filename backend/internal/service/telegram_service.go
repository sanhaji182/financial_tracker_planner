package service

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"
)

type TelegramService interface {
	SendMessage(title, message, actionHint string) error
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
		// Silently skip if not configured
		return nil
	}

	text := fmt.Sprintf("⚠️ *%s*\n%s\n_%s_", title, message, actionHint)

	payload := map[string]interface{}{
		"chat_id":    s.chatID,
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
