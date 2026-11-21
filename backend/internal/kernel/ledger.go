package kernel

import "fmt"

// LedgerFormulaVersion versions pure ledger invariant helpers.
const LedgerFormulaVersion = "ledger-v1"

// SplitLine is one category allocation of a parent transaction.
type SplitLine struct {
	Amount float64
}

// ValidateSplitSum checks sum(splits) == parent amount at money scale.
// Returns nil when valid; otherwise a descriptive error.
func ValidateSplitSum(parentAmount float64, splits []SplitLine, scale int) error {
	if scale < 0 {
		scale = DefaultMoneyScale
	}
	parent := RoundMoney(parentAmount, scale)
	if parent <= 0 {
		return fmt.Errorf("parent amount must be positive, got %v", parentAmount)
	}
	if len(splits) == 0 {
		return fmt.Errorf("at least one split line required")
	}
	var sum float64
	for i, s := range splits {
		line := RoundMoney(s.Amount, scale)
		if line <= 0 {
			return fmt.Errorf("split[%d] amount must be positive, got %v", i, s.Amount)
		}
		sum += line
	}
	sum = RoundMoney(sum, scale)
	if !MoneyEqual(sum, parent, scale) {
		return fmt.Errorf("split sum %v must equal transaction amount %v", sum, parent)
	}
	return nil
}

// TransferParts is the double-entry view of an account transfer.
// Debit leaves source; credit arrives at target; fee is optional cost of transfer.
// Invariant: debit == credit + fee (all major units, same currency).
type TransferParts struct {
	Debit  float64 // amount leaving source
	Credit float64 // amount arriving at target
	Fee    float64 // explicit fee (0 if none)
}

// ValidateTransfer checks debit == credit + fee and all non-negative with debit > 0.
func ValidateTransfer(t TransferParts, scale int) error {
	if scale < 0 {
		scale = DefaultMoneyScale
	}
	debit := RoundMoney(t.Debit, scale)
	credit := RoundMoney(t.Credit, scale)
	fee := RoundMoney(t.Fee, scale)
	if debit <= 0 {
		return fmt.Errorf("transfer debit must be > 0, got %v", t.Debit)
	}
	if credit < 0 || fee < 0 {
		return fmt.Errorf("transfer credit/fee must be >= 0 (credit=%v fee=%v)", t.Credit, t.Fee)
	}
	wantCreditPlusFee := MoneyAdd(scale, credit, fee)
	if !MoneyEqual(debit, wantCreditPlusFee, scale) {
		return fmt.Errorf("transfer invariant violated: debit %v != credit %v + fee %v", debit, credit, fee)
	}
	return nil
}

// DebtPaymentSplit is the financing split of a cash payment against a liability.
type DebtPaymentSplit struct {
	PaymentAmount    float64
	OutstandingBefore float64
	AnnualInterestPct float64
	// Optional explicit fees charged with this payment (not interest).
	Fees float64
}

// DebtPaymentResult is principal / interest / fees after rounding.
type DebtPaymentResult struct {
	Interest  float64
	Principal float64
	Fees      float64
	Total     float64 // interest + principal + fees (== payment after round)
	// OutstandingAfter = max(0, outstanding_before - principal)
	OutstandingAfter float64
	// Overpay is cash beyond outstanding+interest+fees (should be 0 after clamp).
	Overpay float64
	FormulaVersion string
}

// SplitDebtPayment allocates a cash payment into interest then principal (+fees).
// Interest uses MonthlyInterest (debt-v1) rounded to money scale.
// Invariants:
//   - interest + principal + fees == payment (at scale)
//   - outstanding_after >= 0
//   - principal <= outstanding_before
//   - if payment covers more than outstanding+interest+fees, excess is overpay
//     and principal is capped at outstanding_before (liability never negative).
func SplitDebtPayment(in DebtPaymentSplit, scale int) (DebtPaymentResult, error) {
	if scale < 0 {
		scale = DefaultMoneyScale
	}
	payment := RoundMoney(in.PaymentAmount, scale)
	outstanding := RoundMoney(in.OutstandingBefore, scale)
	fees := RoundMoney(in.Fees, scale)
	if payment <= 0 {
		return DebtPaymentResult{}, fmt.Errorf("payment amount must be > 0")
	}
	if outstanding < 0 {
		return DebtPaymentResult{}, fmt.Errorf("outstanding balance cannot be negative")
	}
	if fees < 0 {
		return DebtPaymentResult{}, fmt.Errorf("fees cannot be negative")
	}
	if fees > payment {
		return DebtPaymentResult{}, fmt.Errorf("fees %v exceed payment %v", fees, payment)
	}

	// Interest first on pre-payment balance.
	interest := RoundIDR(MonthlyInterest(outstanding, in.AnnualInterestPct))
	// Cap interest to remaining payment after fees.
	available := MoneySub(payment, fees, scale)
	if interest > available {
		interest = available
	}
	interest = RoundMoney(interest, scale)

	// Principal is the rest, capped by outstanding.
	principal := MoneySub(available, interest, scale)
	overpay := 0.0
	if principal > outstanding {
		overpay = MoneySub(principal, outstanding, scale)
		principal = outstanding
	}
	principal = Floor0Money(principal, scale)

	// Reconcile total: if rounding left a 1-minor-unit gap, absorb into principal
	// when room remains, else into interest (display-only; total must match payment
	// when overpay==0 and principal not capped... when capped, total may be < payment).
	total := MoneyAdd(scale, interest, principal, fees)
	if overpay == 0 && !MoneyEqual(total, payment, scale) {
		// Absorb residual into principal if outstanding allows.
		diff := MoneySub(payment, total, scale)
		if diff > 0 && MoneyAdd(scale, principal, diff) <= outstanding+1e-9 {
			principal = MoneyAdd(scale, principal, diff)
		} else if diff > 0 {
			interest = MoneyAdd(scale, interest, diff)
		} else if diff < 0 {
			// total > payment — reduce principal first
			adj := -diff
			if principal >= adj {
				principal = MoneySub(principal, adj, scale)
			} else {
				interest = MoneySub(interest, adj, scale)
				if interest < 0 {
					interest = 0
				}
			}
		}
		total = MoneyAdd(scale, interest, principal, fees)
	}

	after := Floor0Money(MoneySub(outstanding, principal, scale), scale)
	if after < 0 {
		return DebtPaymentResult{}, fmt.Errorf("invariant: outstanding after payment is negative")
	}

	return DebtPaymentResult{
		Interest:         interest,
		Principal:        principal,
		Fees:             fees,
		Total:            total,
		OutstandingAfter: after,
		Overpay:          overpay,
		FormulaVersion:   LedgerFormulaVersion + "+" + DebtFormulaVersion + "+" + MoneyPolicyVersion,
	}, nil
}

// LedgerMovement is one posted cash effect on an account in reporting currency.
// Sign convention: + increases balance (income, transfer-in), − decreases
// (expense, transfer-out). Transfers should appear as −debit on source and
// +credit on target; fees as −fee on source (or separate fee account).
type LedgerMovement struct {
	Amount float64
}

// ExpectedAccountBalance reconstructs balance = opening + sum(movements).
// Pure identity check for "account balance equals opening + posted ledger".
func ExpectedAccountBalance(opening float64, movements []LedgerMovement, scale int) float64 {
	if scale < 0 {
		scale = DefaultMoneyScale
	}
	sum := RoundMoney(opening, scale)
	for _, m := range movements {
		sum = MoneyAdd(scale, sum, m.Amount)
	}
	return sum
}

// ValidateAccountBalance checks stored balance matches reconstructed ledger.
func ValidateAccountBalance(stored, opening float64, movements []LedgerMovement, scale int) error {
	want := ExpectedAccountBalance(opening, movements, scale)
	if !MoneyEqual(stored, want, scale) {
		return fmt.Errorf("account balance invariant: stored %v != opening+ledger %v", RoundMoney(stored, scale), want)
	}
	return nil
}

// FXAmount holds original + reporting currency values with rate provenance.
// Historical reports must use these snapshots, never a live rate rewrite.
type FXAmount struct {
	OriginalAmount   float64
	OriginalCurrency string
	Rate             float64 // original → reporting
	RateTimestamp    string  // RFC3339 or empty if unknown
	RateSource       string
	ReportingAmount  float64
}

// ValidateFXAmount checks reporting ≈ original * rate at money scale.
func ValidateFXAmount(fx FXAmount, scale int) error {
	if scale < 0 {
		scale = DefaultMoneyScale
	}
	if fx.OriginalCurrency == "" {
		return fmt.Errorf("original currency required")
	}
	if fx.Rate <= 0 {
		return fmt.Errorf("FX rate must be > 0")
	}
	want := RoundMoney(fx.OriginalAmount*fx.Rate, scale)
	got := RoundMoney(fx.ReportingAmount, scale)
	if !MoneyEqual(want, got, scale) {
		return fmt.Errorf("FX amount mismatch: original %v * rate %v = %v, got reporting %v",
			fx.OriginalAmount, fx.Rate, want, got)
	}
	return nil
}
