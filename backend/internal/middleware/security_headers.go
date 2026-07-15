package middleware

import "github.com/gin-gonic/gin"

// SecurityHeaders attaches baseline browser security headers.
// CSP is intentionally moderate so the SPA/API can coexist without breaking
// third-party auth or analytics later; tighten further as the frontend stabilizes.
func SecurityHeaders() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("X-Frame-Options", "DENY")
		c.Header("Referrer-Policy", "strict-origin-when-cross-origin")
		c.Header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()")
		c.Header("Cross-Origin-Opener-Policy", "same-origin")
		c.Header("Cross-Origin-Resource-Policy", "same-site")
		// HSTS only meaningful behind HTTPS terminators (Cloudflare/nginx TLS).
		c.Header("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		c.Header("Content-Security-Policy", "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; object-src 'none'")
		c.Next()
	}
}
