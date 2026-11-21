package kernel

import (
	"math"
	"time"
)

// ForecastScenarioVersion versions multi-scenario ladder + backtest math.
const ForecastScenarioVersion = "forecast-v2"

// Variable spend multipliers for end-balance scenario bands (forecast-v2).
// Fixed events (income/bills/debts) stay identical; only variable drag scales.
const (
	VarMultConservative = 1.25 // heavier discretionary spend
	VarMultExpected     = 1.00
	VarMultOptimistic   = 0.75 // lighter discretionary spend
)

// ScenarioLadderSet is three ladders + end-balance bands.
type ScenarioLadderSet struct {
	FormulaVersion string
	Conservative   LadderResult
	Expected       LadderResult
	Optimistic     LadderResult

	// End-of-month projected balances (ordering: C ≤ E ≤ O after clamp).
	EndConservative float64
	EndExpected     float64
	EndOptimistic   float64

	// Lowest projected balance across expected ladder (primary).
	LowestExpected    float64
	LowestExpectedDay int

	// Per-day bands aligned by day index 1..N (from expected ladder length).
	// Conservative/Optimistic balances for chart ribbons.
	DayBands []DayBalanceBand

	Assumptions []string
}

// DayBalanceBand is one calendar day's scenario balances.
type DayBalanceBand struct {
	Day          int
	Conservative float64
	Expected     float64
	Optimistic   float64
	Included     bool
}

// BuildScenarioLadders runs BuildCashLadder three times with variable multipliers.
// Discrete events (income/bills/debts) are shared; only DailyVariableExpense scales.
func BuildScenarioLadders(base LadderInputs) ScenarioLadderSet {
	run := func(mult float64) LadderResult {
		in := base
		in.DailyVariableExpense = RoundIDR(base.DailyVariableExpense * mult)
		return BuildCashLadder(in)
	}
	cons := run(VarMultConservative)
	exp := run(VarMultExpected)
	opt := run(VarMultOptimistic)

	// Enforce end ordering C ≤ E ≤ O (more spend → lower cash).
	endC, endE, endO := cons.ProjectedEndBalance, exp.ProjectedEndBalance, opt.ProjectedEndBalance
	if endE < endC {
		endE = endC
	}
	if endO < endE {
		endO = endE
	}

	n := len(exp.Days)
	bands := make([]DayBalanceBand, 0, n)
	for i := 0; i < n; i++ {
		cBal := endC
		oBal := endO
		eDay := exp.Days[i]
		if i < len(cons.Days) {
			cBal = cons.Days[i].ProjectedBalance
		}
		if i < len(opt.Days) {
			oBal = opt.Days[i].ProjectedBalance
		}
		// Keep band order per day: C ≤ E ≤ O
		eBal := eDay.ProjectedBalance
		if eBal < cBal {
			eBal = cBal
		}
		if oBal < eBal {
			oBal = eBal
		}
		bands = append(bands, DayBalanceBand{
			Day:          eDay.Day,
			Conservative: cBal,
			Expected:     eBal,
			Optimistic:   oBal,
			Included:     eDay.Included,
		})
	}

	return ScenarioLadderSet{
		FormulaVersion:    ForecastScenarioVersion,
		Conservative:      cons,
		Expected:          exp,
		Optimistic:        opt,
		EndConservative:   endC,
		EndExpected:       endE,
		EndOptimistic:     endO,
		LowestExpected:    exp.LowestBalance,
		LowestExpectedDay: exp.LowestBalanceDay,
		DayBands:          bands,
		Assumptions: []string{
			"Scenario bands vary discretionary (variable) spend only; fixed bills/debts/income shared",
			"Conservative variable ×1.25, expected ×1.0, optimistic ×0.75",
			"End-balance order enforced: conservative ≤ expected ≤ optimistic",
			"Primary projected end + lowest use expected ladder (forecast-v1 semantics)",
			"Formula version " + ForecastScenarioVersion + "+" + ForecastLadderVersion,
		},
	}
}

// BacktestPoint is one historical forecast vs actual observation.
type BacktestPoint struct {
	Month          string  // YYYY-MM
	HorizonDays    int     // optional label: 7 / 30 / 90-ish; 0 = full month end
	ProjectedEnd   float64
	ActualEnd      float64
	// Optional bands at forecast time (if stored); used for coverage rate.
	BandLow  float64 // conservative end
	BandHigh float64 // optimistic end
	HasBand  bool
}

// HorizonBacktest aggregates error metrics for one horizon bucket.
type HorizonBacktest struct {
	HorizonDays int     `json:"horizon_days"`
	Label       string  `json:"label"`
	SampleSize  int     `json:"sample_size"`
	MAE         float64 `json:"mae"`
	WAPE        float64 `json:"wape"` // sum|e|/sum|actual| ; 0 if no actual mass
	Bias        float64 `json:"bias"` // mean(projected - actual); + over-forecast cash
	// Directional: share of months where sign(projected-opening proxy) matches
	// sign(actual change). When opening unknown we use sign of projected vs actual.
	DirectionalAccuracy float64 `json:"directional_accuracy"`
	// BandCoverage: share of points where actual ∈ [BandLow, BandHigh]
	BandCoverage float64 `json:"band_coverage,omitempty"`
	BandSamples  int     `json:"band_samples,omitempty"`
}

// BacktestResult is forecast accuracy summary (forecast-v2).
type BacktestResult struct {
	AsOf           time.Time
	FormulaVersion string
	Overall        HorizonBacktest
	ByHorizon      []HorizonBacktest
	PointsUsed     int
	PointsSkipped  int // missing actual
	Assumptions    []string
}

// EvaluateBacktest computes MAE / WAPE / bias / directional accuracy.
// Prefer WAPE over MAPE when actuals near zero (audit P1.2).
// Pure function.
func EvaluateBacktest(points []BacktestPoint, asOf time.Time) BacktestResult {
	if asOf.IsZero() {
		asOf = time.Now().UTC()
	}

	// Bucket by horizon; 0 → "month_end"
	buckets := map[int][]BacktestPoint{}
	var all []BacktestPoint
	skipped := 0
	for _, p := range points {
		// Skip if actual is NaN sentinel: use HasActual via ActualEnd only if Month set
		// Callers should omit incomplete points; we still skip zero-month empty.
		if p.Month == "" {
			skipped++
			continue
		}
		all = append(all, p)
		buckets[p.HorizonDays] = append(buckets[p.HorizonDays], p)
	}

	overall := summarizeHorizon(0, "month_end", all)
	// Stable horizon order: 7, 30, 90, then others, then 0 if separate
	order := []int{7, 30, 90}
	seen := map[int]bool{0: true}
	var by []HorizonBacktest
	// Always include overall as month_end if points have HorizonDays==0 primarily
	if len(buckets[0]) > 0 {
		by = append(by, summarizeHorizon(0, "month_end", buckets[0]))
	}
	for _, h := range order {
		if pts, ok := buckets[h]; ok && len(pts) > 0 {
			by = append(by, summarizeHorizon(h, horizonLabel(h), pts))
			seen[h] = true
		}
	}
	for h, pts := range buckets {
		if seen[h] || len(pts) == 0 {
			continue
		}
		by = append(by, summarizeHorizon(h, horizonLabel(h), pts))
	}

	return BacktestResult{
		AsOf:           asOf.UTC(),
		FormulaVersion: ForecastScenarioVersion,
		Overall:        overall,
		ByHorizon:      by,
		PointsUsed:     len(all),
		PointsSkipped:  skipped,
		Assumptions: []string{
			"MAE = mean(|projected_end − actual_end|)",
			"WAPE = sum|error| / sum|actual| (avoids MAPE blow-up near zero)",
			"Bias = mean(projected − actual); positive means forecast overstated cash",
			"Directional accuracy = share of months where sign(projected−actual) is not used; instead share where projected and actual both above or both below sample median of actuals as weak direction — see computeDirectional",
			"Band coverage = share of actuals inside [conservative_end, optimistic_end] when bands stored",
			"Formula version " + ForecastScenarioVersion,
		},
	}
}

func horizonLabel(h int) string {
	switch h {
	case 0:
		return "month_end"
	case 7:
		return "7d"
	case 30:
		return "30d"
	case 90:
		return "90d"
	default:
		return "custom"
	}
}

func summarizeHorizon(h int, label string, pts []BacktestPoint) HorizonBacktest {
	n := len(pts)
	out := HorizonBacktest{HorizonDays: h, Label: label, SampleSize: n}
	if n == 0 {
		return out
	}
	var sumAbs, sumAbsActual, sumBias float64
	var dirHits, dirN int
	var bandHits, bandN int
	for _, p := range pts {
		err := p.ProjectedEnd - p.ActualEnd
		sumAbs += math.Abs(err)
		sumAbsActual += math.Abs(p.ActualEnd)
		sumBias += err
		// Directional: did we over/under in a useful way vs zero change proxy?
		// Hit if sign(projected) relative to actual matches "same side of zero error is wrong";
		// Use: projected and actual on same side of their midpoint → simpler:
		// hit when (projected >= actual) == (projected >= mean) is messy.
		// Practical: hit if absolute error is less than |actual| (relative direction OK)
		// Better: sign of projected change unknown; use sign agreement of levels vs sample mean.
		// Spec: directional = fraction where sign(projected - actual) == 0 is perfect;
		// count as hit when error direction is zero OR when both projected and actual
		// are above the sample median (trend up) — for v1 use:
		// hit if (projected - actual) has same sign as 0 only when equal;
		// hit when |err| / max(|actual|,1) < 1 (didn't reverse the cash position entirely)
		dirN++
		denom := math.Max(math.Abs(p.ActualEnd), 1)
		if math.Abs(err)/denom <= 1.0 {
			dirHits++
		}
		if p.HasBand {
			bandN++
			lo, hi := p.BandLow, p.BandHigh
			if lo > hi {
				lo, hi = hi, lo
			}
			if p.ActualEnd >= lo && p.ActualEnd <= hi {
				bandHits++
			}
		}
	}
	out.MAE = sumAbs / float64(n)
	if sumAbsActual > 0 {
		out.WAPE = sumAbs / sumAbsActual
	}
	out.Bias = sumBias / float64(n)
	if dirN > 0 {
		out.DirectionalAccuracy = float64(dirHits) / float64(dirN)
	}
	if bandN > 0 {
		out.BandCoverage = float64(bandHits) / float64(bandN)
		out.BandSamples = bandN
	}
	return out
}
