# P2: Retirement Planning Module

## Konteks

Saat ini tidak ada modul perencanaan pensiun. Pengguna perlu mengetahui apakah kontribusi saat ini cukup untuk pensiun.

## File yang Perlu Dibuat

### 1. Schema Migration

```sql
-- backend/migrations/000020_create_retirement_profiles.up.sql
CREATE TABLE IF NOT EXISTS retirement_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    current_age INTEGER,
    retirement_age INTEGER DEFAULT 55,
    life_expectancy INTEGER DEFAULT 80,
    current_monthly_expense DECIMAL(15,2),
    expected_inflation_pct DECIMAL(5,2) DEFAULT 5.0,
    expected_return_pct DECIMAL(5,2) DEFAULT 8.0,
    current_retirement_savings DECIMAL(15,2) DEFAULT 0,
    monthly_contribution DECIMAL(15,2) DEFAULT 0,
    employer_contribution DECIMAL(15,2) DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_retirement_user ON retirement_profiles(user_id);
```

### 2. DTO (`backend/internal/dto/retirement.go`)

```go
type RetirementProfileRequest struct {
    CurrentAge           *int     `json:"current_age"`
    RetirementAge        *int     `json:"retirement_age"`
    LifeExpectancy       *int     `json:"life_expectancy"`
    CurrentMonthlyExpense *float64 `json:"current_monthly_expense"`
    ExpectedInflationPct *float64 `json:"expected_inflation_pct"`
    ExpectedReturnPct    *float64 `json:"expected_return_pct"`
    CurrentRetirementSavings *float64 `json:"current_retirement_savings"`
    MonthlyContribution  *float64 `json:"monthly_contribution"`
    EmployerContribution *float64 `json:"employer_contribution"`
}

type RetirementAssessmentResponse struct {
    // Input summary
    Profile                RetirementProfile  `json:"profile"`
    
    // Calculated results
    YearsToRetirement      int     `json:"years_to_retirement"`
    YearsInRetirement      int     `json:"years_in_retirement"`
    FutureMonthlyExpense   float64 `json:"future_monthly_expense"` // adjusted for inflation
    TotalRetirementCorpus  float64 `json:"total_retirement_corpus"` // amount needed at retirement
    ProjectedSavings       float64 `json:"projected_savings"` // what current plan yields
    FundingGap             float64 `json:"funding_gap"` // shortfall (0 if sufficient)
    IsOnTrack              bool    `json:"is_on_track"`
    RequiredMonthlySaving  float64 `json:"required_monthly_saving"` // to close gap
    
    // Recommendations
    Recommendations        []string `json:"recommendations"`
}
```

### 3. Service (`backend/internal/service/retirement_service.go`)

Kalkulasi:
- `futureMonthlyExpense = currentExpense × (1 + inflation/100)^yearsToRetirement`
- `totalRetirementCorpus = futureMonthlyExpense × 12 × yearsInRetirement`
- `projectedSavings = FV(currentSavings, return, years) + FV(monthlyContrib, return, years)`
- `fundingGap = totalRetirementCorpus - projectedSavings`
- `requiredMonthlySaving = PMT(return, years, -currentSavings, totalRetirementCorpus)`

### 4. Handler (`backend/internal/handler/retirement_handler.go`)

Routes:
- `GET /retirement/assessment` — hitung dan return assessment
- `PUT /retirement/profile` — update profile (owner only)

### 5. Wire ke main.go

```go
retirementService := service.NewRetirementService(dbPool)
retirementHandler := handler.NewRetirementHandler(retirementService)
// ...
retirementHandler.RegisterRoutes(v1)
```

## Acceptance Criteria

- [ ] Schema migration berjalan tanpa error
- [ ] Profile bisa disimpan dan diupdate
- [ ] Assessment menghitung dengan benar:
  - Future expense adjusted for inflation
  - Required retirement corpus
  - Projected savings dari rencana saat ini
  - Funding gap dan rekomendasi
- [ ] `go build ./...` pass
- [ ] Endpoint terdaftar di main.go
