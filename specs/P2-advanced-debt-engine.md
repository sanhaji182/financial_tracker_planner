# P2: Advanced Debt Engine per Jenis Produk

## Konteks

Saat ini debt service menggunakan model bunga sederhana (`outstanding × APR / 12`) untuk semua jenis utang. Ini tidak akurat untuk KPR (annuity/effective), kartu kredit (revolving), dan cicilan flat.

## File Terkait

- `backend/internal/service/debt_service.go` — kalkulasi interest, payoff simulation
- `backend/internal/dto/debt.go` — debt DTO
- `backend/internal/model/debt.go` — debt model (field: type, interest_rate, outstanding_balance, minimum_payment, tenor_months, start_date, end_date)
- `backend/migrations/000005_create_debts_tables.up.sql` — schema debts table

## Yang Perlu Dibuat

### 1. Interest Calculator Interface

```go
// backend/internal/service/debt_calculator.go

type DebtCalculator interface {
    // Hitung bunga bulanan berdasarkan jenis produk
    CalculateMonthlyInterest(outstanding float64, annualRate float64, month time.Time) float64
    
    // Hitung minimum payment
    CalculateMinimumPayment(outstanding float64, annualRate float64, tenorMonths int, debtType string) float64
    
    // Simulate payoff schedule
    SimulatePayoff(outstanding float64, annualRate float64, monthlyPayment float64, debtType string) []PayoffMonth
}

type PayoffMonth struct {
    Month           int     `json:"month"`
    Payment         float64 `json:"payment"`
    PrincipalPortion float64 `json:"principal_portion"`
    InterestPortion float64 `json:"interest_portion"`
    RemainingBalance float64 `json:"remaining_balance"`
}
```

### 2. Implementasi per Jenis

**KPR (annuity/effective):**
- Monthly payment = P × r(1+r)^n / ((1+r)^n - 1)
- Setiap bulan: interest = outstanding × monthly_rate, principal = payment - interest

**Credit card (revolving):**
- Minimum payment = max(percentage × balance, fixed_minimum)
- Interest = outstanding × daily_rate × days_in_cycle
- Grace period handling

**Cicilan flat:**
- Total interest = principal × rate × tenor
- Monthly payment = (principal + total_interest) / tenor
- Interest portion = total_interest / tenor (konstan)

**Anuitas/KPR Indonesia:**
- Sama dengan annuity, tapi dengan angsuran tetap per bulan

**Zero-interest installment:**
- Monthly payment = principal / tenor
- No interest calculation

### 3. Update Debt Service

- `debt_service.go`: ganti `calculateInterestPortion()` dengan calculator interface
- `debt_service.go`: ganti `SimulateDebtAvalanche()` dengan per-debt-type simulation
- Tambah `GetPayoffSchedule(ctx, debtID)` — return month-by-month payoff

### 4. Update Debt DTO

```go
// backend/internal/dto/debt.go
type PayoffScheduleResponse struct {
    DebtID           string         `json:"debt_id"`
    DebtName         string         `json:"debt_name"`
    TotalInterest    float64        `json:"total_interest"`
    TotalPayments    float64        `json:"total_payments"`
    PayoffMonths     int            `json:"payoff_months"`
    PayoffDate       string         `json:"payoff_date"`
    MonthlySchedule  []PayoffMonth  `json:"monthly_schedule"`
}

type DebtComparisonResponse struct {
    Strategy         string  `json:"strategy"` // avalanche, snowball, minimum_only
    TotalInterest    float64 `json:"total_interest"`
    TotalMonths      int     `json:"total_months"`
    MonthlySavings   float64 `json:"monthly_savings_vs_minimum"`
}
```

### 5. Schema (opsional, jika field baru dibutuhkan)

```sql
ALTER TABLE debts ADD COLUMN IF NOT EXISTS loan_type_detail VARCHAR(50);
ALTER TABLE debts ADD COLUMN IF NOT EXISTS grace_period_days INTEGER DEFAULT 0;
ALTER TABLE debts ADD COLUMN IF NOT EXISTS prepayment_penalty_pct DECIMAL(5,2);
```

## Acceptance Criteria

- [ ] Setiap debt type memiliki calculator yang benar
- [ ] Payoff schedule akurat untuk KPR annuity
- [ ] Credit card minimum payment calculation benar
- [ ] Debt avalanche simulation menggunakan per-type interest
- [ ] API `GET /debts/:id/payoff-schedule` tersedia
- [ ] API `GET /debts/compare-strategies` tersedia
- [ ] Existing tests tetap pass
