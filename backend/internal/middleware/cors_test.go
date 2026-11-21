package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestCORS(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Setenv("CORS_ALLOWED_ORIGINS", "")

	router := gin.New()
	router.Use(CORS())
	router.GET("/ping", func(c *gin.Context) {
		c.String(http.StatusOK, "pong")
	})

	t.Run("allows Capacitor and web localhost origins", func(t *testing.T) {
		origins := []string{
			"http://localhost:5173",
			"https://localhost",
			"capacitor://localhost",
			"http://localhost",
		}

		for _, origin := range origins {
			req := httptest.NewRequest(http.MethodGet, "/ping", nil)
			req.Header.Set("Origin", origin)
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)

			if rec.Code != http.StatusOK {
				t.Fatalf("expected 200 for origin %s, got %d", origin, rec.Code)
			}
			if got := rec.Header().Get("Access-Control-Allow-Origin"); got != origin {
				t.Fatalf("expected Allow-Origin %s, got %s", origin, got)
			}
		}
	})

	t.Run("preflight includes X-Client-Platform header", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodOptions, "/ping", nil)
		req.Header.Set("Origin", "https://localhost")
		req.Header.Set("Access-Control-Request-Method", "POST")
		req.Header.Set("Access-Control-Request-Headers", "content-type,x-client-platform")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusNoContent {
			t.Fatalf("expected 204 for preflight, got %d", rec.Code)
		}
		allowHeaders := rec.Header().Get("Access-Control-Allow-Headers")
		if !strings.Contains(allowHeaders, "X-Client-Platform") {
			t.Fatalf("expected X-Client-Platform in Allow-Headers, got %q", allowHeaders)
		}
	})

	t.Run("blocks untrusted origin", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/ping", nil)
		req.Header.Set("Origin", "https://evil.example.com")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusForbidden {
			t.Fatalf("expected 403 for untrusted origin, got %d", rec.Code)
		}
	})
}
