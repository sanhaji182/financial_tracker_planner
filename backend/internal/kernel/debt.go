package kernel

import (
	"math"
	"sort"
	"time"
)

// DebtFormulaVersion versions the simple monthly-interest avalanche engine.
const DebtFormulaVersion = "debt-v1"

// MaxSimMonths is the hard stop (100 years). Hitting this without payoff is treated as stalled.
const MaxSimMonths = 1200

// DebtInput is one active contract for simulation.
type DebtInput struct {
	ID             string
	Name           string
	// Type: kpr | credit_card | installment | personal_loan | other
	// v1 uses the same monthly APR/12 model for all types; type is recorded for assumptions.
	Type              string
	Balance           float64
	AnnualInterestPct float64 // e.g. 12.5 for 12.5% p.a.
	MinimumPayment    float64
}

// DebtPayoffSchedule is per-debt payoff metadata from a sim run.
type DebtPayoffSchedule struct {
	DebtID            string
	DebtName          string
	PayoffMonthIndex  int // 0 = not paid off / stalled
	PayoffDate        time.Time
	TotalInterestPaid float64
}

// AvalancheRun is one side of the with/without-extra comparison.
type AvalancheRun struct {
	MonthsToPayoff    int
	TotalInterestPaid float64
	Schedules         []DebtPayoffSchedule
	Stalled           bool // true if budget cannot cover interest (negative amortization)
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

	Assumptions []string
}

// MonthlyInterest applies simple APR/12 accrual used by debt-v1.
func MonthlyInterest(balance, annualPct float64) float64 {
	if balance <= 0 || annualPct <= 0 {
		return 0
	}
	return balance * (annualPct / 12.0 / 100.0)
}

// SimulateAvalanche runs fixed-budget avalanche (highest APR first) with and without extra.
// Pure function. Model assumptions are deliberately simple monthly APR/12 — not contract-perfect.
func SimulateAvalanche(debts []DebtInput, extraMonthly float64, asOf time.Time) AvalancheResult {
	if asOf.IsZero() {
		asOf = time.Now().UTC()
	}

	without := runAvalanche(debts, 0, asOf)
	with := runAvalanche(debts, extraMonthly, asOf)

	savingsInterest := without.TotalInterestPaid - with.TotalInterestPaid
	if savingsInterest < 0 {
		savingsInterest = 0
	}
	savingsMonths := without.MonthsToPayoff - with.MonthsToPayoff
	if savingsMonths < 0 {
		savingsMonths = 0
	}

	return AvalancheResult{
		AsOf:           asOf.UTC(),
		FormulaVersion: DebtFormulaVersion,
		WithExtra:      with,
		WithoutExtra:   without,
		SavingsInterest: savingsInterest,
		SavingsMonths:   savingsMonths,
		NegativeAmortization: without.Stalled || with.Stalled,
		Assumptions: []string{
			"Interest accrues monthly as balance × (APR/12/100) before payments",
			"Avalanche: fixed monthly budget = sum(min payments) + extra; highest APR first",
			"When a debt is paid off, its min payment rolls into remaining debts",
			"Negative amortization detected when monthly budget ≤ next-month interest",
			"Savings are estimates under these simplified assumptions — not a loan contract quote",
			"Formula version " + DebtFormulaVersion,
		},
	}
}

type simDebt struct {
	id             string
	name           string
	balance        float64
	interestRate   float64
	minimumPayment float64
}

func runAvalanche(debts []DebtInput, extraMonthly float64, asOf time.Time) AvalancheRun {
	var simDebts []*simDebt
	for _, d := range debts {
		if d.Balance <= 0 {
			continue
		}
		simDebts = append(simDebts, &simDebt{
			id:             d.ID,
			name:           d.Name,
			balance:        d.Balance,
			interestRate:   d.AnnualInterestPct,
			minimumPayment: d.MinimumPayment,
		})
	}

	if len(simDebts) == 0 {
		return AvalancheRun{Schedules: []DebtPayoffSchedule{}}
	}

	sort.Slice(simDebts, func(i, j int) bool {
		return simDebts[i].interestRate > simDebts[j].interestRate
	})

	totalInterest := 0.0
	monthCount := 0
	stalled := false

	// Fixed payment budget: mins + extra. Paid-off mins roll into next target.
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

		// 1. Accrue interest first
		for _, d := range simDebts {
			if d.balance <= 0 {
				continue
			}
			interest := MonthlyInterest(d.balance, d.interestRate)
			d.balance += interest
			totalInterest += interest
			sched := payoffSchedules[d.id]
			sched.TotalInterestPaid += interest
			payoffSchedules[d.id] = sched
		}

		// 2. Pay mins, then roll remainder into highest-APR active debt
		remainingBudget := monthlyBudget
		for _, d := range simDebts {
			if d.balance <= 0 {
				continue
			}
			payment := math.Min(d.minimumPayment, d.balance)
			d.balance -= payment
			remainingBudget -= payment
		}
		for _, d := range simDebts {
			if d.balance <= 0 || remainingBudget <= 0 {
				continue
			}
			payment := math.Min(remainingBudget, d.balance)
			d.balance -= payment
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
					sched.PayoffMonthIndex = monthCount
					sched.PayoffDate = currentDate
					payoffSchedules[d.id] = sched
				}
			}
		}

		// Negative amortization guard: if budget cannot cover next month's interest, stop.
		monthlyInterest := 0.0
		for _, d := range simDebts {
			if d.balance > 0 {
				monthlyInterest += MonthlyInterest(d.balance, d.interestRate)
			}
		}
		if monthlyBudget <= monthlyInterest && monthlyInterest > 0 {
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
		sched, found := payoffSchedules[d.ID]
		if !found && !stalled {
			sched = DebtPayoffSchedule{
				DebtID:           d.ID,
				DebtName:         d.Name,
				PayoffMonthIndex: monthCount,
				PayoffDate:       asOf.AddDate(0, monthCount, 0),
			}
		} else if !found {
			// Explicit zero payoff = unpayable under assumptions
			sched = DebtPayoffSchedule{DebtID: d.ID, DebtName: d.Name}
		}
		// Ensure identity fields set
		if sched.DebtID == "" {
			sched.DebtID = d.ID
			sched.DebtName = d.Name
		}
		schedules = append(schedules, sched)
	}

	return AvalancheRun{
		MonthsToPayoff:    monthCount,
		TotalInterestPaid: totalInterest,
		Schedules:         schedules,
		Stalled:           stalled,
	}
}
