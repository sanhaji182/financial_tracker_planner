package handler

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/model"
	"github.com/user/financial-os/internal/util"
)

func buildSignedPasskeyAssertion(
	t *testing.T,
	privKey *ecdsa.PrivateKey,
	credID, challenge, origin, rpID string,
	signCount uint32,
) []byte {
	t.Helper()
	clientDataBytes, err := json.Marshal(map[string]string{
		"type":      "webauthn.get",
		"challenge": challenge,
		"origin":    origin,
	})
	if err != nil {
		t.Fatalf("failed to marshal clientDataJSON: %v", err)
	}
	authData := make([]byte, 37)
	rpHash := sha256.Sum256([]byte(rpID))
	copy(authData[:32], rpHash[:])
	authData[32] = 0x05 // UP | UV
	binary.BigEndian.PutUint32(authData[33:37], signCount)

	clientHash := sha256.Sum256(clientDataBytes)
	signedPayload := append(append([]byte{}, authData...), clientHash[:]...)
	digest := sha256.Sum256(signedPayload)
	sigDER, err := ecdsa.SignASN1(rand.Reader, privKey, digest[:])
	if err != nil {
		t.Fatalf("failed to sign assertion: %v", err)
	}

	body, _ := json.Marshal(map[string]string{
		"challenge":          challenge,
		"credential_id":      credID,
		"client_data_json":   base64.RawURLEncoding.EncodeToString(clientDataBytes),
		"authenticator_data": base64.RawURLEncoding.EncodeToString(authData),
		"signature":          base64.RawURLEncoding.EncodeToString(sigDER),
	})
	return body
}

func requestPasskeyLoginChallenge(t *testing.T, r *gin.Engine, email, origin string) string {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/passkey/login/options", bytes.NewBufferString(`{"email":"`+email+`"}`))
	req.Header.Set("Content-Type", "application/json")
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 login/options, got %d: %s", rec.Code, rec.Body.String())
	}
	var payload struct {
		Data struct {
			Challenge string `json:"challenge"`
			RPID      string `json:"rpId"`
		} `json:"data"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &payload)
	return payload.Data.Challenge
}

func TestPasskeyHandlerRegisterAndSignLogin(t *testing.T) {
	gin.SetMode(gin.TestMode)
	store := NewMemoryPasskeyStore()
	userID := "11111111-1111-1111-1111-111111111111"
	email := "owner@keluarga.id"
	store.SeedUserEmail(email, userID)

	svc := &mockAuthService{
		loginResp: &dto.AuthResponse{
			AccessToken:  "jwt-passkey-access",
			RefreshToken: "jwt-passkey-refresh",
			User: model.UserResponse{
				ID:    userID,
				Email: email,
				Name:  "Owner",
				Role:  "owner",
			},
		},
	}

	const rpID = "app.keuanganbersama.id"
	const allowedOrigin = "https://app.keuanganbersama.id"

	r := gin.New()
	authGroup := r.Group("/api/v1/auth")
	h := NewPasskeyHandler(store, svc, nil).WithWebAuthnConfig(rpID, []string{allowedOrigin})
	h.RegisterRoutes(authGroup)

	// Generate real ECDSA P-256 authenticator key pair
	privKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("failed to generate P-256 key: %v", err)
	}
	spkiDER, err := x509.MarshalPKIXPublicKey(&privKey.PublicKey)
	if err != nil {
		t.Fatalf("failed to marshal SPKI public key: %v", err)
	}
	spkiB64 := base64.StdEncoding.EncodeToString(spkiDER)
	credID := "cred-es256-test-01"

	token, _ := util.GenerateAccessToken(userID, "owner", email)

	// 1. Get registration challenge & verify rp.id matches
	regOptReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth/passkey/register/options", bytes.NewBufferString(`{}`))
	regOptReq.Header.Set("Authorization", "Bearer "+token)
	regOptReq.Header.Set("Origin", allowedOrigin)
	regOptRec := httptest.NewRecorder()
	r.ServeHTTP(regOptRec, regOptReq)
	if regOptRec.Code != http.StatusOK {
		t.Fatalf("expected 200 register/options, got %d: %s", regOptRec.Code, regOptRec.Body.String())
	}
	var regOpt struct {
		Data struct {
			Challenge string `json:"challenge"`
			RP        struct {
				ID string `json:"id"`
			} `json:"rp"`
		} `json:"data"`
	}
	_ = json.Unmarshal(regOptRec.Body.Bytes(), &regOpt)
	if regOpt.Data.RP.ID != rpID {
		t.Fatalf("expected rp.id=%s, got %q", rpID, regOpt.Data.RP.ID)
	}

	// 2a. Reject registration from disallowed origin
	badRegClientData, _ := json.Marshal(map[string]string{
		"type":      "webauthn.create",
		"challenge": regOpt.Data.Challenge,
		"origin":    "https://evil.example",
	})
	badRegBody, _ := json.Marshal(map[string]string{
		"challenge":           regOpt.Data.Challenge,
		"credential_id":       credID,
		"public_key_spki_b64": spkiB64,
		"client_data_json":    base64.RawURLEncoding.EncodeToString(badRegClientData),
	})
	badRegReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth/passkey/register/verify", bytes.NewReader(badRegBody))
	badRegReq.Header.Set("Authorization", "Bearer "+token)
	badRegReq.Header.Set("Content-Type", "application/json")
	badRegRec := httptest.NewRecorder()
	r.ServeHTTP(badRegRec, badRegReq)
	if badRegRec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 on disallowed registration origin, got %d: %s", badRegRec.Code, badRegRec.Body.String())
	}

	// Issue fresh register challenge & succeed with allowed origin
	regOptReq2 := httptest.NewRequest(http.MethodPost, "/api/v1/auth/passkey/register/options", bytes.NewBufferString(`{}`))
	regOptReq2.Header.Set("Authorization", "Bearer "+token)
	regOptRec2 := httptest.NewRecorder()
	r.ServeHTTP(regOptRec2, regOptReq2)
	_ = json.Unmarshal(regOptRec2.Body.Bytes(), &regOpt)

	// 2b. Verify valid registration
	regClientData, _ := json.Marshal(map[string]string{
		"type":      "webauthn.create",
		"challenge": regOpt.Data.Challenge,
		"origin":    allowedOrigin,
	})
	regVerifyBody, _ := json.Marshal(map[string]string{
		"challenge":           regOpt.Data.Challenge,
		"credential_id":       credID,
		"public_key_spki_b64": spkiB64,
		"client_data_json":    base64.RawURLEncoding.EncodeToString(regClientData),
		"device_name":         "Chrome MacBook Touch ID",
	})
	regVerifyReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth/passkey/register/verify", bytes.NewReader(regVerifyBody))
	regVerifyReq.Header.Set("Authorization", "Bearer "+token)
	regVerifyReq.Header.Set("Content-Type", "application/json")
	regVerifyRec := httptest.NewRecorder()
	r.ServeHTTP(regVerifyRec, regVerifyReq)
	if regVerifyRec.Code != http.StatusCreated {
		t.Fatalf("expected 201 register/verify, got %d: %s", regVerifyRec.Code, regVerifyRec.Body.String())
	}

	// 3. Request login options & check rpId + allowCredentials
	loginOptReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth/passkey/login/options", bytes.NewBufferString(`{"email":"owner@keluarga.id"}`))
	loginOptReq.Header.Set("Content-Type", "application/json")
	loginOptRec := httptest.NewRecorder()
	r.ServeHTTP(loginOptRec, loginOptReq)
	if loginOptRec.Code != http.StatusOK {
		t.Fatalf("expected 200 login/options, got %d", loginOptRec.Code)
	}
	var loginOpt struct {
		Data struct {
			Challenge        string `json:"challenge"`
			RPID             string `json:"rpId"`
			AllowCredentials []struct {
				ID string `json:"id"`
			} `json:"allowCredentials"`
		} `json:"data"`
	}
	_ = json.Unmarshal(loginOptRec.Body.Bytes(), &loginOpt)
	if loginOpt.Data.RPID != rpID {
		t.Fatalf("expected rpId=%s, got %q", rpID, loginOpt.Data.RPID)
	}
	if len(loginOpt.Data.AllowCredentials) != 1 || loginOpt.Data.AllowCredentials[0].ID != credID {
		t.Fatalf("expected allowCredentials to contain %s, got %+v", credID, loginOpt.Data.AllowCredentials)
	}

	// 4. Sign real WebAuthn assertion (signCount = 7)
	loginVerifyBody := buildSignedPasskeyAssertion(t, privKey, credID, loginOpt.Data.Challenge, allowedOrigin, rpID, 7)
	loginVerifyReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth/passkey/login/verify", bytes.NewReader(loginVerifyBody))
	loginVerifyReq.Header.Set("Content-Type", "application/json")
	loginVerifyRec := httptest.NewRecorder()
	r.ServeHTTP(loginVerifyRec, loginVerifyReq)
	if loginVerifyRec.Code != http.StatusOK {
		t.Fatalf("expected 200 login/verify, got %d: %s", loginVerifyRec.Code, loginVerifyRec.Body.String())
	}

	var loginPayload struct {
		Data map[string]interface{} `json:"data"`
	}
	_ = json.Unmarshal(loginVerifyRec.Body.Bytes(), &loginPayload)
	if loginPayload.Data["access_token"] != "jwt-passkey-access" {
		t.Fatalf("expected access_token from IssueTokensForUser, got %v", loginPayload.Data["access_token"])
	}

	// 5. Replaying same challenge must fail -> 401
	replayReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth/passkey/login/verify", bytes.NewReader(loginVerifyBody))
	replayReq.Header.Set("Content-Type", "application/json")
	replayRec := httptest.NewRecorder()
	r.ServeHTTP(replayRec, replayReq)
	if replayRec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 on replayed challenge, got %d", replayRec.Code)
	}

	// 6. Second valid login with higher signCount = 8 succeeds
	ch2 := requestPasskeyLoginChallenge(t, r, email, allowedOrigin)
	body2 := buildSignedPasskeyAssertion(t, privKey, credID, ch2, allowedOrigin, rpID, 8)
	req2 := httptest.NewRequest(http.MethodPost, "/api/v1/auth/passkey/login/verify", bytes.NewReader(body2))
	req2.Header.Set("Content-Type", "application/json")
	rec2 := httptest.NewRecorder()
	r.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusOK {
		t.Fatalf("expected 200 on monotonic signCount=8, got %d: %s", rec2.Code, rec2.Body.String())
	}

	// 7. Wrong origin in clientDataJSON must fail -> 401
	chBadOrigin := requestPasskeyLoginChallenge(t, r, email, allowedOrigin)
	badOriginBody := buildSignedPasskeyAssertion(t, privKey, credID, chBadOrigin, "https://evil.example", rpID, 9)
	badOriginReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth/passkey/login/verify", bytes.NewReader(badOriginBody))
	badOriginReq.Header.Set("Content-Type", "application/json")
	badOriginRec := httptest.NewRecorder()
	r.ServeHTTP(badOriginRec, badOriginReq)
	if badOriginRec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 on disallowed origin, got %d: %s", badOriginRec.Code, badOriginRec.Body.String())
	}

	// 8. Wrong rpIdHash must fail -> 401
	chBadRP := requestPasskeyLoginChallenge(t, r, email, allowedOrigin)
	badRPBody := buildSignedPasskeyAssertion(t, privKey, credID, chBadRP, allowedOrigin, "evil.example", 9)
	badRPReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth/passkey/login/verify", bytes.NewReader(badRPBody))
	badRPReq.Header.Set("Content-Type", "application/json")
	badRPRec := httptest.NewRecorder()
	r.ServeHTTP(badRPRec, badRPReq)
	if badRPRec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 on wrong rpIdHash, got %d: %s", badRPRec.Code, badRPRec.Body.String())
	}

	// 9. Replayed/regressed signCount (== 8 and < 8) must fail -> 401
	for _, staleCount := range []uint32{8, 5} {
		chStale := requestPasskeyLoginChallenge(t, r, email, allowedOrigin)
		staleBody := buildSignedPasskeyAssertion(t, privKey, credID, chStale, allowedOrigin, rpID, staleCount)
		staleReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth/passkey/login/verify", bytes.NewReader(staleBody))
		staleReq.Header.Set("Content-Type", "application/json")
		staleRec := httptest.NewRecorder()
		r.ServeHTTP(staleRec, staleReq)
		if staleRec.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401 on stale/regressed signCount=%d, got %d: %s", staleCount, staleRec.Code, staleRec.Body.String())
		}
	}
}

func TestPasskeyAllowedOriginsEnvFallbackAndProdFailClosed(t *testing.T) {
	h := NewPasskeyHandler(NewMemoryPasskeyStore(), nil, nil)

	t.Setenv("WEBAUTHN_ORIGINS", "")
	t.Setenv("CORS_ALLOWED_ORIGINS", "https://keluarga.app, https://m.keluarga.app/")
	t.Setenv("CORS_ORIGINS", "")
	t.Setenv("FRONTEND_URL", "")
	t.Setenv("APP_ENV", "production")

	origins := h.resolveAllowedOrigins(nil)
	if len(origins) != 2 || origins[0] != "https://keluarga.app" || origins[1] != "https://m.keluarga.app" {
		t.Fatalf("expected CORS_ALLOWED_ORIGINS fallback to normalize cleanly, got %+v", origins)
	}

	t.Setenv("CORS_ALLOWED_ORIGINS", "")
	prodEmpty := h.resolveAllowedOrigins(nil)
	if len(prodEmpty) != 0 {
		t.Fatalf("expected fail-closed empty allowed origins in production when unset, got %+v", prodEmpty)
	}
}
