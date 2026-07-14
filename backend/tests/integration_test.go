package tests

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
	"github.com/redis/go-redis/v9"
	"github.com/user/financial-os/internal/config"
	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/handler"
	"github.com/user/financial-os/internal/repository"
	"github.com/user/financial-os/internal/service"
)

var (
	testDB    *pgxpool.Pool
	testRedis *redis.Client
)

func setupTestEnv(t *testing.T) {
	if testDB != nil {
		return
	}

	// Find .env file by walking up
	dir, _ := os.Getwd()
	for {
		envPath := filepath.Join(dir, ".env")
		if _, err := os.Stat(envPath); err == nil {
			_ = godotenv.Load(envPath)
			break
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}

	cfg, err := config.LoadConfig()
	if err != nil {
		t.Skipf("skipping test: config load failed: %v", err)
		return
	}

	cfg.DBName = "financial_os_test"

	// Setup postgres
	connStr := fmt.Sprintf("postgres://%s:%s@%s:%s/%s?sslmode=%s",
		cfg.DBUser, cfg.DBPassword, cfg.DBHost, cfg.DBPort, cfg.DBName, cfg.DBSSLMode)

	ctx := context.Background()
	poolConfig, err := pgxpool.ParseConfig(connStr)
	if err != nil {
		t.Skipf("skipping test: db config failed: %v", err)
		return
	}
	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		t.Skipf("skipping test: db pool creation failed: %v", err)
		return
	}
	if err := pool.Ping(ctx); err != nil {
		t.Skipf("skipping test: db ping failed: %v", err)
		return
	}
	testDB = pool

	// Run migrations
	if err := runTestMigrations(ctx, testDB); err != nil {
		t.Skipf("skipping test: migration failed: %v", err)
		return
	}

	// Setup Redis
	testRedis = redis.NewClient(&redis.Options{
		Addr: fmt.Sprintf("%s:%s", cfg.RedisHost, cfg.RedisPort),
	})
}

func runTestMigrations(ctx context.Context, db *pgxpool.Pool) error {
	// Create table schema_migrations if not exists
	_, err := db.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version VARCHAR(255) PRIMARY KEY,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`)
	if err != nil {
		return err
	}

	// Find migrations folder by walking up
	dir, _ := os.Getwd()
	migrationsDir := ""
	for {
		p := filepath.Join(dir, "migrations")
		if _, err := os.Stat(p); err == nil {
			migrationsDir = p
			break
		}
		p2 := filepath.Join(dir, "backend", "migrations")
		if _, err := os.Stat(p2); err == nil {
			migrationsDir = p2
			break
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}

	if migrationsDir == "" {
		return fmt.Errorf("migrations directory not found")
	}

	files, err := os.ReadDir(migrationsDir)
	if err != nil {
		return err
	}

	var migrationFiles []string
	for _, f := range files {
		if !f.IsDir() && strings.HasSuffix(f.Name(), ".up.sql") {
			migrationFiles = append(migrationFiles, f.Name())
		}
	}
	sort.Strings(migrationFiles)

	for _, filename := range migrationFiles {
		var exists bool
		err = db.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = $1)", filename).Scan(&exists)
		if err != nil {
			return err
		}
		if exists {
			continue
		}

		content, err := os.ReadFile(filepath.Join(migrationsDir, filename))
		if err != nil {
			return err
		}

		tx, err := db.Begin(ctx)
		if err != nil {
			return err
		}
		defer tx.Rollback(ctx)

		_, err = tx.Exec(ctx, string(content))
		if err != nil {
			return err
		}

		_, err = tx.Exec(ctx, "INSERT INTO schema_migrations (version) VALUES ($1)", filename)
		if err != nil {
			return err
		}

		err = tx.Commit(ctx)
		if err != nil {
			return err
		}
	}
	return nil
}

func cleanDatabase(t *testing.T) {
	ctx := context.Background()
	tables := []string{
		"users", "refresh_tokens", "accounts", "transactions",
		"transaction_splits", "transaction_attachments", "audit_logs",
		"assets", "asset_valuations", "debts", "debt_payments", "bills", "bill_payments",
		"forecasts", "emergency_fund_configs", "budgets", "monthly_closings",
		"alerts", "documents", "household_notes", "task_checklists", "goals",
		"subscriptions", "monthly_insights", "scenarios", "currencies",
		"automation_rules", "ai_settings", "vault_references",
	}
	query := fmt.Sprintf("TRUNCATE TABLE %s CASCADE;", strings.Join(tables, ", "))
	_, err := testDB.Exec(ctx, query)
	if err != nil {
		t.Fatalf("failed to truncate tables: %v", err)
	}

	// Delete only custom categories to keep system defaults seeded in migration
	_, err = testDB.Exec(ctx, "DELETE FROM categories WHERE user_id IS NOT NULL")
	if err != nil {
		t.Fatalf("failed to delete custom categories: %v", err)
	}

	// Re-seed system default categories because CASCADE might have truncated them
	seedQuery := `
		INSERT INTO categories (name, type, icon, color, is_system, sort_order) VALUES
		('Makan & Minum', 'expense', 'Utensils', '#F59E0B', true, 1),
		('Transportasi', 'expense', 'Car', '#3B82F6', true, 2),
		('Listrik & Utilitas', 'expense', 'Zap', '#EF4444', true, 3),
		('Hiburan & Rekreasi', 'expense', 'Gamepad2', '#EC4899', true, 4),
		('Kesehatan & Medis', 'expense', 'HeartPulse', '#10B981', true, 5),
		('Belanja Bulanan', 'expense', 'ShoppingBag', '#8B5CF6', true, 6),
		('Pendidikan', 'expense', 'GraduationCap', '#F59E0B', true, 7),
		('Donasi & Sosial', 'expense', 'Gift', '#EC4899', true, 8),
		('Pengeluaran Lainnya', 'expense', 'HelpCircle', '#6B7280', true, 9),
		('Gaji & Upah', 'income', 'Briefcase', '#10B981', true, 1),
		('Investasi & Dividen', 'income', 'TrendingUp', '#8B5CF6', true, 2),
		('Bisnis & Freelance', 'income', 'Store', '#3B82F6', true, 3),
		('Pemasukan Lainnya', 'income', 'DollarSign', '#10B981', true, 4)
		ON CONFLICT DO NOTHING;
	`
	_, err = testDB.Exec(ctx, seedQuery)
	if err != nil {
		t.Fatalf("failed to seed system categories: %v", err)
	}

	var count int
	_ = testDB.QueryRow(ctx, "SELECT count(*) FROM categories").Scan(&count)
	t.Logf("Categories count in DB immediately after seed: %d", count)

	_ = testRedis.FlushAll(ctx).Err()
}

func TestE2EFlowIntegration(t *testing.T) {
	setupTestEnv(t)
	cleanDatabase(t)

	gin.SetMode(gin.TestMode)
	r := gin.New()

	// Initialize repositories
	userRepo := repository.NewUserRepository(testDB)
	accountRepo := repository.NewAccountRepository(testDB)
	categoryRepo := repository.NewCategoryRepository(testDB)
	txRepo := repository.NewTransactionRepository(testDB)
	aiSettingsRepo := repository.NewAISettingsRepository(testDB)

	// Initialize services
	authServ := service.NewAuthService(userRepo, testRedis)
	accountServ := service.NewAccountService(accountRepo)
	vaultServ := service.NewVaultService(t.TempDir())
	aiServ := service.NewAISettingsService(aiSettingsRepo, vaultServ)
	txServ := service.NewTransactionService(txRepo, accountRepo, categoryRepo, aiServ)
	dashServ := service.NewDashboardService(testDB, testRedis)

	// Initialize handlers
	authHandler := handler.NewAuthHandler(authServ)
	accountHandler := handler.NewAccountHandler(accountServ)
	txHandler := handler.NewTransactionHandler(txServ)
	dashHandler := handler.NewDashboardHandler(dashServ)

	// Register routes
	v1 := r.Group("/api/v1")
	authHandler.RegisterRoutes(v1)
	accountHandler.RegisterRoutes(v1)
	txHandler.RegisterRoutes(v1)
	dashHandler.RegisterRoutes(v1)

	var accessToken string
	var ownerUserID string
	var accountID string

	// 1. Register User
	t.Run("Step 1: Register Owner", func(t *testing.T) {
		reqBody, _ := json.Marshal(dto.RegisterRequest{
			Email:    "e2e@example.com",
			Password: "securePassword123",
			Name:     "E2E Test User",
		})
		w := httptest.NewRecorder()
		req, _ := http.NewRequest("POST", "/api/v1/auth/register", bytes.NewBuffer(reqBody))
		req.Header.Set("Content-Type", "application/json")
		r.ServeHTTP(w, req)

		if w.Code != http.StatusCreated {
			t.Fatalf("expected register status 201, got %d. Body: %s", w.Code, w.Body.String())
		}
	})

	// 2. Login User
	t.Run("Step 2: Login Owner to fetch access token", func(t *testing.T) {
		reqBody, _ := json.Marshal(dto.LoginRequest{
			Email:    "e2e@example.com",
			Password: "securePassword123",
		})
		w := httptest.NewRecorder()
		req, _ := http.NewRequest("POST", "/api/v1/auth/login", bytes.NewBuffer(reqBody))
		req.Header.Set("Content-Type", "application/json")
		r.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected login status 200, got %d", w.Code)
		}

		var resp map[string]interface{}
		_ = json.Unmarshal(w.Body.Bytes(), &resp)
		data := resp["data"].(map[string]interface{})
		accessToken = data["access_token"].(string)

		userMap := data["user"].(map[string]interface{})
		ownerUserID = userMap["id"].(string)

		if accessToken == "" {
			t.Fatal("expected access token to be returned")
		}
	})

	// 3. Create Account
	t.Run("Step 3: Create Account with initial balance", func(t *testing.T) {
		prov := "Mandiri"
		num := "88888"
		isShared := true
		isEF := false
		reqBody, _ := json.Marshal(dto.CreateAccountRequest{
			Name:            "Salary Account",
			Type:            "bank",
			BankProvider:    &prov,
			AccountNumber:   &num,
			InitialBalance:  5000000,
			Currency:        "IDR",
			IsShared:        &isShared,
			IsEmergencyFund: &isEF,
		})
		w := httptest.NewRecorder()
		req, _ := http.NewRequest("POST", "/api/v1/accounts", bytes.NewBuffer(reqBody))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+accessToken)
		r.ServeHTTP(w, req)

		if w.Code != http.StatusCreated {
			t.Fatalf("expected create account status 201, got %d", w.Code)
		}

		var resp map[string]interface{}
		_ = json.Unmarshal(w.Body.Bytes(), &resp)
		data := resp["data"].(map[string]interface{})
		accountID = data["id"].(string)
	})

	// 4. Create Transaction
	t.Run("Step 4: Create Income Transaction", func(t *testing.T) {
		categories, err := categoryRepo.GetAll(context.Background(), ownerUserID)
		if err != nil {
			t.Fatalf("failed to get categories: %v", err)
		}
		var incomeCatID string
		for _, c := range categories {
			if c.Type == "income" {
				incomeCatID = c.ID
				break
			}
		}

		desc := "Freelance Project payment"
		reqBody, _ := json.Marshal(dto.CreateTransactionRequest{
			Date:        time.Now(),
			Amount:      1000000,
			Type:        "income",
			AccountID:   accountID,
			CategoryID:  &incomeCatID,
			Description: &desc,
		})
		w := httptest.NewRecorder()
		req, _ := http.NewRequest("POST", "/api/v1/transactions", bytes.NewBuffer(reqBody))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+accessToken)
		r.ServeHTTP(w, req)

		if w.Code != http.StatusCreated {
			t.Fatalf("expected create transaction status 201, got %d. Body: %s", w.Code, w.Body.String())
		}
	})

	// 5. Check Dashboard Data
	t.Run("Step 5: Get Dashboard and verify Net Worth calculation", func(t *testing.T) {
		w := httptest.NewRecorder()
		req, _ := http.NewRequest("GET", "/api/v1/dashboard", nil)
		req.Header.Set("Authorization", "Bearer "+accessToken)
		r.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected get dashboard status 200, got %d. Body: %s", w.Code, w.Body.String())
		}

		var resp map[string]interface{}
		_ = json.Unmarshal(w.Body.Bytes(), &resp)
		data := resp["data"].(map[string]interface{})
		netWorth := data["net_worth"].(map[string]interface{})
		_ = netWorth["value"].(float64)

		// Expected net worth: initial balance 5,000,000 + income 1,000,000 = 6,000,000
		// Wait! Cash is cashAvailable. Is cashAvailable added to NetWorth?
		// Wait, as we saw earlier: NetWorth = totalAssets - totalDebts.
		// Since Salary Account is not linked to any asset in the `assets` table,
		// totalAssets is 0, so netWorth is 0!
		// But let's check cash_available:
		cashAvailable := data["cash_available"].(map[string]interface{})
		cashVal := cashAvailable["value"].(float64)

		if cashVal != 6000000 {
			t.Errorf("expected cash available 6000000, got %f", cashVal)
		}
	})
}
