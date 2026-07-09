package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/user/financial-os/internal/config"
	"github.com/user/financial-os/internal/handler"
	"github.com/user/financial-os/internal/middleware"
	"github.com/user/financial-os/internal/repository"
	"github.com/user/financial-os/internal/service"
)

func main() {
	// Initialize logger
	zerolog.TimeFieldFormat = zerolog.TimeFormatUnix
	log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr, TimeFormat: time.RFC3339})

	log.Info().Msg("Starting Financial OS Backend...")

	// Load configuration
	cfg, err := config.LoadConfig()
	if err != nil {
		log.Fatal().Err(err).Msg("Failed to load configuration")
	}

	// Set Gin mode
	if cfg.AppEnv == "production" {
		gin.SetMode(gin.ReleaseMode)
	}

	// Setup Database Connection Pool
	dbPool, err := setupDatabase(cfg)
	if err != nil {
		log.Fatal().Err(err).Msg("Database connection failed")
	}
	defer dbPool.Close()

	// Run Database Migrations
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := runMigrations(ctx, dbPool); err != nil {
		log.Fatal().Err(err).Msg("Database migration failed")
	}

	// Setup Redis Client
	rdb := setupRedis(cfg)
	defer rdb.Close()

	// Initialize Repositories
	userRepo := repository.NewUserRepository(dbPool)
	accountRepo := repository.NewAccountRepository(dbPool)
	categoryRepo := repository.NewCategoryRepository(dbPool)
	txRepo := repository.NewTransactionRepository(dbPool)

	// Initialize Services
	authService := service.NewAuthService(userRepo, rdb)
	accountService := service.NewAccountService(accountRepo)
	categoryService := service.NewCategoryService(categoryRepo)
	txService := service.NewTransactionService(txRepo, accountRepo, categoryRepo)

	// Initialize Handlers
	authHandler := handler.NewAuthHandler(authService)
	accountHandler := handler.NewAccountHandler(accountService)
	categoryHandler := handler.NewCategoryHandler(categoryService)
	txHandler := handler.NewTransactionHandler(txService)

	// Initialize Gin engine
	r := gin.New()

	// Global middlewares
	r.Use(middleware.Logger())
	r.Use(middleware.CORS())
	r.Use(gin.Recovery())

	// Create uploads directory if it doesn't exist and serve static files
	uploadsDir := "/app/uploads"
	if _, err := os.Stat(uploadsDir); os.IsNotExist(err) {
		_ = os.MkdirAll(uploadsDir, os.ModePerm)
	}
	r.Static("/uploads", uploadsDir)

	// Health check functions
	dbCheck := func() bool {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		err := dbPool.Ping(ctx)
		return err == nil
	}

	redisCheck := func() bool {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_, err := rdb.Ping(ctx).Result()
		return err == nil
	}

	// API Router Group v1
	v1 := r.Group("/api/v1")
	{
		// Register health check handler
		healthHandler := handler.NewHealthHandler(dbCheck, redisCheck)
		healthHandler.RegisterRoutes(v1)

		// Register Auth handler
		authHandler.RegisterRoutes(v1)

		// Register Accounts handler
		accountHandler.RegisterRoutes(v1)

		// Register Categories handler
		categoryHandler.RegisterRoutes(v1)

		// Register Transactions handler
		txHandler.RegisterRoutes(v1)

		// Placeholder for future endpoints
		v1.GET("/placeholder", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{
				"message": "This is a placeholder for future financial planning features",
			})
		})
	}

	// Start server
	serverAddr := fmt.Sprintf(":%s", cfg.AppPort)
	log.Info().Msgf("Server is running on address %s", serverAddr)
	if err := r.Run(serverAddr); err != nil {
		log.Fatal().Err(err).Msg("Server failed to start")
	}
}

func setupDatabase(cfg *config.Config) (*pgxpool.Pool, error) {
	connStr := fmt.Sprintf("postgres://%s:%s@%s:%s/%s?sslmode=%s",
		cfg.DBUser, cfg.DBPassword, cfg.DBHost, cfg.DBPort, cfg.DBName, cfg.DBSSLMode)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	poolConfig, err := pgxpool.ParseConfig(connStr)
	if err != nil {
		return nil, err
	}

	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		return nil, err
	}

	// We ping to check connection
	if err := pool.Ping(ctx); err != nil {
		return nil, err
	}

	log.Info().Msg("Connected to PostgreSQL successfully")
	return pool, nil
}

func setupRedis(cfg *config.Config) *redis.Client {
	rdb := redis.NewClient(&redis.Options{
		Addr:     fmt.Sprintf("%s:%s", cfg.RedisHost, cfg.RedisPort),
		Password: "", // no password set
		DB:       0,  // use default DB
	})

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	_, err := rdb.Ping(ctx).Result()
	if err != nil {
		log.Warn().Err(err).Msg("Redis connection check failed, will retry on request")
	} else {
		log.Info().Msg("Connected to Redis successfully")
	}

	return rdb
}

func runMigrations(ctx context.Context, db *pgxpool.Pool) error {
	// Create table schema_migrations if not exists
	_, err := db.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version VARCHAR(255) PRIMARY KEY,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`)
	if err != nil {
		return fmt.Errorf("failed to create schema_migrations table: %w", err)
	}

	// Read up.sql migration files from directory
	files, err := os.ReadDir("migrations")
	if err != nil {
		return fmt.Errorf("failed to read migrations directory: %w", err)
	}

	var migrationFiles []string
	for _, f := range files {
		if !f.IsDir() && strings.HasSuffix(f.Name(), ".up.sql") {
			migrationFiles = append(migrationFiles, f.Name())
		}
	}
	sort.Strings(migrationFiles)

	// For each file, check if already applied, otherwise apply
	for _, filename := range migrationFiles {
		var exists bool
		err = db.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = $1)", filename).Scan(&exists)
		if err != nil {
			return fmt.Errorf("failed to check migration state for %s: %w", filename, err)
		}

		if exists {
			continue
		}

		log.Info().Msgf("Applying migration: %s", filename)
		content, err := os.ReadFile("migrations/" + filename)
		if err != nil {
			return fmt.Errorf("failed to read migration file %s: %w", filename, err)
		}

		// Execute in a transaction
		tx, err := db.Begin(ctx)
		if err != nil {
			return fmt.Errorf("failed to begin transaction: %w", err)
		}
		defer tx.Rollback(ctx)

		_, err = tx.Exec(ctx, string(content))
		if err != nil {
			return fmt.Errorf("failed to execute migration %s: %w", filename, err)
		}

		_, err = tx.Exec(ctx, "INSERT INTO schema_migrations (version) VALUES ($1)", filename)
		if err != nil {
			return fmt.Errorf("failed to log migration %s: %w", filename, err)
		}

		if err = tx.Commit(ctx); err != nil {
			return fmt.Errorf("failed to commit migration transaction %s: %w", filename, err)
		}
		log.Info().Msgf("Successfully applied migration: %s", filename)
	}

	return nil
}
