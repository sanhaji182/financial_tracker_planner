package service

import (
	"context"
	"testing"
	"time"

	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/model"
	"github.com/user/financial-os/internal/repository"
)

func TestForecastService(t *testing.T) {
	setupTestEnv(t)

	userRepo := repository.NewUserRepository(testDB)
	accountRepo := repository.NewAccountRepository(testDB)
	categoryRepo := repository.NewCategoryRepository(testDB)
	txRepo := repository.NewTransactionRepository(testDB)

	vaultServ := NewVaultService(t.TempDir())
	aiSettingsRepo := repository.NewAISettingsRepository(testDB)
	aiServ := NewAISettingsService(aiSettingsRepo, vaultServ)
	txServ := NewTransactionService(txRepo, accountRepo, categoryRepo, aiServ)

	forecastServ := NewForecastService(testDB, testRedis)

	ctx := context.Background()
	cleanDatabase(t)

	// Create test user
	testUser := &model.User{
		Email:        "forecaster@example.com",
		PasswordHash: "hashedPassword",
		Name:         "Forecaster Test",
		Role:         "owner",
		IsActive:     true,
	}
	var err error
	testUser, err = userRepo.CreateUser(ctx, testUser)
	if err != nil {
		t.Fatalf("failed to create test user: %v", err)
	}

	// Create test account
	prov := "BCA"
	num := "11111"
	isShared := true
	isEF := false
	accReq := dto.CreateAccountRequest{
		Name:            "Forecast Source",
		Type:            "bank",
		BankProvider:    &prov,
		AccountNumber:   &num,
		InitialBalance:  3000000,
		Currency:        "IDR",
		IsShared:        &isShared,
		IsEmergencyFund: &isEF,
	}
	account, err := NewAccountService(accountRepo).CreateAccount(ctx, testUser.ID, accReq)
	if err != nil {
		t.Fatalf("failed to create account: %v", err)
	}

	// Get category
	categories, err := categoryRepo.GetAll(ctx, testUser.ID)
	if err != nil {
		t.Fatalf("failed to get categories: %v", err)
	}
	var incomeCatID string
	for _, c := range categories {
		if c.Type == "income" {
			incomeCatID = c.ID
			break
		}
	}

	ip := "127.0.0.1"
	ua := "Go-Test-Agent"

	// Forecast estimates from the three completed months, not the incomplete
	// current month. Seed each historical month so the fixture matches production.
	desc := "Income Seed"
	startOfMonth := time.Date(time.Now().Year(), time.Now().Month(), 1, 12, 0, 0, 0, time.Local)
	for monthsAgo := 1; monthsAgo <= 3; monthsAgo++ {
		txReq := dto.CreateTransactionRequest{
			Date:        startOfMonth.AddDate(0, -monthsAgo, 0),
			Amount:      500000,
			Type:        "income",
			AccountID:   account.ID,
			CategoryID:  &incomeCatID,
			Description: &desc,
		}
		_, err = txServ.CreateTransaction(ctx, testUser.ID, txReq, &ip, &ua)
		if err != nil {
			t.Fatalf("failed to create historical transaction: %v", err)
		}
	}

	t.Run("Calculate forecast", func(t *testing.T) {
		currentMonth := time.Now().Format("2006-01")
		resp, err := forecastServ.CalculateMonthlyForecast(ctx, testUser.ID, currentMonth)
		if err != nil {
			t.Fatalf("failed to calculate monthly forecast: %v", err)
		}

		if resp.Month != currentMonth {
			t.Errorf("expected month %s, got %s", currentMonth, resp.Month)
		}

		if resp.EstimatedIncome.Value <= 0 {
			t.Errorf("expected estimated income to be positive, got %f", resp.EstimatedIncome.Value)
		}

		// Check daily projections
		proj, err := forecastServ.GetDailyProjections(ctx, testUser.ID, currentMonth)
		if err != nil {
			t.Fatalf("failed to get daily projections: %v", err)
		}
		if len(proj) == 0 {
			t.Error("expected non-empty daily projections")
		}
	})
}
