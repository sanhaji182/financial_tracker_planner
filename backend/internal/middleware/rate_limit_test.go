package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestRateLimitReturns429(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	// Low threshold so the test stays fast.
	r.POST("/auth/login", RateLimit(3), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	var last int
	for i := 0; i < 5; i++ {
		req := httptest.NewRequest(http.MethodPost, "/auth/login", nil)
		req.RemoteAddr = "203.0.113.10:12345"
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		last = w.Code
		if i < 3 && w.Code != http.StatusOK {
			t.Fatalf("request %d: expected 200, got %d", i+1, w.Code)
		}
		if i >= 3 && w.Code != http.StatusTooManyRequests {
			t.Fatalf("request %d: expected 429, got %d", i+1, w.Code)
		}
	}
	if last != http.StatusTooManyRequests {
		t.Fatalf("expected final status 429, got %d", last)
	}
}

func TestSecurityHeadersPresent(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(SecurityHeaders())
	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	want := []string{
		"X-Content-Type-Options",
		"X-Frame-Options",
		"Referrer-Policy",
		"Permissions-Policy",
		"Strict-Transport-Security",
		"Content-Security-Policy",
	}
	for _, h := range want {
		if w.Header().Get(h) == "" {
			t.Errorf("missing security header %s", h)
		}
	}
}

func TestRateLimitWithRedisNilFallback(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/auth/refresh", RateLimitWithRedis(nil, 2), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	for i := 0; i < 3; i++ {
		req := httptest.NewRequest(http.MethodPost, "/auth/refresh", nil)
		req.RemoteAddr = "198.51.100.42:5555"
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Header().Get("X-RateLimit-Limit") != "2" {
			t.Fatalf("expected X-RateLimit-Limit=2, got %q", w.Header().Get("X-RateLimit-Limit"))
		}
		if i < 2 && w.Code != http.StatusOK {
			t.Fatalf("request %d: expected 200, got %d", i+1, w.Code)
		}
		if i == 2 && w.Code != http.StatusTooManyRequests {
			t.Fatalf("request %d: expected 429, got %d", i+1, w.Code)
		}
	}
}
