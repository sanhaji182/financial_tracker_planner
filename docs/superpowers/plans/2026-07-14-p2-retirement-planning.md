# P2: Retirement Planning Module

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a retirement planning module that calculates whether users are on track for retirement and provides recommendations.

**Architecture:** New schema for retirement profiles, service for financial calculations (future value, present value, PMT), handler for API endpoints, wired into main.go.

**Tech Stack:** Go (backend), PostgreSQL (new table), REST API

## Global Constraints

- Schema migration for `retirement_profiles` table
- Financial formulas: FV, PV, PMT for retirement corpus calculation
- Inflation adjustment for future expenses
- `go build ./...` must pass after each task
- Endpoint registration in main.go

---

### Task 1: Create Schema Migration

**Files:**
- Create: `backend/migrations/000021_create_retirement_profiles.up.sql`
- Create: `backend/migrations/000021_create_retirement_profiles.down.sql`

- [ ] **Step 1: Create up migration**

```sql
-- backend/migrations/000021_create_retirement_profiles.up.sql
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

- [ ] **Step 2: Create down migration**

```sql
-- backend/migrations/000021_create_retirement_profiles.down.sql
DROP TABLE IF EXISTS retirement_profiles;
```

- [ ] **Step 3: Commit**

```bash
cd /Volumes/Backup/php/financial_planning
git add backend/migrations/000021_*
git commit -m "feat(db): add retirement_profiles table migration"
```

---

### Task 2: Create Retirement DTO

**Files:**
- Create: `backend/internal/dto/retirement.go`

**Interfaces:**
- Produces: `RetirementProfileRequest`, `RetirementAssessmentResponse`

- [ ] **Step 1: Create retirement DTOs**

```go
// backend/internal/dto/retirement.go
package dto

import "time"

type RetirementProfileRequest struct {
	CurrentAge            *int     `json:"current_age"`
	RetirementAge         *int     `json:"retirement_age"`
	LifeExpectancy        *int     `json:"life_expectancy"`
	CurrentMonthlyExpense *float64 `json:"current_monthly_expense"`
	ExpectedInflationPct  *float64 `json:"expected_inflation_pct"`
	ExpectedReturnPct     *float64 `json:"expected_return_pct"`
	CurrentRetirementSavings *float64 `json:"current_retirement_savings"`
	MonthlyContribution   *float64 `json:"monthly_contribution"`
	EmployerContribution  *float64 `json:"employer_contribution"`
	Notes                 *string  `json:"notes"`
}

type RetirementProfileResponse struct {
	ID                     string    `json:"id"`
	UserID                 string    `json:"user_id"`
	CurrentAge             int       `json:"current_age"`
	RetirementAge          int       `json:"retirement_age"`
	LifeExpectancy         int       `json:"life_expectancy"`
	CurrentMonthlyExpense  float64   `json:"current_monthly_expense"`
	FormattedExpense       string    `json:"formatted_monthly_expense"`
	ExpectedInflationPct   float64   `json:"expected_inflation_pct"`
	ExpectedReturnPct      float64   `json:"expected_return_pct"`
	CurrentRetirementSavings float64 `json:"current_retirement_savings"`
	FormattedSavings       string    `json:"formatted_savings"`
	MonthlyContribution    float64   `json:"monthly_contribution"`
	FormattedContribution  string    `json:"formatted_contribution"`
	EmployerContribution   float64   `json:"employer_contribution"`
	FormattedEmployer      string    `json:"formatted_employer"`
	Notes                  *string   `json:"notes,omitempty"`
	CreatedAt              time.Time `json:"created_at"`
	UpdatedAt              time.Time `json:"updated_at"`
}

type RetirementAssessmentResponse struct {
	// Input summary
	Profile RetirementProfileResponse `json:"profile"`
	
	// Calculated results
	YearsToRetirement     int     `json:"years_to_retirement"`
	YearsInRetirement     int     `json:"years_in_retirement"`
	FutureMonthlyExpense  float64 `json:"future_monthly_expense"`
	FormattedFutureExpense string `json:"formatted_future_expense"`
	TotalRetirementCorpus float64 `json:"total_retirement_corpus"`
	FormattedCorpus       string  `json:"formatted_corpus"`
	ProjectedSavings      float64 `json:"projected_savings"`
	FormattedProjected    string  `json:"formatted_projected"`
	FundingGap            float64 `json:"funding_gap"`
	FormattedGap          string  `json:"formatted_gap"`
	IsOnTrack             bool    `json:"is_on_track"`
	RequiredMonthlySaving float64 `json:"required_monthly_saving"`
	FormattedRequired     string  `json:"formatted_required"`
	
	// Recommendations
	Recommendations []string `json:"recommendations"`
}
```

- [ ] **Step 2: Commit**

```bash
cd /Volumes/Backup/php/financial_planning
git add backend/internal/dto/retirement.go
git commit -m "feat(dto): add retirement planning request/response types"
```

---

### Task 3: Create Retirement Model

**Files:**
- Create: `backend/internal/model/retirement.go`

- [ ] **Step 1: Create retirement model**

```go
// backend/internal/model/retirement.go
package model

import "time"

type RetirementProfile struct {
	ID                     string    `json:"id" db:"id"`
	UserID                 string    `json:"user_id" db:"user_id"`
	CurrentAge             int       `json:"current_age" db:"current_age"`
	RetirementAge          int       `json:"retirement_age" db:"retirement_age"`
	LifeExpectancy         int       `json:"life_expectancy" db:"life_expectancy"`
	CurrentMonthlyExpense  float64   `json:"current_monthly_expense" db:"current_monthly_expense"`
	ExpectedInflationPct   float64   `json:"expected_inflation_pct" db:"expected_inflation_pct"`
	ExpectedReturnPct      float64   `json:"expected_return_pct" db:"expected_return_pct"`
	CurrentRetirementSavings float64 `json:"current_retirement_savings" db:"current_retirement_savings"`
	MonthlyContribution    float64   `json:"monthly_contribution" db:"monthly_contribution"`
	EmployerContribution   float64   `json:"employer_contribution" db:"employer_contribution"`
	Notes                  *string   `json:"notes,omitempty" db:"notes"`
	CreatedAt              time.Time `json:"created_at" db:"created_at"`
	UpdatedAt              time.Time `json:"updated_at" db:"updated_at"`
}
```

- [ ] **Step 2: Commit**

```bash
cd /Volumes/Backup/php/financial_planning
git add backend/internal/model/retirement.go
git commit -m "feat(model): add RetirementProfile model"
```

---

### Task 4: Create Retirement Repository

**Files:**
- Create: `backend/internal/repository/retirement_repo.go`

**Interfaces:**
- Produces: `RetirementRepository` with CRUD operations

- [ ] **Step 1: Create repository**

```go
// backend/internal/repository/retirement_repo.go
package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/user/financial-os/internal/model"
)

type RetirementRepository interface {
	GetByUserID(ctx context.Context, userID string) (*model.RetirementProfile, error)
	Upsert(ctx context.Context, profile *model.RetirementProfile) (*model.RetirementProfile, error)
}

type retirementRepository struct {
	db *pgxpool.Pool
}

func NewRetirementRepository(db *pgxpool.Pool) RetirementRepository {
	return &retirementRepository{db: db}
}

func (r *retirementRepository) GetByUserID(ctx context.Context, userID string) (*model.RetirementProfile, error) {
	p := &model.RetirementProfile{}
	err := r.db.QueryRow(ctx, `
		SELECT id, user_id, current_age, retirement_age, life_expectancy,
		       current_monthly_expense, expected_inflation_pct, expected_return_pct,
		       current_retirement_savings, monthly_contribution, employer_contribution,
		       notes, created_at, updated_at
		FROM retirement_profiles
		WHERE user_id = $1
		ORDER BY updated_at DESC
		LIMIT 1
	`, userID).Scan(
		&p.ID, &p.UserID, &p.CurrentAge, &p.RetirementAge, &p.LifeExpectancy,
		&p.CurrentMonthlyExpense, &p.ExpectedInflationPct, &p.ExpectedReturnPct,
		&p.CurrentRetirementSavings, &p.MonthlyContribution, &p.EmployerContribution,
		&p.Notes, &p.CreatedAt, &p.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("retirement profile not found: %w", err)
	}
	return p, nil
}

func (r *retirementRepository) Upsert(ctx context.Context, p *model.RetirementProfile) (*model.RetirementProfile, error) {
	err := r.db.QueryRow(ctx, `
		INSERT INTO retirement_profiles (
			user_id, current_age, retirement_age, life_expectancy,
			current_monthly_expense, expected_inflation_pct, expected_return_pct,
			current_retirement_savings, monthly_contribution, employer_contribution, notes
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		ON CONFLICT (user_id) DO UPDATE SET
			current_age = EXCLUDED.current_age,
			retirement_age = EXCLUDED.retirement_age,
			life_expectancy = EXCLUDED.life_expectancy,
			current_monthly_expense = EXCLUDED.current_monthly_expense,
			expected_inflation_pct = EXCLUDED.expected_inflation_pct,
			expected_return_pct = EXCLUDED.expected_return_pct,
			current_retirement_savings = EXCLUDED.current_retirement_savings,
			monthly_contribution = EXCLUDED.monthly_contribution,
			employer_contribution = EXCLUDED.employer_contribution,
			notes = EXCLUDED.notes,
			updated_at = NOW()
		RETURNING id, created_at, updated_at
	`, p.UserID, p.CurrentAge, p.RetirementAge, p.LifeExpectancy,
		p.CurrentMonthlyExpense, p.ExpectedInflationPct, p.ExpectedReturnPct,
		p.CurrentRetirementSavings, p.MonthlyContribution, p.EmployerContribution,
		p.Notes).Scan(&p.ID, &p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("failed to upsert retirement profile: %w", err)
	}
	return p, nil
}
```

- [ ] **Step 2: Add unique constraint migration**

```sql
-- Add to migration or create new one
ALTER TABLE retirement_profiles ADD CONSTRAINT unique_retirement_user UNIQUE (user_id);
```

- [ ] **Step 3: Commit**

```bash
cd /Volumes/Backup/php/financial_planning
git add backend/internal/repository/retirement_repo.go
git commit -m "feat(repo): add RetirementRepository with upsert support"
```

---

### Task 5: Create Retirement Service with Financial Calculations

**Files:**
- Create: `backend/internal/service/retirement_service.go`
- Create: `backend/internal/service/retirement_service_test.go`

**Interfaces:**
- Produces: `RetirementService` with `GetAssessment()` and `UpdateProfile()` methods
- Financial formulas: FV, PMT for retirement planning

- [ ] **Step 1: Create retirement service**

```go
// backend/internal/service/retirement_service.go
package service

import (
	"context"
	"math"

	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/model"
	"github.com/user/financial-os/internal/repository"
)

type RetirementService interface {
	GetAssessment(ctx context.Context, userID string) (*dto.RetirementAssessmentResponse, error)
	UpdateProfile(ctx context.Context, userID string, req dto.RetirementProfileRequest) (*dto.RetirementProfileResponse, error)
}

type retirementService struct {
	repo repository.RetirementRepository
}

func NewRetirementService(repo repository.RetirementRepository) RetirementService {
	return &retirementService{repo: repo}
}

func (s *retirementService) GetAssessment(ctx context.Context, userID string) (*dto.RetirementAssessmentResponse, error) {
	profile, err := s.repo.GetByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	
	return s.calculateAssessment(profile), nil
}

func (s *retirementService) UpdateProfile(ctx context.Context, userID string, req dto.RetirementProfileRequest) (*dto.RetirementProfileResponse, error) {
	// Get existing or create new
	existing, _ := s.repo.GetByUserID(ctx, userID)
	if existing == nil {
		existing = &model.RetirementProfile{
			UserID: userID,
		}
	}
	
	// Apply updates from request
	if req.CurrentAge != nil {
		existing.CurrentAge = *req.CurrentAge
	}
	if req.RetirementAge != nil {
		existing.RetirementAge = *req.RetirementAge
	}
	if req.LifeExpectancy != nil {
		existing.LifeExpectancy = *req.LifeExpectancy
	}
	if req.CurrentMonthlyExpense != nil {
		existing.CurrentMonthlyExpense = *req.CurrentMonthlyExpense
	}
	if req.ExpectedInflationPct != nil {
		existing.ExpectedInflationPct = *req.ExpectedInflationPct
	}
	if req.ExpectedReturnPct != nil {
		existing.ExpectedReturnPct = *req.ExpectedReturnPct
	}
	if req.CurrentRetirementSavings != nil {
		existing.CurrentRetirementSavings = *req.CurrentRetirementSavings
	}
	if req.MonthlyContribution != nil {
		existing.MonthlyContribution = *req.MonthlyContribution
	}
	if req.EmployerContribution != nil {
		existing.EmployerContribution = *req.EmployerContribution
	}
	if req.Notes != nil {
		existing.Notes = req.Notes
	}
	
	saved, err := s.repo.Upsert(ctx, existing)
	if err != nil {
		return nil, err
	}
	
	return toProfileResponse(saved), nil
}

func (s *retirementService) calculateAssessment(p *model.RetirementProfile) *dto.RetirementAssessmentResponse {
	yearsToRetirement := p.RetirementAge - p.CurrentAge
	yearsInRetirement := p.LifeExpectancy - p.RetirementAge
	
	if yearsToRetirement <= 0 {
		yearsToRetirement = 1
	}
	if yearsInRetirement <= 0 {
		yearsInRetirement = 1
	}
	
	// Future monthly expense adjusted for inflation
	inflationRate := p.ExpectedInflationPct / 100
	futureMonthlyExpense := p.CurrentMonthlyExpense * math.Pow(1+inflationRate, float64(yearsToRetirement))
	
	// Total retirement corpus needed (simplified: future expense × 12 × years in retirement)
	// More sophisticated would use present value of annuity
	totalCorpus := futureMonthlyExpense * 12 * float64(yearsInRetirement)
	
	// Projected savings from current plan
	returnRate := p.ExpectedReturnPct / 100
	totalMonthlyContrib := p.MonthlyContribution + p.EmployerContribution
	
	// FV of current savings
	fvCurrentSavings := p.CurrentRetirementSavings * math.Pow(1+returnRate, float64(yearsToRetirement))
	
	// FV of monthly contributions (future value of annuity)
	fvContributions := 0.0
	if returnRate > 0 {
		monthlyRate := returnRate / 12
		months := float64(yearsToRetirement * 12)
		fvContributions = totalMonthlyContrib * (math.Pow(1+monthlyRate, months) - 1) / monthlyRate
	} else {
		fvContributions = totalMonthlyContrib * float64(yearsToRetirement*12)
	}
	
	projectedSavings := fvCurrentSavings + fvContributions
	
	// Funding gap
	fundingGap := totalCorpus - projectedSavings
	if fundingGap < 0 {
		fundingGap = 0
	}
	
	isOnTrack := fundingGap <= 0
	
	// Required monthly saving to close gap
	requiredMonthly := 0.0
	if !isOnTrack && returnRate > 0 {
		monthlyRate := returnRate / 12
		months := float64(yearsToRetirement * 12)
		// PMT formula: PMT = PV × r / (1 - (1+r)^-n)
		// But we need to find PMT to reach future value, so:
		// PMT = FV × r / ((1+r)^n - 1)
		remainingGap := fundingGap
		requiredMonthly = remainingGap * monthlyRate / (math.Pow(1+monthlyRate, months) - 1)
	}
	
	// Generate recommendations
	recommendations := generateRecommendations(p, isOnTrack, fundingGap, requiredMonthly)
	
	return &dto.RetirementAssessmentResponse{
		Profile: toProfileResponse(p),
		
		YearsToRetirement:  yearsToRetirement,
		YearsInRetirement:  yearsInRetirement,
		FutureMonthlyExpense: futureMonthlyExpense,
		FormattedFutureExpense: dto.FormatRupiah(futureMonthlyExpense),
		TotalRetirementCorpus: totalCorpus,
		FormattedCorpus: dto.FormatRupiah(totalCorpus),
		ProjectedSavings: projectedSavings,
		FormattedProjected: dto.FormatRupiah(projectedSavings),
		FundingGap: fundingGap,
		FormattedGap: dto.FormatRupiah(fundingGap),
		IsOnTrack: isOnTrack,
		RequiredMonthlySaving: requiredMonthly,
		FormattedRequired: dto.FormatRupiah(requiredMonthly),
		
		Recommendations: recommendations,
	}
}

func generateRecommendations(p *model.RetirementProfile, isOnTrack bool, gap, required float64) []string {
	var recs []string
	
	if isOnTrack {
		recs = append(recs, "✅ Anda sudah on track untuk pensiun! Pertahankan kontribusi saat ini.")
	} else {
		recs = append(recs, "⚠️ Ada gap pendanaan pensiun. Pertimbangkan untuk meningkatkan kontribusi.")
		recs = append(recs, "💡 Tambah kontribusi bulanan sebesar "+dto.FormatRupiah(required)+" untuk menutup gap.")
	}
	
	if p.CurrentRetirementSavings == 0 {
		recs = append(recs, "🏦 Mulai investasi untuk pensiun sesegera mungkin untuk memanfaatkan compound interest.")
	}
	
	if p.ExpectedReturnPct > 10 {
		recs = append(recs, "📉 Asumsi return "+fmt.Sprintf("%.1f%%", p.ExpectedReturnPct)+" cukup agresif. Pertimbangkan asumsi yang lebih konservatif.")
	}
	
	if p.CurrentAge < 30 {
		recs = append(recs, "🎯 Anda masih muda! Waktu adalah aset terbaik untuk investasi jangka panjang.")
	}
	
	return recs
}

func toProfileResponse(p *model.RetirementProfile) dto.RetirementProfileResponse {
	return dto.RetirementProfileResponse{
		ID: p.ID,
		UserID: p.UserID,
		CurrentAge: p.CurrentAge,
		RetirementAge: p.RetirementAge,
		LifeExpectancy: p.LifeExpectancy,
		CurrentMonthlyExpense: p.CurrentMonthlyExpense,
		FormattedExpense: dto.FormatRupiah(p.CurrentMonthlyExpense),
		ExpectedInflationPct: p.ExpectedInflationPct,
		ExpectedReturnPct: p.ExpectedReturnPct,
		CurrentRetirementSavings: p.CurrentRetirementSavings,
		FormattedSavings: dto.FormatRupiah(p.CurrentRetirementSavings),
		MonthlyContribution: p.MonthlyContribution,
		FormattedContribution: dto.FormatRupiah(p.MonthlyContribution),
		EmployerContribution: p.EmployerContribution,
		FormattedEmployer: dto.FormatRupiah(p.EmployerContribution),
		Notes: p.Notes,
		CreatedAt: p.CreatedAt,
		UpdatedAt: p.UpdatedAt,
	}
}
```

- [ ] **Step 2: Write tests**

```go
// backend/internal/service/retirement_service_test.go
package service

import (
	"testing"
)

func TestCalculateAssessment_OnTrack(t *testing.T) {
	// This would require mocking the repository
	// For now, test the financial calculations directly
}

func TestFutureValue(t *testing.T) {
	// Test FV calculation
	presentValue := 100000000.0 // 100M
	rate := 0.08 // 8%
	years := 20.0
	
	fv := presentValue * math.Pow(1+rate, years)
	
	// Should be around 466M
	if fv < 460000000 || fv > 470000000 {
		t.Errorf("FV = %f, expected ~466M", fv)
	}
}
```

- [ ] **Step 3: Verify build**

Run: `cd /Volumes/Backup/php/financial_planning/backend && go build ./...`

- [ ] **Step 4: Commit**

```bash
cd /Volumes/Backup/php/financial_planning
git add backend/internal/service/retirement_service.go backend/internal/service/retirement_service_test.go
git commit -m "feat(service): implement retirement planning calculations"
```

---

### Task 6: Create Retirement Handler

**Files:**
- Create: `backend/internal/handler/retirement_handler.go`

**Interfaces:**
- Produces: `GET /retirement/assessment`, `PUT /retirement/profile` endpoints

- [ ] **Step 1: Create handler**

```go
// backend/internal/handler/retirement_handler.go
package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/service"
)

type RetirementHandler struct {
	retirementService service.RetirementService
}

func NewRetirementHandler(retirementService service.RetirementService) *RetirementHandler {
	return &RetirementHandler{retirementService: retirementService}
}

func (h *RetirementHandler) RegisterRoutes(rg *gin.RouterGroup) {
	retirement := rg.Group("/retirement")
	{
		retirement.GET("/assessment", h.GetAssessment)
		retirement.PUT("/profile", h.UpdateProfile)
	}
}

func (h *RetirementHandler) GetAssessment(c *gin.Context) {
	userID := c.GetString("userID")
	
	assessment, err := h.retirementService.GetAssessment(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Retirement profile not found. Please create one first."})
		return
	}
	
	c.JSON(http.StatusOK, assessment)
}

func (h *RetirementHandler) UpdateProfile(c *gin.Context) {
	userID := c.GetString("userID")
	
	var req dto.RetirementProfileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	
	profile, err := h.retirementService.UpdateProfile(c.Request.Context(), userID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	
	c.JSON(http.StatusOK, profile)
}
```

- [ ] **Step 2: Verify build**

Run: `cd /Volumes/Backup/php/financial_planning/backend && go build ./...`

- [ ] **Step 3: Commit**

```bash
cd /Volumes/Backup/php/financial_planning
git add backend/internal/handler/retirement_handler.go
git commit -m "feat(handler): add retirement planning endpoints"
```

---

### Task 7: Wire into main.go

**Files:**
- Modify: `backend/cmd/server/main.go`

- [ ] **Step 1: Add retirement module initialization**

```go
// In main.go, after other repository initializations:
retirementRepo := repository.NewRetirementRepository(dbPool)

// After other service initializations:
retirementService := service.NewRetirementService(retirementRepo)

// After other handler initializations:
retirementHandler := handler.NewRetirementHandler(retirementService)

// In route registration section:
retirementHandler.RegisterRoutes(v1)
```

- [ ] **Step 2: Verify build**

Run: `cd /Volumes/Backup/php/financial_planning/backend && go build ./...`

- [ ] **Step 3: Commit**

```bash
cd /Volumes/Backup/php/financial_planning
git add backend/cmd/server/main.go
git commit -m "feat: wire retirement planning module into main application"
```

---

### Task 8: Final Verification

- [ ] **Step 1: Full build and tests**

Run: `cd /Volumes/Backup/php/financial_planning/backend && go build ./... && go test ./... -v && go vet ./...`

- [ ] **Step 2: Commit any final fixes**

```bash
cd /Volumes/Backup/php/financial_planning
git add -A
git commit -m "feat: complete retirement planning module"
```
