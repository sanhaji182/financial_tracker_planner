package config

import (
	"os"
	"testing"
)

func TestLoadConfigProductionRejectsDefaultJWT(t *testing.T) {
	t.Setenv("APP_ENV", "production")
	t.Setenv("APP_SECRET", "this-is-a-secure-production-app-secret-key-32+")
	t.Setenv("JWT_ACCESS_SECRET", "access-secret-key-change-this-in-production")
	t.Setenv("JWT_REFRESH_SECRET", "another-refresh-secret-key-change-this-32")
	t.Setenv("DB_SSL_MODE", "prefer")

	// Avoid accidental .env interference by ensuring required keys are set.
	_ = os.Unsetenv("CORS_ALLOWED_ORIGINS")

	_, err := LoadConfig()
	if err == nil {
		t.Fatal("expected production config to reject default JWT_ACCESS_SECRET")
	}
}

func TestLoadConfigProductionRejectsSameJWTSecrets(t *testing.T) {
	t.Setenv("APP_ENV", "production")
	t.Setenv("APP_SECRET", "this-is-a-secure-production-app-secret-key-32+")
	same := "same-jwt-secret-value-for-access-and-refresh-32+"
	t.Setenv("JWT_ACCESS_SECRET", same)
	t.Setenv("JWT_REFRESH_SECRET", same)
	t.Setenv("DB_SSL_MODE", "prefer")

	_, err := LoadConfig()
	if err == nil {
		t.Fatal("expected production config to reject identical JWT secrets")
	}
}

func TestLoadConfigDevelopmentAllowsFallback(t *testing.T) {
	t.Setenv("APP_ENV", "development")
	t.Setenv("JWT_ACCESS_SECRET", "")
	t.Setenv("JWT_REFRESH_SECRET", "")
	t.Setenv("APP_SECRET", "dev")
	t.Setenv("DB_SSL_MODE", "disable")

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("development config should load: %v", err)
	}
	if len(cfg.JWTAccessSecret) < 16 {
		t.Fatalf("expected development JWT fallback, got %q", cfg.JWTAccessSecret)
	}
}
