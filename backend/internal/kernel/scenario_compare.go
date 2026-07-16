package kernel

import (
	"fmt"
	"math"
	"time"
)

// ScenarioCompareVersion versions side-by-side what-if outcome math.
const ScenarioCompareVersion = "scenario-v1"

// ScenarioChangeType enumerates supported pure change kinds.
const (
	ScenarioExtraDebtPayment   = "extra_debt_payment"
	ScenarioIncomeChange       = "income_change" // percentage
	ScenarioLargePurchase      = "large_purchase"
	ScenarioInvestmentIncrease = "investment_increase"
	ScenarioAddSubscription    = "add_subscription"
	ScenarioRemoveExpense      = "remove_expense"
)

// ScenarioChangeInput is one simulated delta (pure).
type ScenarioChangeInput struct {
	Type               string
	MonthlyExtraAmount float64 // extra_debt_payment
	Percentage         float64 // income_change (% of base income)
	Amount             float64 // large_purchase (one-shot)
	MonthlyAmount      float64 // subscription / investment monthly
}

// ScenarioCompareInputs is the household snapshot + changes.
type ScenarioCompareInputs struct {
	AsOf time.Time

	StartingCash     float64
	AvgMonthlyIncome float64
	AvgMonthlyExpense float64
	OutstandingDebts float64

	// Blended nominal APR (e.g. 0.18 = 18%) for interest estimate over horizon.
	BlendedDebtAPR float64

	// Sum of monthly_required across active time-bound goals (base state).
	ActiveGoalsMonthlyNeed float64

	// Projection horizon for interest / goal delay (default 12).
	HorizonMonths int

	Changes []ScenarioChangeInput
}

// ScenarioMetric is base vs scenario with impact + severity.
type ScenarioMetric struct {
	Base     float64 `json:"base"`
	Scenario float64 `json:"scenario"`
	Impact   float64 `json:"impact"`
	Severity string  `json:"severity"` // positive | neutral | negative
	Unit     string  `json:"unit,omitempty"` // idr | months | ratio
}

// ScenarioCompareResult is the rich side-by-side outcome set.
type ScenarioCompareResult struct {
	AsOf           time.Time `json:"as_of"`
	FormulaVersion string    `json:"formula_version"`
	HorizonMonths  int       `json:"horizon_months"`

	EndingBalance   ScenarioMetric `json:"ending_balance"`
	TotalDebts      ScenarioMetric `json:"total_debts"`
	EFCoverage      ScenarioMetric `json:"ef_coverage"`
	CashRunway      ScenarioMetric `json:"cash_runway"`
	DebtInterest    ScenarioMetric `json:"debt_interest_cost"` // estimated interest over horizon
	GoalFundingGap  ScenarioMetric `json:"goal_funding_gap"`  // monthly
	GoalDelayMonths ScenarioMetric `json:"goal_delay_months"` // estimated extra months to fund goals
	DownsideRunway  ScenarioMetric `json:"downside_runway"`   // runway if income −20%

	Assumptions []string `json:"assumptions"`
	Notes       []string `json:"notes"`
}

// ComputeScenarioCompare builds educational what-if outcomes.
// Pure function — estimates only; not a guarantee of future results.
func ComputeScenarioCompare(in ScenarioCompareInputs) ScenarioCompareResult {
	asOf := in.AsOf
	if asOf.IsZero() {
		asOf = time.Now().UTC()
	}
	horizon := in.HorizonMonths
	if horizon <= 0 {
		horizon = 12
	}

	start := math.Max(0, in.StartingCash)
	baseIncome := math.Max(0, in.AvgMonthlyIncome)
	baseExpense := math.Max(0, in.AvgMonthlyExpense)
	baseDebts := math.Max(0, in.OutstandingDebts)
	apr := in.BlendedDebtAPR
	if apr < 0 {
		apr = 0
	}
	goalNeed := math.Max(0, in.ActiveGoalsMonthlyNeed)

	// BASE one-month ending snapshot (same shape as legacy service)
	baseEnding := start + baseIncome - baseExpense
	baseEF := 0.0
	if baseExpense > 0 {
		baseEF = start / baseExpense
	}
	baseRunway := baseEF
	baseInterest := estimateInterest(baseDebts, apr, horizon)
	baseSurplus := baseIncome - baseExpense
	baseGoalGap := math.Max(0, goalNeed-math.Max(0, baseSurplus))
	baseGoalDelay := estimateGoalDelay(goalNeed, math.Max(0, baseSurplus), horizon)
	baseDownside := downsideRunway(start, baseIncome, baseExpense)

	// SCENARIO state
	sIncome := baseIncome
	sExpense := baseExpense
	sDebts := baseDebts
	sCash := start
	sEnding := baseEnding
	extraDebtPayMonthly := 0.0

	for _, c := range in.Changes {
		switch c.Type {
		case ScenarioExtraDebtPayment:
			pay := math.Max(0, c.MonthlyExtraAmount)
			extraDebtPayMonthly += pay
			sDebts = math.Max(0, sDebts-pay)
			sEnding -= pay
			sCash -= pay
		case ScenarioIncomeChange:
			delta := baseIncome * (c.Percentage / 100.0)
			sIncome += delta
			sEnding += delta
		case ScenarioLargePurchase:
			amt := math.Max(0, c.Amount)
			sEnding -= amt
			sCash -= amt
		case ScenarioInvestmentIncrease:
			amt := math.Max(0, c.MonthlyAmount)
			sEnding -= amt
			sCash -= amt
		case ScenarioAddSubscription:
			amt := math.Max(0, c.MonthlyAmount)
			sExpense += amt
			sEnding -= amt
		case ScenarioRemoveExpense:
			amt := math.Max(0, c.MonthlyAmount)
			sExpense = math.Max(0, sExpense-amt)
			sEnding += amt
		}
	}

	if sCash < 0 {
		sCash = 0
	}
	sEF := 0.0
	if sExpense > 0 {
		sEF = sCash / sExpense
	}
	sRunway := sEF
	// Interest: apply extra payments as reducing average balance roughly
	// Simple model: interest on scenario debt stock over horizon
	sInterest := estimateInterest(sDebts, apr, horizon)
	// Also credit reduced interest from extra payments mid-horizon (half-year average reduction)
	if extraDebtPayMonthly > 0 && apr > 0 {
		// Approximate interest saved ≈ extra_pay * horizon/2 * monthly_rate * horizon is wrong;
		// use average balance reduction of extra_pay * horizon/2
		avgReduction := extraDebtPayMonthly * float64(horizon) / 2.0
		if avgReduction > baseDebts {
			avgReduction = baseDebts
		}
		saved := avgReduction * apr * (float64(horizon) / 12.0)
		sInterest = math.Max(0, estimateInterest(baseDebts, apr, horizon)-saved)
		// Keep stock-based floor
		stock := estimateInterest(sDebts, apr, horizon)
		if stock < sInterest {
			sInterest = stock
		}
	}
	sSurplus := sIncome - sExpense - extraDebtPayMonthly
	// Large purchase / investment already hit cash; surplus for goals uses income-expense-extraDebt
	sGoalGap := math.Max(0, goalNeed-math.Max(0, sSurplus))
	sGoalDelay := estimateGoalDelay(goalNeed, math.Max(0, sSurplus), horizon)
	sDownside := downsideRunway(sCash, sIncome, sExpense)

	metric := func(base, scen float64, inverse bool, unit string) ScenarioMetric {
		impact := RoundMoney(scen-base, 4)
		// For money use 2 dp
		if unit == "idr" {
			base = RoundMoney(base, 2)
			scen = RoundMoney(scen, 2)
			impact = RoundMoney(scen-base, 2)
		} else if unit == "months" || unit == "ratio" {
			base = RoundMoney(base, 2)
			scen = RoundMoney(scen, 2)
			impact = RoundMoney(scen-base, 2)
		}
		return ScenarioMetric{
			Base:     base,
			Scenario: scen,
			Impact:   impact,
			Severity: severity(impact, inverse),
			Unit:     unit,
		}
	}

	assumptions := []string{
		"Formula version " + ScenarioCompareVersion,
		fmt.Sprintf("Horizon %d months for interest & goal-delay estimates", horizon),
		"Ending balance = starting_cash + avg_income − avg_expense ± change effects (1-month snapshot)",
		"Debt interest ≈ outstanding × APR × (horizon/12); extra payments reduce average balance",
		"Goal delay assumes constant surplus applied to activeGoalsMonthlyNeed (no compounding)",
		"Downside runway: income −20%, expenses unchanged, cash / monthly_net_burn",
		"Educational estimate only — not a forecast guarantee",
	}
	if apr <= 0 {
		assumptions = append(assumptions, "BlendedDebtAPR=0 → interest cost shown as 0")
	}

	notes := []string{}
	if sEnding < 0 {
		notes = append(notes, "Scenario ending balance negatif — likuiditas tertekan pada bulan pertama.")
	}
	if sRunway < baseRunway && sRunway < 3 {
		notes = append(notes, "Cash runway skenario di bawah 3 bulan.")
	}
	if sGoalDelay > baseGoalDelay+0.5 {
		notes = append(notes, "Pendanaan tujuan ber-tenggat diperkirakan molor dibanding baseline.")
	}
	if sInterest < baseInterest {
		notes = append(notes, "Estimasi bunga utang menurun berkat pembayaran ekstra / saldo lebih rendah.")
	}

	return ScenarioCompareResult{
		AsOf:           asOf,
		FormulaVersion: ScenarioCompareVersion,
		HorizonMonths:  horizon,
		EndingBalance:  metric(baseEnding, sEnding, false, "idr"),
		TotalDebts:     metric(baseDebts, sDebts, true, "idr"),
		EFCoverage:     metric(baseEF, sEF, false, "months"),
		CashRunway:     metric(baseRunway, sRunway, false, "months"),
		DebtInterest:   metric(baseInterest, sInterest, true, "idr"),
		GoalFundingGap: metric(baseGoalGap, sGoalGap, true, "idr"),
		GoalDelayMonths: metric(baseGoalDelay, sGoalDelay, true, "months"),
		DownsideRunway: metric(baseDownside, sDownside, false, "months"),
		Assumptions:    assumptions,
		Notes:          notes,
	}
}

func estimateInterest(balance, apr float64, horizonMonths int) float64 {
	if balance <= 0 || apr <= 0 || horizonMonths <= 0 {
		return 0
	}
	// Simple (non-compound) interest over horizon fraction of year
	return RoundMoney(balance*apr*(float64(horizonMonths)/12.0), 2)
}

func estimateGoalDelay(monthlyNeed, monthlySurplus float64, horizon int) float64 {
	if monthlyNeed <= 0 {
		return 0
	}
	if monthlySurplus <= 0 {
		// Cannot fund — delay at least full horizon as signal
		return float64(horizon)
	}
	if monthlySurplus+1e-9 >= monthlyNeed {
		return 0
	}
	// Months to accumulate one "month of need" shortfall pattern:
	// If need is N and surplus S, funded fraction S/N; delay factor = N/S − 1 months per month of need.
	// For planning: extra months to fund 12×need bucket ≈ 12*(N/S) − 12
	monthsToFundYear := (monthlyNeed * float64(horizon)) / monthlySurplus
	delay := monthsToFundYear - float64(horizon)
	if delay < 0 {
		return 0
	}
	return RoundMoney(delay, 2)
}

func downsideRunway(cash, income, expense float64) float64 {
	// Income shock −20%
	net := income*0.8 - expense
	if net >= 0 {
		// Still cash-flow positive under shock — runway is comfortable; report cash/expense months
		if expense <= 0 {
			return 99
		}
		return RoundMoney(cash/expense, 2)
	}
	// Burning cash
	burn := -net
	if burn <= 0 {
		return 0
	}
	return RoundMoney(cash/burn, 2)
}

func severity(impact float64, inverse bool) string {
	const eps = 1e-9
	if math.Abs(impact) < eps {
		return "neutral"
	}
	if inverse {
		if impact < 0 {
			return "positive"
		}
		return "negative"
	}
	if impact > 0 {
		return "positive"
	}
	return "negative"
}
