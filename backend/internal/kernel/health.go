package kernel

import (
	"fmt"
	"math"
	"time"
)

// HealthFormulaVersion versions the composite financial health score.
const HealthFormulaVersion = "health-v1"

// Component weights (must sum to 1.0).
const (
	HealthWeightDTI     = 0.30
	HealthWeightEF      = 0.30
	HealthWeightCash    = 0.20
	HealthWeightSavings = 0.20
	// Reconciliation confidence floor: unreconciled books cannot look perfect.
	HealthReconFloor = 0.70
)

// HealthInputs drives ComputeHealthScore. Pure — no I/O.
type HealthInputs struct {
	AsOf time.Time

	// IncomeThisMonth: if <= 0, DTI is not scorable → insufficient, no false healthy.
	IncomeThisMonth      float64
	ExpenseThisMonth     float64
	TotalMinDebtPayments float64
	CashAvailable        float64
	MonthlyLivingCost    float64

	// EF from shared ef-v1 (caller runs ComputeEF first).
	EFCoverageMonths float64
	EFTargetMonths   float64

	// Reconciliation over recent window (0–1 rate).
	ReconciliationRate float64 // 0..1; if no txs, pass 1.0

	// Income stability: min/max monthly income over lookback. Volatile → slight confidence haircut.
	MinMonthlyIncome float64
	MaxMonthlyIncome float64

	// OptOut: user disabled gamified score — still return methodology but Score=0, Rating=opt_out.
	OptOut bool
}

// HealthComponent is one scored pillar with explainability.
type HealthComponent struct {
	Key         string  `json:"key"`
	Label       string  `json:"label"`
	Weight      float64 `json:"weight"`
	RawScore    float64 `json:"raw_score"` // 0–100 before weight
	Weighted    float64 `json:"weighted"`  // weight * raw
	Included    bool    `json:"included"`  // false if data insufficient for this pillar
	Explain     string  `json:"explain"`
	ValueLabel  string  `json:"value_label,omitempty"` // e.g. "DTI 32%"
}

// HealthResult is the pure health score output.
type HealthResult struct {
	AsOf           time.Time
	FormulaVersion string

	Score       int    // 0–100 after confidence; 0 if insufficient or opt-out
	Rating      string // Excellent|Good|Fair|Poor|Critical|Insufficient|OptOut
	StatusColor string // Green|Yellow|Orange|Red|Gray

	// DTI
	DTIRatio  float64
	DTIStatus string // healthy|warning|danger|insufficient

	RawScore                float64 // pre-confidence composite 0–100
	ReconciliationRate      float64
	ReconciliationConfidence float64 // 0.70–1.0
	DataConfidence          string  // high|medium|low
	IsSufficient            bool
	MissingFields           []string

	Components  []HealthComponent
	Methodology []string
	Disclaimer  string
	Assumptions []string

	// Not a credit score — always true for API consumers.
	IsCreditScore bool // always false
}

// ComputeHealthScore builds a governed composite score. Pure function.
func ComputeHealthScore(in HealthInputs) HealthResult {
	if in.AsOf.IsZero() {
		in.AsOf = time.Now().UTC()
	}
	methodology := []string{
		"Composite weights: DTI 30%, Emergency Fund 30%, Cash buffer 20%, Savings rate 20%",
		"DTI score: 100 if DTI<20%; linear to 0 at DTI≥60%; excluded (not zero) when income missing",
		"EF score: min(100, coverage_months / adaptive_target_months × 100)",
		"Cash score: min(100, cash / monthly_living_cost × 50) — 2 months living cost ≈ 100",
		"Savings score: min(100, (income−expense)/income × 200) when income > 0 — 50% savings rate ≈ 100",
		"Reconciliation confidence multiplies raw score: floor 0.70 at 0% reconciled → 1.0 at 100%",
		"Volatile income (min/max ratio < 0.7) caps data confidence at medium",
		"This is NOT a credit score, bank underwriting grade, or investment advice",
		"Formula version " + HealthFormulaVersion,
	}
	disclaimer := "Bukan credit score. Skor edukatif berdasarkan data yang Anda input — bukan penilaian dari biro kredit atau bank."

	if in.OptOut {
		return HealthResult{
			AsOf:           in.AsOf.UTC(),
			FormulaVersion: HealthFormulaVersion,
			Score:          0,
			Rating:         "OptOut",
			StatusColor:    "Gray",
			DTIStatus:      "insufficient",
			IsSufficient:   false,
			MissingFields:  []string{"opt_out"},
			Methodology:    methodology,
			Disclaimer:     disclaimer,
			IsCreditScore:  false,
			DataConfidence: "low",
			Assumptions:    []string{"User opted out of gamified health score"},
		}
	}

	var missing []string
	var components []HealthComponent

	// --- DTI ---
	dtiRatio := 0.0
	dtiStatus := "insufficient"
	dtiScore := 0.0
	dtiIncluded := false
	dtiExplain := "DTI membutuhkan income bulan ini"
	if in.IncomeThisMonth > 0 {
		dtiIncluded = true
		dtiRatio = (in.TotalMinDebtPayments / in.IncomeThisMonth) * 100
		if dtiRatio < 20 {
			dtiStatus = "healthy"
			dtiScore = 100
		} else if dtiRatio <= 60 {
			dtiStatus = "warning"
			if dtiRatio > 50 {
				dtiStatus = "danger"
			}
			dtiScore = 100 - (dtiRatio-20)*(100.0/40.0)
		} else {
			dtiStatus = "danger"
			dtiScore = 0
		}
		dtiExplain = "Rasio cicilan minimum terhadap income"
	} else {
		missing = append(missing, "income")
		// Critical: do NOT treat missing income as DTI=0 healthy.
		dtiStatus = "insufficient"
	}
	components = append(components, HealthComponent{
		Key: "dti", Label: "Debt-to-Income", Weight: HealthWeightDTI,
		RawScore: dtiScore, Weighted: ternary(dtiIncluded, HealthWeightDTI*dtiScore, 0),
		Included: dtiIncluded, Explain: dtiExplain,
		ValueLabel: func() string {
			if !dtiIncluded {
				return "n/a (no income)"
			}
			return "DTI " + formatPct(dtiRatio)
		}(),
	})

	// --- EF ---
	efTarget := in.EFTargetMonths
	if efTarget <= 0 {
		efTarget = float64(EFDefaultTargetMonths)
	}
	efScore := math.Min(100, (in.EFCoverageMonths/efTarget)*100)
	efIncluded := in.MonthlyLivingCost > 0 || in.EFCoverageMonths > 0
	if in.MonthlyLivingCost <= 0 && in.EFCoverageMonths <= 0 {
		missing = append(missing, "living_cost")
		efIncluded = false
		efScore = 0
	}
	components = append(components, HealthComponent{
		Key: "emergency_fund", Label: "Emergency Fund", Weight: HealthWeightEF,
		RawScore: efScore, Weighted: ternary(efIncluded, HealthWeightEF*efScore, 0),
		Included: efIncluded, Explain: "Cakupan EF vs target adaptif (ef-v1)",
		ValueLabel: formatMonths(in.EFCoverageMonths) + " / " + formatMonths(efTarget) + " bln",
	})

	// --- Cash ---
	cashScore := 0.0
	cashIncluded := in.MonthlyLivingCost > 0
	if cashIncluded {
		cashScore = math.Min(100, (in.CashAvailable/in.MonthlyLivingCost)*50.0)
	} else if in.CashAvailable > 0 {
		// Cash exists but no living cost baseline — partial, score neutral low-confidence
		cashIncluded = false
		if !containsStrK(missing, "living_cost") {
			missing = append(missing, "living_cost")
		}
	}
	components = append(components, HealthComponent{
		Key: "cash", Label: "Cash buffer", Weight: HealthWeightCash,
		RawScore: cashScore, Weighted: ternary(cashIncluded, HealthWeightCash*cashScore, 0),
		Included: cashIncluded, Explain: "Kas likuid vs biaya hidup bulanan",
	})

	// --- Savings ---
	savingsThisMonth := in.IncomeThisMonth - in.ExpenseThisMonth
	if savingsThisMonth < 0 {
		savingsThisMonth = 0
	}
	savingsScore := 0.0
	savingsIncluded := in.IncomeThisMonth > 0
	if savingsIncluded {
		savingsScore = math.Min(100, (savingsThisMonth/in.IncomeThisMonth)*200)
	}
	components = append(components, HealthComponent{
		Key: "savings_rate", Label: "Savings rate", Weight: HealthWeightSavings,
		RawScore: savingsScore, Weighted: ternary(savingsIncluded, HealthWeightSavings*savingsScore, 0),
		Included: savingsIncluded, Explain: "Proporsi sisa income bulan ini (dibatasi 50% → skor 100)",
	})

	// Re-weight if some pillars excluded so we don't silently give free points.
	activeWeight := 0.0
	weightedSum := 0.0
	for _, c := range components {
		if c.Included {
			activeWeight += c.Weight
			weightedSum += c.Weight * c.RawScore
		}
	}
	rawHealth := 0.0
	if activeWeight > 0 {
		rawHealth = weightedSum / activeWeight // normalize to 0–100 over included pillars
	}

	// Rebuild weighted display with normalized weights for transparency
	if activeWeight > 0 {
		for i := range components {
			if components[i].Included {
				components[i].Weighted = (components[i].Weight / activeWeight) * components[i].RawScore
			} else {
				components[i].Weighted = 0
			}
		}
	}

	reconRate := in.ReconciliationRate
	if reconRate < 0 {
		reconRate = 0
	}
	if reconRate > 1 {
		reconRate = 1
	}
	reconConf := HealthReconFloor + (1.0-HealthReconFloor)*reconRate

	// Income volatility haircut on confidence label (not score) when ratio low.
	dataConf := "high"
	if in.IncomeThisMonth <= 0 {
		dataConf = "low"
	} else if in.MaxMonthlyIncome > 0 && in.MinMonthlyIncome > 0 {
		ratio := in.MinMonthlyIncome / in.MaxMonthlyIncome
		if ratio < 0.7 {
			dataConf = "medium"
		}
	}
	if reconRate < 0.5 {
		if dataConf == "high" {
			dataConf = "medium"
		} else {
			dataConf = "low"
		}
	}
	// Need at least income OR (EF+cash living cost) to show a score
	sufficient := in.IncomeThisMonth > 0 || (efIncluded && cashIncluded)
	if !sufficient {
		dataConf = "low"
	}

	scoreVal := int(math.Round(rawHealth * reconConf))
	if scoreVal > 100 {
		scoreVal = 100
	}
	if scoreVal < 0 {
		scoreVal = 0
	}

	rating, color := "Critical", "Red"
	if !sufficient {
		rating, color = "Insufficient", "Gray"
		scoreVal = 0 // never show a pretty number on empty books
	} else if scoreVal >= 80 {
		rating, color = "Excellent", "Green"
	} else if scoreVal >= 60 {
		rating, color = "Good", "Green"
	} else if scoreVal >= 40 {
		rating, color = "Fair", "Yellow"
	} else if scoreVal >= 20 {
		rating, color = "Poor", "Orange"
	}

	return HealthResult{
		AsOf:                     in.AsOf.UTC(),
		FormulaVersion:           HealthFormulaVersion,
		Score:                    scoreVal,
		Rating:                   rating,
		StatusColor:              color,
		DTIRatio:                 dtiRatio,
		DTIStatus:                dtiStatus,
		RawScore:                 rawHealth,
		ReconciliationRate:       reconRate,
		ReconciliationConfidence: reconConf,
		DataConfidence:           dataConf,
		IsSufficient:             sufficient,
		MissingFields:            missing,
		Components:               components,
		Methodology:              methodology,
		Disclaimer:               disclaimer,
		IsCreditScore:            false,
		Assumptions: []string{
			"Pillars without data are excluded and weights renormalized — missing income does not grant free DTI points",
			"Reconciliation confidence floor " + formatPct(HealthReconFloor*100),
		},
	}
}

func ternary(cond bool, a, b float64) float64 {
	if cond {
		return a
	}
	return b
}

func formatPct(v float64) string {
	return fmt.Sprintf("%.1f%%", v)
}

func formatMonths(v float64) string {
	return fmt.Sprintf("%.1f", v)
}

func containsStrK(ss []string, target string) bool {
	for _, s := range ss {
		if s == target {
			return true
		}
	}
	return false
}
