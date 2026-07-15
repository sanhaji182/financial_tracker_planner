package kernel

// ForecastLadderVersion versions the day-by-day cash ladder used by forecast.
// Bump when event inclusion/as-of semantics change.
const ForecastLadderVersion = "forecast-v1"

// LadderEvent is a discrete cash movement on a calendar day of the target month.
// Amount is signed: positive = inflow, negative = outflow.
type LadderEvent struct {
	Day    int    // 1..DaysInMonth
	Name   string
	Amount float64
	Kind   string // income | bill | debt | variable | other
}

// LadderInputs drives BuildCashLadder. Pure — no I/O.
//
// Current-month semantics (forecast-v1):
//   - StartingCash is the as-of liquid balance (already includes posted income/expense).
//   - Only events on days >= AsOfDay are applied (future cash from as-of).
//   - Callers must pre-filter: omit income already received, paid bills, paid debt mins.
//   - Days before AsOfDay are filled as balance stubs (Included=false) so charts stay full-month.
type LadderInputs struct {
	AsOfDay              int
	DaysInMonth          int
	IsCurrentMonth       bool
	StartingCash         float64
	Events               []LadderEvent // discrete events (income/bill/debt); not daily variable
	DailyVariableExpense float64
	LivingCostThreshold  float64
}

// DayProjection is one day on the ladder.
type DayProjection struct {
	Day              int
	ProjectedBalance float64
	EventName        string
	EventAmount      float64
	// Included is false for days before AsOfDay on current-month forecasts
	// (balance held flat at StartingCash; no future events applied yet).
	Included bool
}

// LadderResult is the pure ladder output.
type LadderResult struct {
	FormulaVersion      string
	Days                []DayProjection
	ProjectedEndBalance float64
	LowestBalance       float64
	LowestBalanceDay    int
	IsTight             bool
	RemainingIncome     float64 // sum of positive discrete events applied
	RemainingFixed      float64 // abs sum of bill+debt events applied
	RemainingVariable   float64 // daily variable * projected days
	IncludedEvents      []string
	ExcludedDaysBefore  int // how many leading stub days (current month only)
	Assumptions         []string
}

// BuildCashLadder projects daily liquid cash from StartingCash applying only
// future events. Pure function.
func BuildCashLadder(in LadderInputs) LadderResult {
	daysInMonth := in.DaysInMonth
	if daysInMonth < 1 {
		daysInMonth = 1
	}
	asOf := in.AsOfDay
	if asOf < 1 {
		asOf = 1
	}
	if asOf > daysInMonth {
		asOf = daysInMonth
	}
	// Future months always start from day 1.
	startDay := 1
	if in.IsCurrentMonth {
		startDay = asOf
	}

	// Index discrete events by day.
	byDay := map[int][]LadderEvent{}
	for _, e := range in.Events {
		if e.Day < 1 || e.Day > daysInMonth {
			continue
		}
		byDay[e.Day] = append(byDay[e.Day], e)
	}

	days := make([]DayProjection, 0, daysInMonth)
	running := in.StartingCash
	lowest := in.StartingCash
	lowestDay := startDay
	isTight := false
	var remainingIncome, remainingFixed, remainingVariable float64
	var included []string
	excludedBefore := 0

	for d := 1; d <= daysInMonth; d++ {
		var eventName string
		var eventAmount float64
		includedDay := d >= startDay

		if !includedDay {
			excludedBefore++
			// Pre-as-of stub: hold opening cash so charts span the full month.
			days = append(days, DayProjection{
				Day:              d,
				ProjectedBalance: in.StartingCash,
				Included:         false,
			})
			if in.StartingCash < in.LivingCostThreshold && in.LivingCostThreshold > 0 {
				// Do not mark tight on historical stubs — only projected path.
			}
			continue
		}

		// Discrete events for this day.
		for _, e := range byDay[d] {
			running += e.Amount
			if eventName != "" {
				eventName += " & " + e.Name
			} else {
				eventName = e.Name
			}
			eventAmount += e.Amount
			included = append(included, e.Name)
			if e.Amount > 0 {
				remainingIncome += e.Amount
			} else if e.Kind == "bill" || e.Kind == "debt" {
				remainingFixed += -e.Amount
			}
		}

		// Daily variable drag only on projected days.
		if in.DailyVariableExpense > 0 {
			running -= in.DailyVariableExpense
			remainingVariable += in.DailyVariableExpense
		}

		if running < lowest {
			lowest = running
			lowestDay = d
		}
		if in.LivingCostThreshold > 0 && running < in.LivingCostThreshold {
			isTight = true
		}

		days = append(days, DayProjection{
			Day:              d,
			ProjectedBalance: running,
			EventName:        eventName,
			EventAmount:      eventAmount,
			Included:         true,
		})
	}

	assumptions := []string{
		"Opening cash is as-of liquid balance; posted income/expense already reflected",
		"Only unpaid future bills and unpaid debt minimums are projected",
		"Income event only when remaining income (estimate − MTD) > 0",
		"Variable spend projected only for remaining days (daily = monthly/30)",
		"Pre-as-of days are chart stubs at opening cash (not re-simulated history)",
		"Formula version " + ForecastLadderVersion,
	}

	return LadderResult{
		FormulaVersion:      ForecastLadderVersion,
		Days:                days,
		ProjectedEndBalance: running,
		LowestBalance:       lowest,
		LowestBalanceDay:    lowestDay,
		IsTight:             isTight,
		RemainingIncome:     remainingIncome,
		RemainingFixed:      remainingFixed,
		RemainingVariable:   remainingVariable,
		IncludedEvents:      included,
		ExcludedDaysBefore:  excludedBefore,
		Assumptions:         assumptions,
	}
}
