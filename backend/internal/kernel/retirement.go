package kernel

import (
	"fmt"
	"math"
	"time"
)

// RetirementFormulaVersion versions inflation-adjusted retirement education math.
const RetirementFormulaVersion = "retirement-v1"

// Educational defaults — NOT product guarantees.
const (
	RetirementDefaultInflation     = 0.04  // 4% annual education assumption
	RetirementDefaultRealReturn    = 0.03  // real return after inflation (illustrative)
	RetirementDefaultNominalReturn = 0.07  // nominal education assumption
	RetirementDefaultLongevityLow  = 80
	RetirementDefaultLongevityMid  = 85
	RetirementDefaultLongevityHigh = 95
	RetirementDefaultRetireAge     = 60
	RetirementDefaultCurrentAge    = 35
	RetirementDefaultIncomeReplace = 0.70 // 70% of pre-retirement monthly expenses target
)

// RetirementInputs is a pure snapshot for retirement education.
type RetirementInputs struct {
	AsOf time.Time

	CurrentAge      int
	RetirementAge   int
	CurrentSavings  float64 // liquid + investment already earmarked
	MonthlyContrib  float64 // planned / actual monthly contribution
	MonthlyExpenses float64 // current lifestyle cost (IDR)
	// Optional overrides (0 = use educational defaults)
	InflationRate      float64
	NominalReturnRate  float64
	IncomeReplaceRatio float64 // 0–1 of expenses targeted in retirement
	LongevityLow       int
	LongevityMid       int
	LongevityHigh      int
}

// RetirementScenario is one longevity band outcome.
type RetirementScenario struct {
	Label              string  `json:"label"` // longevity_low | mid | high
	LongevityAge       int     `json:"longevity_age"`
	YearsInRetirement  int     `json:"years_in_retirement"`
	CorpusNeeded       float64 `json:"corpus_needed"`
	ProjectedCorpus    float64 `json:"projected_corpus"`
	FundingGap         float64 `json:"funding_gap"` // max(0, needed - projected)
	MonthlyShortfall   float64 `json:"monthly_shortfall"` // extra contrib needed to close gap
	IsFunded           bool    `json:"is_funded"`
	Note               string  `json:"note"`
}

// RetirementResult is the pure educational retirement view.
type RetirementResult struct {
	AsOf           time.Time `json:"as_of"`
	FormulaVersion string    `json:"formula_version"`

	CurrentAge     int     `json:"current_age"`
	RetirementAge  int     `json:"retirement_age"`
	YearsToRetire  int     `json:"years_to_retire"`
	CurrentSavings float64 `json:"current_savings"`
	MonthlyContrib float64 `json:"monthly_contribution"`
	MonthlyExpenses float64 `json:"monthly_expenses"`

	InflationRate      float64 `json:"inflation_rate"`
	NominalReturnRate  float64 `json:"nominal_return_rate"`
	RealReturnRate     float64 `json:"real_return_rate"`
	IncomeReplaceRatio float64 `json:"income_replace_ratio"`

	// Target monthly spending at retirement (today's IDR inflated)
	TargetMonthlyAtRetire float64 `json:"target_monthly_at_retire"`
	// Corpus needed for mid longevity (primary card)
	PrimaryCorpusNeeded  float64 `json:"primary_corpus_needed"`
	ProjectedCorpus      float64 `json:"projected_corpus"`
	PrimaryFundingGap    float64 `json:"primary_funding_gap"`
	RequiredMonthlyContrib float64 `json:"required_monthly_contribution"`
	ContributionGap      float64 `json:"contribution_gap"` // required - current

	Scenarios []RetirementScenario `json:"scenarios"`

	DataConfidence string   `json:"data_confidence"`
	IsSufficient   bool     `json:"is_sufficient"`
	MissingFields  []string `json:"missing_fields,omitempty"`
	Assumptions    []string `json:"assumptions"`
	Methodology    []string `json:"methodology"`
	Guidance       []string `json:"guidance"`
	Disclaimer     string   `json:"disclaimer"`
	// Explicit anti-guarantee flags
	IsGuaranteedReturn bool `json:"is_guaranteed_return"`
	IsProductAdvice    bool `json:"is_product_advice"`
}

// ComputeRetirementEducation builds inflation-adjusted retirement scenarios.
// Educational only — never guarantees returns or recommends products.
func ComputeRetirementEducation(in RetirementInputs) RetirementResult {
	asOf := in.AsOf
	if asOf.IsZero() {
		asOf = time.Now().UTC()
	}

	currentAge := in.CurrentAge
	if currentAge <= 0 {
		currentAge = RetirementDefaultCurrentAge
	}
	retireAge := in.RetirementAge
	if retireAge <= 0 {
		retireAge = RetirementDefaultRetireAge
	}
	if retireAge <= currentAge {
		retireAge = currentAge + 1
	}
	yearsToRetire := retireAge - currentAge

	inflation := in.InflationRate
	if inflation <= 0 {
		inflation = RetirementDefaultInflation
	}
	nominal := in.NominalReturnRate
	if nominal <= 0 {
		nominal = RetirementDefaultNominalReturn
	}
	// Approximate real return: (1+n)/(1+i) - 1
	realReturn := (1+nominal)/(1+inflation) - 1
	if realReturn < 0 {
		realReturn = 0
	}

	replace := in.IncomeReplaceRatio
	if replace <= 0 {
		replace = RetirementDefaultIncomeReplace
	}

	lonLow := in.LongevityLow
	if lonLow <= 0 {
		lonLow = RetirementDefaultLongevityLow
	}
	lonMid := in.LongevityMid
	if lonMid <= 0 {
		lonMid = RetirementDefaultLongevityMid
	}
	lonHigh := in.LongevityHigh
	if lonHigh <= 0 {
		lonHigh = RetirementDefaultLongevityHigh
	}

	expenses := math.Max(0, RoundIDR(in.MonthlyExpenses))
	savings := math.Max(0, RoundIDR(in.CurrentSavings))
	contrib := math.Max(0, RoundIDR(in.MonthlyContrib))

	// Target monthly at retirement in future IDR
	targetMonthly := RoundIDR(expenses * replace * math.Pow(1+inflation, float64(yearsToRetire)))

	// Project corpus at retirement with monthly contributions (nominal FV of annuity)
	projected := futureValueMonthly(savings, contrib, nominal, yearsToRetire)

	var missing []string
	if in.CurrentAge <= 0 {
		missing = append(missing, "current_age")
	}
	if in.RetirementAge <= 0 {
		missing = append(missing, "retirement_age")
	}
	if expenses <= 0 {
		missing = append(missing, "monthly_expenses")
	}
	if savings <= 0 && contrib <= 0 {
		missing = append(missing, "current_savings_or_contribution")
	}

	confidence := "high"
	if len(missing) >= 3 {
		confidence = "low"
	} else if len(missing) > 0 {
		confidence = "medium"
	}
	sufficient := len(missing) == 0

	// Build longevity scenarios — corpus needed = target monthly × 12 × years in retirement,
	// discounted to retirement-date purchasing power using real return (education approx).
	type band struct {
		label string
		age   int
	}
	bands := []band{
		{"longevity_low", lonLow},
		{"longevity_mid", lonMid},
		{"longevity_high", lonHigh},
	}

	scenarios := make([]RetirementScenario, 0, len(bands))
	var primaryNeed, primaryGap, requiredContrib float64

	for _, b := range bands {
		yearsInRet := b.age - retireAge
		if yearsInRet < 1 {
			yearsInRet = 1
		}
		// Corpus at retirement to fund target monthly for yearsInRet,
		// drawing down at real return (inflation-adjusted education model).
		need := corpusForAnnuity(targetMonthly, realReturn, yearsInRet)
		gap := math.Max(0, RoundIDR(need-projected))
		// Extra monthly contrib needed over yearsToRetire to close gap
		extra := 0.0
		if gap > 0 && yearsToRetire > 0 {
			extra = pmtForFutureValue(gap, nominal, yearsToRetire)
		}
		funded := gap <= 0.5 // rounding tolerance
		note := "Estimasi edukatif — hasil aktual dapat berbeda."
		if funded {
			note = "Proyeksi corpus ≥ kebutuhan skenario (bukan jaminan)."
		} else {
			note = fmt.Sprintf("Butuh ~Rp %s ekstra / bln untuk menutup gap skenario ini (estimasi).", formatIDRShort(extra))
		}
		sc := RetirementScenario{
			Label:             b.label,
			LongevityAge:      b.age,
			YearsInRetirement: yearsInRet,
			CorpusNeeded:      RoundIDR(need),
			ProjectedCorpus:   RoundIDR(projected),
			FundingGap:        gap,
			MonthlyShortfall:  RoundIDR(extra),
			IsFunded:          funded,
			Note:              note,
		}
		scenarios = append(scenarios, sc)
		if b.label == "longevity_mid" {
			primaryNeed = sc.CorpusNeeded
			primaryGap = sc.FundingGap
			requiredContrib = RoundIDR(contrib + extra)
		}
	}

	contribGap := math.Max(0, RoundIDR(requiredContrib-contrib))

	assumptions := []string{
		fmt.Sprintf("Inflasi edukatif %.1f%%/tahun (bukan prediksi).", inflation*100),
		fmt.Sprintf("Return nominal ilustratif %.1f%%/tahun — BUKAN jaminan hasil.", nominal*100),
		fmt.Sprintf("Return riil aproksimasi %.1f%%/tahun setelah inflasi.", realReturn*100),
		fmt.Sprintf("Target belanja pensiun = %.0f%% dari biaya hidup saat ini (dinaikkan inflasi).", replace*100),
		fmt.Sprintf("Longevity band %d / %d / %d tahun.", lonLow, lonMid, lonHigh),
		"Kontribusi bulanan diasumsikan konstan; tidak ada model gaji naik atau tax.",
		"Tidak memodelkan BPJS/jaminan sosial/pajak warisan — sesuaikan manual.",
	}

	methodology := []string{
		"1. Naikkan biaya hidup ke usia pensiun dengan faktor inflasi majemuk.",
		"2. Target belanja bulanan pensiun = rasio pengganti × biaya inflated.",
		"3. Proyeksikan tabungan: FV lump sum + FV anuitas kontribusi bulanan (nominal).",
		"4. Hitung corpus kebutuhan per band longevity dengan penarikan riil.",
		"5. Funding gap = max(0, corpus kebutuhan − proyeksi); shortfall kontribusi dari PMT gap.",
		"6. Semua angka berlabel estimasi edukatif; is_guaranteed_return=false.",
	}

	guidance := []string{
		"Mulai dari gap kontribusi skenario mid longevity — itu target edukatif utama.",
		"Naikkan kontribusi bertahap atau perpanjang masa kerja jika gap besar.",
		"Jaga dana darurat & utang berbunga tinggi sebelum membesarkan kontribusi pensiun.",
		"Band longevity high menunjukan sensitivitas usia panjang — bukan prediksi kematian.",
		"Konsultasikan perencana berizin bila butuh saran personal; ini bukan nasihat investasi.",
	}
	if !sufficient {
		guidance = append([]string{"Lengkapi usia, target pensiun, biaya hidup, dan tabungan agar estimasi lebih bermakna."}, guidance...)
	}

	disclaimer := "Estimasi edukatif berbasis asumsi generik. Bukan jaminan return, bukan proyeksi produk, " +
		"bukan nasihat investasi/asuransi berizin, dan bukan simulasi pajak. Hasil aktual dapat jauh berbeda."

	return RetirementResult{
		AsOf:                   asOf.UTC(),
		FormulaVersion:         RetirementFormulaVersion,
		CurrentAge:             currentAge,
		RetirementAge:          retireAge,
		YearsToRetire:          yearsToRetire,
		CurrentSavings:         savings,
		MonthlyContrib:         contrib,
		MonthlyExpenses:        expenses,
		InflationRate:          inflation,
		NominalReturnRate:      nominal,
		RealReturnRate:         realReturn,
		IncomeReplaceRatio:     replace,
		TargetMonthlyAtRetire:  targetMonthly,
		PrimaryCorpusNeeded:    primaryNeed,
		ProjectedCorpus:        RoundIDR(projected),
		PrimaryFundingGap:      primaryGap,
		RequiredMonthlyContrib: requiredContrib,
		ContributionGap:        contribGap,
		Scenarios:              scenarios,
		DataConfidence:         confidence,
		IsSufficient:           sufficient,
		MissingFields:          missing,
		Assumptions:            assumptions,
		Methodology:            methodology,
		Guidance:               guidance,
		Disclaimer:             disclaimer,
		IsGuaranteedReturn:     false,
		IsProductAdvice:        false,
	}
}

// futureValueMonthly: FV = PV*(1+r)^n + PMT * [((1+r_m)^(12n) - 1) / r_m]
// with r annual nominal, monthly compounding approximation.
func futureValueMonthly(pv, pmt, annualRate float64, years int) float64 {
	if years <= 0 {
		return pv
	}
	n := years
	// Annual compounding for PV growth (simpler education model)
	grown := pv * math.Pow(1+annualRate, float64(n))
	if pmt <= 0 {
		return grown
	}
	// Monthly rate
	rm := annualRate / 12.0
	months := float64(n * 12)
	if math.Abs(rm) < 1e-12 {
		return grown + pmt*months
	}
	annuity := pmt * (math.Pow(1+rm, months) - 1) / rm
	return grown + annuity
}

// corpusForAnnuity: present value at retirement of monthly withdrawals for years,
// discounted at real annual rate (education).
func corpusForAnnuity(monthly, realAnnual float64, years int) float64 {
	if years <= 0 || monthly <= 0 {
		return 0
	}
	rm := realAnnual / 12.0
	months := float64(years * 12)
	if math.Abs(rm) < 1e-12 {
		return monthly * months
	}
	// PV of ordinary annuity
	return monthly * (1 - math.Pow(1+rm, -months)) / rm
}

// pmtForFutureValue: monthly payment to reach FV in years at annual nominal rate.
func pmtForFutureValue(fv, annualRate float64, years int) float64 {
	if fv <= 0 || years <= 0 {
		return 0
	}
	rm := annualRate / 12.0
	months := float64(years * 12)
	if math.Abs(rm) < 1e-12 {
		return fv / months
	}
	// PMT = FV * r / ((1+r)^n - 1)
	return fv * rm / (math.Pow(1+rm, months) - 1)
}

func formatIDRShort(v float64) string {
	v = math.Abs(RoundIDR(v))
	if v >= 1_000_000_000 {
		return fmt.Sprintf("%.1fM", v/1_000_000_000) // miliar shorthand ambiguous — use full
	}
	// Use Indonesian grouping via integer
	n := int64(v)
	if n < 1000 {
		return fmt.Sprintf("%d", n)
	}
	s := fmt.Sprintf("%d", n)
	// insert dots every 3 from right
	out := make([]byte, 0, len(s)+len(s)/3)
	for i, c := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			out = append(out, '.')
		}
		out = append(out, byte(c))
	}
	return string(out)
}
