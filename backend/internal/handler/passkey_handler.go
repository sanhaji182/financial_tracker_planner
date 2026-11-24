package handler

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/x509"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/user/financial-os/internal/middleware"
	"github.com/user/financial-os/internal/service"
)

type PasskeyCredential struct {
	ID               string     `json:"id"`
	UserID           string     `json:"user_id"`
	CredentialID     string     `json:"credential_id"`
	PublicKeySPKIB64 string     `json:"-"`
	Algorithm        string     `json:"algorithm"`
	DeviceName       string     `json:"device_name"`
	SignCount        int64      `json:"sign_count"`
	CreatedAt        time.Time  `json:"created_at"`
	LastUsedAt       *time.Time `json:"last_used_at,omitempty"`
}

type PasskeyStore interface {
	ListByUser(ctx context.Context, userID string) ([]PasskeyCredential, error)
	SaveCredential(ctx context.Context, cred *PasskeyCredential) (*PasskeyCredential, error)
	FindByCredentialID(ctx context.Context, credentialID string) (*PasskeyCredential, error)
	UpdateSignCount(ctx context.Context, credentialID string, signCount int64) error
	DeleteByID(ctx context.Context, userID, id string) error
	FindUserIDByEmail(ctx context.Context, email string) (string, error)
}

type PgPasskeyStore struct {
	db *pgxpool.Pool
}

func NewPgPasskeyStore(db *pgxpool.Pool) *PgPasskeyStore {
	return &PgPasskeyStore{db: db}
}

func (s *PgPasskeyStore) ListByUser(ctx context.Context, userID string) ([]PasskeyCredential, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id::text, user_id::text, credential_id, public_key_spki_b64, algorithm, device_name, sign_count, created_at, last_used_at
		FROM webauthn_credentials
		WHERE user_id = $1
		ORDER BY created_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]PasskeyCredential, 0)
	for rows.Next() {
		var c PasskeyCredential
		if err := rows.Scan(&c.ID, &c.UserID, &c.CredentialID, &c.PublicKeySPKIB64, &c.Algorithm, &c.DeviceName, &c.SignCount, &c.CreatedAt, &c.LastUsedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *PgPasskeyStore) SaveCredential(ctx context.Context, cred *PasskeyCredential) (*PasskeyCredential, error) {
	var saved PasskeyCredential
	err := s.db.QueryRow(ctx, `
		INSERT INTO webauthn_credentials (user_id, credential_id, public_key_spki_b64, algorithm, device_name, sign_count)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (credential_id) DO UPDATE
		SET public_key_spki_b64 = EXCLUDED.public_key_spki_b64,
		    device_name = EXCLUDED.device_name
		RETURNING id::text, user_id::text, credential_id, public_key_spki_b64, algorithm, device_name, sign_count, created_at, last_used_at
	`, cred.UserID, cred.CredentialID, cred.PublicKeySPKIB64, cred.Algorithm, cred.DeviceName, cred.SignCount).Scan(
		&saved.ID, &saved.UserID, &saved.CredentialID, &saved.PublicKeySPKIB64, &saved.Algorithm, &saved.DeviceName, &saved.SignCount, &saved.CreatedAt, &saved.LastUsedAt,
	)
	if err != nil {
		return nil, err
	}
	return &saved, nil
}

func (s *PgPasskeyStore) FindByCredentialID(ctx context.Context, credentialID string) (*PasskeyCredential, error) {
	var c PasskeyCredential
	err := s.db.QueryRow(ctx, `
		SELECT id::text, user_id::text, credential_id, public_key_spki_b64, algorithm, device_name, sign_count, created_at, last_used_at
		FROM webauthn_credentials
		WHERE credential_id = $1
	`, credentialID).Scan(&c.ID, &c.UserID, &c.CredentialID, &c.PublicKeySPKIB64, &c.Algorithm, &c.DeviceName, &c.SignCount, &c.CreatedAt, &c.LastUsedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errors.New("passkey tidak ditemukan")
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func (s *PgPasskeyStore) UpdateSignCount(ctx context.Context, credentialID string, signCount int64) error {
	_, err := s.db.Exec(ctx, `
		UPDATE webauthn_credentials
		SET sign_count = $2, last_used_at = NOW()
		WHERE credential_id = $1
	`, credentialID, signCount)
	return err
}

func (s *PgPasskeyStore) DeleteByID(ctx context.Context, userID, id string) error {
	_, err := s.db.Exec(ctx, `DELETE FROM webauthn_credentials WHERE id = $1 AND user_id = $2`, id, userID)
	return err
}

func (s *PgPasskeyStore) FindUserIDByEmail(ctx context.Context, email string) (string, error) {
	var uid string
	err := s.db.QueryRow(ctx, `SELECT id::text FROM users WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL AND is_active = true`, strings.TrimSpace(email)).Scan(&uid)
	if err != nil {
		return "", err
	}
	return uid, nil
}

// MemoryPasskeyStore implements PasskeyStore in memory for unit tests.
type MemoryPasskeyStore struct {
	mu     sync.RWMutex
	creds  map[string]*PasskeyCredential
	emails map[string]string
}

func NewMemoryPasskeyStore() *MemoryPasskeyStore {
	return &MemoryPasskeyStore{
		creds:  make(map[string]*PasskeyCredential),
		emails: make(map[string]string),
	}
}

func (m *MemoryPasskeyStore) SeedUserEmail(email, userID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.emails[strings.ToLower(strings.TrimSpace(email))] = userID
}

func (m *MemoryPasskeyStore) ListByUser(_ context.Context, userID string) ([]PasskeyCredential, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]PasskeyCredential, 0)
	for _, c := range m.creds {
		if c.UserID == userID {
			out = append(out, *c)
		}
	}
	return out, nil
}

func (m *MemoryPasskeyStore) SaveCredential(_ context.Context, cred *PasskeyCredential) (*PasskeyCredential, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	cp := *cred
	if cp.ID == "" {
		cp.ID = uuid.NewString()
	}
	cp.CreatedAt = time.Now()
	m.creds[cp.CredentialID] = &cp
	out := cp
	return &out, nil
}

func (m *MemoryPasskeyStore) FindByCredentialID(_ context.Context, credentialID string) (*PasskeyCredential, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	c, ok := m.creds[credentialID]
	if !ok {
		return nil, errors.New("passkey tidak ditemukan")
	}
	cp := *c
	return &cp, nil
}

func (m *MemoryPasskeyStore) UpdateSignCount(_ context.Context, credentialID string, signCount int64) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if c, ok := m.creds[credentialID]; ok {
		now := time.Now()
		c.SignCount = signCount
		c.LastUsedAt = &now
	}
	return nil
}

func (m *MemoryPasskeyStore) DeleteByID(_ context.Context, userID, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for k, c := range m.creds {
		if c.ID == id && c.UserID == userID {
			delete(m.creds, k)
		}
	}
	return nil
}

func (m *MemoryPasskeyStore) FindUserIDByEmail(_ context.Context, email string) (string, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	uid, ok := m.emails[strings.ToLower(strings.TrimSpace(email))]
	if !ok {
		return "", errors.New("user not found")
	}
	return uid, nil
}

type passkeyChallengeEntry struct {
	Kind      string `json:"kind"`
	UserID    string `json:"user_id,omitempty"`
	RPID      string `json:"rp_id,omitempty"`
	ExpiresAt int64  `json:"expires_at"`
}

func normalizeOrigin(raw string) string {
	clean := strings.TrimRight(strings.TrimSpace(raw), "/")
	if clean == "" || clean == "*" {
		return ""
	}
	u, err := url.Parse(clean)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return ""
	}
	return strings.ToLower(u.Scheme) + "://" + strings.ToLower(u.Host)
}

func hostOnly(hostPort string) string {
	clean := strings.TrimSpace(hostPort)
	if clean == "" {
		return ""
	}
	if h, _, err := net.SplitHostPort(clean); err == nil {
		return strings.ToLower(strings.Trim(h, "[]"))
	}
	return strings.ToLower(strings.Trim(clean, "[]"))
}

func isOriginAllowed(origin string, allowed []string) bool {
	norm := normalizeOrigin(origin)
	if norm == "" {
		return false
	}
	for _, candidate := range allowed {
		if normalizeOrigin(candidate) == norm {
			return true
		}
	}
	return false
}

func decodeBase64Flexible(raw string) ([]byte, error) {
	clean := strings.TrimSpace(raw)
	if clean == "" {
		return nil, errors.New("base64 kosong")
	}
	if b, err := base64.RawURLEncoding.DecodeString(clean); err == nil {
		return b, nil
	}
	if b, err := base64.URLEncoding.DecodeString(clean); err == nil {
		return b, nil
	}
	if b, err := base64.StdEncoding.DecodeString(clean); err == nil {
		return b, nil
	}
	return base64.RawStdEncoding.DecodeString(clean)
}

func parseECDSAPublicKeySPKI(spkiB64 string) (*ecdsa.PublicKey, error) {
	derBytes, err := decodeBase64Flexible(spkiB64)
	if err != nil {
		return nil, errors.New("public_key_spki_b64 tidak valid")
	}
	pubAny, err := x509.ParsePKIXPublicKey(derBytes)
	if err != nil {
		return nil, errors.New("format public key SPKI tidak didukung (butuh ECDSA P-256 ES256)")
	}
	ecdsaPub, ok := pubAny.(*ecdsa.PublicKey)
	if !ok || ecdsaPub.Curve != elliptic.P256() {
		return nil, errors.New("algoritma Passkey harus ES256 (ECDSA P-256)")
	}
	return ecdsaPub, nil
}

// VerifyWebAuthnAssertion validates a WebAuthn ES256 assertion strictly (origin, rpIdHash, UP flag, signature, monotonic signCount).
func VerifyWebAuthnAssertion(
	publicKeySPKIB64,
	expectedChallengeB64Url,
	expectedRPID string,
	allowedOrigins []string,
	prevSignCount int64,
	clientDataJSONB64Url,
	authenticatorDataB64Url,
	signatureB64Url string,
) (uint32, error) {
	ecdsaPub, err := parseECDSAPublicKeySPKI(publicKeySPKIB64)
	if err != nil {
		return 0, err
	}

	clientDataBytes, err := decodeBase64Flexible(clientDataJSONB64Url)
	if err != nil {
		return 0, errors.New("clientDataJSON tidak valid")
	}
	var clientData struct {
		Type      string `json:"type"`
		Challenge string `json:"challenge"`
		Origin    string `json:"origin"`
	}
	if err := json.Unmarshal(clientDataBytes, &clientData); err != nil {
		return 0, errors.New("gagal membaca clientDataJSON")
	}
	if clientData.Type != "webauthn.get" {
		return 0, errors.New("tipe clientDataJSON harus webauthn.get")
	}
	if subtle.ConstantTimeCompare([]byte(clientData.Challenge), []byte(expectedChallengeB64Url)) != 1 {
		return 0, errors.New("challenge Passkey tidak cocok atau kedaluwarsa")
	}
	if !isOriginAllowed(clientData.Origin, allowedOrigins) {
		return 0, errors.New("origin Passkey tidak diizinkan")
	}

	authData, err := decodeBase64Flexible(authenticatorDataB64Url)
	if err != nil || len(authData) < 37 {
		return 0, errors.New("authenticatorData tidak valid")
	}

	cleanRPID := strings.ToLower(strings.TrimSpace(expectedRPID))
	if cleanRPID == "" {
		return 0, errors.New("RP ID Passkey tidak tersedia")
	}
	expectedRPHash := sha256.Sum256([]byte(cleanRPID))
	if subtle.ConstantTimeCompare(authData[:32], expectedRPHash[:]) != 1 {
		return 0, errors.New("rpIdHash Passkey tidak cocok dengan domain server")
	}

	// Bit 0 (0x01) = User Present (UP)
	if authData[32]&0x01 == 0 {
		return 0, errors.New("verifikasi kehadiran pengguna (UP flag) gagal")
	}
	signCount := binary.BigEndian.Uint32(authData[33:37])

	sigBytes, err := decodeBase64Flexible(signatureB64Url)
	if err != nil || len(sigBytes) == 0 {
		return 0, errors.New("tanda tangan WebAuthn kosong/tidak valid")
	}

	clientHash := sha256.Sum256(clientDataBytes)
	signedPayload := make([]byte, len(authData)+len(clientHash))
	copy(signedPayload, authData)
	copy(signedPayload[len(authData):], clientHash[:])
	digest := sha256.Sum256(signedPayload)

	if !ecdsa.VerifyASN1(ecdsaPub, digest[:], sigBytes) {
		return 0, errors.New("verifikasi tanda tangan kriptografi Passkey gagal")
	}

	// Enforce monotonic signCount to detect cloned/replayed authenticators when counter is supported (> 0).
	if signCount > 0 || prevSignCount > 0 {
		if int64(signCount) <= prevSignCount {
			return 0, errors.New("deteksi anomali signCount Passkey (potensi replay/clone)")
		}
	}
	return signCount, nil
}

type PasskeyHandler struct {
	store          PasskeyStore
	authService    service.AuthService
	rdb            *redis.Client
	rpID           string
	allowedOrigins []string
	mu             sync.Mutex
	challenges     map[string]passkeyChallengeEntry
}

func NewPasskeyHandler(store PasskeyStore, authService service.AuthService, rdb *redis.Client) *PasskeyHandler {
	return &PasskeyHandler{
		store:       store,
		authService: authService,
		rdb:         rdb,
		challenges:  make(map[string]passkeyChallengeEntry),
	}
}

func (h *PasskeyHandler) WithWebAuthnConfig(rpID string, allowedOrigins []string) *PasskeyHandler {
	h.rpID = strings.TrimSpace(rpID)
	h.allowedOrigins = append([]string(nil), allowedOrigins...)
	return h
}

func (h *PasskeyHandler) resolveRPID(c *gin.Context) string {
	if clean := hostOnly(h.rpID); clean != "" {
		return clean
	}
	if clean := hostOnly(os.Getenv("WEBAUTHN_RP_ID")); clean != "" {
		return clean
	}
	if c != nil {
		if originHdr := strings.TrimSpace(c.GetHeader("Origin")); originHdr != "" {
			if u, err := url.Parse(originHdr); err == nil && u.Hostname() != "" {
				return strings.ToLower(u.Hostname())
			}
		}
		if reqHost := hostOnly(c.Request.Host); reqHost != "" {
			return reqHost
		}
	}
	if os.Getenv("APP_ENV") != "production" {
		return "localhost"
	}
	return ""
}

func (h *PasskeyHandler) resolveAllowedOrigins(c *gin.Context) []string {
	var rawCandidates []string
	if len(h.allowedOrigins) > 0 {
		rawCandidates = append(rawCandidates, h.allowedOrigins...)
	} else if envOrigins := strings.TrimSpace(os.Getenv("WEBAUTHN_ORIGINS")); envOrigins != "" {
		rawCandidates = strings.Split(envOrigins, ",")
	} else if corsAllowed := strings.TrimSpace(os.Getenv("CORS_ALLOWED_ORIGINS")); corsAllowed != "" {
		rawCandidates = strings.Split(corsAllowed, ",")
	} else if corsOrigins := strings.TrimSpace(os.Getenv("CORS_ORIGINS")); corsOrigins != "" {
		rawCandidates = strings.Split(corsOrigins, ",")
	} else if frontendURL := strings.TrimSpace(os.Getenv("FRONTEND_URL")); frontendURL != "" {
		rawCandidates = []string{frontendURL}
	}

	seen := make(map[string]struct{})
	out := make([]string, 0, len(rawCandidates))
	addNormalized := func(raw string) {
		norm := normalizeOrigin(raw)
		if norm == "" {
			return
		}
		if _, ok := seen[norm]; !ok {
			seen[norm] = struct{}{}
			out = append(out, norm)
		}
	}
	for _, cand := range rawCandidates {
		addNormalized(cand)
	}

	if len(out) == 0 && os.Getenv("APP_ENV") != "production" {
		for _, devOrigin := range []string{
			"http://localhost:5173",
			"http://localhost:3000",
			"http://localhost:4173",
			"http://localhost",
			"https://localhost",
			"capacitor://localhost",
		} {
			addNormalized(devOrigin)
		}
		if c != nil {
			if originHdr := strings.TrimSpace(c.GetHeader("Origin")); originHdr != "" {
				if u, err := url.Parse(originHdr); err == nil {
					host := strings.ToLower(u.Hostname())
					if host == "localhost" || host == "127.0.0.1" {
						addNormalized(originHdr)
					}
				}
			}
		}
	}
	return out
}

func (h *PasskeyHandler) issueChallenge(ctx context.Context, kind, userID, rpID string) (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	challenge := base64.RawURLEncoding.EncodeToString(buf)
	entry := passkeyChallengeEntry{
		Kind:      kind,
		UserID:    userID,
		RPID:      strings.ToLower(strings.TrimSpace(rpID)),
		ExpiresAt: time.Now().Add(5 * time.Minute).Unix(),
	}

	if h.rdb != nil {
		if raw, err := json.Marshal(entry); err == nil {
			if err := h.rdb.Set(ctx, "passkey:chal:"+challenge, string(raw), 5*time.Minute).Err(); err == nil {
				return challenge, nil
			}
		}
	}

	h.mu.Lock()
	defer h.mu.Unlock()
	h.challenges[challenge] = entry
	return challenge, nil
}

func (h *PasskeyHandler) consumeChallenge(ctx context.Context, challenge, expectedKind string) (*passkeyChallengeEntry, error) {
	clean := strings.TrimSpace(challenge)
	if clean == "" {
		return nil, errors.New("challenge wajib disertakan")
	}

	if h.rdb != nil {
		key := "passkey:chal:" + clean
		if val, err := h.rdb.GetDel(ctx, key).Result(); err == nil && val != "" {
			var entry passkeyChallengeEntry
			if jsonErr := json.Unmarshal([]byte(val), &entry); jsonErr == nil && entry.Kind == expectedKind {
				return &entry, nil
			}
		}
	}

	h.mu.Lock()
	defer h.mu.Unlock()
	entry, ok := h.challenges[clean]
	if !ok {
		return nil, errors.New("challenge Passkey tidak valid atau sudah dipakai")
	}
	delete(h.challenges, clean)
	if time.Now().Unix() > entry.ExpiresAt || entry.Kind != expectedKind {
		return nil, errors.New("challenge Passkey kedaluwarsa")
	}
	return &entry, nil
}

func (h *PasskeyHandler) RegisterRoutes(authGroup *gin.RouterGroup) {
	pk := authGroup.Group("/passkey")
	{
		pk.POST("/login/options", h.LoginOptions)
		pk.POST("/login/verify", h.LoginVerify)

		pk.GET("/credentials", middleware.AuthMiddleware(), h.ListCredentials)
		pk.POST("/register/options", middleware.AuthMiddleware(), h.RegisterOptions)
		pk.POST("/register/verify", middleware.AuthMiddleware(), h.RegisterVerify)
		pk.DELETE("/credentials/:id", middleware.AuthMiddleware(), h.DeleteCredential)
	}
}

func (h *PasskeyHandler) ListCredentials(c *gin.Context) {
	userID := c.GetString("user_id")
	list, err := h.store.ListByUser(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()}})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": list})
}

func (h *PasskeyHandler) RegisterOptions(c *gin.Context) {
	userID := c.GetString("user_id")
	email := c.GetString("email")
	rpID := h.resolveRPID(c)
	if rpID == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": gin.H{"code": "WEBAUTHN_NOT_CONFIGURED", "message": "WEBAUTHN_RP_ID belum dikonfigurasi"}})
		return
	}
	challenge, err := h.issueChallenge(c.Request.Context(), "register", userID, rpID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()}})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"challenge": challenge,
			"rp": gin.H{
				"id":   rpID,
				"name": "Keuangan Bersama",
			},
			"user": gin.H{
				"id":          base64.RawURLEncoding.EncodeToString([]byte(userID)),
				"name":        email,
				"displayName": email,
			},
			"pubKeyCredParams": []gin.H{{"type": "public-key", "alg": -7}},
			"timeout":          60000,
			"attestation":      "none",
		},
	})
}

func (h *PasskeyHandler) RegisterVerify(c *gin.Context) {
	userID := c.GetString("user_id")
	var req struct {
		Challenge        string `json:"challenge" binding:"required"`
		CredentialID     string `json:"credential_id" binding:"required"`
		PublicKeySPKIB64 string `json:"public_key_spki_b64" binding:"required"`
		ClientDataJSON   string `json:"client_data_json" binding:"required"`
		DeviceName       string `json:"device_name"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": gin.H{"code": "BAD_REQUEST", "message": err.Error()}})
		return
	}

	entry, err := h.consumeChallenge(c.Request.Context(), req.Challenge, "register")
	if err != nil || entry.UserID != userID {
		c.JSON(http.StatusBadRequest, gin.H{"error": gin.H{"code": "INVALID_CHALLENGE", "message": "Challenge pendaftaran Passkey tidak valid"}})
		return
	}

	cdBytes, cdErr := decodeBase64Flexible(req.ClientDataJSON)
	if cdErr != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": gin.H{"code": "INVALID_CLIENT_DATA", "message": "client_data_json tidak valid"}})
		return
	}
	var cd struct {
		Type      string `json:"type"`
		Challenge string `json:"challenge"`
		Origin    string `json:"origin"`
	}
	if err := json.Unmarshal(cdBytes, &cd); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": gin.H{"code": "INVALID_CLIENT_DATA", "message": "Gagal membaca client_data_json"}})
		return
	}
	if cd.Type != "webauthn.create" || subtle.ConstantTimeCompare([]byte(cd.Challenge), []byte(req.Challenge)) != 1 {
		c.JSON(http.StatusBadRequest, gin.H{"error": gin.H{"code": "INVALID_CLIENT_DATA", "message": "Data pendaftaran Passkey tidak cocok"}})
		return
	}
	if !isOriginAllowed(cd.Origin, h.resolveAllowedOrigins(c)) {
		c.JSON(http.StatusBadRequest, gin.H{"error": gin.H{"code": "INVALID_ORIGIN", "message": "Origin pendaftaran Passkey tidak diizinkan"}})
		return
	}

	if _, err := parseECDSAPublicKeySPKI(req.PublicKeySPKIB64); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": gin.H{"code": "INVALID_PUBLIC_KEY", "message": err.Error()}})
		return
	}

	deviceName := strings.TrimSpace(req.DeviceName)
	if deviceName == "" {
		deviceName = "Perangkat Browser"
	}

	saved, err := h.store.SaveCredential(c.Request.Context(), &PasskeyCredential{
		UserID:           userID,
		CredentialID:     strings.TrimSpace(req.CredentialID),
		PublicKeySPKIB64: strings.TrimSpace(req.PublicKeySPKIB64),
		Algorithm:        "ES256",
		DeviceName:       deviceName,
		SignCount:        0,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()}})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"data": saved})
}

func (h *PasskeyHandler) DeleteCredential(c *gin.Context) {
	userID := c.GetString("user_id")
	id := c.Param("id")
	if err := h.store.DeleteByID(c.Request.Context(), userID, id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()}})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Passkey dihapus"})
}

func (h *PasskeyHandler) LoginOptions(c *gin.Context) {
	var req struct {
		Email string `json:"email"`
	}
	_ = c.ShouldBindJSON(&req)

	rpID := h.resolveRPID(c)
	if rpID == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": gin.H{"code": "WEBAUTHN_NOT_CONFIGURED", "message": "WEBAUTHN_RP_ID belum dikonfigurasi"}})
		return
	}

	var allow []gin.H
	if strings.TrimSpace(req.Email) != "" {
		if uid, err := h.store.FindUserIDByEmail(c.Request.Context(), req.Email); err == nil {
			if creds, err := h.store.ListByUser(c.Request.Context(), uid); err == nil {
				for _, cr := range creds {
					allow = append(allow, gin.H{
						"id":   cr.CredentialID,
						"type": "public-key",
					})
				}
			}
		}
	}

	challenge, err := h.issueChallenge(c.Request.Context(), "login", "", rpID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()}})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"challenge":        challenge,
			"rpId":             rpID,
			"timeout":          60000,
			"userVerification": "preferred",
			"allowCredentials": allow,
		},
	})
}

func (h *PasskeyHandler) LoginVerify(c *gin.Context) {
	var req struct {
		Challenge         string `json:"challenge" binding:"required"`
		CredentialID      string `json:"credential_id" binding:"required"`
		ClientDataJSON    string `json:"client_data_json" binding:"required"`
		AuthenticatorData string `json:"authenticator_data" binding:"required"`
		Signature         string `json:"signature" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": gin.H{"code": "BAD_REQUEST", "message": err.Error()}})
		return
	}

	entry, err := h.consumeChallenge(c.Request.Context(), req.Challenge, "login")
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": gin.H{"code": "INVALID_CHALLENGE", "message": err.Error()}})
		return
	}

	cred, err := h.store.FindByCredentialID(c.Request.Context(), strings.TrimSpace(req.CredentialID))
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": gin.H{"code": "PASSKEY_NOT_FOUND", "message": "Passkey belum terdaftar di server"}})
		return
	}

	expectedRPID := entry.RPID
	if expectedRPID == "" {
		expectedRPID = h.resolveRPID(c)
	}

	signCount, err := VerifyWebAuthnAssertion(
		cred.PublicKeySPKIB64,
		req.Challenge,
		expectedRPID,
		h.resolveAllowedOrigins(c),
		cred.SignCount,
		req.ClientDataJSON,
		req.AuthenticatorData,
		req.Signature,
	)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": gin.H{"code": "PASSKEY_INVALID", "message": err.Error()}})
		return
	}

	_ = h.store.UpdateSignCount(c.Request.Context(), cred.CredentialID, int64(signCount))

	authResp, err := h.authService.IssueTokensForUser(c.Request.Context(), cred.UserID)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": gin.H{"code": "AUTH_FAILED", "message": err.Error()}})
		return
	}

	maxAge := int(7 * 24 * time.Hour / time.Second)
	secure := os.Getenv("APP_ENV") == "production"
	c.SetCookie("refresh_token", authResp.RefreshToken, maxAge, "/api/v1/auth", "", secure, true)

	c.JSON(http.StatusOK, gin.H{
		"message": "Login Passkey berhasil",
		"data":    authResponseData(c, authResp),
	})
}
