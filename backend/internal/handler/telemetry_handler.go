package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog/log"

	"github.com/user/financial-os/internal/middleware"
)

type ClientErrorEvent struct {
	ID         string                 `json:"id"`
	UserID     *string                `json:"user_id,omitempty"`
	Platform   string                 `json:"platform"`
	AppVersion string                 `json:"app_version"`
	Message    string                 `json:"message"`
	Stack      string                 `json:"stack,omitempty"`
	Route      string                 `json:"route,omitempty"`
	Metadata   map[string]interface{} `json:"metadata,omitempty"`
	CreatedAt  time.Time              `json:"created_at"`
}

type TelemetryStore interface {
	SaveEvent(ctx context.Context, ev *ClientErrorEvent) error
	ListRecent(ctx context.Context, limit int) ([]ClientErrorEvent, error)
}

type PgTelemetryStore struct {
	db *pgxpool.Pool
}

func NewPgTelemetryStore(db *pgxpool.Pool) *PgTelemetryStore {
	return &PgTelemetryStore{db: db}
}

func (s *PgTelemetryStore) SaveEvent(ctx context.Context, ev *ClientErrorEvent) error {
	metaBytes, _ := json.Marshal(ev.Metadata)
	if len(metaBytes) == 0 {
		metaBytes = []byte("{}")
	}
	_, err := s.db.Exec(ctx, `
		INSERT INTO client_error_events (user_id, platform, app_version, message, stack, route, metadata)
		VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
	`, ev.UserID, ev.Platform, ev.AppVersion, ev.Message, ev.Stack, ev.Route, string(metaBytes))
	return err
}

func (s *PgTelemetryStore) ListRecent(ctx context.Context, limit int) ([]ClientErrorEvent, error) {
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	rows, err := s.db.Query(ctx, `
		SELECT id::text, user_id::text, COALESCE(platform, ''), COALESCE(app_version, ''),
		       message, COALESCE(stack, ''), COALESCE(route, ''), metadata, created_at
		FROM client_error_events
		ORDER BY created_at DESC
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]ClientErrorEvent, 0)
	for rows.Next() {
		var ev ClientErrorEvent
		var metaRaw []byte
		if err := rows.Scan(&ev.ID, &ev.UserID, &ev.Platform, &ev.AppVersion, &ev.Message, &ev.Stack, &ev.Route, &metaRaw, &ev.CreatedAt); err != nil {
			return nil, err
		}
		if len(metaRaw) > 0 {
			_ = json.Unmarshal(metaRaw, &ev.Metadata)
		}
		out = append(out, ev)
	}
	return out, rows.Err()
}

// MemoryTelemetryStore stores telemetry events safely in a bounded memory ring buffer for tests.
type MemoryTelemetryStore struct {
	mu     sync.Mutex
	events []ClientErrorEvent
}

func NewMemoryTelemetryStore() *MemoryTelemetryStore {
	return &MemoryTelemetryStore{}
}

func (m *MemoryTelemetryStore) SaveEvent(_ context.Context, ev *ClientErrorEvent) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	cp := *ev
	if cp.ID == "" {
		cp.ID = uuid.NewString()
	}
	if cp.CreatedAt.IsZero() {
		cp.CreatedAt = time.Now()
	}
	m.events = append([]ClientErrorEvent{cp}, m.events...)
	if len(m.events) > 100 {
		m.events = m.events[:100]
	}
	return nil
}

func (m *MemoryTelemetryStore) ListRecent(_ context.Context, limit int) ([]ClientErrorEvent, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if limit <= 0 || limit > len(m.events) {
		limit = len(m.events)
	}
	out := make([]ClientErrorEvent, limit)
	copy(out, m.events[:limit])
	return out, nil
}

type TelemetryHandler struct {
	store     TelemetryStore
	rdb       *redis.Client
	startedAt time.Time
}

func NewTelemetryHandler(store TelemetryStore, rdb *redis.Client) *TelemetryHandler {
	return &TelemetryHandler{
		store:     store,
		rdb:       rdb,
		startedAt: time.Now(),
	}
}

func (h *TelemetryHandler) RegisterRoutes(rg *gin.RouterGroup) {
	tel := rg.Group("/telemetry")
	{
		tel.POST("/client-error", middleware.RateLimitWithRedis(h.rdb, 60), h.ReportClientError)
		tel.GET("/diagnostics", middleware.AuthMiddleware(), middleware.RoleMiddleware("owner"), h.Diagnostics)
	}
}

func truncateString(s string, maxLen int) string {
	trimmed := strings.TrimSpace(s)
	if len(trimmed) <= maxLen {
		return trimmed
	}
	return trimmed[:maxLen]
}

func (h *TelemetryHandler) ReportClientError(c *gin.Context) {
	var req struct {
		Platform   string                 `json:"platform"`
		AppVersion string                 `json:"app_version"`
		Message    string                 `json:"message" binding:"required"`
		Stack      string                 `json:"stack"`
		Route      string                 `json:"route"`
		Metadata   map[string]interface{} `json:"metadata"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": gin.H{"code": "BAD_REQUEST", "message": err.Error()}})
		return
	}

	ev := &ClientErrorEvent{
		Platform:   truncateString(req.Platform, 40),
		AppVersion: truncateString(req.AppVersion, 40),
		Message:    truncateString(req.Message, 1000),
		Stack:      truncateString(req.Stack, 4000),
		Route:      truncateString(req.Route, 255),
		Metadata:   req.Metadata,
		CreatedAt:  time.Now(),
	}
	if uid := c.GetString("user_id"); uid != "" {
		ev.UserID = &uid
	}

	log.Warn().
		Str("platform", ev.Platform).
		Str("app_version", ev.AppVersion).
		Str("route", ev.Route).
		Str("message", ev.Message).
		Msg("client error telemetry received")

	if h.store != nil {
		_ = h.store.SaveEvent(c.Request.Context(), ev)
	}

	c.JSON(http.StatusAccepted, gin.H{"accepted": true})
}

func (h *TelemetryHandler) Diagnostics(c *gin.Context) {
	events := []ClientErrorEvent{}
	if h.store != nil {
		if list, err := h.store.ListRecent(c.Request.Context(), 20); err == nil {
			events = list
		}
	}
	snapMode := "sandbox"
	if os.Getenv("SNAP_BI_CLIENT_ID") != "" && os.Getenv("SNAP_BI_CLIENT_SECRET") != "" {
		snapMode = "configured"
	}
	c.JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"uptime_seconds":      int64(time.Since(h.startedAt).Seconds()),
			"recent_errors_count": len(events),
			"recent_errors":       events,
			"telegram_configured": os.Getenv("TELEGRAM_BOT_TOKEN") != "",
			"sentry_configured":   os.Getenv("SENTRY_DSN") != "",
			"snap_mode":           snapMode,
		},
	})
}
