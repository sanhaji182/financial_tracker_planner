# P3: Product Analytics & Forecast Accuracy

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement analytics tracking to measure forecast accuracy, data quality, and user activation metrics.

**Architecture:** New `analytics_events` table for event tracking, analytics service for calculations, handler for API endpoints. Integrates with existing closing service to compare forecast vs actual.

**Tech Stack:** Go (backend), PostgreSQL (new table), REST API

## Global Constraints

- Schema migration for `analytics_events` table
- Event types follow naming convention: `entity.action`
- Forecast accuracy calculated during monthly closing
- Data quality report aggregates from multiple tables
- `go build ./...` must pass after each task

---

### Task 1: Create Schema Migration

**Files:**
- Create: `backend/migrations/000022_create_analytics_events.up.sql`
- Create: `backend/migrations/000022_create_analytics_events.down.sql`

- [ ] **Step 1: Create up migration**

```sql
-- backend/migrations/000022_create_analytics_events.up.sql
CREATE TABLE IF NOT EXISTS analytics_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_type VARCHAR(100) NOT NULL,
    event_data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_user ON analytics_events(user_id);
CREATE INDEX IF NOT EXISTS idx_analytics_type ON analytics_events(event_type);
CREATE INDEX IF NOT EXISTS idx_analytics_created ON analytics_events(created_at);
```

- [ ] **Step 2: Create down migration**

```sql
-- backend/migrations/000022_create_analytics_events.down.sql
DROP TABLE IF EXISTS analytics_events;
```

- [ ] **Step 3: Commit**

```bash
cd /Volumes/Backup/php/financial_planning
git add backend/migrations/000022_*
git commit -m "feat(db): add analytics_events table migration"
```

---

### Task 2: Create Analytics Event Types and DTOs

**Files:**
- Create: `backend/internal/analytics/events.go`
- Create: `backend/internal/dto/analytics.go`

**Interfaces:**
- Produces: Event type constants, response DTOs

- [ ] **Step 1: Create event type constants**

```go
// backend/internal/analytics/events.go
package analytics

// Event type constants for analytics tracking
const (
	EventForecastGenerated  = "forecast.generated"
	EventForecastAccuracy   = "forecast.accuracy"
	EventReconciliationDone = "reconciliation.done"
	EventGoalCreated        = "goal.created"
	EventGoalContributed    = "goal.contributed"
	EventAllocationFollowed = "allocation.followed"
	EventProtectionAssessed = "protection.assessed"
	EventRetirementAssessed = "retirement.assessed"
	EventDataQualityChecked = "data_quality.checked"
	EventOnboardingCompleted = "onboarding.completed"
)
```

- [ ] **Step 2: Create analytics DTOs**

```go
// backend/internal/dto/analytics.go
package dto

type ForecastAccuracyReport struct {
	Month              string  `json:"month"`
	ForecastIncome     float64 `json:"forecast_income"`
	ActualIncome       float64 `json:"actual_income"`
	ForecastExpense    float64 `json:"forecast_expense"`
	ActualExpense      float64 `json:"actual_expense"`
	ForecastEndBalance float64 `json:"forecast_end_balance"`
	ActualEndBalance   float64 `json:"actual_end_balance"`
	IncomeAccuracy     float64 `json:"income_accuracy"`   // 0-100
	ExpenseAccuracy    float64 `json:"expense_accuracy"`   // 0-100
	BalanceAccuracy    float64 `json:"balance_accuracy"`   // 0-100
}

type DataQualityReport struct {
	LastReconciliationAgeDays int    `json:"last_reconciliation_age_days"`
	UncategorizedTransactions int    `json:"uncategorized_transactions"`
	StaleAssetValuations      int    `json:"stale_asset_valuations"`
	MissingRecurringIncome    bool   `json:"missing_recurring_income"`
	MissingInterestRates      int    `json:"missing_interest_rates"`
	SuspectedDuplicates       int    `json:"suspected_duplicates"`
	OCRPendingReview          int    `json:"ocr_pending_review"`
	QualityScore              int    `json:"quality_score"` // 0-100
}

type ActivationMetrics struct {
	TotalUsers               int     `json:"total_users"`
	UsersWithForecast        int     `json:"users_with_forecast"`
	UsersWithReconciliation  int     `json:"users_with_reconciliation"`
	UsersWithGoals           int     `json:"users_with_goals"`
	ActivationRate           float64 `json:"activation_rate"`
	AvgDaysToFirstForecast   float64 `json:"avg_days_to_first_forecast"`
}

type AnalyticsEventResponse struct {
	ID        string                 `json:"id"`
	UserID    string                 `json:"user_id"`
	EventType string                 `json:"event_type"`
	EventData map[string]interface{} `json:"event_data"`
	CreatedAt string                 `json:"created_at"`
}
```

- [ ] **Step 3: Commit**

```bash
cd /Volumes/Backup/php/financial_planning
git add backend/internal/analytics/events.go backend/internal/dto/analytics.go
git commit -m "feat(dto): add analytics event types and response DTOs"
```

---

### Task 3: Create Analytics Repository

**Files:**
- Create: `backend/internal/repository/analytics_repo.go`

**Interfaces:**
- Produces: `AnalyticsRepository` with event tracking and querying

- [ ] **Step 1: Create repository**

```go
// backend/internal/repository/analytics_repo.go
package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type AnalyticsRepository interface {
	TrackEvent(ctx context.Context, userID, eventType string, data map[string]interface{}) error
	GetEventsByUser(ctx context.Context, userID string, eventType string, since time.Time) ([]AnalyticsEvent, error)
	GetForecastAccuracyData(ctx context.Context, userID string, month string) (*ForecastComparison, error)
}

type AnalyticsEvent struct {
	ID        string
	UserID    string
	EventType string
	EventData map[string]interface{}
	CreatedAt time.Time
}

type ForecastComparison struct {
	Month              string
	ForecastIncome     float64
	ActualIncome       float64
	ForecastExpense    float64
	ActualExpense      float64
	ForecastEndBalance float64
	ActualEndBalance   float64
}

type analyticsRepository struct {
	db *pgxpool.Pool
}

func NewAnalyticsRepository(db *pgxpool.Pool) AnalyticsRepository {
	return &analyticsRepository{db: db}
}

func (r *analyticsRepository) TrackEvent(ctx context.Context, userID, eventType string, data map[string]interface{}) error {
	dataJSON, err := json.Marshal(data)
	if err != nil {
		return fmt.Errorf("failed to marshal event data: %w", err)
	}
	
	_, err = r.db.Exec(ctx, `
		INSERT INTO analytics_events (user_id, event_type, event_data)
		VALUES ($1, $2, $3)
	`, userID, eventType, string(dataJSON))
	
	return err
}

func (r *analyticsRepository) GetEventsByUser(ctx context.Context, userID string, eventType string, since time.Time) ([]AnalyticsEvent, error) {
	rows, err := r.db.Query(ctx, `
		SELECT id, user_id, event_type, event_data, created_at
		FROM analytics_events
		WHERE user_id = $1 AND event_type = $2 AND created_at >= $3
		ORDER BY created_at DESC
	`, userID, eventType, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	
	var events []AnalyticsEvent
	for rows.Next() {
		var e AnalyticsEvent
		var dataBytes []byte
		if err := rows.Scan(&e.ID, &e.UserID, &e.EventType, &dataBytes, &e.CreatedAt); err != nil {
			continue
		}
		json.Unmarshal(dataBytes, &e.EventData)
		events = append(events, e)
	}
	
	return events, nil
}

func (r *analyticsRepository) GetForecastAccuracyData(ctx context.Context, userID string, month string) (*ForecastComparison, error) {
	// This would query forecast and actual data from monthly closings
	// Simplified implementation
	comp := &ForecastComparison{
		Month: month,
	}
	
	// Get forecast data
	err := r.db.QueryRow(ctx, `
		SELECT COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0),
		       COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0)
		FROM forecasts
		WHERE user_id = $1 AND month = $2
	`, userID, month).Scan(&comp.ForecastIncome, &comp.ForecastExpense)
	if err != nil {
		// No forecast data
	}
	
	// Get actual data from transactions
	err = r.db.QueryRow(ctx, `
		SELECT COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0),
		       COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0)
		FROM transactions
		WHERE user_id = $1 AND to_char(date, 'YYYY-MM') = $2 AND deleted_at IS NULL
	`, userID, month).Scan(&comp.ActualIncome, &comp.ActualExpense)
	if err != nil {
		// No actual data
	}
	
	return comp, nil
}
```

- [ ] **Step 2: Commit**

```bash
cd /Volumes/Backup/php/financial_planning
git add backend/internal/repository/analytics_repo.go
git commit -m "feat(repo): add AnalyticsRepository for event tracking"
```

---

### Task 4: Create Analytics Service

**Files:**
- Create: `backend/internal/service/analytics_service.go`
- Create: `backend/internal/service/analytics_service_test.go`

**Interfaces:**
- Produces: `AnalyticsService` with tracking, accuracy, and quality methods

- [ ] **Step 1: Create analytics service**

```go
// backend/internal/service/analytics_service.go
package service

import (
	"context"
	"math"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/user/financial-os/internal/analytics"
	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/repository"
)

type AnalyticsService interface {
	TrackEvent(ctx context.Context, userID string, eventType string, data map[string]interface{}) error
	GetForecastAccuracy(ctx context.Context, userID string, month string) (*dto.ForecastAccuracyReport, error)
	GetDataQualityReport(ctx context.Context, userID string) (*dto.DataQualityReport, error)
	GetActivationMetrics(ctx context.Context) (*dto.ActivationMetrics, error)
}

type analyticsService struct {
	db   *pgxpool.Pool
	repo repository.AnalyticsRepository
}

func NewAnalyticsService(db *pgxpool.Pool, repo repository.AnalyticsRepository) AnalyticsService {
	return &analyticsService{db: db, repo: repo}
}

func (s *analyticsService) TrackEvent(ctx context.Context, userID string, eventType string, data map[string]interface{}) error {
	return s.repo.TrackEvent(ctx, userID, eventType, data)
}

func (s *analyticsService) GetForecastAccuracy(ctx context.Context, userID string, month string) (*dto.ForecastAccuracyReport, error) {
	comp, err := s.repo.GetForecastAccuracyData(ctx, userID, month)
	if err != nil {
		return nil, err
	}
	
	// Calculate accuracy percentages
	calculateAccuracy := func(forecast, actual float64) float64 {
		if forecast == 0 && actual == 0 {
			return 100
		}
		if forecast == 0 {
			return 0
		}
		diff := math.Abs(forecast - actual)
		accuracy := (1 - diff/forecast) * 100
		if accuracy < 0 {
			accuracy = 0
		}
		return math.Round(accuracy*100) / 100
	}
	
	report := &dto.ForecastAccuracyReport{
		Month:              comp.Month,
		ForecastIncome:     comp.ForecastIncome,
		ActualIncome:       comp.ActualIncome,
		ForecastExpense:    comp.ForecastExpense,
		ActualExpense:      comp.ActualExpense,
		ForecastEndBalance: comp.ForecastEndBalance,
		ActualEndBalance:   comp.ActualEndBalance,
		IncomeAccuracy:     calculateAccuracy(comp.ForecastIncome, comp.ActualIncome),
		ExpenseAccuracy:    calculateAccuracy(comp.ForecastExpense, comp.ActualExpense),
		BalanceAccuracy:    calculateAccuracy(comp.ForecastEndBalance, comp.ActualEndBalance),
	}
	
	// Track this accuracy check event
	s.TrackEvent(ctx, userID, analytics.EventForecastAccuracy, map[string]interface{}{
		"month": month,
		"income_accuracy": report.IncomeAccuracy,
		"expense_accuracy": report.ExpenseAccuracy,
	})
	
	return report, nil
}

func (s *analyticsService) GetDataQualityReport(ctx context.Context, userID string) (*dto.DataQualityReport, error) {
	report := &dto.DataQualityReport{}
	
	// Last reconciliation age
	var lastRecon *time.Time
	err := s.db.QueryRow(ctx, `
		SELECT MAX(created_at) FROM reconciliations WHERE user_id = $1
	`, userID).Scan(&lastRecon)
	if err == nil && lastRecon != nil {
		report.LastReconciliationAgeDays = int(time.Since(*lastRecon).Hours() / 24)
	} else {
		report.LastReconciliationAgeDays = 999 // Never reconciled
	}
	
	// Uncategorized transactions
	s.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM transactions 
		WHERE user_id = $1 AND category_id IS NULL AND deleted_at IS NULL
	`, userID).Scan(&report.UncategorizedTransactions)
	
	// Stale asset valuations (> 90 days)
	s.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM assets 
		WHERE user_id = $1 AND updated_at < NOW() - INTERVAL '90 days' AND deleted_at IS NULL
	`, userID).Scan(&report.StaleAssetValuations)
	
	// Missing interest rates on debts
	s.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM debts 
		WHERE user_id = $1 AND interest_rate IS NULL AND status = 'active' AND deleted_at IS NULL
	`, userID).Scan(&report.MissingInterestRates)
	
	// Calculate quality score (0-100)
	score := 100
	if report.LastReconciliationAgeDays > 30 {
		score -= 20
	}
	if report.LastReconciliationAgeDays > 90 {
		score -= 20
	}
	if report.UncategorizedTransactions > 10 {
		score -= 15
	}
	if report.StaleAssetValuations > 0 {
		score -= 10
	}
	if report.MissingInterestRates > 0 {
		score -= 10
	}
	if score < 0 {
		score = 0
	}
	report.QualityScore = score
	
	// Track this quality check
	s.TrackEvent(ctx, userID, analytics.EventDataQualityChecked, map[string]interface{}{
		"quality_score": score,
	})
	
	return report, nil
}

func (s *analyticsService) GetActivationMetrics(ctx context.Context) (*dto.ActivationMetrics, error) {
	metrics := &dto.ActivationMetrics{}
	
	// Total users
	s.db.QueryRow(ctx, `SELECT COUNT(*) FROM users`).Scan(&metrics.TotalUsers)
	
	// Users with forecasts
	s.db.QueryRow(ctx, `SELECT COUNT(DISTINCT user_id) FROM forecasts`).Scan(&metrics.UsersWithForecast)
	
	// Users with reconciliations
	s.db.QueryRow(ctx, `SELECT COUNT(DISTINCT user_id) FROM reconciliations`).Scan(&metrics.UsersWithReconciliation)
	
	// Users with goals
	s.db.QueryRow(ctx, `SELECT COUNT(DISTINCT user_id) FROM goals`).Scan(&metrics.UsersWithGoals)
	
	// Activation rate
	if metrics.TotalUsers > 0 {
		metrics.ActivationRate = float64(metrics.UsersWithForecast) / float64(metrics.TotalUsers) * 100
	}
	
	// Avg days to first forecast
	s.db.QueryRow(ctx, `
		SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (f.created_at - u.created_at)) / 86400), 0)
		FROM forecasts f
		JOIN users u ON f.user_id = u.id
	`).Scan(&metrics.AvgDaysToFirstForecast)
	
	return metrics, nil
}
```

- [ ] **Step 2: Verify build**

Run: `cd /Volumes/Backup/php/financial_planning/backend && go build ./...`

- [ ] **Step 3: Commit**

```bash
cd /Volumes/Backup/php/financial_planning
git add backend/internal/service/analytics_service.go
git commit -m "feat(service): implement analytics service with forecast accuracy and data quality"
```

---

### Task 5: Create Analytics Handler

**Files:**
- Create: `backend/internal/handler/analytics_handler.go`

**Interfaces:**
- Produces: `GET /analytics/forecast-accuracy`, `GET /analytics/data-quality`, `GET /analytics/activation` endpoints

- [ ] **Step 1: Create handler**

```go
// backend/internal/handler/analytics_handler.go
package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/user/financial-os/internal/service"
)

type AnalyticsHandler struct {
	analyticsService service.AnalyticsService
}

func NewAnalyticsHandler(analyticsService service.AnalyticsService) *AnalyticsHandler {
	return &AnalyticsHandler{analyticsService: analyticsService}
}

func (h *AnalyticsHandler) RegisterRoutes(rg *gin.RouterGroup) {
	analytics := rg.Group("/analytics")
	{
		analytics.GET("/forecast-accuracy", h.GetForecastAccuracy)
		analytics.GET("/data-quality", h.GetDataQuality)
		analytics.GET("/activation", h.GetActivationMetrics)
	}
}

func (h *AnalyticsHandler) GetForecastAccuracy(c *gin.Context) {
	userID := c.GetString("userID")
	month := c.Query("month")
	
	if month == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "month parameter required (YYYY-MM)"})
		return
	}
	
	report, err := h.analyticsService.GetForecastAccuracy(c.Request.Context(), userID, month)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	
	c.JSON(http.StatusOK, report)
}

func (h *AnalyticsHandler) GetDataQuality(c *gin.Context) {
	userID := c.GetString("userID")
	
	report, err := h.analyticsService.GetDataQualityReport(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	
	c.JSON(http.StatusOK, report)
}

func (h *AnalyticsHandler) GetActivationMetrics(c *gin.Context) {
	// This endpoint might be admin-only in production
	metrics, err := h.analyticsService.GetActivationMetrics(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	
	c.JSON(http.StatusOK, metrics)
}
```

- [ ] **Step 2: Verify build**

Run: `cd /Volumes/Backup/php/financial_planning/backend && go build ./...`

- [ ] **Step 3: Commit**

```bash
cd /Volumes/Backup/php/financial_planning
git add backend/internal/handler/analytics_handler.go
git commit -m "feat(handler): add analytics endpoints"
```

---

### Task 6: Wire into main.go

**Files:**
- Modify: `backend/cmd/server/main.go`

- [ ] **Step 1: Add analytics module initialization**

```go
// In main.go, after other repository initializations:
analyticsRepo := repository.NewAnalyticsRepository(dbPool)

// After other service initializations:
analyticsService := service.NewAnalyticsService(dbPool, analyticsRepo)

// After other handler initializations:
analyticsHandler := handler.NewAnalyticsHandler(analyticsService)

// In route registration section:
analyticsHandler.RegisterRoutes(v1)
```

- [ ] **Step 2: Verify build**

Run: `cd /Volumes/Backup/php/financial_planning/backend && go build ./...`

- [ ] **Step 3: Commit**

```bash
cd /Volumes/Backup/php/financial_planning
git add backend/cmd/server/main.go
git commit -m "feat: wire analytics module into main application"
```

---

### Task 7: Integrate with Monthly Closing

**Files:**
- Modify: `backend/internal/service/closing_service.go`

**Interfaces:**
- Consumes: `AnalyticsService.TrackEvent()` from Task 4
- Produces: Automatic forecast accuracy tracking when closing is created

- [ ] **Step 1: Add analytics tracking to closing service**

In the closing service, after a successful monthly close:

```go
// In closing_service.go, add analytics service dependency
type closingService struct {
    db              *pgxpool.Pool
    analyticsService AnalyticsService  // Add this
}

func NewClosingService(db *pgxpool.Pool, analyticsService AnalyticsService) ClosingService {
    return &closingService{
        db: db,
        analyticsService: analyticsService,
    }
}

// In the CreateClosing or similar method, after successful close:
func (s *closingService) CreateClosing(ctx context.Context, userID string, month string) error {
    // ... existing closing logic ...
    
    // Track forecast accuracy if analytics service is available
    if s.analyticsService != nil {
        accuracy, _ := s.analyticsService.GetForecastAccuracy(ctx, userID, month)
        if accuracy != nil {
            s.analyticsService.TrackEvent(ctx, userID, "closing.completed", map[string]interface{}{
                "month": month,
                "income_accuracy": accuracy.IncomeAccuracy,
                "expense_accuracy": accuracy.ExpenseAccuracy,
                "balance_accuracy": accuracy.BalanceAccuracy,
            })
        }
    }
    
    return nil
}
```

- [ ] **Step 2: Update main.go to pass analytics service to closing service**

```go
closingService := service.NewClosingService(dbPool, analyticsService)
```

- [ ] **Step 3: Verify build**

Run: `cd /Volumes/Backup/php/financial_planning/backend && go build ./...`

- [ ] **Step 4: Commit**

```bash
cd /Volumes/Backup/php/financial_planning
git add backend/internal/service/closing_service.go backend/cmd/server/main.go
git commit -m "feat: integrate analytics tracking with monthly closing"
```

---

### Task 8: Final Verification

- [ ] **Step 1: Full build and tests**

Run: `cd /Volumes/Backup/php/financial_planning/backend && go build ./... && go test ./... -v && go vet ./...`

- [ ] **Step 2: Commit any final fixes**

```bash
cd /Volumes/Backup/php/financial_planning
git add -A
git commit -m "feat: complete product analytics implementation"
```
