package kernel

import "time"

// EFFormulaVersion versions emergency-fund target/coverage math.
const EFFormulaVersion = "ef-v1"

// Adaptive target months based on income stability over a lookback window.
// Rules (ef-v1):
//   - no income history → defaultMonths (typically 6)
//   - min/max monthly income ratio < 0.7 → unstable → 9 months
//   - otherwise stable → 4 months
// Manual targetMonths from user config always wins when UseAdaptive is false.
const (
	EFDefaultTargetMonths  = 6
	EFUnstableTargetMonths = 9
	EFStableTargetMonths   = 4
	EFIncomeStabilityFloor = 0.7
)

// EFInputs is a pure snapshot for emergency-fund metrics.
type EFInputs struct {
	AsOf time.Time

	// Total liquid balances marked as emergency fund.
	EFBalance float64

	// Monthly living cost (override or 3-month average).
	MonthlyLivingCost float64

	// Configured target months from user. Used when UseAdaptive is false,
	// or as the baseline default when adaptive has no income signal.
	ConfiguredTargetMonths int

	// When true and ConfiguredTargetMonths equals EFDefaultTargetMonths (or 0),
	// recompute target from income stability. Explicit non-default config wins.
	UseAdaptive bool

	// Min/max monthly income over lookback (e.g. last 3 months). Both 0 = no history.
	MinMonthlyIncome float64
	MaxMonthlyIncome float64
}

// EFResult is the unified emergency-fund decision output.
type EFResult struct {
	AsOf           time.Time
	FormulaVersion string

	TargetMonths       int
	TargetAmount       float64
	CoverageMonths     float64
	ProgressPercentage float64
	Status             string // Aman | Kurang | Kritis
	TargetRationale    string
	Assumptions        []string

	DataQuality DataQuality
}

// ComputeEF produces adaptive target, coverage, progress, and status.
// Pure function — no I/O.
func ComputeEF(in EFInputs) EFResult {
	asOf := in.AsOf
	if asOf.IsZero() {
		asOf = time.Now().UTC()
	}

	configured := in.ConfiguredTargetMonths
	if configured <= 0 {
		configured = EFDefaultTargetMonths
	}

	targetMonths := configured
	rationale := "Target manual pengguna"

	if in.UseAdaptive && (configured == EFDefaultTargetMonths || in.ConfiguredTargetMonths <= 0) {
		switch {
		case in.MaxMonthlyIncome <= 0:
			targetMonths = EFDefaultTargetMonths
			rationale = "6 bulan: histori pendapatan belum cukup"
		case in.MinMonthlyIncome/in.MaxMonthlyIncome < EFIncomeStabilityFloor:
			targetMonths = EFUnstableTargetMonths
			rationale = "9 bulan: pendapatan berfluktuasi"
		default:
			targetMonths = EFStableTargetMonths
			rationale = "4 bulan: pendapatan historis relatif stabil"
		}
	}

	living := in.MonthlyLivingCost
	targetAmount := living * float64(targetMonths)

	coverage := 0.0
	if living > 0 {
		coverage = in.EFBalance / living
	}

	progress := 0.0
	if targetAmount > 0 {
		progress = (in.EFBalance / targetAmount) * 100.0
	}

	status := "Kritis"
	if coverage >= float64(targetMonths) {
		status = "Aman"
	} else if coverage >= 3.0 {
		status = "Kurang"
	}

	missing := []string{}
	if living <= 0 {
		missing = append(missing, "living_cost_history")
	}
	confidence := "high"
	if len(missing) > 0 {
		confidence = "low"
	} else if in.MaxMonthlyIncome <= 0 && in.UseAdaptive {
		confidence = "medium"
	}

	return EFResult{
		AsOf:               asOf.UTC(),
		FormulaVersion:     EFFormulaVersion,
		TargetMonths:       targetMonths,
		TargetAmount:       targetAmount,
		CoverageMonths:     coverage,
		ProgressPercentage: progress,
		Status:             status,
		TargetRationale:    rationale,
		Assumptions: []string{
			"Coverage = EF balance / monthly living cost",
			"Target amount = living cost × target months",
			"Adaptive target: unstable income (<70% min/max) → 9 mo; stable → 4 mo; no history → 6 mo",
			"Status: ≥ target months = Aman; ≥ 3 months = Kurang; else Kritis",
			"Formula version " + EFFormulaVersion,
		},
		DataQuality: DataQuality{
			IsSufficient:       len(missing) == 0,
			MissingFields:      missing,
			UsesFallbackValues: false,
			Confidence:         confidence,
		},
	}
}
