package connector

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/sha512"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// AccountBalance represents a normalized balance fetched via SNAP BI Open API.
type AccountBalance struct {
	AccountNo string  `json:"account_no"`
	AccountName string `json:"account_name"`
	Currency  string  `json:"currency"`
	Available float64 `json:"available"`
	Hold      float64 `json:"hold"`
	AsOf      string  `json:"as_of"`
}

// BankTransactionItem represents a normalized debit/credit entry from SNAP BI bank statements.
type BankTransactionItem struct {
	ReferenceNo string  `json:"reference_no"`
	Amount      float64 `json:"amount"`
	Currency    string  `json:"currency"`
	Direction   string  `json:"direction"` // "DB" | "CR"
	Channel     string  `json:"channel"`   // "QRIS Tap" | "QRIS" | "BI-FAST" | "TRANSFER"
	Description string  `json:"description"`
	OccurredAt  string  `json:"occurred_at"`
}

// AccountConnector defines the abstraction required to connect licensed Bank Indonesia SNAP
// aggregators or direct bank Open APIs cleanly without coupling domain services to a single bank.
type AccountConnector interface {
	ProviderName() string
	GetAccessToken(ctx context.Context) (string, error)
	GetAccountBalance(ctx context.Context, accessToken, partnerAccountNo string) (*AccountBalance, error)
	GetTransactionHistory(ctx context.Context, accessToken, partnerAccountNo string, from, to time.Time) ([]BankTransactionItem, error)
}

var wibLocation = time.FixedZone("WIB", 7*3600)

// FormatSNAPTimestamp formats t using Bank Indonesia SNAP ISO-8601 +07:00 standard.
func FormatSNAPTimestamp(t time.Time) string {
	return t.In(wibLocation).Format("2006-01-02T15:04:05+07:00")
}

// MinifyJSONBody strips insignificance whitespace from JSON payloads before canonical hashing per SNAP BI spec.
func MinifyJSONBody(raw []byte) string {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" {
		return ""
	}
	var anyVal any
	if err := json.Unmarshal([]byte(trimmed), &anyVal); err != nil {
		return trimmed
	}
	compact, err := json.Marshal(anyVal)
	if err != nil {
		return trimmed
	}
	return string(compact)
}

// BuildSNAPSymmetricSignature computes the Bank Indonesia SNAP symmetric signature:
// HMAC-SHA512(clientSecret, "METHOD:RelativePath:AccessToken:LowerHex(SHA256(Minify(Body))):Timestamp").
func BuildSNAPSymmetricSignature(
	method, relativePath, accessToken string,
	bodyBytes []byte,
	timestamp, clientSecret string,
) string {
	minified := MinifyJSONBody(bodyBytes)
	bodyDigest := sha256.Sum256([]byte(minified))
	lowerHexDigest := strings.ToLower(hex.EncodeToString(bodyDigest[:]))
	canonical := fmt.Sprintf("%s:%s:%s:%s:%s",
		strings.ToUpper(strings.TrimSpace(method)),
		strings.TrimSpace(relativePath),
		strings.TrimSpace(accessToken),
		lowerHexDigest,
		strings.TrimSpace(timestamp),
	)
	mac := hmac.New(sha512.New, []byte(clientSecret))
	mac.Write([]byte(canonical))
	return base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

// VerifySNAPSymmetricSignature validates a SNAP BI symmetric signature in constant time.
func VerifySNAPSymmetricSignature(
	method, relativePath, accessToken string,
	bodyBytes []byte,
	timestamp, clientSecret, signatureB64 string,
) bool {
	expected := BuildSNAPSymmetricSignature(method, relativePath, accessToken, bodyBytes, timestamp, clientSecret)
	return hmac.Equal([]byte(expected), []byte(strings.TrimSpace(signatureB64)))
}

// SandboxSNAPConnector implements AccountConnector against deterministic BI SNAP sandbox fixtures.
type SandboxSNAPConnector struct {
	provider     string
	clientID     string
	clientSecret string
}

func NewSandboxSNAPConnector(provider, clientID, clientSecret string) *SandboxSNAPConnector {
	if strings.TrimSpace(provider) == "" {
		provider = "SNAP-BI-Sandbox"
	}
	return &SandboxSNAPConnector{
		provider:     provider,
		clientID:     clientID,
		clientSecret: clientSecret,
	}
}

func (c *SandboxSNAPConnector) ProviderName() string {
	return c.provider
}

func (c *SandboxSNAPConnector) GetAccessToken(_ context.Context) (string, error) {
	ts := FormatSNAPTimestamp(time.Now())
	raw := fmt.Sprintf("snap-sandbox:%s:%s", c.clientID, ts)
	return base64.RawURLEncoding.EncodeToString([]byte(raw)), nil
}

func (c *SandboxSNAPConnector) GetAccountBalance(_ context.Context, accessToken, partnerAccountNo string) (*AccountBalance, error) {
	if strings.TrimSpace(accessToken) == "" {
		return nil, fmt.Errorf("snap access token required")
	}
	if strings.TrimSpace(partnerAccountNo) == "" {
		return nil, fmt.Errorf("partner account number required")
	}
	return &AccountBalance{
		AccountNo:   partnerAccountNo,
		AccountName: fmt.Sprintf("%s Primary Account", c.provider),
		Currency:    "IDR",
		Available:   12500000,
		Hold:        0,
		AsOf:        FormatSNAPTimestamp(time.Now()),
	}, nil
}

func (c *SandboxSNAPConnector) GetTransactionHistory(
	_ context.Context, accessToken, partnerAccountNo string, from, to time.Time,
) ([]BankTransactionItem, error) {
	if strings.TrimSpace(accessToken) == "" {
		return nil, fmt.Errorf("snap access token required")
	}
	if to.Before(from) {
		return nil, fmt.Errorf("invalid date range")
	}
	return []BankTransactionItem{
		{
			ReferenceNo: fmt.Sprintf("SNAP-QRIS-%s-01", partnerAccountNo),
			Amount:      45000,
			Currency:    "IDR",
			Direction:   "DB",
			Channel:     "QRIS Tap",
			Description: "MRT JAKARTA LEBAK BULUS",
			OccurredAt:  FormatSNAPTimestamp(from.Add(2 * time.Hour)),
		},
		{
			ReferenceNo: fmt.Sprintf("SNAP-BIFAST-%s-02", partnerAccountNo),
			Amount:      1500000,
			Currency:    "IDR",
			Direction:   "CR",
			Channel:     "BI-FAST",
			Description: "TRANSFER MASUK KELUARGA",
			OccurredAt:  FormatSNAPTimestamp(from.Add(5 * time.Hour)),
		},
	}, nil
}
