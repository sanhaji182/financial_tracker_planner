# P3: Product Analytics & Forecast Accuracy

## Konteks

Saat ini tidak ada cara untuk mengukur:
- Apakah forecast akurat dibanding actual
- Apakah pengguna mengikuti rekomendasi alokasi
- Berapa lama pengguna sampai mendapat forecast pertama
- Apakah reconciliation dilakukan secara rutin

## File yang Perlu Dibuat

### 1. Schema Migration

```sql
-- backend/migrations/000021_create_analytics_events.up.sql
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

### 2. Event Types yang Perlu Dicatat

```go
// backend/internal/analytics/events.go
const (
    EventForecastGenerated    = "forecast.generated"
    EventForecastAccuracy     = "forecast.accuracy"     // when month closes, compare forecast vs actual
    EventReconciliationDone   = "reconciliation.done"
    EventGoalCreated          = "goal.created"
    EventGoalContributed      = "goal.contributed"
    EventAllocationFollowed   = "allocation.followed"    // user created transaction matching advice
    EventProtectionAssessed   = "protection.assessed"
    EventRetirementAssessed   = "retirement.assessed"
    EventDataQualityChecked   = "data_quality.checked"
    EventOnboardingCompleted  = "onboarding.completed"
)
```

### 3. Analytics Service

```go
// backend/internal/service/analytics_service.go
type AnalyticsService interface {
    TrackEvent(ctx context.Context, userID, eventType string, data map[string]interface{}) error
    GetForecastAccuracy(ctx context.Context, userID string) (*ForecastAccuracyReport, error)
    GetUserActivationMetrics(ctx context.Context) (*ActivationMetrics, error)
    GetDataQualityReport(ctx context.Context, userID string) (*DataQualityReport, error)
}
```

### 4. Forecast Accuracy

Saat monthly closing dibuat, bandingkan forecast vs actual:
```go
type ForecastAccuracyReport struct {
    Month               string  `json:"month"`
    ForecastIncome      float64 `json:"forecast_income"`
    ActualIncome        float64 `json:"actual_income"`
    ForecastExpense     float64 `json:"forecast_expense"`
    ActualExpense       float64 `json:"actual_expense"`
    ForecastEndBalance  float64 `json:"forecast_end_balance"`
    ActualEndBalance    float64 `json:"actual_end_balance"`
    IncomeAccuracy      float64 `json:"income_accuracy"`  // 0-100
    ExpenseAccuracy     float64 `json:"expense_accuracy"`
    BalanceAccuracy     float64 `json:"balance_accuracy"`
}
```

### 5. Data Quality Report

```go
type DataQualityReport struct {
    LastReconciliationAge       int    `json:"last_reconciliation_age_days"`
    UncategorizedTransactions   int    `json:"uncategorized_transactions"`
    StaleAssetValuations        int    `json:"stale_asset_valuations"` // > 90 days
    MissingRecurringIncome      bool   `json:"missing_recurring_income"`
    MissingInterestRates        int    `json:"missing_interest_rates"`
    SuspectedDuplicates         int    `json:"suspected_duplicates"`
    OCRPendingReview            int    `json:"ocr_pending_review"`
    QualityScore                int    `json:"quality_score"` // 0-100
}
```

### 6. Handler

```go
// backend/internal/handler/analytics_handler.go
// Routes:
// GET /analytics/forecast-accuracy?month=YYYY-MM
// GET /analytics/data-quality
// GET /analytics/activation (owner only, admin)
```

## Acceptance Criteria

- [ ] Schema migration berjalan
- [ ] Forecast accuracy dihitung saat monthly closing
- [ ] Data quality report menunjukkan semua metrik
- [ ] `GET /analytics/forecast-accuracy` return akurasi per bulan
- [ ] `GET /analytics/data-quality` return skor kualitas data
- [ ] Handler terdaftar di main.go
- [ ] `go build ./...` pass
