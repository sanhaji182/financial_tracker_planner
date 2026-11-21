package kernel

import (
	"math"
	"time"
)

// FormulaVersion is the single versioned source of truth for decision-support math.
// Bump when formula semantics change so clients can invalidate caches and show provenance.
const FormulaVersion = "kernel-v1"

// CashflowInputs is the shared input snapshot for surplus / safe-to-spend / forecast end.
// Services load data from DB/Redis; pure math lives here only.
type CashflowInputs struct {
	AsOf time.Time

	// Cash on hand (liquid accounts) at AsOf.
	CashAvailable float64

	// Month-to-date confirmed cashflow (current month path).
	IncomeMTD  float64
	ExpenseMTD float64

	// Estimated full-month figures (forecast path / allocation path).
	// When IsCurrentMonth is true, EstimatedIncome/Expenses are still used for remaining-period projections.
	EstimatedIncome           float64
	EstimatedFixedExpenses    float64 // bills + min debt payments for target month
	EstimatedVariableExpenses float64 // avg variable spend
	MonthlyLivingCost         float64 // avg total living cost (EF threshold & buffer)

	// Obligations not already included in ExpenseMTD.
	MinDebtPayments float64

	// Projection context
	IsCurrentMonth bool
	DaysRemaining  int // remaining calendar days in month including today? services pass days after today
	DaysInMonth    int

	// Lowest projected daily balance from the cash ladder (optional; 0 means unknown).
	// When set (>0 or negative), safe-to-spend is capped by lowest - required buffer.
	LowestProjectedBalance float64
	HasLowestBalance       bool

	// Required buffer months of living cost that must stay liquid (default 0.5 in Compute if 0 and living cost > 0? we keep explicit).
	RequiredBuffer float64
}

// SafeToSpendScenarios holds conservative / expected / optimistic bands.
type SafeToSpendScenarios struct {
	Conservative float64
	Expected     float64
	Optimistic   float64
}

// DataQuality summarizes whether decision numbers should be trusted.
type DataQuality struct {
	IsSufficient       bool
	MissingFields      []string
	UsesFallbackValues bool
	Confidence         string // high | medium | low
}

// CashflowResult is the unified decision-support output.
type CashflowResult struct {
	AsOf           time.Time
	FormulaVersion string

	// Monthly surplus available for discretionary allocation (after buffer).
	// Surplus = max(0, income - fixed - variable - income*BufferRate)
	Surplus float64

	// Primary safe-to-spend (conservative).
	SafeToSpend          float64
	SafeToSpendScenarios SafeToSpendScenarios

	// Projected end-of-month liquid cash (simple remaining-days model).
	ProjectedEndBalance float64

	// Living-cost threshold used for is_tight style checks.
	LivingCostThreshold float64

	// Assumptions listed for UI explainability.
	Assumptions []string

	DataQuality DataQuality
}

// BufferRate is the fraction of income reserved before surplus allocation.
const BufferRate = 0.10

// floor0 returns max(0, v).
func floor0(v float64) float64 {
	if v < 0 {
		return 0
	}
	return v
}

// ComputeCashflow produces surplus, safe-to-spend scenarios, and projected end balance
// from a shared input snapshot. Pure function — no I/O.
func ComputeCashflow(in CashflowInputs) CashflowResult {
	asOf := in.AsOf
	if asOf.IsZero() {
		asOf = time.Now().UTC()
	}

	missing := []string{}
	// Income: prefer MTD for current month sufficiency; estimated for forecast months.
	incomeSignal := in.EstimatedIncome
	if in.IsCurrentMonth && in.IncomeMTD > 0 {
		incomeSignal = in.IncomeMTD
	}
	if incomeSignal <= 0 {
		missing = append(missing, "income")
	}
	if in.MonthlyLivingCost <= 0 && in.EstimatedVariableExpenses <= 0 {
		missing = append(missing, "expense_history")
	}

	living := in.MonthlyLivingCost
	if living <= 0 {
		living = in.EstimatedVariableExpenses
	}

	// --- Surplus (allocation) ---
	// Prefer full-month estimated figures so allocation is stable mid-month.
	// Fall back to MTD income when estimates missing.
	surplusIncome := in.EstimatedIncome
	if surplusIncome <= 0 {
		surplusIncome = in.IncomeMTD
	}
	fixed := in.EstimatedFixedExpenses
	if fixed <= 0 {
		fixed = in.MinDebtPayments
	}
	variable := in.EstimatedVariableExpenses
	if variable <= 0 {
		// Fall back to living cost as variable proxy.
		variable = living
	}
	buffer := BufferRate * surplusIncome
	surplus := floor0(surplusIncome - fixed - variable - buffer)

	// --- Remaining variable projection ---
	daysRem := in.DaysRemaining
	if daysRem < 0 {
		daysRem = 0
	}
	dailyVar := 0.0
	if in.EstimatedVariableExpenses > 0 {
		dailyVar = in.EstimatedVariableExpenses / 30.0
	} else if living > 0 {
		dailyVar = living / 30.0
	}
	projectedRemainingVar := dailyVar * float64(daysRem)

	// --- Projected end balance ---
	// Current month: start from cash, subtract remaining variable spend only
	// (MTD income/expense already reflected in cash; fixed obligations still due
	// are approximated via MinDebtPayments + remaining estimated fixed not yet paid —
	// we conservatively subtract outstanding min debt + remaining variable).
	// Future month: start from cash/starting balance + estimated income - fixed - variable.
	var projectedEnd float64
	if in.IsCurrentMonth {
		projectedEnd = in.CashAvailable - projectedRemainingVar - in.MinDebtPayments
		// Remaining fixed bills beyond min debt are not always known; when estimated fixed
		// exceeds already-paid portion we can't observe paid portion here — leave as-is.
	} else {
		projectedEnd = in.CashAvailable + in.EstimatedIncome - fixed - variable
	}
	// Do not floor projected end — negative is a real signal. Consumers may floor for display.

	// --- Safe-to-spend scenarios ---
	// Shared definition (kernel-v1):
	//   base = cash + remaining_income_estimate - remaining_obligations - remaining_variable - living_buffer
	// For current month, remaining_income_estimate = max(0, estimatedIncome - incomeMTD)
	// so we never double-count income already reflected in cash.
	remainingIncome := 0.0
	if in.IsCurrentMonth {
		remainingIncome = floor0(in.EstimatedIncome - in.IncomeMTD)
		// If no estimate, don't invent future income.
		if in.EstimatedIncome <= 0 {
			remainingIncome = 0
		}
	} else {
		remainingIncome = in.EstimatedIncome
	}

	remainingFixed := fixed
	if in.IsCurrentMonth {
		// Approximate remaining fixed as min debt payments still due this month.
		// Full bill calendar lives in the forecast ladder; kernel stays pure.
		remainingFixed = in.MinDebtPayments
		if remainingFixed <= 0 {
			remainingFixed = fixed
		}
	}

	// Living buffers for scenarios
	consBuffer := living             // full month living cost buffer
	expBuffer := living * 0.5        // half month
	optBuffer := projectedRemainingVar * 0.2 // light buffer on remaining variable only

	conservative := in.CashAvailable + remainingIncome - remainingFixed - projectedRemainingVar - consBuffer
	expected := in.CashAvailable + remainingIncome - remainingFixed - projectedRemainingVar - expBuffer
	optimistic := in.CashAvailable + remainingIncome - remainingFixed - projectedRemainingVar*0.8 - optBuffer

	// Cap by lowest projected balance - required buffer (invariant from audit).
	requiredBuffer := in.RequiredBuffer
	if requiredBuffer <= 0 && living > 0 {
		requiredBuffer = living * 0.05 // 5% of monthly living cost default reserve
	}
	if in.HasLowestBalance {
		cap := floor0(in.LowestProjectedBalance - requiredBuffer)
		conservative = math.Min(conservative, cap)
		expected = math.Min(expected, cap)
		// optimistic may exceed slightly but still cannot exceed lowest+small slack
		optimistic = math.Min(optimistic, floor0(in.LowestProjectedBalance))
	}

	conservative = floor0(conservative)
	expected = floor0(expected)
	optimistic = floor0(optimistic)
	// Ensure ordering conservative <= expected <= optimistic after floor
	if expected < conservative {
		expected = conservative
	}
	if optimistic < expected {
		optimistic = expected
	}

	// Data quality
	confidence := "high"
	if len(missing) > 0 {
		confidence = "low"
	} else if in.IsCurrentMonth && (in.IncomeMTD <= 0 || living <= 0) {
		confidence = "medium"
	} else if !in.HasLowestBalance {
		confidence = "medium"
	}

	assumptions := []string{
		"Surplus = estimated_income - fixed - variable - 10% income buffer (floored at 0)",
		"Safe-to-spend conservative uses full living-cost buffer",
		"Current-month remaining income = max(0, estimated_income - income_mtd) to avoid double-count",
		"Safe-to-spend capped by lowest_projected_balance - required_buffer when ladder available",
		"Formula version " + FormulaVersion,
	}

	return CashflowResult{
		AsOf:           asOf.UTC(),
		FormulaVersion: FormulaVersion,
		Surplus:        surplus,
		SafeToSpend:    conservative,
		SafeToSpendScenarios: SafeToSpendScenarios{
			Conservative: conservative,
			Expected:     expected,
			Optimistic:   optimistic,
		},
		ProjectedEndBalance: projectedEnd,
		LivingCostThreshold: living,
		Assumptions:         assumptions,
		DataQuality: DataQuality{
			IsSufficient:       len(missing) == 0,
			MissingFields:      missing,
			UsesFallbackValues: in.EstimatedVariableExpenses <= 0 && living > 0,
			Confidence:         confidence,
		},
	}
}
