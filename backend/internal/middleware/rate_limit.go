package middleware

import (
	"fmt"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
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
	return RateLimitWithRedis(nil, requestsPerMinute)
}

// RateLimitWithRedis enforces sliding-window per-IP rate limiting backed by Redis
// across replicas, automatically falling back to the in-memory limiter when Redis is unavailable.
func RateLimitWithRedis(rdb *redis.Client, requestsPerMinute int) gin.HandlerFunc {
	fallbackLimiter := newRateLimiter(requestsPerMinute)

	return func(c *gin.Context) {
		ip := c.ClientIP()

		if rdb != nil {
			now := time.Now()
			windowStartMs := now.Add(-1 * time.Minute).UnixMilli()
			nowMs := now.UnixMilli()
			key := fmt.Sprintf("ratelimit:ip:%s", ip)

			pipe := rdb.TxPipeline()
			pipe.ZRemRangeByScore(c.Request.Context(), key, "-inf", strconv.FormatInt(windowStartMs, 10))
			countCmd := pipe.ZCard(c.Request.Context(), key)
			_, err := pipe.Exec(c.Request.Context())

			if err == nil {
				count := int(countCmd.Val())
				resetTime := now.Add(1 * time.Minute)
				if count >= requestsPerMinute {
					c.Header("X-RateLimit-Limit", fmt.Sprintf("%d", requestsPerMinute))
					c.Header("X-RateLimit-Remaining", "0")
					c.Header("X-RateLimit-Reset", fmt.Sprintf("%d", resetTime.Unix()))
					c.JSON(http.StatusTooManyRequests, gin.H{
						"error": gin.H{
							"code":    "RATE_LIMIT_EXCEEDED",
							"message": "Terlalu banyak permintaan. Silakan coba lagi dalam 1 menit.",
						},
					})
					c.Abort()
					return
				}

				member := fmt.Sprintf("%d-%d", nowMs, now.UnixNano())
				writePipe := rdb.TxPipeline()
				writePipe.ZAdd(c.Request.Context(), key, redis.Z{Score: float64(nowMs), Member: member})
				writePipe.PExpire(c.Request.Context(), key, time.Minute)
				_, _ = writePipe.Exec(c.Request.Context())

				remaining := requestsPerMinute - (count + 1)
				if remaining < 0 {
					remaining = 0
				}
				c.Header("X-RateLimit-Limit", fmt.Sprintf("%d", requestsPerMinute))
				c.Header("X-RateLimit-Remaining", fmt.Sprintf("%d", remaining))
				c.Header("X-RateLimit-Reset", fmt.Sprintf("%d", resetTime.Unix()))
				c.Next()
				return
			}
		}

		allowed, remaining, resetTime := fallbackLimiter.isAllowed(ip)

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
