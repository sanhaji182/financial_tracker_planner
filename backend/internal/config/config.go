package config

import (
	"fmt"
	"os"

	"github.com/joho/godotenv"
	"github.com/rs/zerolog/log"
)

type Config struct {
	AppEnv     string
	AppPort    string
	AppSecret  string
	DBHost     string
	DBPort     string
	DBName     string
	DBUser     string
	DBPassword string
	DBSSLMode  string
	RedisHost  string
	RedisPort  string
}

func LoadConfig() (*Config, error) {
	// Try to load .env file if it exists (usually for local development)
	if err := godotenv.Load(); err != nil {
		log.Info().Msg("No .env file found, using system environment variables")
	}

	cfg := &Config{
		AppEnv:     getEnv("APP_ENV", "development"),
		AppPort:    getEnv("APP_PORT", "8080"),
		AppSecret:  getEnv("APP_SECRET", "change-this-to-a-secure-secret-key-32-chars"),
		DBHost:     getEnv("DB_HOST", "localhost"),
		DBPort:     getEnv("DB_PORT", "5432"),
		DBName:     getEnv("DB_NAME", "financial_os"),
		DBUser:     getEnv("DB_USER", "postgres"),
		DBPassword: getEnv("DB_PASSWORD", "postgres_secret"),
		DBSSLMode:  getEnv("DB_SSL_MODE", "disable"),
		RedisHost:  getEnv("REDIS_HOST", "localhost"),
		RedisPort:  getEnv("REDIS_PORT", "6379"),
	}

	// Production safety checks
	if cfg.AppEnv == "production" {
		defaultSecret := "change-this-to-a-secure-secret-key-32-chars"
		if cfg.AppSecret == defaultSecret || len(cfg.AppSecret) < 32 {
			return nil, fmt.Errorf("APP_SECRET must be a secure 32+ character string in production")
		}
		if cfg.DBSSLMode == "disable" {
			return nil, fmt.Errorf("DB_SSL_MODE must not be 'disable' in production")
		}
	}

	return cfg, nil
}

func getEnv(key, defaultValue string) string {
	if value, exists := os.LookupEnv(key); exists {
		return value
	}
	return defaultValue
}
