package middleware

import (
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

type clientInfo struct {
	requests  []time.Time
	resetTime time.Time
}

type rateLimiter struct {
	mu                sync.RWMutex
	clients           map[string]*clientInfo
	requestsPerMinute int
	cleanupInterval   time.Duration
}

func newRateLimiter(requestsPerMinute int) *rateLimiter {
	rl := &rateLimiter{
		clients:           make(map[string]*clientInfo),
		requestsPerMinute: requestsPerMinute,
		cleanupInterval:   5 * time.Minute,
	}

	go rl.cleanup()

	return rl
}

func (rl *rateLimiter) cleanup() {
	ticker := time.NewTicker(rl.cleanupInterval)
	defer ticker.Stop()

	for range ticker.C {
		rl.mu.Lock()
		for ip, info := range rl.clients {
			if time.Since(info.resetTime) > 2*time.Minute {
				delete(rl.clients, ip)
			}
		}
		rl.mu.Unlock()
	}
}

func (rl *rateLimiter) isAllowed(ip string) (bool, int, time.Time) {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	windowStart := now.Add(-1 * time.Minute)

	info, exists := rl.clients[ip]
	if !exists {
		info = &clientInfo{
			resetTime: now.Add(1 * time.Minute),
		}
		rl.clients[ip] = info
	}

	// Remove old requests outside the current window
	var validRequests []time.Time
	for _, reqTime := range info.requests {
		if reqTime.After(windowStart) {
			validRequests = append(validRequests, reqTime)
		}
	}
	info.requests = validRequests

	// Check if rate limit is exceeded
	if len(info.requests) >= rl.requestsPerMinute {
		return false, 0, info.resetTime
	}

	// Add current request
	info.requests = append(info.requests, now)
	remaining := rl.requestsPerMinute - len(info.requests)

	// Update reset time if needed
	if now.After(info.resetTime) {
		info.resetTime = now.Add(1 * time.Minute)
	}

	return true, remaining, info.resetTime
}

func RateLimit(requestsPerMinute int) gin.HandlerFunc {
	limiter := newRateLimiter(requestsPerMinute)

	return func(c *gin.Context) {
		ip := c.ClientIP()

		allowed, remaining, resetTime := limiter.isAllowed(ip)

		// Set standard rate limit headers
		c.Header("X-RateLimit-Limit", fmt.Sprintf("%d", requestsPerMinute))
		c.Header("X-RateLimit-Remaining", fmt.Sprintf("%d", remaining))
		c.Header("X-RateLimit-Reset", fmt.Sprintf("%d", resetTime.Unix()))

		if !allowed {
			c.JSON(http.StatusTooManyRequests, gin.H{
				"error": gin.H{
					"code":    "RATE_LIMIT_EXCEEDED",
					"message": "Rate limit exceeded. Please try again later.",
				},
			})
			c.Abort()
			return
		}

		c.Next()
	}
}
