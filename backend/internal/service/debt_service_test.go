package service

import (
	"context"
	"testing"
	"time"

	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/model"
	"github.com/user/financial-os/internal/repository"
)

func TestDebtService(t *testing.T) {
	setupTestEnv(t)

	userRepo := repository.NewUserRepository(testDB)
	accountRepo := repository.NewAccountRepository(testDB)
	categoryRepo := repository.NewCategoryRepository(testDB)
	debtRepo := repository.NewDebtRepository(testDB)
	debtServ := NewDebtService(debtRepo, accountRepo, categoryRepo)

	ctx := context.Background()
	cleanDatabase(t)

	// Create test user
	testUser := &model.User{
		Email:        "debtor@example.com",
		PasswordHash: "hashedPassword",
		Name:         "Debtor Test",
		Role:         "owner",
		IsActive:     true,
	}
	var err error
	testUser, err = userRepo.CreateUser(ctx, testUser)
	if err != nil {
		t.Fatalf("failed to create test user: %v", err)
	}

	// Create test account for payments
	prov := "BCA"
	num := "11111"
	isShared := true
	isEF := false
	accReq := dto.CreateAccountRequest{
		Name:            "Debt Pay Account",
		Type:            "bank",
		BankProvider:    &prov,
		AccountNumber:   &num,
		InitialBalance:  5000000,
		Currency:        "IDR",
		IsShared:        &isShared,
		IsEmergencyFund: &isEF,
	}
	account, err := NewAccountService(accountRepo).CreateAccount(ctx, testUser.ID, accReq)
	if err != nil {
		t.Fatalf("failed to create payment account: %v", err)
	}

	var debtID string

	t.Run("Create debt success", func(t *testing.T) {
		cred := "Kredit Mandiri"
		interest := 12.0
		minPay := 500000.0
		due := 15
		tenor := 12
		start := time.Now()

		req := dto.CreateDebtRequest{
			Name:           "Car Loan",
			Type:           "installment",
			Creditor:       &cred,
			OriginalAmount: 20000000,
			Outstanding:    15000000,
			InterestRate:   &interest,
			MinimumPayment: &minPay,
			DueDay:         &due,
			TenorMonths:    &tenor,
			StartDate:      &start,
			AccountID:      &account.ID,
			IsShared:       true,
		}

		resp, err := debtServ.CreateDebt(ctx, testUser.ID, req)
		if err != nil {
			t.Fatalf("failed to create debt: %v", err)
		}

		if resp.Name != req.Name {
			t.Errorf("expected name %s, got %s", req.Name, resp.Name)
		}
		if resp.OutstandingBalance != 15000000 {
			t.Errorf("expected outstanding balance 15000000, got %f", resp.OutstandingBalance)
		}

		debtID = resp.ID
	})

	t.Run("Record debt payment success", func(t *testing.T) {
		notes := "Month 1 payment"
		req := dto.RecordDebtPaymentRequest{
			Amount:         1000000,
			PaymentDate:    time.Now(),
			IsExtraPayment: false,
			Notes:          &notes,
			AccountID:      account.ID,
		}

		resp, err := debtServ.RecordPayment(ctx, debtID, testUser.ID, req)
		if err != nil {
			t.Fatalf("failed to record debt payment: %v", err)
		}

		if resp.Amount != 1000000 {
			t.Errorf("expected payment amount 1000000, got %f", resp.Amount)
		}

		// Verify outstanding balance on debt decreased
		d, err := debtServ.GetDebtByID(ctx, debtID, testUser.ID)
		if err != nil {
			t.Fatalf("failed to get debt: %v", err)
		}

		// Balance is: 15,000,000 - p.Amount (1,000,000) = 14,000,000
		expectedBalance := 14000000.0
		if d.OutstandingBalance != expectedBalance {
			t.Errorf("expected outstanding balance %f, got %f", expectedBalance, d.OutstandingBalance)
		}
	})

	t.Run("Simulate avalanche success", func(t *testing.T) {
		sim, err := debtServ.SimulateAvalanche(ctx, testUser.ID, 500000)
		if err != nil {
			t.Fatalf("failed to simulate avalanche: %v", err)
		}

		if len(sim.SchedulesWithExtra) == 0 {
			t.Error("expected non-empty simulation schedule list")
		}
	})
}
