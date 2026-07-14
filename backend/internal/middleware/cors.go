package middleware

import (
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
)

func CORS() gin.HandlerFunc {
	configuredOrigins := os.Getenv("CORS_ALLOWED_ORIGINS")
	if configuredOrigins == "" {
		configuredOrigins = "http://localhost:5173,http://localhost:3000,http://localhost:8080"
	}
	allowedOrigins := make(map[string]struct{})
	for _, value := range strings.Split(configuredOrigins, ",") {
		if origin := strings.TrimSpace(value); origin != "" {
			allowedOrigins[origin] = struct{}{}
		}
	}

	return func(c *gin.Context) {
		origin := c.Request.Header.Get("Origin")
		if origin != "" {
			if _, allowed := allowedOrigins[origin]; !allowed {
				c.AbortWithStatus(http.StatusForbidden)
				return
			}
			c.Writer.Header().Set("Access-Control-Allow-Origin", origin)
			c.Writer.Header().Set("Vary", "Origin")
		}
		c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization, accept, origin, Cache-Control, X-Requested-With")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS, GET, PUT, DELETE")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}

		c.Next()
	}
}
