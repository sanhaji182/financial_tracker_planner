package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

type HealthHandler struct {
	// We can pass references to db pool and redis client here in future.
	// For scaffolding, we accept interfaces or just simple mock checks.
	dbConnected    func() bool
	redisConnected func() bool
}

func NewHealthHandler(dbCheck, redisCheck func() bool) *HealthHandler {
	return &HealthHandler{
		dbConnected:    dbCheck,
		redisConnected: redisCheck,
	}
}

func (h *HealthHandler) RegisterRoutes(rg *gin.RouterGroup) {
	rg.GET("/health", h.CheckHealth)
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
		"status":   overall,
		"database": dbStatus,
		"redis":    redisStatus,
	})
}
