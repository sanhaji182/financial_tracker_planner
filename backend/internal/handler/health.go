package handler

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

type HealthHandler struct {
	// We can pass references to db pool and redis client here in future.
	// For scaffolding, we accept interfaces or just simple mock checks.
	dbConnected    func() bool
	redisConnected func() bool
	version        string
	buildSHA       string
	startedAt      time.Time
}

func NewHealthHandler(dbCheck, redisCheck func() bool, version, buildSHA string) *HealthHandler {
	return &HealthHandler{
		dbConnected:    dbCheck,
		redisConnected: redisCheck,
		version:        version,
		buildSHA:       buildSHA,
		startedAt:      time.Now().UTC(),
	}
}

func (h *HealthHandler) RegisterRoutes(rg *gin.RouterGroup) {
	rg.GET("/health", h.CheckHealth)
	rg.GET("/version", h.CheckVersion)
}

func (h *HealthHandler) CheckHealth(c *gin.Context) {
	dbStatus := "disconnected"
	if h.dbConnected() {
		dbStatus = "connected"
	}

	redisStatus := "disconnected"
	if h.redisConnected() {
		redisStatus = "connected"
	}

	status := http.StatusOK
	overall := "healthy"

	if dbStatus == "disconnected" || redisStatus == "disconnected" {
		overall = "degraded"
		// We still return 200 for scaffolding/load balancers to inspect details,
		// or we can set it based on requirement. Let's keep it healthy or degraded.
	}

	c.JSON(status, gin.H{
		"status":    overall,
		"database":  dbStatus,
		"redis":     redisStatus,
		"version":   h.version,
		"build_sha": h.buildSHA,
		"as_of":     time.Now().UTC().Format(time.RFC3339),
	})
}

func (h *HealthHandler) CheckVersion(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"version":    h.version,
		"build_sha":  h.buildSHA,
		"started_at": h.startedAt.Format(time.RFC3339),
		"as_of":      time.Now().UTC().Format(time.RFC3339),
	})
}
