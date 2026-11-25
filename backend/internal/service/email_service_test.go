package service

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/smtp"
	"strings"
	"testing"
)

func TestEmailServiceResendAndSMTP(t *testing.T) {
	var capturedAuth string
	var capturedPayload map[string]interface{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedAuth = r.Header.Get("Authorization")
		body, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(body, &capturedPayload)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"id":"email_123"}`))
	}))
	defer srv.Close()

	svcResend := &emailService{
		provider:     "resend",
		fromAddr:     "Keuangan Bersama <noreply@keluarga.id>",
		resendAPIKey: "re_test_key_123",
		resendURL:    srv.URL,
		httpClient:   srv.Client(),
	}
	if !svcResend.IsConfigured() {
		t.Fatalf("expected resend EmailService to report configured")
	}
	err := svcResend.SendEmail(context.Background(), EmailMessage{
		To:       "ahliwaris@keluarga.id",
		Subject:  "Pengingat Check-In\r\nBcc: evil@attacker.com",
		TextBody: "Halo, jangan lupa Check-In hari ini.",
		HTMLBody: "<p>Halo, jangan lupa <b>Check-In</b> hari ini.</p>",
	})
	if err != nil {
		t.Fatalf("resend SendEmail failed: %v", err)
	}
	if capturedAuth != "Bearer re_test_key_123" {
		t.Fatalf("unexpected Authorization header: %s", capturedAuth)
	}
	if strings.Contains(capturedPayload["subject"].(string), "\n") || strings.Contains(capturedPayload["subject"].(string), "\r") {
		t.Fatalf("expected CR/LF to be sanitized in subject, got %q", capturedPayload["subject"])
	}

	var smtpSentTo []string
	var smtpRaw string
	svcSMTP := &emailService{
		provider: "smtp",
		fromAddr: "bot@keluarga.id",
		smtpHost: "smtp.gmail.com",
		smtpPort: "587",
		smtpUser: "bot@keluarga.id",
		smtpPass: "app-password",
		smtpSendFn: func(addr string, _ smtp.Auth, from string, to []string, msg []byte) error {
			if addr != "smtp.gmail.com:587" || from != "bot@keluarga.id" {
				t.Fatalf("unexpected smtp params addr=%s from=%s", addr, from)
			}
			smtpSentTo = to
			smtpRaw = string(msg)
			return nil
		},
	}
	if err := svcSMTP.SendEmail(context.Background(), EmailMessage{
		To:       "owner@keluarga.id",
		Subject:  "Tes SMTP",
		TextBody: "Konten teks aman",
	}); err != nil {
		t.Fatalf("smtp SendEmail failed: %v", err)
	}
	if len(smtpSentTo) != 1 || smtpSentTo[0] != "owner@keluarga.id" || !strings.Contains(smtpRaw, "Konten teks aman") {
		t.Fatalf("unexpected SMTP capture to=%+v raw=%q", smtpSentTo, smtpRaw)
	}
}
