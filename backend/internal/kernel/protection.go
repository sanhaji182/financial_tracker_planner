package kernel

import (
	"fmt"
	"math"
	"time"
)

// ProtectionFormulaVersion versions needs-based protection gap math.
const ProtectionFormulaVersion = "protection-v1"

// Default multiple of annual income for life-cover education estimate
// when dependents exist. Not a product recommendation.
const (
	ProtectionIncomeMultipleDefault   = 10.0
	ProtectionIncomeMultipleNoDep     = 5.0
	ProtectionFuneralBufferMonths     = 3.0
	ProtectionEducationPerDependent   = 50_000_000.0 // educational placeholder IDR assumption
	ProtectionHealthWeight            = 20
	ProtectionLifeWeight              = 25
	ProtectionEFWeight                = 25
	ProtectionDTIWeight               = 15
	ProtectionIncomeStabilityWeight   = 10
	ProtectionMultiEarnerWeight       = 5
)

// ProtectionInputs is a pure snapshot for coverage-gap education.
type ProtectionInputs struct {
	AsOf time.Time

	MonthlyIncome   float64
	MonthlyExpenses float64
	EFBalance       float64
	EFCoverageMonths float64
	EFTargetMonths  float64
	OutstandingDebts float64

	DependentsCount    int
	IncomeEarnersCount int
	HasHealthInsurance bool
	HasLifeInsurance   bool

	// Optional existing life cover amount (IDR). 0 = unknown/none.
	ExistingLifeCover float64

	// Years until youngest dependent is independent. 0 → default 18 if dependents > 0.
	YearsToIndependence int

	// Income stability signal (min/max monthly). Both 0 = unknown.
	MinMonthlyIncome float64
	MaxMonthlyIncome float64

	// Override income multiple (0 = use default rules).
	IncomeMultipleOverride float64
}

// ProtectionGapItem is one educational gap category.
type ProtectionGapItem struct {
	Category    string  `json:"category"`
	Severity    string  `json:"severity"` // high | medium | low
	Description string  `json:"description"`
	Amount      float64 `json:"amount,omitempty"` // optional IDR magnitude
}

// ProtectionResult is needs-based educational assessment. Never product advice.
type ProtectionResult struct {
	AsOf           time.Time `json:"as_of"`
	FormulaVersion string    `json:"formula_version"`

	// Needs-based life cover estimate (educational).
	LifeCoverNeed     float64 `json:"life_cover_need"`
	ExistingLifeCover float64 `json:"existing_life_cover"`
	LifeCoverGap      float64 `json:"life_cover_gap"` // max(0, need − existing − partial liquid)

	// Component breakdown of need
	IncomeReplacement   float64 `json:"income_replacement"`
	DebtClearance       float64 `json:"debt_clearance"`
	DependentEducation  float64 `json:"dependent_education_buffer"`
	FuneralBuffer       float64 `json:"funeral_buffer"`
	LiquidOffset        float64 `json:"liquid_offset"` // EF counted against need

	ProtectionScore int    `json:"protection_score"` // 0–100 educational composite
	ScoreLabel      string `json:"score_label"`      // Strong | Adequate | Thin | Critical | Insufficient
	DataConfidence  string `json:"data_confidence"`  // high | medium | low
	IsSufficient    bool   `json:"is_sufficient"`
	MissingFields   []string `json:"missing_fields"`

	Gaps            []ProtectionGapItem `json:"gaps"`
	Guidance        []string            `json:"guidance"` // neutral educational bullets
	Assumptions     []string            `json:"assumptions"`
	Methodology     []string            `json:"methodology"`
	Disclaimer      string              `json:"disclaimer"`
	IsProductAdvice bool                `json:"is_product_advice"` // always false
}

// ComputeProtectionAssessment builds a needs-based educational protection view.
// Pure function — no product / insurer / instrument recommendations.
func ComputeProtectionAssessment(in ProtectionInputs) ProtectionResult {
	asOf := in.AsOf
	if asOf.IsZero() {
		asOf = time.Now().UTC()
	}

	methodology := []string{
		"Educational needs estimate only — not insurance suitability or product advice",
		"Life cover need ≈ income_replacement + outstanding_debts + education_buffer + funeral_buffer − liquid_EF_offset",
		fmt.Sprintf("Income replacement default: %gx annual income with dependents, %gx without (override supported)",
			ProtectionIncomeMultipleDefault, ProtectionIncomeMultipleNoDep),
		"Education buffer is a flat educational placeholder per dependent — replace with household-specific costs",
		"Score weights: health 20, life cover presence 25, EF 25, DTI 15, income stability 10, multi-earner 5",
		"Missing income → insufficient confidence; no 'healthy' false signal",
	}

	disclaimer := "Ini adalah estimasi edukatif berbasis asumsi generik, bukan rekomendasi produk asuransi, " +
		"nasihat berizin, atau penilaian underwriting. Sesuaikan angka dengan kebutuhan rumah tangga " +
		"dan konsultasikan profesional berizin bila diperlukan."

	assumptions := []string{
		"Formula version " + ProtectionFormulaVersion,
		fmt.Sprintf("Funeral buffer = %.0f × monthly expenses", ProtectionFuneralBufferMonths),
		fmt.Sprintf("Education placeholder = %.0f IDR per dependent", ProtectionEducationPerDependent),
		"Liquid offset uses emergency-fund balance only (not full net worth)",
		"No insurer, rider, or premium is recommended",
	}

	var missing []string
	if in.MonthlyIncome <= 0 {
		missing = append(missing, "income")
	}
	if in.MonthlyExpenses <= 0 {
		missing = append(missing, "expenses")
	}
	if in.IncomeEarnersCount <= 0 {
		missing = append(missing, "income_earners_count")
	}

	// Life cover need components
	mult := in.IncomeMultipleOverride
	if mult <= 0 {
		if in.DependentsCount > 0 {
			mult = ProtectionIncomeMultipleDefault
		} else {
			mult = ProtectionIncomeMultipleNoDep
		}
	}
	// Optional: if years-to-independence set and dependents > 0, cap multiple by years
	years := in.YearsToIndependence
	if in.DependentsCount > 0 && years <= 0 {
		years = 18
	}
	if in.DependentsCount > 0 && years > 0 && in.IncomeMultipleOverride <= 0 {
		// Use min(default multiple, years) as a soft education range label in assumptions
		assumptions = append(assumptions, fmt.Sprintf(
			"Dependents present; independence horizon assumed %d years (informational)", years))
	}

	annualIncome := math.Max(0, in.MonthlyIncome) * 12
	incomeReplacement := RoundMoney(annualIncome*mult, 2)
	debtClearance := RoundMoney(math.Max(0, in.OutstandingDebts), 2)
	depCount := in.DependentsCount
	if depCount < 0 {
		depCount = 0
	}
	eduBuffer := RoundMoney(float64(depCount)*ProtectionEducationPerDependent, 2)
	funeral := RoundMoney(math.Max(0, in.MonthlyExpenses)*ProtectionFuneralBufferMonths, 2)
	liquidOffset := RoundMoney(math.Max(0, in.EFBalance), 2)

	need := RoundMoney(incomeReplacement+debtClearance+eduBuffer+funeral, 2)
	existing := RoundMoney(math.Max(0, in.ExistingLifeCover), 2)
	// Only count existing life cover + partial liquid against need
	covered := existing + liquidOffset
	gap := RoundMoney(math.Max(0, need-covered), 2)

	assumptions = append(assumptions, fmt.Sprintf("Income multiple applied: %.1fx annual income", mult))

	// Score (educational composite)
	score := 0
	var gaps []ProtectionGapItem
	var guidance []string

	// Health insurance presence
	if in.HasHealthInsurance {
		score += ProtectionHealthWeight
	} else {
		gaps = append(gaps, ProtectionGapItem{
			Category:    "health_insurance",
			Severity:    "high",
			Description: "Belum ada indikasi proteksi kesehatan. Pertimbangkan cakupan dasar untuk seluruh anggota rumah tangga.",
		})
		guidance = append(guidance, "Pastikan ada proteksi kesehatan dasar (publik atau swasta) sebelum fokus ke produk lain.")
	}

	// Life cover
	if in.HasLifeInsurance && existing > 0 && gap <= need*0.2 {
		score += ProtectionLifeWeight
	} else if in.HasLifeInsurance {
		score += ProtectionLifeWeight * 2 / 3
		if gap > 0 {
			gaps = append(gaps, ProtectionGapItem{
				Category:    "life_cover_gap",
				Severity:    "medium",
				Description: fmt.Sprintf("Estimasi kebutuhan proteksi jiwa ~%s; cakupan tercatat masih menyisakan gap ~%s.", moneyLabel(need), moneyLabel(gap)),
				Amount:      gap,
			})
			guidance = append(guidance, "Tinjau apakah pertanggungan jiwa yang ada mendekati kebutuhan pengganti pendapatan + utang + buffer tanggungan.")
		}
	} else if in.DependentsCount > 0 || in.IncomeEarnersCount <= 1 {
		gaps = append(gaps, ProtectionGapItem{
			Category:    "life_insurance",
			Severity:    "high",
			Description: fmt.Sprintf("Dengan %d tanggungan dan %d pencari nafkah, estimasi kebutuhan pengganti pendapatan + utang ≈ %s (edukatif).", in.DependentsCount, maxInt(in.IncomeEarnersCount, 1), moneyLabel(need)),
			Amount:      gap,
		})
		guidance = append(guidance, "Hitung kebutuhan pengganti pendapatan secara mandiri; bandingkan dengan utang outstanding dan biaya tanggungan.")
	} else {
		score += ProtectionLifeWeight / 2
		if gap > 0 {
			gaps = append(gaps, ProtectionGapItem{
				Category:    "life_cover_gap",
				Severity:    "low",
				Description: "Tanpa tanggungan, kebutuhan tetap ada untuk utang dan biaya akhir (estimasi edukatif).",
				Amount:      gap,
			})
		}
	}

	// EF
	targetMonths := in.EFTargetMonths
	if targetMonths <= 0 {
		targetMonths = EFDefaultTargetMonths
	}
	efMonths := in.EFCoverageMonths
	if efMonths <= 0 && in.MonthlyExpenses > 0 && in.EFBalance > 0 {
		efMonths = in.EFBalance / in.MonthlyExpenses
	}
	if efMonths >= targetMonths {
		score += ProtectionEFWeight
	} else if efMonths > 0 {
		score += int(math.Round((efMonths / targetMonths) * float64(ProtectionEFWeight)))
		sev := "medium"
		if efMonths < 1 {
			sev = "high"
		}
		gaps = append(gaps, ProtectionGapItem{
			Category:    "emergency_fund",
			Severity:    sev,
			Description: fmt.Sprintf("Dana darurat ≈ %.1f bulan vs target adaptif %.0f bulan.", efMonths, targetMonths),
			Amount:      RoundMoney(math.Max(0, targetMonths*in.MonthlyExpenses-in.EFBalance), 2),
		})
		guidance = append(guidance, "Prioritaskan dana darurat likuid sebelum menambah komitmen proteksi berbiaya tinggi.")
	} else {
		gaps = append(gaps, ProtectionGapItem{
			Category:    "emergency_fund",
			Severity:    "high",
			Description: "Belum terdeteksi saldo dana darurat. Ini fondasi ketahanan kas rumah tangga.",
		})
		guidance = append(guidance, "Bangun buffer kas darurat terlebih dulu agar shock pendapatan tidak memaksa utang mahal.")
	}

	// DTI proxy from debts vs income (minimum payments not always available — use debt/annual income rough)
	dti := 0.0
	dtiKnown := false
	if in.MonthlyIncome > 0 && in.OutstandingDebts >= 0 {
		// Approximate monthly debt service as 1/36 of outstanding if no payment data (installment heuristic)
		// Caller should prefer real min payments; we only have outstanding here so use soft signal:
		// debt-to-annual-income ratio.
		dti = (in.OutstandingDebts / (in.MonthlyIncome * 12)) * 100
		dtiKnown = true
		assumptions = append(assumptions, "DTI signal uses outstanding_debt / annual_income (rough) when min payments not supplied")
	}
	if !dtiKnown || in.MonthlyIncome <= 0 {
		// partial credit withheld
		score += 0
	} else if dti < 30 {
		score += ProtectionDTIWeight
	} else if dti < 60 {
		score += ProtectionDTIWeight / 2
		gaps = append(gaps, ProtectionGapItem{
			Category:    "debt_load",
			Severity:    "medium",
			Description: fmt.Sprintf("Beban utang (outstanding/annual income) ≈ %.0f%% — pantau arus kas cicilan.", dti),
		})
	} else {
		gaps = append(gaps, ProtectionGapItem{
			Category:    "debt_load",
			Severity:    "high",
			Description: fmt.Sprintf("Beban utang tinggi (≈ %.0f%% outstanding vs income tahunan). Proteksi jiwa sering lebih relevan untuk menutup utang.", dti),
		})
		guidance = append(guidance, "Utang berbunga tinggi dan cicilan besar menekan kemampuan bayar premi/iuran — selaraskan prioritas.")
	}

	// Income stability
	stable := true
	if in.MaxMonthlyIncome > 0 && in.MonthlyIncome > 0 {
		variance := (in.MaxMonthlyIncome - in.MinMonthlyIncome) / in.MonthlyIncome
		stable = variance < 0.5
	}
	if in.MonthlyIncome <= 0 {
		// no credit
	} else if stable {
		score += ProtectionIncomeStabilityWeight
	} else {
		score += ProtectionIncomeStabilityWeight / 2
		gaps = append(gaps, ProtectionGapItem{
			Category:    "income_stability",
			Severity:    "medium",
			Description: "Variasi penghasilan bulanan cukup besar; buffer kas dan proteksi pendapatan lebih krusial.",
		})
	}

	// Multi-earner
	earners := in.IncomeEarnersCount
	if earners <= 0 {
		earners = 1
	}
	if earners >= 2 {
		score += ProtectionMultiEarnerWeight
	} else {
		score += 2
		if in.DependentsCount > 0 {
			gaps = append(gaps, ProtectionGapItem{
				Category:    "single_earner",
				Severity:    "medium",
				Description: "Satu pencari nafkah dengan tanggungan — risiko konsentrasi pendapatan lebih tinggi.",
			})
		}
	}

	if score > 100 {
		score = 100
	}
	if score < 0 {
		score = 0
	}

	// Data confidence
	conf := "high"
	sufficient := len(missing) == 0
	switch {
	case len(missing) >= 2 || in.MonthlyIncome <= 0:
		conf = "low"
		sufficient = false
		score = int(math.Min(float64(score), 40)) // cap when income missing — no false strong
	case len(missing) == 1 || in.ExistingLifeCover == 0 && in.HasLifeInsurance:
		conf = "medium"
	}

	label := protectionLabel(score, sufficient)

	if len(guidance) == 0 {
		guidance = append(guidance, "Estimasi proteksi tampak memadai pada asumsi saat ini — review ulang saat ada perubahan tanggungan, utang, atau pendapatan.")
	}
	// Always include non-product framing
	guidance = append(guidance, "Bandingkan opsi secara mandiri (termasuk skema publik). Aplikasi ini tidak menjual atau merekomendasikan produk tertentu.")

	return ProtectionResult{
		AsOf:                asOf,
		FormulaVersion:      ProtectionFormulaVersion,
		LifeCoverNeed:       need,
		ExistingLifeCover:   existing,
		LifeCoverGap:        gap,
		IncomeReplacement:   incomeReplacement,
		DebtClearance:       debtClearance,
		DependentEducation:  eduBuffer,
		FuneralBuffer:       funeral,
		LiquidOffset:        liquidOffset,
		ProtectionScore:     score,
		ScoreLabel:          label,
		DataConfidence:      conf,
		IsSufficient:        sufficient,
		MissingFields:       missing,
		Gaps:                gaps,
		Guidance:            guidance,
		Assumptions:         assumptions,
		Methodology:         methodology,
		Disclaimer:          disclaimer,
		IsProductAdvice:     false,
	}
}

func protectionLabel(score int, sufficient bool) string {
	if !sufficient {
		return "Insufficient"
	}
	switch {
	case score >= 80:
		return "Strong"
	case score >= 60:
		return "Adequate"
	case score >= 40:
		return "Thin"
	default:
		return "Critical"
	}
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
