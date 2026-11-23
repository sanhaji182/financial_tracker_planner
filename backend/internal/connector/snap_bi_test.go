package connector

import (
	"context"
	"testing"
	"time"
)

func TestBuildAndVerifySNAPSymmetricSignature(t *testing.T) {
	ts := FormatSNAPTimestamp(time.Date(2026, 11, 22, 10, 15, 0, 0, time.UTC))
	body := []byte("{\n  \"partnerReferenceNo\": \"202611220001\",\n  \"accountNo\": \"1234567890\"\n}")
	sig := BuildSNAPSymmetricSignature(
		"POST",
		"/openapi/v1.0/balance-inquiry",
		"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
		body,
		ts,
		"super-secret-client-key",
	)

	if sig == "" {
		t.Fatal("expected non-empty SNAP BI signature")
	}

	// Minified JSON spacing must yield the exact same canonical signature
	compactBody := []byte(`{"partnerReferenceNo":"202611220001","accountNo":"1234567890"}`)
	if !VerifySNAPSymmetricSignature(
		"POST",
		"/openapi/v1.0/balance-inquiry",
		"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
		compactBody,
		ts,
		"super-secret-client-key",
		sig,
	) {
		t.Fatal("expected minified body signature verification to succeed")
	}

	if VerifySNAPSymmetricSignature(
		"POST",
		"/openapi/v1.0/balance-inquiry",
		"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
		compactBody,
		ts,
		"wrong-secret",
		sig,
	) {
		t.Fatal("expected wrong secret verification to fail")
	}
}

func TestSandboxSNAPConnector(t *testing.T) {
	ctx := context.Background()
	conn := NewSandboxSNAPConnector("BCA-SNAP", "client-1", "secret-1")
	if conn.ProviderName() != "BCA-SNAP" {
		t.Fatalf("unexpected provider name %s", conn.ProviderName())
	}

	tok, err := conn.GetAccessToken(ctx)
	if err != nil || tok == "" {
		t.Fatalf("expected valid sandbox token, got err=%v tok=%q", err, tok)
	}

	bal, err := conn.GetAccountBalance(ctx, tok, "5220304050")
	if err != nil {
		t.Fatalf("unexpected balance error: %v", err)
	}
	if bal.Currency != "IDR" || bal.Available <= 0 {
		t.Fatalf("unexpected sandbox balance: %+v", bal)
	}

	from := time.Now().Add(-24 * time.Hour)
	to := time.Now()
	hist, err := conn.GetTransactionHistory(ctx, tok, "5220304050", from, to)
	if err != nil {
		t.Fatalf("unexpected history error: %v", err)
	}
	if len(hist) != 2 || hist[0].Channel != "QRIS Tap" {
		t.Fatalf("unexpected sandbox history: %+v", hist)
	}
}
