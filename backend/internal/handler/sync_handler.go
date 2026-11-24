package handler

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/user/financial-os/internal/middleware"
)

var (
	errSyncConflict       = errors.New("sync revision conflict")
	errNoLinkedHousehold  = errors.New("user does not have an active household vault")
)

type SyncEnvelope struct {
	HouseholdOwnerID string    `json:"household_owner_id,omitempty"`
	Revision         int64     `json:"revision"`
	CiphertextB64    string    `json:"ciphertext_b64"`
	IVB64            string    `json:"iv_b64"`
	SaltB64          string    `json:"salt_b64"`
	KDFIterations    int       `json:"kdf_iterations"`
	DeviceID         string    `json:"device_id"`
	UpdatedBy        string    `json:"updated_by,omitempty"`
	UpdatedAt        time.Time `json:"updated_at"`
}

type UpsertSyncEnvelopeRequest struct {
	BaseRevision  int64  `json:"base_revision"`
	CiphertextB64 string `json:"ciphertext_b64" binding:"required"`
	IVB64         string `json:"iv_b64" binding:"required"`
	SaltB64       string `json:"salt_b64" binding:"required"`
	KDFIterations int    `json:"kdf_iterations"`
	DeviceID      string `json:"device_id"`
}

// SyncStore abstracts E2EE household vault storage across PostgreSQL and isolated test stores.
type SyncStore interface {
	ResolveHouseholdOwner(ctx context.Context, userID, role string) (string, error)
	GetEnvelope(ctx context.Context, ownerID string) (*SyncEnvelope, error)
	PutEnvelope(ctx context.Context, ownerID, updatedBy string, req UpsertSyncEnvelopeRequest) (*SyncEnvelope, *SyncEnvelope, error)
}

type PgSyncStore struct {
	db *pgxpool.Pool
}

func NewPgSyncStore(db *pgxpool.Pool) *PgSyncStore {
	return &PgSyncStore{db: db}
}

func (s *PgSyncStore) ResolveHouseholdOwner(ctx context.Context, userID, role string) (string, error) {
	if role == "owner" {
		return userID, nil
	}
	var invitedBy *string
	err := s.db.QueryRow(ctx, `
		SELECT invited_by::text FROM users WHERE id = $1 AND is_active = true
	`, userID).Scan(&invitedBy)
	if err != nil || invitedBy == nil || strings.TrimSpace(*invitedBy) == "" {
		return "", errNoLinkedHousehold
	}
	return *invitedBy, nil
}

func (s *PgSyncStore) GetEnvelope(ctx context.Context, ownerID string) (*SyncEnvelope, error) {
	var env SyncEnvelope
	err := s.db.QueryRow(ctx, `
		SELECT household_owner_id::text, revision, ciphertext_b64, iv_b64, salt_b64,
		       kdf_iterations, device_id, updated_by::text, updated_at
		FROM household_sync_envelopes
		WHERE household_owner_id = $1
	`, ownerID).Scan(
		&env.HouseholdOwnerID,
		&env.Revision,
		&env.CiphertextB64,
		&env.IVB64,
		&env.SaltB64,
		&env.KDFIterations,
		&env.DeviceID,
		&env.UpdatedBy,
		&env.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &env, nil
}

func (s *PgSyncStore) PutEnvelope(
	ctx context.Context, ownerID, updatedBy string, req UpsertSyncEnvelopeRequest,
) (*SyncEnvelope, *SyncEnvelope, error) {
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var current SyncEnvelope
	err = tx.QueryRow(ctx, `
		SELECT household_owner_id::text, revision, ciphertext_b64, iv_b64, salt_b64,
		       kdf_iterations, device_id, updated_by::text, updated_at
		FROM household_sync_envelopes
		WHERE household_owner_id = $1
		FOR UPDATE
	`, ownerID).Scan(
		&current.HouseholdOwnerID,
		&current.Revision,
		&current.CiphertextB64,
		&current.IVB64,
		&current.SaltB64,
		&current.KDFIterations,
		&current.DeviceID,
		&current.UpdatedBy,
		&current.UpdatedAt,
	)

	kdf := req.KDFIterations
	if kdf <= 0 {
		kdf = 100000
	}

	if errors.Is(err, pgx.ErrNoRows) {
		if req.BaseRevision != 0 {
			return nil, nil, errSyncConflict
		}
		var saved SyncEnvelope
		err = tx.QueryRow(ctx, `
			INSERT INTO household_sync_envelopes (
				household_owner_id, revision, ciphertext_b64, iv_b64, salt_b64,
				kdf_iterations, device_id, updated_by, updated_at
			) VALUES ($1, 1, $2, $3, $4, $5, $6, $7, NOW())
			RETURNING household_owner_id::text, revision, ciphertext_b64, iv_b64, salt_b64,
			          kdf_iterations, device_id, updated_by::text, updated_at
		`, ownerID, req.CiphertextB64, req.IVB64, req.SaltB64, kdf, req.DeviceID, updatedBy).Scan(
			&saved.HouseholdOwnerID,
			&saved.Revision,
			&saved.CiphertextB64,
			&saved.IVB64,
			&saved.SaltB64,
			&saved.KDFIterations,
			&saved.DeviceID,
			&saved.UpdatedBy,
			&saved.UpdatedAt,
		)
		if err != nil {
			return nil, nil, err
		}
		if err = tx.Commit(ctx); err != nil {
			return nil, nil, err
		}
		return &saved, nil, nil
	} else if err != nil {
		return nil, nil, err
	}

	if req.BaseRevision != current.Revision {
		return nil, &current, errSyncConflict
	}

	var saved SyncEnvelope
	err = tx.QueryRow(ctx, `
		UPDATE household_sync_envelopes
		SET revision = revision + 1,
		    ciphertext_b64 = $2,
		    iv_b64 = $3,
		    salt_b64 = $4,
		    kdf_iterations = $5,
		    device_id = $6,
		    updated_by = $7,
		    updated_at = NOW()
		WHERE household_owner_id = $1
		RETURNING household_owner_id::text, revision, ciphertext_b64, iv_b64, salt_b64,
		          kdf_iterations, device_id, updated_by::text, updated_at
	`, ownerID, req.CiphertextB64, req.IVB64, req.SaltB64, kdf, req.DeviceID, updatedBy).Scan(
		&saved.HouseholdOwnerID,
		&saved.Revision,
		&saved.CiphertextB64,
		&saved.IVB64,
		&saved.SaltB64,
		&saved.KDFIterations,
		&saved.DeviceID,
		&saved.UpdatedBy,
		&saved.UpdatedAt,
	)
	if err != nil {
		return nil, nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, nil, err
	}
	return &saved, nil, nil
}

// MemorySyncStore is an in-memory SyncStore used for deterministic unit tests.
type MemorySyncStore struct {
	mu          sync.RWMutex
	spouseOwner map[string]string
	envelopes   map[string]*SyncEnvelope
}

func NewMemorySyncStore() *MemorySyncStore {
	return &MemorySyncStore{
		spouseOwner: make(map[string]string),
		envelopes:   make(map[string]*SyncEnvelope),
	}
}

func (m *MemorySyncStore) LinkSpouse(spouseID, ownerID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.spouseOwner[spouseID] = ownerID
}

func (m *MemorySyncStore) ResolveHouseholdOwner(_ context.Context, userID, role string) (string, error) {
	if role == "owner" {
		return userID, nil
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	ownerID, ok := m.spouseOwner[userID]
	if !ok || ownerID == "" {
		return "", errNoLinkedHousehold
	}
	return ownerID, nil
}

func (m *MemorySyncStore) GetEnvelope(_ context.Context, ownerID string) (*SyncEnvelope, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	env, ok := m.envelopes[ownerID]
	if !ok {
		return nil, nil
	}
	copyEnv := *env
	return &copyEnv, nil
}

func (m *MemorySyncStore) PutEnvelope(
	_ context.Context, ownerID, updatedBy string, req UpsertSyncEnvelopeRequest,
) (*SyncEnvelope, *SyncEnvelope, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	kdf := req.KDFIterations
	if kdf <= 0 {
		kdf = 100000
	}

	current, exists := m.envelopes[ownerID]
	if !exists {
		if req.BaseRevision != 0 {
			return nil, nil, errSyncConflict
		}
		saved := &SyncEnvelope{
			HouseholdOwnerID: ownerID,
			Revision:         1,
			CiphertextB64:    req.CiphertextB64,
			IVB64:            req.IVB64,
			SaltB64:          req.SaltB64,
			KDFIterations:    kdf,
			DeviceID:         req.DeviceID,
			UpdatedBy:        updatedBy,
			UpdatedAt:        time.Now().UTC(),
		}
		m.envelopes[ownerID] = saved
		copyEnv := *saved
		return &copyEnv, nil, nil
	}

	if req.BaseRevision != current.Revision {
		copyCur := *current
		return nil, &copyCur, errSyncConflict
	}

	saved := &SyncEnvelope{
		HouseholdOwnerID: ownerID,
		Revision:         current.Revision + 1,
		CiphertextB64:    req.CiphertextB64,
		IVB64:            req.IVB64,
		SaltB64:          req.SaltB64,
		KDFIterations:    kdf,
		DeviceID:         req.DeviceID,
		UpdatedBy:        updatedBy,
		UpdatedAt:        time.Now().UTC(),
	}
	m.envelopes[ownerID] = saved
	copyEnv := *saved
	return &copyEnv, nil, nil
}

type SyncHandler struct {
	store SyncStore
}

func NewSyncHandler(store SyncStore) *SyncHandler {
	return &SyncHandler{store: store}
}

func (h *SyncHandler) RegisterRoutes(rg *gin.RouterGroup) {
	syncGroup := rg.Group("/sync")
	syncGroup.Use(middleware.AuthMiddleware())
	syncGroup.Use(middleware.RoleMiddleware("owner", "spouse_viewer", "spouse_co_owner"))
	{
		syncGroup.GET("/envelope", h.GetEnvelope)
		syncGroup.PUT("/envelope", h.PutEnvelope)
	}
}

func (h *SyncHandler) GetEnvelope(c *gin.Context) {
	userID := c.GetString("user_id")
	role := c.GetString("role")

	ownerID, err := h.store.ResolveHouseholdOwner(c.Request.Context(), userID, role)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{
			"error": gin.H{
				"code":    "FORBIDDEN",
				"message": err.Error(),
			},
		})
		return
	}

	env, err := h.store.GetEnvelope(c.Request.Context(), ownerID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{
				"code":    "INTERNAL_SERVER_ERROR",
				"message": err.Error(),
			},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"data": env,
	})
}

func (h *SyncHandler) PutEnvelope(c *gin.Context) {
	userID := c.GetString("user_id")
	role := c.GetString("role")

	var req UpsertSyncEnvelopeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{
				"code":    "BAD_REQUEST",
				"message": err.Error(),
			},
		})
		return
	}

	ownerID, err := h.store.ResolveHouseholdOwner(c.Request.Context(), userID, role)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{
			"error": gin.H{
				"code":    "FORBIDDEN",
				"message": err.Error(),
			},
		})
		return
	}

	saved, latest, err := h.store.PutEnvelope(c.Request.Context(), ownerID, userID, req)
	if errors.Is(err, errSyncConflict) {
		c.JSON(http.StatusConflict, gin.H{
			"error": gin.H{
				"code":    "SYNC_CONFLICT",
				"message": "Envelope revision conflict; pull latest ciphertext and merge before pushing.",
			},
			"data": latest,
		})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{
				"code":    "INTERNAL_SERVER_ERROR",
				"message": err.Error(),
			},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"data": saved,
	})
}
