package kernel

import (
	"math"
	"testing"
	"time"
)

// Golden household fixtures for the calculation kernel (P0.1 acceptance).
// Each case is a pure-input snapshot; services must map DB rows into these shapes.
//
// Covers: salary, irregular income, no-income, partial bills, heavy fixed load,
// transfer-neutral cash, multi-currency preconverted to IDR, negative cash,
// sparse data, ladder caps, end-of-month, future month.

type goldenCase struct {
	name string
	in   CashflowInputs

	// Optional numeric expectations. nil = do not assert equality.
	wantSurplus    *float64
	wantSTSMax     *float64 // STS must be <= this
	wantSTSMin     *float64 // STS must be >= this
	wantSufficient bool
	wantConfidence string // empty skips
	checkOrder     bool   // C ≤ E ≤ O
	checkSTSCap    bool   // STS ≤ max(0, lowest-buffer) when HasLowestBalance
	checkNoDouble  bool   // income fully received → no double-count path
}

func f64(v float64) *float64 { return &v }

func almostEq(a, b, tol float64) bool {
	return math.Abs(a-b) <= tol
}

func TestGoldenHouseholdFixtures(t *testing.T) {
	asOf := time.Date(2026, 7, 15, 12, 0, 0, 0, time.UTC)

	cases := []goldenCase{
		{
			name: "salary_stable_full_month",
			in: CashflowInputs{
				AsOf: asOf, CashAvailable: 12_000_000,
				EstimatedIncome: 20_000_000, EstimatedFixedExpenses: 6_000_000,
				EstimatedVariableExpenses: 5_000_000, MonthlyLivingCost: 8_000_000,
				IsCurrentMonth: false, DaysRemaining: 30, DaysInMonth: 30,
			},
			// surplus = 20 - 6 - 5 - 2 = 7M
			wantSurplus: f64(7_000_000), wantSufficient: true, wantConfidence: "medium", // no ladder → medium
			checkOrder: true,
		},
		{
			name: "salary_current_month_partial_income_received",
			in: CashflowInputs{
				AsOf: asOf, CashAvailable: 8_000_000,
				IncomeMTD: 10_000_000, ExpenseMTD: 3_000_000,
				EstimatedIncome: 20_000_000, EstimatedFixedExpenses: 4_000_000,
				EstimatedVariableExpenses: 6_000_000, MonthlyLivingCost: 7_000_000,
				MinDebtPayments: 500_000,
				IsCurrentMonth:  true, DaysRemaining: 16, DaysInMonth: 31,
			},
			wantSufficient: true, checkOrder: true, checkNoDouble: true,
		},
		{
			name: "salary_income_fully_received_no_double_count",
			in: CashflowInputs{
				AsOf: asOf, CashAvailable: 15_000_000,
				IncomeMTD: 20_000_000, ExpenseMTD: 5_000_000,
				EstimatedIncome: 20_000_000, EstimatedFixedExpenses: 3_000_000,
				EstimatedVariableExpenses: 6_000_000, MonthlyLivingCost: 6_000_000,
				MinDebtPayments: 1_000_000,
				IsCurrentMonth:  true, DaysRemaining: 10, DaysInMonth: 31,
			},
			// Known from cashflow_test: STS conservative ≈ 6M
			wantSTSMin: f64(5_900_000), wantSTSMax: f64(6_100_000),
			wantSufficient: true, checkOrder: true, checkNoDouble: true,
		},
		{
			name: "irregular_income_low_estimate",
			in: CashflowInputs{
				AsOf: asOf, CashAvailable: 3_000_000,
				EstimatedIncome: 4_000_000, EstimatedFixedExpenses: 2_500_000,
				EstimatedVariableExpenses: 1_500_000, MonthlyLivingCost: 3_000_000,
				IsCurrentMonth: false, DaysRemaining: 30, DaysInMonth: 30,
			},
			// surplus floors at 0: 4 - 2.5 - 1.5 - 0.4 = -0.4 → 0
			wantSurplus: f64(0), wantSufficient: true, checkOrder: true,
		},
		{
			name: "no_income_month_insufficient",
			in: CashflowInputs{
				AsOf: asOf, CashAvailable: 2_000_000,
				EstimatedIncome: 0, ExpenseMTD: 500_000,
				EstimatedFixedExpenses: 1_000_000, EstimatedVariableExpenses: 800_000,
				MonthlyLivingCost: 2_000_000,
				IsCurrentMonth: true, DaysRemaining: 20, DaysInMonth: 31,
			},
			wantSurplus: f64(0), wantSufficient: false, checkOrder: true,
		},
		{
			name: "sparse_data_missing_expense_history",
			in: CashflowInputs{
				AsOf: asOf, CashAvailable: 1_000_000,
				EstimatedIncome: 5_000_000,
			},
			wantSufficient: false,
		},
		{
			name: "partial_bills_high_fixed",
			in: CashflowInputs{
				AsOf: asOf, CashAvailable: 5_000_000,
				EstimatedIncome: 15_000_000, EstimatedFixedExpenses: 10_000_000,
				EstimatedVariableExpenses: 2_000_000, MonthlyLivingCost: 9_000_000,
				IsCurrentMonth: false, DaysRemaining: 30, DaysInMonth: 30,
			},
			// surplus = 15 - 10 - 2 - 1.5 = 1.5M
			wantSurplus: f64(1_500_000), wantSufficient: true, checkOrder: true,
		},
		{
			name: "overdue_like_heavy_fixed_load",
			in: CashflowInputs{
				AsOf: asOf, CashAvailable: 1_500_000,
				EstimatedIncome: 12_000_000, EstimatedFixedExpenses: 11_000_000,
				EstimatedVariableExpenses: 3_000_000, MonthlyLivingCost: 10_000_000,
				MinDebtPayments: 2_000_000,
				IsCurrentMonth:  false, DaysRemaining: 30, DaysInMonth: 30,
			},
			wantSurplus: f64(0), wantSufficient: true, checkOrder: true,
		},
		{
			name: "negative_cash_available",
			in: CashflowInputs{
				AsOf: asOf, CashAvailable: -2_000_000,
				EstimatedIncome: 10_000_000, EstimatedFixedExpenses: 3_000_000,
				EstimatedVariableExpenses: 2_000_000, MonthlyLivingCost: 4_000_000,
				IsCurrentMonth: false, DaysRemaining: 30, DaysInMonth: 30,
			},
			// surplus still positive; STS floored at 0
			wantSurplus: f64(4_000_000), // 10-3-2-1=4
			wantSTSMin:  f64(0), wantSufficient: true, checkOrder: true,
		},
		{
			name: "ladder_cap_tight_mid_month",
			in: CashflowInputs{
				AsOf: asOf, CashAvailable: 50_000_000,
				EstimatedIncome: 20_000_000, EstimatedFixedExpenses: 2_000_000,
				EstimatedVariableExpenses: 3_000_000, MonthlyLivingCost: 5_000_000,
				IsCurrentMonth: false, DaysRemaining: 30, DaysInMonth: 30,
				HasLowestBalance: true, LowestProjectedBalance: 1_000_000, RequiredBuffer: 200_000,
			},
			wantSTSMax: f64(800_000), wantSufficient: true,
			checkOrder: true, checkSTSCap: true,
		},
		{
			name: "ladder_cap_negative_lowest",
			in: CashflowInputs{
				AsOf: asOf, CashAvailable: 8_000_000,
				EstimatedIncome: 12_000_000, EstimatedFixedExpenses: 3_000_000,
				EstimatedVariableExpenses: 4_000_000, MonthlyLivingCost: 5_000_000,
				IsCurrentMonth: true, DaysRemaining: 12, DaysInMonth: 31,
				IncomeMTD:        12_000_000,
				HasLowestBalance: true, LowestProjectedBalance: -500_000, RequiredBuffer: 0,
			},
			// cap = max(0, -500k - 0) = 0 → STS must be 0
			// Note: RequiredBuffer 0 triggers default living*0.05 inside kernel when HasLowestBalance,
			// but cap uses floor0(lowest - requiredBuffer). With lowest negative, cap is still 0.
			wantSTSMax: f64(0), wantSufficient: true, checkSTSCap: true, checkOrder: true, checkNoDouble: true,
		},
		{
			name: "multi_currency_preconverted_idr",
			// Caller already converted FX; kernel treats amounts as reporting currency.
			in: CashflowInputs{
				AsOf: asOf, CashAvailable: 25_000_000,
				EstimatedIncome: 30_000_000, EstimatedFixedExpenses: 8_000_000,
				EstimatedVariableExpenses: 7_000_000, MonthlyLivingCost: 10_000_000,
				IsCurrentMonth: false, DaysRemaining: 30, DaysInMonth: 30,
			},
			// surplus = 30 - 8 - 7 - 3 = 12M
			wantSurplus: f64(12_000_000), wantSufficient: true, checkOrder: true,
		},
		{
			name: "transfer_neutral_cash_snapshot",
			// Transfers don't change total liquid; only cash snapshot matters.
			in: CashflowInputs{
				AsOf: asOf, CashAvailable: 9_000_000,
				EstimatedIncome: 18_000_000, EstimatedFixedExpenses: 5_000_000,
				EstimatedVariableExpenses: 4_000_000, MonthlyLivingCost: 7_000_000,
				IsCurrentMonth: false, DaysRemaining: 30, DaysInMonth: 30,
			},
			// surplus = 18-5-4-1.8 = 7.2M
			wantSurplus: f64(7_200_000), wantSufficient: true, checkOrder: true,
		},
		{
			name: "high_debt_min_payments",
			in: CashflowInputs{
				AsOf: asOf, CashAvailable: 4_000_000,
				EstimatedIncome: 16_000_000, EstimatedFixedExpenses: 9_000_000,
				EstimatedVariableExpenses: 3_000_000, MonthlyLivingCost: 8_000_000,
				MinDebtPayments: 4_000_000,
				IsCurrentMonth:  false, DaysRemaining: 30, DaysInMonth: 30,
			},
			// surplus = 16-9-3-1.6 = 2.4M
			wantSurplus: f64(2_400_000), wantSufficient: true, checkOrder: true,
		},
		{
			name: "zero_variable_expense_history",
			// Kernel falls back variable → living when EstimatedVariableExpenses == 0.
			in: CashflowInputs{
				AsOf: asOf, CashAvailable: 6_000_000,
				EstimatedIncome: 14_000_000, EstimatedFixedExpenses: 5_000_000,
				EstimatedVariableExpenses: 0, MonthlyLivingCost: 5_000_000,
				IsCurrentMonth: false, DaysRemaining: 30, DaysInMonth: 30,
			},
			// surplus = 14-5-5-1.4 = 2.6M (variable fallback to living)
			wantSurplus: f64(2_600_000), wantSufficient: true, checkOrder: true,
		},
		{
			name: "end_of_month_one_day_left",
			in: CashflowInputs{
				AsOf:          time.Date(2026, 7, 31, 8, 0, 0, 0, time.UTC),
				CashAvailable: 3_500_000,
				IncomeMTD:     15_000_000, ExpenseMTD: 11_000_000,
				EstimatedIncome: 15_000_000, EstimatedFixedExpenses: 4_000_000,
				EstimatedVariableExpenses: 5_000_000, MonthlyLivingCost: 6_000_000,
				IsCurrentMonth: true, DaysRemaining: 1, DaysInMonth: 31,
			},
			wantSufficient: true, checkOrder: true, checkNoDouble: true,
		},
		{
			name: "future_month_full_projection",
			in: CashflowInputs{
				AsOf: asOf, CashAvailable: 10_000_000,
				EstimatedIncome: 22_000_000, EstimatedFixedExpenses: 7_000_000,
				EstimatedVariableExpenses: 6_000_000, MonthlyLivingCost: 9_000_000,
				IsCurrentMonth: false, DaysRemaining: 31, DaysInMonth: 31,
			},
			// surplus = 22-7-6-2.2 = 6.8M
			wantSurplus: f64(6_800_000), wantSufficient: true, checkOrder: true,
		},
		{
			name: "medium_confidence_tight_budget",
			in: CashflowInputs{
				AsOf: asOf, CashAvailable: 500_000,
				EstimatedIncome: 2_000_000, EstimatedFixedExpenses: 1_200_000,
				EstimatedVariableExpenses: 600_000, MonthlyLivingCost: 1_500_000,
				IsCurrentMonth: false, DaysRemaining: 30, DaysInMonth: 30,
			},
			wantSurplus: f64(0), // 2-1.2-0.6-0.2 = 0
			wantSufficient: true, checkOrder: true,
		},
		{
			name: "required_buffer_explicit_large",
			in: CashflowInputs{
				AsOf: asOf, CashAvailable: 20_000_000,
				EstimatedIncome: 25_000_000, EstimatedFixedExpenses: 5_000_000,
				EstimatedVariableExpenses: 5_000_000, MonthlyLivingCost: 8_000_000,
				IsCurrentMonth: false, DaysRemaining: 30, DaysInMonth: 30,
				HasLowestBalance: true, LowestProjectedBalance: 15_000_000, RequiredBuffer: 10_000_000,
			},
			// cap = 5M; STS <= 5M
			wantSTSMax: f64(5_000_000), wantSufficient: true, checkSTSCap: true, checkOrder: true,
		},
		{
			name: "optimistic_not_below_conservative",
			in: CashflowInputs{
				AsOf: asOf, CashAvailable: 7_000_000,
				EstimatedIncome: 18_000_000, EstimatedFixedExpenses: 4_000_000,
				EstimatedVariableExpenses: 8_000_000, MonthlyLivingCost: 9_000_000,
				IsCurrentMonth: false, DaysRemaining: 30, DaysInMonth: 30,
			},
			wantSufficient: true, checkOrder: true,
		},
	}

	if len(cases) < 20 {
		t.Fatalf("need at least 20 golden fixtures, got %d", len(cases))
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			res := ComputeCashflow(tc.in)

			if res.FormulaVersion != FormulaVersion {
				t.Fatalf("formula version %q", res.FormulaVersion)
			}
			if res.SafeToSpend < 0 {
				t.Fatalf("STS must never be negative, got %f", res.SafeToSpend)
			}
			if res.Surplus < 0 {
				t.Fatalf("surplus must never be negative, got %f", res.Surplus)
			}

			if tc.wantSurplus != nil && !almostEq(res.Surplus, *tc.wantSurplus, 1) {
				t.Fatalf("surplus want %f got %f", *tc.wantSurplus, res.Surplus)
			}
			if tc.wantSTSMax != nil && res.SafeToSpend > *tc.wantSTSMax+1 {
				t.Fatalf("STS %f exceeds max %f", res.SafeToSpend, *tc.wantSTSMax)
			}
			if tc.wantSTSMin != nil && res.SafeToSpend < *tc.wantSTSMin-1 {
				t.Fatalf("STS %f below min %f", res.SafeToSpend, *tc.wantSTSMin)
			}
			if res.DataQuality.IsSufficient != tc.wantSufficient {
				t.Fatalf("sufficient want %v got %v missing=%v", tc.wantSufficient, res.DataQuality.IsSufficient, res.DataQuality.MissingFields)
			}
			if tc.wantConfidence != "" && res.DataQuality.Confidence != tc.wantConfidence {
				t.Fatalf("confidence want %s got %s", tc.wantConfidence, res.DataQuality.Confidence)
			}
			if tc.checkOrder {
				s := res.SafeToSpendScenarios
				if s.Conservative > s.Expected+0.01 || s.Expected > s.Optimistic+0.01 {
					t.Fatalf("scenario order C=%f E=%f O=%f", s.Conservative, s.Expected, s.Optimistic)
				}
				if !almostEq(res.SafeToSpend, s.Conservative, 0.01) {
					t.Fatalf("primary STS must equal conservative")
				}
			}
			if tc.checkSTSCap && tc.in.HasLowestBalance {
				// Mirror kernel default buffer when RequiredBuffer <= 0.
				req := tc.in.RequiredBuffer
				if req <= 0 && tc.in.MonthlyLivingCost > 0 {
					req = tc.in.MonthlyLivingCost * 0.05
				}
				cap := math.Max(0, tc.in.LowestProjectedBalance-req)
				if res.SafeToSpend > cap+0.01 {
					t.Fatalf("STS %f > ladder cap %f (reqBuf=%f)", res.SafeToSpend, cap, req)
				}
			}
			if tc.checkNoDouble && tc.in.IsCurrentMonth && tc.in.IncomeMTD >= tc.in.EstimatedIncome && tc.in.EstimatedIncome > 0 {
				// With full income already in cash, projected end should not be cash + full estimate.
				if res.ProjectedEndBalance > tc.in.CashAvailable+tc.in.EstimatedIncome-1 {
					t.Fatalf("projected end looks double-counted: end=%f cash=%f income=%f",
						res.ProjectedEndBalance, tc.in.CashAvailable, tc.in.EstimatedIncome)
				}
			}
		})
	}
}

func TestGoldenLadderFixtures(t *testing.T) {
	// Companion ladder cases: current-month as-of, paid events excluded by day filter.
	cases := []struct {
		name         string
		in           LadderInputs
		wantEnd      float64
		wantExcluded int
		wantEndTol   float64
		checkEnd     bool
	}{
		{
			name: "current_month_as_of_day_15_future_only",
			in: LadderInputs{
				AsOfDay: 15, DaysInMonth: 31, IsCurrentMonth: true,
				StartingCash: 10_000_000,
				Events: []LadderEvent{
					{Day: 5, Name: "Gaji already paid", Amount: 15_000_000, Kind: "income"}, // ignored (before as-of)
					{Day: 20, Name: "Sisa gaji", Amount: 5_000_000, Kind: "income"},
					{Day: 25, Name: "PLN", Amount: -500_000, Kind: "bill"},
				},
				DailyVariableExpense: 100_000,
			},
			// Days 15..31 = 17 days variable = 1.7M; +5M income -0.5M bill
			// end = 10M + 5M - 0.5M - 1.7M = 12.8M
			wantEnd: 12_800_000, wantExcluded: 14, wantEndTol: 1, checkEnd: true,
		},
		{
			name: "future_month_full_events",
			in: LadderInputs{
				AsOfDay: 1, DaysInMonth: 30, IsCurrentMonth: false,
				StartingCash: 5_000_000,
				Events: []LadderEvent{
					{Day: 1, Name: "Salary", Amount: 20_000_000, Kind: "income"},
					{Day: 10, Name: "Rent", Amount: -4_000_000, Kind: "bill"},
					{Day: 15, Name: "Debt min", Amount: -1_000_000, Kind: "debt"},
				},
				DailyVariableExpense: 50_000,
			},
			// end = 5 + 20 - 4 - 1 - 50k*30 = 18.5M
			wantEnd: 18_500_000, wantExcluded: 0, wantEndTol: 1, checkEnd: true,
		},
		{
			name: "no_events_variable_only_drains",
			in: LadderInputs{
				AsOfDay: 1, DaysInMonth: 10, IsCurrentMonth: false,
				StartingCash:         1_000_000,
				DailyVariableExpense: 100_000,
			},
			// end = 1M - 100k*10 = 0
			wantEnd: 0, wantExcluded: 0, wantEndTol: 1, checkEnd: true,
		},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			res := BuildCashLadder(tc.in)
			if res.FormulaVersion != ForecastLadderVersion {
				t.Fatalf("version %s", res.FormulaVersion)
			}
			if res.ExcludedDaysBefore != tc.wantExcluded {
				t.Fatalf("excluded days want %d got %d", tc.wantExcluded, res.ExcludedDaysBefore)
			}
			if tc.checkEnd && !almostEq(res.ProjectedEndBalance, tc.wantEnd, tc.wantEndTol) {
				t.Fatalf("end want %f got %f", tc.wantEnd, res.ProjectedEndBalance)
			}
			// LowestBalance is the minimum running balance seen while projecting.
			// It is seeded from StartingCash, so it may be lower than any included
			// day balance when the opening cash is itself the trough.
			if len(res.Days) > 0 {
				minB := res.LowestBalance
				for _, d := range res.Days {
					if d.Included && d.ProjectedBalance < minB-0.01 {
						t.Fatalf("included day %d balance %f < reported lowest %f",
							d.Day, d.ProjectedBalance, res.LowestBalance)
					}
				}
				_ = minB
			}
		})
	}
}
