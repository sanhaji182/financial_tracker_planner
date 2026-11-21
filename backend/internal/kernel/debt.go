package kernel

import (
	"math"
	"sort"
	"strings"
	"time"
)

// DebtFormulaVersion versions the type-aware monthly avalanche engine.
// debt-v2: type-specific accrual, fees, grace, CC min-payment %, effective APR, sensitivity.
const DebtFormulaVersion = "debt-v2"

// MaxSimMonths is the hard stop (100 years). Hitting this without payoff is treated as stalled.
const MaxSimMonths = 1200

// Accrual modes.
const (
	AccrualMonthly = "monthly"
	AccrualDaily   = "daily"
)

// DebtInput is one active contract for simulation.
type DebtInput struct {
	ID   string
	Name string
	// Type: kpr | credit_card | installment | personal_loan | other
	Type              string
	Balance           float64
	AnnualInterestPct float64 // nominal APR % p.a. (or flat-rate % for installment flat model)
	MinimumPayment    float64

	// Optional contract knobs (debt-v2). Zero/empty = sensible defaults by type.
	MonthlyFee        float64 // fixed fee added after interest each month (admin/CC fee)
	GraceMonths       int     // months with 0 interest at start (e.g. promo)
	AccrualMode       string  // monthly | daily (default monthly; daily uses APR/365 * 30)
	MinPaymentPercent float64 // credit_card: min payment = max(MinimumPayment, pct% of balance)
	// InstallmentFlat: when true, interest is flat-rate amortized over TenorMonths
	// (common ID bank installment). Balance still reduces by principal only.
	InstallmentFlat bool
	TenorMonths     int     // required when InstallmentFlat
	RefinanceCost   float64 // one-time cost applied month 1 when > 0 (sensitivity / refinance path)
}

// DebtPayoffSchedule is per-debt payoff metadata from a sim run.
type DebtPayoffSchedule struct {
	DebtID            string
	DebtName          string
	DebtType          string
	PayoffMonthIndex  int // 0 = not paid off / stalled
	PayoffDate        time.Time
	TotalInterestPaid float64
	TotalFeesPaid     float64
	EffectiveAPR      float64 // approximate annualized cost from sim cashflows
	InterestModel     string  // human label of accrual model used
}

// AvalancheRun is one side of the with/without-extra comparison.
type AvalancheRun struct {
	MonthsToPayoff    int
	TotalInterestPaid float64
	TotalFeesPaid     float64
	Schedules         []DebtPayoffSchedule
	Stalled           bool // true if budget cannot cover interest (negative amortization)
}

// SensitivityPoint is one extra-payment scenario for estimate ranges.
type SensitivityPoint struct {
	Label             string
	ExtraMonthly      float64
	MonthsToPayoff    int
	TotalInterestPaid float64
	Stalled           bool
}

// AvalancheResult is the full with/without-extra comparison.
type AvalancheResult struct {
	AsOf           time.Time
	FormulaVersion string

	WithExtra    AvalancheRun
	WithoutExtra AvalancheRun

	SavingsInterest float64
	SavingsMonths   int

	// True if either run detected negative amortization / unpayable path.
	NegativeAmortization bool

	// Effective blended APR estimate across active debts (nominal for labeling).
	BlendedNominalAPR float64
	// Type models used in this run (unique labels).
	InterestModels []string

	// Sensitivity around extra payment: −20%, base, +20% (and zero).
	Sensitivity []SensitivityPoint

	Assumptions []string
}

// MonthlyInterest applies simple APR/12 accrual used by debt-v1/v2 monthly mode,
// rounded to money-v1 scale so payment splits and sim stay on DECIMAL(15,2).
func MonthlyInterest(balance, annualPct float64) float64 {
	if balance <= 0 || annualPct <= 0 {
		return 0
	}
	return RoundIDR(balance * (annualPct / 12.0 / 100.0))
}

// DailyInterest30 approximates daily accrual for 30-day month: balance × APR/365 × 30.
func DailyInterest30(balance, annualPct float64) float64 {
	if balance <= 0 || annualPct <= 0 {
		return 0
	}
	return RoundIDR(balance * (annualPct / 100.0) / 365.0 * 30.0)
}

// NormalizeDebtType lowercases and maps aliases.
func NormalizeDebtType(t string) string {
	switch strings.ToLower(strings.TrimSpace(t)) {
	case "kpr", "mortgage", "home_loan":
		return "kpr"
	case "credit_card", "cc", "kartu_kredit":
		return "credit_card"
	case "installment", "cicilan", "flat":
		return "installment"
	case "personal_loan", "pl", "pinjaman":
		return "personal_loan"
	default:
		if t == "" {
			return "other"
		}
		return strings.ToLower(t)
	}
}

// InterestModelLabel describes accrual for UI/assumptions.
func InterestModelLabel(d DebtInput) string {
	t := NormalizeDebtType(d.Type)
	switch {
	case d.InstallmentFlat || t == "installment" && d.InstallmentFlat:
		return "flat-rate installment (principal + fixed interest portion)"
	case d.AccrualMode == AccrualDaily || t == "credit_card" && d.AccrualMode == AccrualDaily:
		return "daily APR accrual (30-day month approx)"
	case t == "kpr":
		return "monthly reducing-balance (KPR-style APR/12)"
	case t == "credit_card":
		return "monthly APR/12 + optional fee; min = max(floor, % balance)"
	default:
		return "monthly reducing-balance APR/12"
	}
}

// EffectiveMinPayment computes contractual minimum for this month's balance.
func EffectiveMinPayment(d DebtInput, balance float64) float64 {
	t := NormalizeDebtType(d.Type)
	minPay := d.MinimumPayment
	if t == "credit_card" && d.MinPaymentPercent > 0 && balance > 0 {
		pctPay := RoundIDR(balance * d.MinPaymentPercent / 100.0)
		if pctPay > minPay {
			minPay = pctPay
		}
	}
	if minPay < 0 {
		minPay = 0
	}
	return minPay
}

// AccrueInterest one month for a debt under its type rules.
func AccrueInterest(d DebtInput, balance float64, monthIndex int) (interest float64, fee float64) {
	if balance <= 0 {
		return 0, 0
	}
	if d.GraceMonths > 0 && monthIndex <= d.GraceMonths {
		// Grace: no interest, fee may still apply.
		return 0, RoundIDR(math.Max(0, d.MonthlyFee))
	}
	t := NormalizeDebtType(d.Type)
	mode := d.AccrualMode
	if mode == "" {
		if t == "credit_card" && d.AccrualMode == AccrualDaily {
			mode = AccrualDaily
		} else {
			mode = AccrualMonthly
		}
	}

	// Flat installment: fixed interest portion = original_style estimate from rate*balance0/tenor
	// For ongoing sim we approximate fixed interest from current contractual fields:
	// monthlyInterest = (AnnualInterestPct/100 * original-like) / tenor — use balance at start
	// as stand-in when Original not available: rate% * balance / tenor per month until tenor ends.
	if d.InstallmentFlat && d.TenorMonths > 0 {
		// Flat total interest ≈ balance_at_start * rate% ; portion per month.
		// Using remaining balance * rate / tenor is a mild under-estimate vs bank flat on original —
		// labeled as estimate. Cap months of flat interest by tenor.
		if monthIndex <= d.TenorMonths {
			interest = RoundIDR(d.Balance * (d.AnnualInterestPct / 100.0) / float64(d.TenorMonths))
		}
		return interest, RoundIDR(math.Max(0, d.MonthlyFee))
	}

	if mode == AccrualDaily {
		interest = DailyInterest30(balance, d.AnnualInterestPct)
	} else {
		interest = MonthlyInterest(balance, d.AnnualInterestPct)
	}
	fee = RoundIDR(math.Max(0, d.MonthlyFee))
	return interest, fee
}

// SimulateAvalanche runs fixed-budget avalanche (highest APR first) with and without extra.
// Pure function. Type-aware accrual (debt-v2); still an estimate, not a loan contract quote.
func SimulateAvalanche(debts []DebtInput, extraMonthly float64, asOf time.Time) AvalancheResult {
	if asOf.IsZero() {
		asOf = time.Now().UTC()
	}

	without := runAvalanche(debts, 0, asOf)
	with := runAvalanche(debts, extraMonthly, asOf)

	savingsInterest := (without.TotalInterestPaid + without.TotalFeesPaid) - (with.TotalInterestPaid + with.TotalFeesPaid)
	if savingsInterest < 0 {
		savingsInterest = 0
	}
	savingsMonths := without.MonthsToPayoff - with.MonthsToPayoff
	if savingsMonths < 0 {
		savingsMonths = 0
	}

	// Blended nominal APR weighted by balance.
	var sumBal, sumW float64
	models := map[string]bool{}
	for _, d := range debts {
		if d.Balance <= 0 {
			continue
		}
		sumBal += d.Balance
		sumW += d.Balance * d.AnnualInterestPct
		models[InterestModelLabel(d)] = true
	}
	blended := 0.0
	if sumBal > 0 {
		blended = sumW / sumBal
	}
	var modelList []string
	for m := range models {
		modelList = append(modelList, m)
	}
	sort.Strings(modelList)

	// Sensitivity: 0, −20%, base, +20% extra.
	sensExtras := []struct {
		label string
		mult  float64
	}{
		{"extra_0", 0},
		{"extra_minus_20pct", 0.8},
		{"extra_base", 1.0},
		{"extra_plus_20pct", 1.2},
	}
	var sens []SensitivityPoint
	for _, s := range sensExtras {
		ex := RoundIDR(extraMonthly * s.mult)
		if s.mult == 0 {
			ex = 0
		}
		run := runAvalanche(debts, ex, asOf)
		sens = append(sens, SensitivityPoint{
			Label:             s.label,
			ExtraMonthly:      ex,
			MonthsToPayoff:    run.MonthsToPayoff,
			TotalInterestPaid: RoundIDR(run.TotalInterestPaid + run.TotalFeesPaid),
			Stalled:           run.Stalled,
		})
	}

	return AvalancheResult{
		AsOf:                 asOf.UTC(),
		FormulaVersion:       DebtFormulaVersion,
		WithExtra:            with,
		WithoutExtra:         without,
		SavingsInterest:      savingsInterest,
		SavingsMonths:        savingsMonths,
		NegativeAmortization: without.Stalled || with.Stalled,
		BlendedNominalAPR:    blended,
		InterestModels:       modelList,
		Sensitivity:          sens,
		Assumptions: []string{
			"Interest model is type-aware (debt-v2) but still an ESTIMATE — not a bank amortization schedule",
			"KPR/personal_loan: monthly reducing balance APR/12 unless AccrualMode=daily",
			"Credit card: monthly or daily accrual; min payment = max(floor, MinPaymentPercent% of balance); MonthlyFee applied",
			"InstallmentFlat: fixed interest portion over TenorMonths (flat-rate style)",
			"GraceMonths: zero interest for first N months; fees may still apply",
			"RefinanceCost: added to balance in month 1 when set (one-time)",
			"Avalanche: fixed monthly budget = sum(effective mins at start) + extra; highest nominal APR first",
			"When a debt is paid off, its starting min payment rolls into remaining debts",
			"Negative amortization detected when monthly budget ≤ next-month interest+fees",
			"Savings and sensitivity (±20% extra) are estimates under these assumptions",
			"Effective APR on schedules is a rough annualized interest/avg-balance proxy",
			"Formula version " + DebtFormulaVersion,
		},
	}
}

type simDebt struct {
	id             string
	name           string
	dtype          string
	balance        float64
	interestRate   float64
	minimumPayment float64 // starting contractual min (for budget roll)
	src            DebtInput
	interestPaid   float64
	feesPaid       float64
	model          string
}

func runAvalanche(debts []DebtInput, extraMonthly float64, asOf time.Time) AvalancheRun {
	var simDebts []*simDebt
	for _, d := range debts {
		if d.Balance <= 0 {
			continue
		}
		// Apply refinance cost up-front to balance for this run path.
		bal := d.Balance
		if d.RefinanceCost > 0 {
			bal = RoundIDR(bal + d.RefinanceCost)
		}
		src := d
		src.Balance = bal // flat interest base uses post-refi balance if any
		simDebts = append(simDebts, &simDebt{
			id:             d.ID,
			name:           d.Name,
			dtype:          NormalizeDebtType(d.Type),
			balance:        bal,
			interestRate:   d.AnnualInterestPct,
			minimumPayment: EffectiveMinPayment(d, bal),
			src:            src,
			model:          InterestModelLabel(d),
		})
	}

	if len(simDebts) == 0 {
		return AvalancheRun{Schedules: []DebtPayoffSchedule{}}
	}

	sort.Slice(simDebts, func(i, j int) bool {
		return simDebts[i].interestRate > simDebts[j].interestRate
	})

	totalInterest := 0.0
	totalFees := 0.0
	monthCount := 0
	stalled := false

	// Fixed payment budget: starting effective mins + extra. Paid-off mins roll into next target.
	monthlyBudget := extraMonthly
	for _, d := range simDebts {
		monthlyBudget += d.minimumPayment
	}

	payoffSchedules := make(map[string]DebtPayoffSchedule)

	for monthCount < MaxSimMonths {
		activeCount := 0
		for _, d := range simDebts {
			if d.balance > 0 {
				activeCount++
			}
		}
		if activeCount == 0 {
			break
		}

		monthCount++
		currentDate := asOf.AddDate(0, monthCount, 0)

		// 1. Accrue interest + fees first
		for _, d := range simDebts {
			if d.balance <= 0 {
				continue
			}
			interest, fee := AccrueInterest(d.src, d.balance, monthCount)
			d.balance = RoundIDR(d.balance + interest + fee)
			d.interestPaid = RoundIDR(d.interestPaid + interest)
			d.feesPaid = RoundIDR(d.feesPaid + fee)
			totalInterest = RoundIDR(totalInterest + interest)
			totalFees = RoundIDR(totalFees + fee)
			sched := payoffSchedules[d.id]
			sched.TotalInterestPaid = d.interestPaid
			sched.TotalFeesPaid = d.feesPaid
			payoffSchedules[d.id] = sched
		}

		// 2. Pay type-aware mins (recomputed on current balance for CC %), then roll remainder
		remainingBudget := monthlyBudget
		for _, d := range simDebts {
			if d.balance <= 0 {
				continue
			}
			minPay := EffectiveMinPayment(d.src, d.balance)
			// Don't exceed starting min contribution to budget for non-CC; CC can demand more
			// but budget is fixed — pay min of (effective min, remaining budget, balance).
			payment := math.Min(minPay, d.balance)
			payment = math.Min(payment, remainingBudget)
			d.balance = RoundIDR(d.balance - payment)
			remainingBudget -= payment
		}
		// Avalanche extra to highest APR
		for _, d := range simDebts {
			if d.balance <= 0 || remainingBudget <= 0 {
				continue
			}
			payment := math.Min(remainingBudget, d.balance)
			d.balance = RoundIDR(d.balance - payment)
			remainingBudget -= payment
		}

		// Record payoffs
		for _, d := range simDebts {
			if d.balance <= 0 {
				d.balance = 0
				sched := payoffSchedules[d.id]
				if sched.PayoffMonthIndex == 0 {
					sched.DebtID = d.id
					sched.DebtName = d.name
					sched.DebtType = d.dtype
					sched.PayoffMonthIndex = monthCount
					sched.PayoffDate = currentDate
					sched.TotalInterestPaid = d.interestPaid
					sched.TotalFeesPaid = d.feesPaid
					sched.InterestModel = d.model
					sched.EffectiveAPR = approxEffectiveAPR(d.interestPaid+d.feesPaid, d.src.Balance, monthCount)
					payoffSchedules[d.id] = sched
				}
			}
		}

		// Negative amortization guard: if budget cannot cover next month's interest+fees, stop.
		nextCost := 0.0
		for _, d := range simDebts {
			if d.balance > 0 {
				i, f := AccrueInterest(d.src, d.balance, monthCount+1)
				nextCost += i + f
			}
		}
		if monthlyBudget <= nextCost && nextCost > 0 {
			stalled = true
			break
		}
	}

	// Compile schedules in input order
	var schedules []DebtPayoffSchedule
	for _, d := range debts {
		if d.Balance <= 0 {
			continue
		}
		// Find sim twin for fees/interest
		var twin *simDebt
		for _, s := range simDebts {
			if s.id == d.ID {
				twin = s
				break
			}
		}
		sched, found := payoffSchedules[d.ID]
		if !found && !stalled {
			sched = DebtPayoffSchedule{
				DebtID:           d.ID,
				DebtName:         d.Name,
				DebtType:         NormalizeDebtType(d.Type),
				PayoffMonthIndex: monthCount,
				PayoffDate:       asOf.AddDate(0, monthCount, 0),
			}
			if twin != nil {
				sched.TotalInterestPaid = twin.interestPaid
				sched.TotalFeesPaid = twin.feesPaid
				sched.InterestModel = twin.model
				sched.EffectiveAPR = approxEffectiveAPR(twin.interestPaid+twin.feesPaid, twin.src.Balance, monthCount)
			}
		} else if !found {
			// Explicit zero payoff = unpayable under assumptions
			sched = DebtPayoffSchedule{
				DebtID:   d.ID,
				DebtName: d.Name,
				DebtType: NormalizeDebtType(d.Type),
			}
			if twin != nil {
				sched.TotalInterestPaid = twin.interestPaid
				sched.TotalFeesPaid = twin.feesPaid
				sched.InterestModel = twin.model
			}
		}
		if sched.DebtID == "" {
			sched.DebtID = d.ID
			sched.DebtName = d.Name
		}
		if sched.DebtType == "" {
			sched.DebtType = NormalizeDebtType(d.Type)
		}
		if sched.InterestModel == "" {
			sched.InterestModel = InterestModelLabel(d)
		}
		schedules = append(schedules, sched)
	}

	return AvalancheRun{
		MonthsToPayoff:    monthCount,
		TotalInterestPaid: totalInterest,
		TotalFeesPaid:     totalFees,
		Schedules:         schedules,
		Stalled:           stalled,
	}
}

// approxEffectiveAPR: rough (total cost / principal) / years * 100.
func approxEffectiveAPR(totalCost, principal float64, months int) float64 {
	if principal <= 0 || months <= 0 {
		return 0
	}
	years := float64(months) / 12.0
	if years <= 0 {
		return 0
	}
	return RoundIDR((totalCost/principal)/years*1000) / 10 // 1 decimal via money round path
}
