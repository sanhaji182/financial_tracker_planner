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
	assetRepo := repository.NewAssetRepository(dbPool)
	debtRepo := repository.NewDebtRepository(dbPool)
	billRepo := repository.NewBillRepository(dbPool)
	aiSettingsRepo := repository.NewAISettingsRepository(dbPool)

	// Initialize Services
	vaultService := service.NewVaultService("/app/data")
	aiSettingsService := service.NewAISettingsService(aiSettingsRepo, vaultService)

	authService := service.NewAuthService(userRepo, rdb)
	accountService := service.NewAccountService(accountRepo)
	categoryService := service.NewCategoryService(categoryRepo)
	txService := service.NewTransactionService(txRepo, accountRepo, categoryRepo, aiSettingsService)
	assetService := service.NewAssetService(assetRepo, accountRepo)
	debtService := service.NewDebtService(debtRepo, accountRepo, categoryRepo)
	dashboardService := service.NewDashboardService(dbPool, rdb)
	sharedViewService := service.NewSharedViewService(dbPool)
	billService := service.NewBillService(dbPool, billRepo, accountRepo, categoryRepo)
	forecastService := service.NewForecastService(dbPool, rdb)
	efService := service.NewEFService(dbPool)
	investmentService := service.NewInvestmentService(dbPool)
	allocationService := service.NewAllocationService(dbPool, forecastService, efService)
	budgetService := service.NewBudgetService(dbPool)
	transferService := service.NewTransferService(dbPool)
	reconciliationService := service.NewReconciliationService(dbPool)
	closingService := service.NewClosingService(dbPool)
	dataQualityService := service.NewDataQualityService(dbPool)
	telegramService := service.NewTelegramService()
	alertService := service.NewAlertService(dbPool)
	alertGeneratorService := service.NewAlertGeneratorService(dbPool, telegramService)
	auditService := service.NewAuditService(txRepo)
	docService := service.NewDocumentService(dbPool)
	journalService := service.NewJournalService(dbPool)
	taskService := service.NewTaskService(dbPool)
	exportService := service.NewExportService(dbPool)
	backupService := service.NewBackupService(cfg)
	goalService := service.NewGoalService(dbPool)
	subService := service.NewSubscriptionService(dbPool)
	insightService := service.NewInsightService(dbPool)
	scenarioService := service.NewScenarioService(dbPool)
	currencyService := service.NewCurrencyService(dbPool)
	protectionService := service.NewProtectionService(dbPool, "/app/data")
	ruleService := service.NewAutomationRuleService(dbPool, telegramService)

	// Initialize Handlers
	authHandler := handler.NewAuthHandler(authService)
	accountHandler := handler.NewAccountHandler(accountService)
	categoryHandler := handler.NewCategoryHandler(categoryService)
	txHandler := handler.NewTransactionHandler(txService)
	assetHandler := handler.NewAssetHandler(assetService)
	debtHandler := handler.NewDebtHandler(debtService)
	dashboardHandler := handler.NewDashboardHandler(dashboardService)
	sharedViewHandler := handler.NewSharedViewHandler(sharedViewService)
	billHandler := handler.NewBillHandler(billService)
	forecastHandler := handler.NewForecastHandler(forecastService)
	efHandler := handler.NewEFHandler(efService)
	investmentHandler := handler.NewInvestmentHandler(investmentService)
	allocationHandler := handler.NewAllocationHandler(allocationService)
	budgetHandler := handler.NewBudgetHandler(budgetService)
	transferHandler := handler.NewTransferHandler(transferService)
	reconciliationHandler := handler.NewReconciliationHandler(reconciliationService)
	closingHandler := handler.NewClosingHandler(closingService)
	dataQualityHandler := handler.NewDataQualityHandler(dataQualityService)
	alertHandler := handler.NewAlertHandler(alertService)
	auditHandler := handler.NewAuditHandler(auditService)
	docHandler := handler.NewDocumentHandler(docService)
	journalHandler := handler.NewJournalHandler(journalService)
	taskHandler := handler.NewTaskHandler(taskService)
	exportHandler := handler.NewExportHandler(exportService)
	backupHandler := handler.NewBackupHandler(backupService, dbPool)
	goalHandler := handler.NewGoalHandler(goalService)
	subHandler := handler.NewSubscriptionHandler(subService)
	insightHandler := handler.NewInsightHandler(insightService)
	scenarioHandler := handler.NewScenarioHandler(scenarioService)
	currencyHandler := handler.NewCurrencyHandler(currencyService)
	ruleHandler := handler.NewAutomationRuleHandler(ruleService)
	protectionHandler := handler.NewProtectionHandler(protectionService)
	aiSettingsHandler := handler.NewAISettingsHandler(aiSettingsService, dashboardService, efService, budgetService, auditService)
	governanceHandler := handler.NewGovernanceHandler()
	jobRunner := service.NewJobRunner(rdb, "")

	// Initialize Gin engine
	r := gin.New()

	// Global middlewares
	r.Use(middleware.Logger())
	r.Use(middleware.CORS())
	r.Use(middleware.SecurityHeaders())
	r.Use(gin.Recovery())

	// Create uploads directory if it doesn't exist (NO static file exposure)
	uploadsDir := "/app/uploads"
	dataDir := "/app/data"
	if _, err := os.Stat(uploadsDir); os.IsNotExist(err) {
		_ = os.MkdirAll(uploadsDir, os.ModePerm)
	}
	if _, err := os.Stat(dataDir); os.IsNotExist(err) {
		_ = os.MkdirAll(dataDir, os.ModePerm)
	}
	// SECURITY: Do NOT expose /uploads as static route.
	// All document downloads go through authenticated /documents/:id/download endpoint.

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
	v1.Use(middleware.DashboardCacheInvalidator(rdb))
	{
		// Register health check handler
		healthHandler := handler.NewHealthHandler(dbCheck, redisCheck, cfg.BuildVersion, cfg.BuildSHA)
		healthHandler.RegisterRoutes(v1)

		// Auth routes — rate limited (login/register/refresh brute-force protection)
		authGroup := v1.Group("/auth")
		authGroup.Use(middleware.RateLimit(30))
		authHandler.RegisterRoutes(authGroup)

		// Register Accounts handler
		accountHandler.RegisterRoutes(v1)

		// Register Categories handler
		categoryHandler.RegisterRoutes(v1)

		// Register Transactions handler
		txHandler.RegisterRoutes(v1)

		// Register Assets handler
		assetHandler.RegisterRoutes(v1)

		// Register Debts handler
		debtHandler.RegisterRoutes(v1)

		// Register Dashboard handler
		dashboardHandler.RegisterRoutes(v1)

		// Register Data Quality Center
		dataQualityHandler.RegisterRoutes(v1)

		// Register SharedView handler
		sharedViewHandler.RegisterRoutes(v1)

		// Register Bills handler
		billHandler.RegisterRoutes(v1)

		// Register Forecast handler
		forecastHandler.RegisterRoutes(v1)

		// Register EF & Investment handler
		efHandler.RegisterRoutes(v1)
		investmentHandler.RegisterRoutes(v1)

		// Register Allocation handler
		allocationHandler.RegisterRoutes(v1)

		// Register Budget handler
		budgetHandler.RegisterRoutes(v1)

		// Register Transfer handler
		transferHandler.RegisterRoutes(v1)

		// Register Reconciliation & Monthly Closing handler
		reconciliationHandler.RegisterRoutes(v1)
		closingHandler.RegisterRoutes(v1)

		// Register Alert handler
		alertHandler.RegisterRoutes(v1)

		// Register Audit handler
		auditHandler.RegisterRoutes(v1)

		// Register Document handler
		docHandler.RegisterRoutes(v1)

		// Register Journal, Task, Export, and Backup handlers
		journalHandler.RegisterRoutes(v1)
		taskHandler.RegisterRoutes(v1)
		exportHandler.RegisterRoutes(v1)
		backupHandler.RegisterRoutes(v1)
		goalHandler.RegisterRoutes(v1)
		subHandler.RegisterRoutes(v1)
		insightHandler.RegisterRoutes(v1)
		scenarioHandler.RegisterRoutes(v1)
		currencyHandler.RegisterRoutes(v1)
		ruleHandler.RegisterRoutes(v1)
		protectionHandler.RegisterRoutes(v1)
		aiSettingsHandler.RegisterRoutes(v1)
		governanceHandler.RegisterRoutes(v1)

		// Placeholder for future endpoints
		v1.GET("/placeholder", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{
				"message": "This is a placeholder for future financial planning features",
			})
		})
	}

	// Start background cron job for auto-updating bills status to overdue
	go func() {
		ticker := time.NewTicker(24 * time.Hour)
		defer ticker.Stop()
		for {
			log.Info().Msg("Running daily background auto status update for bills...")
			idem := time.Now().UTC().Format("2006-01-02")
			if _, err := jobRunner.Run(context.Background(), "bills_auto_overdue", idem, func(ctx context.Context) error {
				return billService.AutoUpdateStatus(ctx)
			}); err != nil {
				log.Error().Err(err).Msg("Failed to run auto status update for bills")
			}

			select {
			case <-ticker.C:
				// continue loop
			}
		}
	}()

	// Start background cron job for alert generation (every 6 hours)
	go func() {
		// Run immediately on startup
		log.Info().Msg("Running initial alert generation...")
		idem := time.Now().UTC().Format("2006-01-02-15")
		if _, err := jobRunner.Run(context.Background(), "alert_generate", idem, func(ctx context.Context) error {
			return alertGeneratorService.GenerateAlertsForAllUsers(ctx)
		}); err != nil {
			log.Error().Err(err).Msg("Initial alert generation failed")
		}

		ticker := time.NewTicker(6 * time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				log.Info().Msg("Running 6h alert generation cron...")
				idem := time.Now().UTC().Format("2006-01-02-15")
				if _, err := jobRunner.Run(context.Background(), "alert_generate", idem, func(ctx context.Context) error {
					return alertGeneratorService.GenerateAlertsForAllUsers(ctx)
				}); err != nil {
					log.Error().Err(err).Msg("Failed to run alert generation")
				}
			}
		}
	}()

	// Start background cron job for task checklists auto-overdue check (every 1 hour)
	go func() {
		// Run immediately on startup
		log.Info().Msg("Running initial task overdue check...")
		idem := time.Now().UTC().Format("2006-01-02-15")
		if _, err := jobRunner.Run(context.Background(), "tasks_auto_overdue", idem, func(ctx context.Context) error {
			affected, err := taskService.RunAutoOverdue(ctx)
			if err != nil {
				return err
			}
			if affected > 0 {
				log.Info().Msgf("Initial task overdue check marked %d tasks as overdue", affected)
			}
			return nil
		}); err != nil {
			log.Error().Err(err).Msg("Initial task overdue check failed")
		}

		ticker := time.NewTicker(1 * time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				log.Info().Msg("Running hourly task overdue check...")
				idem := time.Now().UTC().Format("2006-01-02-15")
				if _, err := jobRunner.Run(context.Background(), "tasks_auto_overdue", idem, func(ctx context.Context) error {
					affected, err := taskService.RunAutoOverdue(ctx)
					if err != nil {
						return err
					}
					if affected > 0 {
						log.Info().Msgf("Hourly task overdue check marked %d tasks as overdue", affected)
					}
					return nil
				}); err != nil {
					log.Error().Err(err).Msg("Failed to run task overdue check")
				}
			}
		}
	}()

	// Start background cron job for automation rules evaluation (every 24 hours)
	go func() {
		// Run immediately on startup
		log.Info().Msg("Running initial automation rules evaluation...")
		idem := time.Now().UTC().Format("2006-01-02")
		if _, err := jobRunner.Run(context.Background(), "automation_rules", idem, func(ctx context.Context) error {
			return ruleService.EvaluateRules(ctx)
		}); err != nil {
			log.Error().Err(err).Msg("Initial automation rules evaluation failed")
		}

		ticker := time.NewTicker(24 * time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				log.Info().Msg("Running 24h automation rules evaluation cron...")
				idem := time.Now().UTC().Format("2006-01-02")
				if _, err := jobRunner.Run(context.Background(), "automation_rules", idem, func(ctx context.Context) error {
					return ruleService.EvaluateRules(ctx)
				}); err != nil {
					log.Error().Err(err).Msg("Failed to run automation rules evaluation")
				}
			}
		}
	}()

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
		Password: cfg.RedisPassword,
		DB:       0, // use default DB
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
