package middleware

import (
	"fmt"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
)

func DashboardCacheInvalidator(rdb *redis.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Next()

		// Only invalidate on successful state-changing operations
		status := c.Writer.Status()
		if status >= 200 && status < 300 {
			method := c.Request.Method
			if method == "POST" || method == "PUT" || method == "DELETE" {
				userID := c.GetString("user_id")
				if userID != "" {
					redisKey := fmt.Sprintf("dashboard:%s", userID)
					_ = rdb.Del(c.Request.Context(), redisKey).Err()
				}
			}
		}
	}
}
