package service

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
	"github.com/redis/go-redis/v9"
	"github.com/user/financial-os/internal/config"
)

var (
	testDB    *pgxpool.Pool
	testRedis *redis.Client
	testCfg   *config.Config
)

func setupTestEnv() {
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
		panic(err)
	}

	// Always use the test database for unit & integration tests
	cfg.DBName = "financial_os_test"
	testCfg = cfg

	// Setup postgres
	connStr := fmt.Sprintf("postgres://%s:%s@%s:%s/%s?sslmode=%s",
		cfg.DBUser, cfg.DBPassword, cfg.DBHost, cfg.DBPort, cfg.DBName, cfg.DBSSLMode)
	
	ctx := context.Background()
	poolConfig, err := pgxpool.ParseConfig(connStr)
	if err != nil {
		panic(err)
	}
	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		panic(err)
	}
	if err := pool.Ping(ctx); err != nil {
		panic(err)
	}
	testDB = pool

	// Run migrations
	if err := runTestMigrations(ctx, testDB); err != nil {
		panic(err)
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
		// Also try backend/migrations
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

	// Preserve system categories but delete custom ones
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

	// Flush Redis
	err = testRedis.FlushAll(ctx).Err()
	if err != nil {
		t.Fatalf("failed to flush redis: %v", err)
	}
}
