package service

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/mail"
	"net/smtp"
	"os"
	"strconv"
	"strings"
	"time"
)

type EmailMessage struct {
	To       string
	Subject  string
	TextBody string
	HTMLBody string
}

type EmailService interface {
	IsConfigured() bool
	ProviderName() string
	SendEmail(ctx context.Context, msg EmailMessage) error
}

type emailService struct {
	provider     string
	fromAddr     string
	smtpHost     string
	smtpPort     string
	smtpUser     string
	smtpPass     string
	resendAPIKey string
	resendURL    string
	httpClient   *http.Client
	smtpSendFn   func(addr string, a smtp.Auth, from string, to []string, msg []byte) error
}

func NewEmailService() EmailService {
	provider := strings.ToLower(strings.TrimSpace(os.Getenv("EMAIL_PROVIDER")))
	smtpHost := strings.TrimSpace(os.Getenv("SMTP_HOST"))
	smtpPort := strings.TrimSpace(os.Getenv("SMTP_PORT"))
	if smtpPort == "" {
		smtpPort = "587"
	}
	smtpUser := strings.TrimSpace(os.Getenv("SMTP_USER"))
	smtpPass := os.Getenv("SMTP_PASS")
	resendKey := strings.TrimSpace(os.Getenv("RESEND_API_KEY"))

	fromAddr := strings.TrimSpace(os.Getenv("EMAIL_FROM"))
	if fromAddr == "" {
		fromAddr = strings.TrimSpace(os.Getenv("SMTP_FROM"))
	}
	if fromAddr == "" && smtpUser != "" && strings.Contains(smtpUser, "@") {
		fromAddr = smtpUser
	}
	if fromAddr == "" {
		fromAddr = "no-reply@keuanganbersama.app"
	}

	if provider == "" {
		switch {
		case smtpHost != "":
			provider = "smtp"
		case resendKey != "":
			provider = "resend"
		default:
			provider = "unconfigured"
		}
	}

	return &emailService{
		provider:     provider,
		fromAddr:     fromAddr,
		smtpHost:     smtpHost,
		smtpPort:     smtpPort,
		smtpUser:     smtpUser,
		smtpPass:     smtpPass,
		resendAPIKey: resendKey,
		resendURL:    "https://api.resend.com/emails",
		httpClient:   &http.Client{Timeout: 12 * time.Second},
		smtpSendFn:   smtp.SendMail,
	}
}

// sanitizeHeader strips CR/LF to prevent SMTP header injection.
func sanitizeEmailHeader(v string) string {
	v = strings.ReplaceAll(v, "\r", " ")
	v = strings.ReplaceAll(v, "\n", " ")
	return strings.TrimSpace(v)
}

func (s *emailService) ProviderName() string {
	return s.provider
}

func (s *emailService) IsConfigured() bool {
	switch s.provider {
	case "smtp":
		return s.smtpHost != ""
	case "resend":
		return s.resendAPIKey != ""
	default:
		return false
	}
}

func (s *emailService) SendEmail(ctx context.Context, msg EmailMessage) error {
	toParsed, err := mail.ParseAddress(strings.TrimSpace(msg.To))
	if err != nil || toParsed.Address == "" {
		return errors.New("alamat email tujuan tidak valid")
	}
	subject := sanitizeEmailHeader(msg.Subject)
	if subject == "" {
		subject = "Notifikasi Keuangan Bersama"
	}

	switch s.provider {
	case "resend":
		if s.resendAPIKey == "" {
			return errors.New("RESEND_API_KEY belum dikonfigurasi")
		}
		return s.sendViaResend(ctx, toParsed.Address, subject, msg.TextBody, msg.HTMLBody)
	case "smtp":
		if s.smtpHost == "" {
			return errors.New("SMTP_HOST belum dikonfigurasi")
		}
		return s.sendViaSMTP(ctx, toParsed.Address, subject, msg.TextBody, msg.HTMLBody)
	default:
		return errors.New("layanan Email outbound (SMTP / RESEND_API_KEY) belum dikonfigurasi di server")
	}
}

func (s *emailService) sendViaResend(ctx context.Context, to, subject, textBody, htmlBody string) error {
	payload := map[string]interface{}{
		"from":    sanitizeEmailHeader(s.fromAddr),
		"to":      []string{to},
		"subject": subject,
		"text":    textBody,
	}
	if strings.TrimSpace(htmlBody) != "" {
		payload["html"] = htmlBody
	}
	raw, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.resendURL, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+s.resendAPIKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("gagal menghubungi Resend API: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		bodySnippet, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("resend API status %d: %s", resp.StatusCode, strings.TrimSpace(string(bodySnippet)))
	}
	return nil
}

func buildRFC2822Message(from, to, subject, textBody, htmlBody string) []byte {
	var buf bytes.Buffer
	fromHeader := sanitizeEmailHeader(from)
	toHeader := sanitizeEmailHeader(to)
	buf.WriteString("From: " + fromHeader + "\r\n")
	buf.WriteString("To: " + toHeader + "\r\n")
	buf.WriteString("Subject: " + sanitizeEmailHeader(subject) + "\r\n")
	buf.WriteString("MIME-Version: 1.0\r\n")

	if strings.TrimSpace(htmlBody) != "" {
		boundary := "kb-boundary-" + strconv.FormatInt(time.Now().UnixNano(), 36)
		buf.WriteString("Content-Type: multipart/alternative; boundary=\"" + boundary + "\"\r\n\r\n")
		buf.WriteString("--" + boundary + "\r\n")
		buf.WriteString("Content-Type: text/plain; charset=UTF-8\r\n\r\n")
		buf.WriteString(textBody + "\r\n\r\n")
		buf.WriteString("--" + boundary + "\r\n")
		buf.WriteString("Content-Type: text/html; charset=UTF-8\r\n\r\n")
		buf.WriteString(htmlBody + "\r\n\r\n")
		buf.WriteString("--" + boundary + "--\r\n")
		return buf.Bytes()
	}

	buf.WriteString("Content-Type: text/plain; charset=UTF-8\r\n\r\n")
	buf.WriteString(textBody + "\r\n")
	return buf.Bytes()
}

func (s *emailService) sendViaSMTP(ctx context.Context, to, subject, textBody, htmlBody string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	fromParsed, err := mail.ParseAddress(strings.TrimSpace(s.fromAddr))
	envelopeFrom := s.fromAddr
	if err == nil && fromParsed.Address != "" {
		envelopeFrom = fromParsed.Address
	}

	addr := s.smtpHost + ":" + s.smtpPort
	rawMsg := buildRFC2822Message(s.fromAddr, to, subject, textBody, htmlBody)

	var auth smtp.Auth
	if s.smtpUser != "" {
		auth = smtp.PlainAuth("", s.smtpUser, s.smtpPass, s.smtpHost)
	}

	if s.smtpPort == "465" {
		conn, err := tls.Dial("tcp", addr, &tls.Config{ServerName: s.smtpHost, MinVersion: tls.VersionTLS12})
		if err != nil {
			return fmt.Errorf("gagal koneksi TLS SMTP (%s): %w", addr, err)
		}
		client, err := smtp.NewClient(conn, s.smtpHost)
		if err != nil {
			conn.Close()
			return err
		}
		defer client.Close()
		if auth != nil {
			if err := client.Auth(auth); err != nil {
				return err
			}
		}
		if err := client.Mail(envelopeFrom); err != nil {
			return err
		}
		if err := client.Rcpt(to); err != nil {
			return err
		}
		w, err := client.Data()
		if err != nil {
			return err
		}
		if _, err := w.Write(rawMsg); err != nil {
			_ = w.Close()
			return err
		}
		if err := w.Close(); err != nil {
			return err
		}
		return client.Quit()
	}

	return s.smtpSendFn(addr, auth, envelopeFrom, []string{to}, rawMsg)
}
