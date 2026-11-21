# P2: Advanced Debt Engine per Product Type

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement accurate interest calculations for different debt types (KPR annuity, credit card revolving, flat installments) instead of the current simple interest model.

**Architecture:** Create a `DebtCalculator` interface with product-specific implementations. Add payoff schedule simulation and debt strategy comparison endpoints. Optional schema migration for new debt fields.

**Tech Stack:** Go (backend), PostgreSQL (optional migration), REST API

## Global Constraints

- Each debt type must have its own calculator implementation
- KPR uses annuity formula: P × r(1+r)^n / ((1+r)^n - 1)
- Credit card uses revolving interest with minimum payment percentage
- Flat installments have constant interest portion per month
- Zero-interest installments have no interest calculation
- `go build ./...` must pass after each task
- Existing tests must continue passing

---

### Task 1: Create DebtCalculator Interface and Types

**Files:**
- Create: `backend/internal/service/debt_calculator.go`

**Interfaces:**
- Produces: `DebtCalculator` interface, `PayoffMonth` struct, calculator implementations

- [ ] **Step 1: Create the calculator interface and types**

```go
// backend/internal/service/debt_calculator.go
package service

import "time"

// PayoffMonth represents a single month in a debt payoff schedule
type PayoffMonth struct {
	Month            int     `json:"month"`
	Payment          float64 `json:"payment"`
	PrincipalPortion float64 `json:"principal_portion"`
	InterestPortion  float64 `json:"interest_portion"`
	RemainingBalance float64 `json:"remaining_balance"`
}

// PayoffScheduleResult contains the complete payoff simulation
type PayoffScheduleResult struct {
	TotalInterest float64       `json:"total_interest"`
	TotalPayments float64       `json:"total_payments"`
	Months        int           `json:"months"`
	Schedule      []PayoffMonth `json:"schedule"`
}

// DebtCalculator defines the interface for debt-specific calculations
type DebtCalculator interface {
	// CalculateMonthlyInterest calculates monthly interest based on product type
	CalculateMonthlyInterest(outstanding float64, annualRate float64) float64
	
	// CalculateMinimumPayment calculates the minimum payment amount
	CalculateMinimumPayment(outstanding float64, annualRate float64, tenorMonths int) float64
	
	// SimulatePayoff generates a month-by-month payoff schedule
	SimulatePayoff(outstanding float64, annualRate float64, monthlyPayment float64, tenorMonths int) *PayoffScheduleResult
}

// GetCalculator returns the appropriate calculator for a debt type
func GetCalculator(debtType string) DebtCalculator {
	switch debtType {
	case "kpr":
		return &KPRCalculator{}
	case "credit_card":
		return &CreditCardCalculator{}
	case "installment":
		return &FlatInstallmentCalculator{}
	case "personal_loan":
		return &AnnuityCalculator{}
	default:
		return &SimpleInterestCalculator{}
	}
}
```

- [ ] **Step 2: Verify build**

Run: `cd /Volumes/Backup/php/financial_planning/backend && go build ./...`

- [ ] **Step 3: Commit**

```bash
cd /Volumes/Backup/php/financial_planning
git add backend/internal/service/debt_calculator.go
git commit -m "feat(service): add DebtCalculator interface and PayoffMonth types"
```

---

### Task 2: Implement KPR Calculator (Annuity)

**Files:**
- Create: `backend/internal/service/debt_calculator_kpr.go`
- Create: `backend/internal/service/debt_calculator_kpr_test.go`

**Interfaces:**
- Implements: `DebtCalculator` for KPR type
- Formula: P × r(1+r)^n / ((1+r)^n - 1)

- [ ] **Step 1: Implement KPRCalculator**

```go
// backend/internal/service/debt_calculator_kpr.go
package service

import "math"

// KPRCalculator implements annuity/effective rate for Indonesian mortgages
type KPRCalculator struct{}

func (c *KPRCalculator) CalculateMonthlyInterest(outstanding float64, annualRate float64) float64 {
	monthlyRate := annualRate / 12 / 100
	return outstanding * monthlyRate
}

func (c *KPRCalculator) CalculateMinimumPayment(outstanding float64, annualRate float64, tenorMonths int) float64 {
	if tenorMonths <= 0 || annualRate <= 0 {
		if tenorMonths > 0 {
			return outstanding / float64(tenorMonths)
		}
		return outstanding
	}
	
	monthlyRate := annualRate / 12 / 100
	// Annuity formula: P × r(1+r)^n / ((1+r)^n - 1)
	r := monthlyRate
	n := float64(tenorMonths)
	payment := outstanding * (r * math.Pow(1+r, n)) / (math.Pow(1+r, n) - 1)
	return payment
}

func (c *KPRCalculator) SimulatePayoff(outstanding float64, annualRate float64, monthlyPayment float64, tenorMonths int) *PayoffScheduleResult {
	result := &PayoffScheduleResult{
		Schedule: make([]PayoffMonth, 0),
	}
	
	balance := outstanding
	monthlyRate := annualRate / 12 / 100
	month := 0
	
	// If no payment specified, calculate using annuity formula
	if monthlyPayment <= 0 {
		monthlyPayment = c.CalculateMinimumPayment(outstanding, annualRate, tenorMonths)
	}
	
	for balance > 0 && month < 600 { // 50 year safety limit
		month++
		
		// Calculate interest for this month
		interest := balance * monthlyRate
		
		// Calculate principal portion
		principal := monthlyPayment - interest
		if principal > balance {
			principal = balance
			monthlyPayment = principal + interest
		}
		
		// Update balance
		balance -= principal
		if balance < 0.01 {
			balance = 0
		}
		
		// Record this month
		result.Schedule = append(result.Schedule, PayoffMonth{
			Month:            month,
			Payment:          monthlyPayment,
			PrincipalPortion: principal,
			InterestPortion:  interest,
			RemainingBalance: balance,
		})
		
		result.TotalInterest += interest
		result.TotalPayments += monthlyPayment
	}
	
	result.Months = month
	return result
}
```

- [ ] **Step 2: Write tests for KPR calculator**

```go
// backend/internal/service/debt_calculator_kpr_test.go
package service

import (
	"math"
	"testing"
)

func TestKPRCalculator_MinimumPayment(t *testing.T) {
	calc := &KPRCalculator{}
	
	// Test case: Rp 500,000,000 loan at 8.5% for 240 months (20 years)
	outstanding := 500000000.0
	annualRate := 8.5
	tenor := 240
	
	payment := calc.CalculateMinimumPayment(outstanding, annualRate, tenor)
	
	// Expected: approximately Rp 4,339,000 per month
	if payment < 4000000 || payment > 5000000 {
		t.Errorf("KPR payment = %f, expected around 4,339,000", payment)
	}
}

func TestKPRCalculator_SimulatePayoff(t *testing.T) {
	calc := &KPRCalculator{}
	
	result := calc.SimulatePayoff(100000000, 10, 0, 120) // 100M, 10%, 10 years
	
	if result.Months != 120 {
		t.Errorf("Expected 120 months, got %d", result.Months)
	}
	
	// Total payments should equal principal + interest
	expectedTotal := 100000000.0 + result.TotalInterest
	if math.Abs(result.TotalPayments - expectedTotal) > 1 {
		t.Errorf("Total payments %f != principal + interest %f", result.TotalPayments, expectedTotal)
	}
}
```

- [ ] **Step 3: Run tests**

Run: `cd /Volumes/Backup/php/financial_planning/backend && go test ./internal/service/... -run TestKPR -v`

- [ ] **Step 4: Commit**

```bash
cd /Volumes/Backup/php/financial_planning
git add backend/internal/service/debt_calculator_kpr.go backend/internal/service/debt_calculator_kpr_test.go
git commit -m "feat(service): implement KPR annuity calculator"
```

---

### Task 3: Implement Credit Card Calculator (Revolving)

**Files:**
- Create: `backend/internal/service/debt_calculator_credit_card.go`
- Create: `backend/internal/service/debt_calculator_credit_card_test.go`

**Interfaces:**
- Implements: `DebtCalculator` for credit card type
- Minimum payment: max(percentage × balance, fixed_minimum)
- Interest: outstanding × daily_rate × days_in_cycle

- [ ] **Step 1: Implement CreditCardCalculator**

```go
// backend/internal/service/debt_calculator_credit_card.go
package service

import "math"

// CreditCardCalculator implements revolving credit card interest
type CreditCardCalculator struct {
	// MinimumPaymentPercentage is typically 10% of balance
	MinimumPaymentPercentage float64
	// FixedMinimum is the absolute minimum payment (e.g., Rp 50,000)
	FixedMinimum float64
	// DaysInBillingCycle is typically 30
	DaysInBillingCycle int
}

func NewCreditCardCalculator() *CreditCardCalculator {
	return &CreditCardCalculator{
		MinimumPaymentPercentage: 0.10, // 10%
		FixedMinimum:             50000, // Rp 50,000
		DaysInBillingCycle:       30,
	}
}

func (c *CreditCardCalculator) CalculateMonthlyInterest(outstanding float64, annualRate float64) float64 {
	// Credit card uses daily rate
	dailyRate := annualRate / 365 / 100
	return outstanding * dailyRate * float64(c.DaysInBillingCycle)
}

func (c *CreditCardCalculator) CalculateMinimumPayment(outstanding float64, annualRate float64, tenorMonths int) float64 {
	// Minimum is max(percentage * balance, fixed_minimum)
	percentageMin := outstanding * c.MinimumPaymentPercentage
	return math.Max(percentageMin, c.FixedMinimum)
}

func (c *CreditCardCalculator) SimulatePayoff(outstanding float64, annualRate float64, monthlyPayment float64, tenorMonths int) *PayoffScheduleResult {
	result := &PayoffScheduleResult{
		Schedule: make([]PayoffMonth, 0),
	}
	
	balance := outstanding
	dailyRate := annualRate / 365 / 100
	month := 0
	
	for balance > 0 && month < 600 {
		month++
		
		// Calculate interest using daily rate
		interest := balance * dailyRate * float64(c.DaysInBillingCycle)
		
		// Determine payment
		payment := monthlyPayment
		if payment <= 0 {
			payment = c.CalculateMinimumPayment(balance, annualRate, 0)
		}
		
		// Ensure payment covers at least interest
		if payment < interest {
			payment = interest + 1 // Minimum to make progress
		}
		
		// Calculate principal
		principal := payment - interest
		if principal > balance {
			principal = balance
			payment = principal + interest
		}
		
		balance -= principal
		if balance < 0.01 {
			balance = 0
		}
		
		result.Schedule = append(result.Schedule, PayoffMonth{
			Month:            month,
			Payment:          payment,
			PrincipalPortion: principal,
			InterestPortion:  interest,
			RemainingBalance: balance,
		})
		
		result.TotalInterest += interest
		result.TotalPayments += payment
	}
	
	result.Months = month
	return result
}
```

- [ ] **Step 2: Write tests**

```go
// backend/internal/service/debt_calculator_credit_card_test.go
package service

import "testing"

func TestCreditCardCalculator_MinimumPayment(t *testing.T) {
	calc := NewCreditCardCalculator()
	
	// Rp 10,000,000 balance, 24% annual rate
	minPayment := calc.CalculateMinimumPayment(10000000, 24, 0)
	
	// Should be max(10,000,000 * 10%, 50,000) = 1,000,000
	if minPayment != 1000000 {
		t.Errorf("Expected 1,000,000, got %f", minPayment)
	}
	
	// Small balance: Rp 100,000
	minPayment = calc.CalculateMinimumPayment(100000, 24, 0)
	
	// Should be max(100,000 * 10%, 50,000) = 50,000
	if minPayment != 50000 {
		t.Errorf("Expected 50,000, got %f", minPayment)
	}
}

func TestCreditCardCalculator_MonthlyInterest(t *testing.T) {
	calc := NewCreditCardCalculator()
	
	// Rp 10,000,000 at 24% annual
	interest := calc.CalculateMonthlyInterest(10000000, 24)
	
	// Daily rate = 24/365/100 = 0.000657
	// Monthly = 10,000,000 * 0.000657 * 30 ≈ 197,260
	if interest < 190000 || interest > 210000 {
		t.Errorf("Interest = %f, expected around 197,260", interest)
	}
}
```

- [ ] **Step 3: Run tests**

Run: `cd /Volumes/Backup/php/financial_planning/backend && go test ./internal/service/... -run TestCreditCard -v`

- [ ] **Step 4: Commit**

```bash
cd /Volumes/Backup/php/financial_planning
git add backend/internal/service/debt_calculator_credit_card.go backend/internal/service/debt_calculator_credit_card_test.go
git commit -m "feat(service): implement credit card revolving calculator"
```

---

### Task 4: Implement Flat Installment Calculator

**Files:**
- Create: `backend/internal/service/debt_calculator_flat.go`
- Create: `backend/internal/service/debt_calculator_flat_test.go`

**Interfaces:**
- Implements: `DebtCalculator` for flat installment type
- Total interest = principal × rate × tenor
- Monthly payment = (principal + total_interest) / tenor

- [ ] **Step 1: Implement FlatInstallmentCalculator**

```go
// backend/internal/service/debt_calculator_flat.go
package service

// FlatInstallmentCalculator implements flat rate installment
// Common for Indonesian consumer loans (cicilan flat)
type FlatInstallmentCalculator struct{}

func (c *FlatInstallmentCalculator) CalculateMonthlyInterest(outstanding float64, annualRate float64) float64 {
	// For flat rate, interest is constant each month
	// This returns the interest portion based on original terms
	return 0 // Will be calculated in SimulatePayoff
}

func (c *FlatInstallmentCalculator) CalculateMinimumPayment(outstanding float64, annualRate float64, tenorMonths int) float64 {
	if tenorMonths <= 0 {
		return outstanding
	}
	
	// Flat rate: total interest = principal × rate × years
	totalInterest := outstanding * (annualRate / 100) * (float64(tenorMonths) / 12)
	return (outstanding + totalInterest) / float64(tenorMonths)
}

func (c *FlatInstallmentCalculator) SimulatePayoff(outstanding float64, annualRate float64, monthlyPayment float64, tenorMonths int) *PayoffScheduleResult {
	result := &PayoffScheduleResult{
		Schedule: make([]PayoffMonth, 0),
	}
	
	if tenorMonths <= 0 {
		tenorMonths = 12 // default
	}
	
	// Calculate flat rate components
	totalInterest := outstanding * (annualRate / 100) * (float64(tenorMonths) / 12)
	constantInterest := totalInterest / float64(tenorMonths)
	constantPrincipal := outstanding / float64(tenorMonths)
	
	if monthlyPayment <= 0 {
		monthlyPayment = constantPrincipal + constantInterest
	}
	
	balance := outstanding
	
	for month := 1; month <= tenorMonths; month++ {
		principal := constantPrincipal
		if principal > balance {
			principal = balance
		}
		
		balance -= principal
		if balance < 0.01 {
			balance = 0
		}
		
		result.Schedule = append(result.Schedule, PayoffMonth{
			Month:            month,
			Payment:          principal + constantInterest,
			PrincipalPortion: principal,
			InterestPortion:  constantInterest,
			RemainingBalance: balance,
		})
		
		result.TotalInterest += constantInterest
		result.TotalPayments += principal + constantInterest
	}
	
	result.Months = tenorMonths
	return result
}
```

- [ ] **Step 2: Write tests**

```go
// backend/internal/service/debt_calculator_flat_test.go
package service

import (
	"math"
	"testing"
)

func TestFlatInstallmentCalculator_MinimumPayment(t *testing.T) {
	calc := &FlatInstallmentCalculator{}
	
	// Rp 12,000,000 loan at 12% for 12 months
	payment := calc.CalculateMinimumPayment(12000000, 12, 12)
	
	// Total interest = 12,000,000 × 12% × 1 = 1,440,000
	// Monthly = (12,000,000 + 1,440,000) / 12 = 1,120,000
	expected := 1120000.0
	if math.Abs(payment - expected) > 1 {
		t.Errorf("Expected %f, got %f", expected, payment)
	}
}

func TestFlatInstallmentCalculator_SimulatePayoff(t *testing.T) {
	calc := &FlatInstallmentCalculator{}
	
	result := calc.SimulatePayoff(12000000, 12, 0, 12)
	
	if result.Months != 12 {
		t.Errorf("Expected 12 months, got %d", result.Months)
	}
	
	// Each month should have same interest portion
	for i, month := range result.Schedule {
		if i > 0 {
			prev := result.Schedule[i-1]
			if math.Abs(month.InterestPortion - prev.InterestPortion) > 0.01 {
				t.Errorf("Month %d interest %f != month %d interest %f", 
					i, month.InterestPortion, i-1, prev.InterestPortion)
			}
		}
	}
}
```

- [ ] **Step 3: Run tests**

Run: `cd /Volumes/Backup/php/financial_planning/backend && go test ./internal/service/... -run TestFlat -v`

- [ ] **Step 4: Commit**

```bash
cd /Volumes/Backup/php/financial_planning
git add backend/internal/service/debt_calculator_flat.go backend/internal/service/debt_calculator_flat_test.go
git commit -m "feat(service): implement flat installment calculator"
```

---

### Task 5: Implement Simple Interest and Zero-Interest Calculators

**Files:**
- Create: `backend/internal/service/debt_calculator_simple.go`

- [ ] **Step 1: Implement SimpleInterestCalculator (fallback)**

```go
// backend/internal/service/debt_calculator_simple.go
package service

// SimpleInterestCalculator is the default fallback (current behavior)
type SimpleInterestCalculator struct{}

func (c *SimpleInterestCalculator) CalculateMonthlyInterest(outstanding float64, annualRate float64) float64 {
	return outstanding * (annualRate / 12 / 100)
}

func (c *SimpleInterestCalculator) CalculateMinimumPayment(outstanding float64, annualRate float64, tenorMonths int) float64 {
	if tenorMonths > 0 {
		return outstanding / float64(tenorMonths)
	}
	return outstanding * 0.1 // 10% default
}

func (c *SimpleInterestCalculator) SimulatePayoff(outstanding float64, annualRate float64, monthlyPayment float64, tenorMonths int) *PayoffScheduleResult {
	result := &PayoffScheduleResult{
		Schedule: make([]PayoffMonth, 0),
	}
	
	balance := outstanding
	month := 0
	
	for balance > 0 && month < 600 {
		month++
		interest := c.CalculateMonthlyInterest(balance, annualRate)
		
		payment := monthlyPayment
		if payment <= 0 {
			payment = interest + (balance / 12) // interest + some principal
		}
		
		principal := payment - interest
		if principal > balance {
			principal = balance
			payment = principal + interest
		}
		
		balance -= principal
		if balance < 0.01 {
			balance = 0
		}
		
		result.Schedule = append(result.Schedule, PayoffMonth{
			Month:            month,
			Payment:          payment,
			PrincipalPortion: principal,
			InterestPortion:  interest,
			RemainingBalance: balance,
		})
		
		result.TotalInterest += interest
		result.TotalPayments += payment
	}
	
	result.Months = month
	return result
}

// ZeroInterestCalculator for 0% installments
type ZeroInterestCalculator struct{}

func (c *ZeroInterestCalculator) CalculateMonthlyInterest(outstanding float64, annualRate float64) float64 {
	return 0
}

func (c *ZeroInterestCalculator) CalculateMinimumPayment(outstanding float64, annualRate float64, tenorMonths int) float64 {
	if tenorMonths > 0 {
		return outstanding / float64(tenorMonths)
	}
	return outstanding
}

func (c *ZeroInterestCalculator) SimulatePayoff(outstanding float64, annualRate float64, monthlyPayment float64, tenorMonths int) *PayoffScheduleResult {
	result := &PayoffScheduleResult{
		Schedule: make([]PayoffMonth, 0),
	}
	
	if tenorMonths <= 0 {
		tenorMonths = 12
	}
	
	principalPerMonth := outstanding / float64(tenorMonths)
	balance := outstanding
	
	for month := 1; month <= tenorMonths; month++ {
		principal := principalPerMonth
		if principal > balance {
			principal = balance
		}
		
		balance -= principal
		if balance < 0.01 {
			balance = 0
		}
		
		result.Schedule = append(result.Schedule, PayoffMonth{
			Month:            month,
			Payment:          principal,
			PrincipalPortion: principal,
			InterestPortion:  0,
			RemainingBalance: balance,
		})
		
		result.TotalPayments += principal
	}
	
	result.Months = tenorMonths
	return result
}
```

- [ ] **Step 2: Verify build**

Run: `cd /Volumes/Backup/php/financial_planning/backend && go build ./...`

- [ ] **Step 3: Commit**

```bash
cd /Volumes/Backup/php/financial_planning
git add backend/internal/service/debt_calculator_simple.go
git commit -m "feat(service): add simple interest and zero-interest calculators"
```

---

### Task 6: Update Debt Service to Use Calculators

**Files:**
- Modify: `backend/internal/service/debt_service.go`

**Interfaces:**
- Consumes: `GetCalculator()` from Task 1
- Produces: Updated `RecordPayment()` and new `GetPayoffSchedule()` method

- [ ] **Step 1: Update interest calculation in RecordPayment**

```go
func (s *debtService) RecordPayment(ctx context.Context, debtID string, userID string, req dto.RecordDebtPaymentRequest) (*dto.DebtPaymentResponse, error) {
    // ... existing validation code ...
    
    // Get appropriate calculator for this debt type
    calculator := GetCalculator(d.Type)
    
    // Calculate interest using product-specific logic
    var interestPortion, principalPortion float64
    if d.InterestRate != nil && *d.InterestRate > 0 {
        interestPortion = calculator.CalculateMonthlyInterest(d.OutstandingBalance, *d.InterestRate)
        if interestPortion > req.Amount {
            interestPortion = req.Amount
        }
        principalPortion = req.Amount - interestPortion
    } else {
        principalPortion = req.Amount
    }
    
    // ... rest of existing code ...
}
```

- [ ] **Step 2: Add GetPayoffSchedule method to interface**

```go
// In DebtService interface
type DebtService interface {
    // ... existing methods ...
    GetPayoffSchedule(ctx context.Context, debtID string, userID string, monthlyPayment float64) (*dto.PayoffScheduleResponse, error)
}
```

- [ ] **Step 3: Implement GetPayoffSchedule**

```go
func (s *debtService) GetPayoffSchedule(ctx context.Context, debtID string, userID string, monthlyPayment float64) (*dto.PayoffScheduleResponse, error) {
    d, err := s.debtRepo.GetByID(ctx, debtID)
    if err != nil {
        return nil, err
    }
    
    if d.UserID != userID {
        return nil, errors.New("unauthorized")
    }
    
    calculator := GetCalculator(d.Type)
    
    rate := 0.0
    if d.InterestRate != nil {
        rate = *d.InterestRate
    }
    
    tenor := 0
    if d.TenorMonths != nil {
        tenor = *d.TenorMonths
    }
    
    result := calculator.SimulatePayoff(d.OutstandingBalance, rate, monthlyPayment, tenor)
    
    return &dto.PayoffScheduleResponse{
        DebtID:          d.ID,
        DebtName:        d.Name,
        TotalInterest:   result.TotalInterest,
        TotalPayments:   result.TotalPayments,
        PayoffMonths:    result.Months,
        MonthlySchedule: result.Schedule,
    }, nil
}
```

- [ ] **Step 4: Verify build**

Run: `cd /Volumes/Backup/php/financial_planning/backend && go build ./...`

- [ ] **Step 5: Commit**

```bash
cd /Volumes/Backup/php/financial_planning
git add backend/internal/service/debt_service.go
git commit -m "feat(service): integrate debt calculators into debt service"
```

---

### Task 7: Add Payoff Schedule DTO and Handler Endpoint

**Files:**
- Modify: `backend/internal/dto/debt.go`
- Modify: `backend/internal/handler/debt_handler.go`

**Interfaces:**
- Produces: `PayoffScheduleResponse` DTO, `GET /debts/:id/payoff-schedule` endpoint

- [ ] **Step 1: Add PayoffScheduleResponse to DTO**

```go
// backend/internal/dto/debt.go
type PayoffScheduleResponse struct {
    DebtID          string                  `json:"debt_id"`
    DebtName        string                  `json:"debt_name"`
    TotalInterest   float64                 `json:"total_interest"`
    FormattedInterest string                `json:"formatted_interest"`
    TotalPayments   float64                 `json:"total_payments"`
    FormattedPayments string                `json:"formatted_payments"`
    PayoffMonths    int                     `json:"payoff_months"`
    PayoffDate      string                  `json:"payoff_date"`
    MonthlySchedule []PayoffMonthResponse   `json:"monthly_schedule"`
}

type PayoffMonthResponse struct {
    Month            int     `json:"month"`
    Payment          float64 `json:"payment"`
    FormattedPayment string  `json:"formatted_payment"`
    PrincipalPortion float64 `json:"principal_portion"`
    InterestPortion  float64 `json:"interest_portion"`
    RemainingBalance float64 `json:"remaining_balance"`
    FormattedBalance string  `json:"formatted_balance"`
}
```

- [ ] **Step 2: Add handler endpoint**

```go
// backend/internal/handler/debt_handler.go
func (h *DebtHandler) GetPayoffSchedule(c *gin.Context) {
    userID := c.GetString("userID")
    debtID := c.Param("id")
    
    monthlyPayment, _ := strconv.ParseFloat(c.Query("monthly_payment"), 64)
    
    schedule, err := h.debtService.GetPayoffSchedule(c.Request.Context(), debtID, userID, monthlyPayment)
    if err != nil {
        c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
        return
    }
    
    c.JSON(http.StatusOK, schedule)
}

// In RegisterRoutes:
// v1.GET("/debts/:id/payoff-schedule", h.GetPayoffSchedule)
```

- [ ] **Step 3: Verify build**

Run: `cd /Volumes/Backup/php/financial_planning/backend && go build ./...`

- [ ] **Step 4: Commit**

```bash
cd /Volumes/Backup/php/financial_planning
git add backend/internal/dto/debt.go backend/internal/handler/debt_handler.go
git commit -m "feat: add GET /debts/:id/payoff-schedule endpoint"
```

---

### Task 8: Optional Schema Migration

**Files:**
- Create: `backend/migrations/000020_add_debt_type_detail.up.sql`
- Create: `backend/migrations/000020_add_debt_type_detail.down.sql`

- [ ] **Step 1: Create migration up file**

```sql
-- backend/migrations/000020_add_debt_type_detail.up.sql
ALTER TABLE debts ADD COLUMN IF NOT EXISTS loan_type_detail VARCHAR(50);
ALTER TABLE debts ADD COLUMN IF NOT EXISTS grace_period_days INTEGER DEFAULT 0;
ALTER TABLE debts ADD COLUMN IF NOT EXISTS prepayment_penalty_pct DECIMAL(5,2);
```

- [ ] **Step 2: Create migration down file**

```sql
-- backend/migrations/000020_add_debt_type_detail.down.sql
ALTER TABLE debts DROP COLUMN IF EXISTS loan_type_detail;
ALTER TABLE debts DROP COLUMN IF EXISTS grace_period_days;
ALTER TABLE debts DROP COLUMN IF EXISTS prepayment_penalty_pct;
```

- [ ] **Step 3: Commit**

```bash
cd /Volumes/Backup/php/financial_planning
git add backend/migrations/000020_*
git commit -m "feat(db): add optional debt detail columns"
```

---

### Task 9: Final Verification

- [ ] **Step 1: Full build and tests**

Run: `cd /Volumes/Backup/php/financial_planning/backend && go build ./... && go test ./... -v && go vet ./...`

- [ ] **Step 2: Commit any final fixes**

```bash
cd /Volumes/Backup/php/financial_planning
git add -A
git commit -m "feat: complete advanced debt engine implementation"
```
