package kernel

import (
	"testing"
)

func TestValidateSplitSumOK(t *testing.T) {
	err := ValidateSplitSum(100_000, []SplitLine{
		{Amount: 40_000},
		{Amount: 60_000},
	}, 2)
	if err != nil {
		t.Fatal(err)
	}
}

func TestValidateSplitSumRejectsMismatch(t *testing.T) {
	err := ValidateSplitSum(100_000, []SplitLine{
		{Amount: 40_000},
		{Amount: 50_000},
	}, 2)
	if err == nil {
		t.Fatal("expected mismatch error")
	}
}

func TestValidateSplitSumFloatNoise(t *testing.T) {
	// 33.33 * 3 = 99.99, parent 100.00 → fail; 33.34+33.33+33.33 = 100.00 → ok
	err := ValidateSplitSum(100.00, []SplitLine{
		{Amount: 33.34},
		{Amount: 33.33},
		{Amount: 33.33},
	}, 2)
	if err != nil {
		t.Fatal(err)
	}
}

func TestValidateSplitSumRejectsNonPositive(t *testing.T) {
	if err := ValidateSplitSum(0, []SplitLine{{Amount: 1}}, 2); err == nil {
		t.Fatal("zero parent")
	}
	if err := ValidateSplitSum(10, []SplitLine{{Amount: -1}, {Amount: 11}}, 2); err == nil {
		t.Fatal("negative line")
	}
	if err := ValidateSplitSum(10, nil, 2); err == nil {
		t.Fatal("empty splits")
	}
}

func TestValidateTransferIdentity(t *testing.T) {
	if err := ValidateTransfer(TransferParts{Debit: 1_000_000, Credit: 1_000_000, Fee: 0}, 2); err != nil {
		t.Fatal(err)
	}
	if err := ValidateTransfer(TransferParts{Debit: 1_000_000, Credit: 995_000, Fee: 5_000}, 2); err != nil {
		t.Fatal(err)
	}
	if err := ValidateTransfer(TransferParts{Debit: 1_000_000, Credit: 900_000, Fee: 0}, 2); err == nil {
		t.Fatal("expected debit != credit")
	}
	if err := ValidateTransfer(TransferParts{Debit: 0, Credit: 0, Fee: 0}, 2); err == nil {
		t.Fatal("zero debit")
	}
}

func TestSplitDebtPaymentChecklistCase(t *testing.T) {
	// Outstanding 15m, APR 12%, payment 1m → interest 150k, principal 850k, new 14.15m
	res, err := SplitDebtPayment(DebtPaymentSplit{
		PaymentAmount:     1_000_000,
		OutstandingBefore: 15_000_000,
		AnnualInterestPct: 12,
	}, 2)
	if err != nil {
		t.Fatal(err)
	}
	if !MoneyEqual(res.Interest, 150_000, 2) {
		t.Fatalf("interest want 150000 got %v", res.Interest)
	}
	if !MoneyEqual(res.Principal, 850_000, 2) {
		t.Fatalf("principal want 850000 got %v", res.Principal)
	}
	if !MoneyEqual(res.OutstandingAfter, 14_150_000, 2) {
		t.Fatalf("outstanding after want 14150000 got %v", res.OutstandingAfter)
	}
	if !MoneyEqual(MoneyAdd(2, res.Interest, res.Principal, res.Fees), 1_000_000, 2) {
		t.Fatalf("parts must sum to payment: %v+%v+%v", res.Interest, res.Principal, res.Fees)
	}
	if res.OutstandingAfter < 0 {
		t.Fatal("outstanding after negative")
	}
}

func TestSplitDebtPaymentInterestOnly(t *testing.T) {
	// Payment less than monthly interest → all interest, 0 principal
	res, err := SplitDebtPayment(DebtPaymentSplit{
		PaymentAmount:     50_000,
		OutstandingBefore: 15_000_000,
		AnnualInterestPct: 12, // 150k interest
	}, 2)
	if err != nil {
		t.Fatal(err)
	}
	if !MoneyEqual(res.Interest, 50_000, 2) {
		t.Fatalf("interest %v", res.Interest)
	}
	if res.Principal != 0 {
		t.Fatalf("principal should be 0, got %v", res.Principal)
	}
	if !MoneyEqual(res.OutstandingAfter, 15_000_000, 2) {
		t.Fatalf("outstanding unchanged, got %v", res.OutstandingAfter)
	}
}

func TestSplitDebtPaymentCapsPrincipalAtOutstanding(t *testing.T) {
	res, err := SplitDebtPayment(DebtPaymentSplit{
		PaymentAmount:     5_000_000,
		OutstandingBefore: 1_000_000,
		AnnualInterestPct: 0,
	}, 2)
	if err != nil {
		t.Fatal(err)
	}
	if !MoneyEqual(res.Principal, 1_000_000, 2) {
		t.Fatalf("principal capped %v", res.Principal)
	}
	if res.OutstandingAfter != 0 {
		t.Fatalf("should pay off, got %v", res.OutstandingAfter)
	}
	if res.Overpay <= 0 {
		t.Fatalf("expected overpay, got %v", res.Overpay)
	}
}

func TestSplitDebtPaymentWithFees(t *testing.T) {
	res, err := SplitDebtPayment(DebtPaymentSplit{
		PaymentAmount:     1_100_000,
		OutstandingBefore: 15_000_000,
		AnnualInterestPct: 12, // 150k
		Fees:              100_000,
	}, 2)
	if err != nil {
		t.Fatal(err)
	}
	// available after fees = 1_000_000 → interest 150k, principal 850k
	if !MoneyEqual(res.Fees, 100_000, 2) || !MoneyEqual(res.Interest, 150_000, 2) || !MoneyEqual(res.Principal, 850_000, 2) {
		t.Fatalf("got fee=%v int=%v prin=%v", res.Fees, res.Interest, res.Principal)
	}
	if !MoneyEqual(MoneyAdd(2, res.Interest, res.Principal, res.Fees), 1_100_000, 2) {
		t.Fatal("sum != payment")
	}
}

func TestExpectedAccountBalanceIdentity(t *testing.T) {
	// opening 5m + income 2m - expense 500k - transfer out 1m + transfer in 300k = 5.8m
	got := ExpectedAccountBalance(5_000_000, []LedgerMovement{
		{Amount: 2_000_000},
		{Amount: -500_000},
		{Amount: -1_000_000},
		{Amount: 300_000},
	}, 2)
	if !MoneyEqual(got, 5_800_000, 2) {
		t.Fatalf("got %v", got)
	}
	if err := ValidateAccountBalance(5_800_000, 5_000_000, []LedgerMovement{
		{Amount: 2_000_000},
		{Amount: -500_000},
		{Amount: -1_000_000},
		{Amount: 300_000},
	}, 2); err != nil {
		t.Fatal(err)
	}
	if err := ValidateAccountBalance(5_000_000, 5_000_000, []LedgerMovement{
		{Amount: 1_000_000},
	}, 2); err == nil {
		t.Fatal("expected mismatch")
	}
}

func TestValidateFXAmount(t *testing.T) {
	// USD 1000 @ 16500 = 16_500_000 IDR
	err := ValidateFXAmount(FXAmount{
		OriginalAmount:   1_000,
		OriginalCurrency: "USD",
		Rate:             16_500,
		RateSource:       "manual",
		ReportingAmount:  16_500_000,
	}, 2)
	if err != nil {
		t.Fatal(err)
	}
	if err := ValidateFXAmount(FXAmount{
		OriginalAmount:   1_000,
		OriginalCurrency: "USD",
		Rate:             16_500,
		ReportingAmount:  16_000_000,
	}, 2); err == nil {
		t.Fatal("expected FX mismatch")
	}
}
