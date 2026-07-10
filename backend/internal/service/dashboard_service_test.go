package service

import (
	"context"
	"testing"
	"time"

	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/model"
	"github.com/user/financial-os/internal/repository"
)

func TestDashboardService(t *testing.T) {
	setupTestEnv()

	userRepo := repository.NewUserRepository(testDB)
	accountRepo := repository.NewAccountRepository(testDB)
	assetRepo := repository.NewAssetRepository(testDB)
	debtRepo := repository.NewDebtRepository(testDB)
	dashServ := NewDashboardService(testDB, testRedis)

	ctx := context.Background()
	cleanDatabase(t)

	// Create test user
	testUser := &model.User{
		Email:        "dasher@example.com",
		PasswordHash: "hashedPassword",
		Name:         "Dasher Test",
		Role:         "owner",
		IsActive:     true,
	}
	var err error
	testUser, err = userRepo.CreateUser(ctx, testUser)
	if err != nil {
		t.Fatalf("failed to create test user: %v", err)
	}

	// Create test account (Cash)
	prov := "Mandiri"
	num := "11111"
	isShared := true
	isEF := false
	accReq := dto.CreateAccountRequest{
		Name:            "Cash Account",
		Type:            "cash",
		BankProvider:    &prov,
		AccountNumber:   &num,
		InitialBalance:  5000000,
		Currency:        "IDR",
		IsShared:        &isShared,
		IsEmergencyFund: &isEF,
	}
	_, err = NewAccountService(accountRepo).CreateAccount(ctx, testUser.ID, accReq)
	if err != nil {
		t.Fatalf("failed to create account: %v", err)
	}

	// Create test asset
	val := 12000000.0
	liquid := true
	asset := &model.Asset{
		UserID:       testUser.ID,
		Name:         "Gold",
		Type:         "investment",
		CurrentValue: val,
		IsLiquid:     liquid,
		Currency:     "IDR",
	}
	_, err = assetRepo.Create(ctx, asset)
	if err != nil {
		t.Fatalf("failed to create asset: %v", err)
	}

	// Create test debt
	interest := 10.0
	minPay := 200000.0
	due := 10
	tenor := 6
	start := time.Now()
	debt := &model.Debt{
		UserID:             testUser.ID,
		Name:               "Gadget Installment",
		Type:               "installment",
		OriginalAmount:     3000000,
		OutstandingBalance: 2000000,
		InterestRate:       &interest,
		MinimumPayment:     &minPay,
		DueDay:             &due,
		TenorMonths:        &tenor,
		StartDate:          &start,
		Currency:           "IDR",
		Status:             "active",
		IsShared:           true,
	}
	_, err = debtRepo.Create(ctx, debt)
	if err != nil {
		t.Fatalf("failed to create debt: %v", err)
	}

	t.Run("Get dashboard data", func(t *testing.T) {
		resp, err := dashServ.GetDashboardData(ctx, testUser.ID)
		if err != nil {
			t.Fatalf("failed to get dashboard data: %v", err)
		}

		// NetWorth calculation is:
		// Assets (12,000,000 in Gold) - Debts (2,000,000 in Gadget Installment) = 10,000,000
		expectedNetWorth := 10000000.0
		if resp.NetWorth.Value != expectedNetWorth {
			t.Errorf("expected net worth %f, got %f", expectedNetWorth, resp.NetWorth.Value)
		}

		if resp.CashAvailable.Value != 5000000 {
			t.Errorf("expected cash available 5000000, got %f", resp.CashAvailable.Value)
		}

		if resp.TotalDebts.TotalOutstanding != 2000000 {
			t.Errorf("expected total debts 2000000, got %f", resp.TotalDebts.TotalOutstanding)
		}
	})

	t.Run("Invalidate cache", func(t *testing.T) {
		err := dashServ.InvalidateCache(ctx, testUser.ID)
		if err != nil {
			t.Fatalf("failed to invalidate cache: %v", err)
		}
	})
}
