package middleware

import (
	"time"

	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog/log"
)

func Logger() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		path := c.Request.URL.Path
		query := c.Request.URL.RawQuery

		c.Next()

		latency := time.Since(start)
		status := c.Writer.Status()

		log.Info().
			Int("status", status).
			Str("method", c.Request.Method).
			Str("path", path).
			Str("query", query).
			Str("ip", c.ClientIP()).
			Dur("latency", latency).
			Msg("HTTP request processed")
	}
}
