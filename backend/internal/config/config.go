package config

import (
	"fmt"
	"os"
	"strings"

	"github.com/joho/godotenv"
	"github.com/rs/zerolog/log"
)

type Config struct {
	AppEnv            string
	AppPort           string
	AppSecret         string
	JWTAccessSecret   string
	JWTRefreshSecret  string
	DBHost            string
	DBPort            string
	DBName            string
	DBUser            string
	DBPassword        string
	DBSSLMode         string
	RedisHost         string
	RedisPort         string
	RedisPassword     string
	BuildSHA          string
	BuildVersion      string
}

func LoadConfig() (*Config, error) {
	// Try to load .env file if it exists (usually for local development)
	if err := godotenv.Load(); err != nil {
		log.Info().Msg("No .env file found, using system environment variables")
	}

	cfg := &Config{
		AppEnv:           getEnv("APP_ENV", "development"),
		AppPort:          getEnv("APP_PORT", "8080"),
		AppSecret:        getEnv("APP_SECRET", "change-this-to-a-secure-secret-key-32-chars"),
		JWTAccessSecret:  getEnv("JWT_ACCESS_SECRET", ""),
		JWTRefreshSecret: getEnv("JWT_REFRESH_SECRET", ""),
		DBHost:           getEnv("DB_HOST", "localhost"),
		DBPort:           getEnv("DB_PORT", "5432"),
		DBName:           getEnv("DB_NAME", "financial_os"),
		DBUser:           getEnv("DB_USER", "postgres"),
		DBPassword:       getEnv("DB_PASSWORD", "postgres_secret"),
		DBSSLMode:        getEnv("DB_SSL_MODE", "disable"),
		RedisHost:        getEnv("REDIS_HOST", "localhost"),
		RedisPort:        getEnv("REDIS_PORT", "6379"),
		RedisPassword:    getEnv("REDIS_PASSWORD", ""),
		BuildSHA:         firstNonEmpty(os.Getenv("BUILD_SHA"), os.Getenv("GIT_SHA"), os.Getenv("COMMIT_SHA"), "dev"),
		BuildVersion:     getEnv("APP_VERSION", "0.1.0"),
	}

	// Production safety checks
	if cfg.AppEnv == "production" {
		defaultSecret := "change-this-to-a-secure-secret-key-32-chars"
		if cfg.AppSecret == defaultSecret || len(cfg.AppSecret) < 32 {
			return nil, fmt.Errorf("APP_SECRET must be a secure 32+ character string in production")
		}
		if err := validateJWTSecret("JWT_ACCESS_SECRET", cfg.JWTAccessSecret); err != nil {
			return nil, err
		}
		if err := validateJWTSecret("JWT_REFRESH_SECRET", cfg.JWTRefreshSecret); err != nil {
			return nil, err
		}
		if cfg.JWTAccessSecret == cfg.JWTRefreshSecret {
			return nil, fmt.Errorf("JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different in production")
		}
		// Prefer/require are acceptable; plain disable is not.
		mode := strings.ToLower(cfg.DBSSLMode)
		if mode == "disable" || mode == "" {
			return nil, fmt.Errorf("DB_SSL_MODE must not be 'disable' in production")
		}
	} else {
		// Development convenience: allow fallback secrets so local tests still work.
		if cfg.JWTAccessSecret == "" {
			cfg.JWTAccessSecret = "dev-access-secret-key-change-me-32chars"
		}
		if cfg.JWTRefreshSecret == "" {
			cfg.JWTRefreshSecret = "dev-refresh-secret-key-change-me-32chars"
		}
	}

	// Publish secrets for legacy util helpers that still read env.
	_ = os.Setenv("JWT_ACCESS_SECRET", cfg.JWTAccessSecret)
	_ = os.Setenv("JWT_REFRESH_SECRET", cfg.JWTRefreshSecret)

	return cfg, nil
}

func validateJWTSecret(name, secret string) error {
	defaultAccess := "access-secret-key-change-this-in-production"
	if secret == "" || secret == defaultAccess || len(secret) < 32 {
		return fmt.Errorf("%s must be a non-default 32+ character string in production", name)
	}
	return nil
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func getEnv(key, defaultValue string) string {
	if value, exists := os.LookupEnv(key); exists {
		return value
	}
	return defaultValue
}
