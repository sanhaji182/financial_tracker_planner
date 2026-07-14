package service

import (
	"context"
	"testing"
	"time"

	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/model"
	"github.com/user/financial-os/internal/repository"
)

func TestBudgetService(t *testing.T) {
	setupTestEnv(t)

	userRepo := repository.NewUserRepository(testDB)
	accountRepo := repository.NewAccountRepository(testDB)
	categoryRepo := repository.NewCategoryRepository(testDB)
	txRepo := repository.NewTransactionRepository(testDB)
	budgetServ := NewBudgetService(testDB)

	vaultServ := NewVaultService(t.TempDir())
	aiSettingsRepo := repository.NewAISettingsRepository(testDB)
	aiServ := NewAISettingsService(aiSettingsRepo, vaultServ)
	txServ := NewTransactionService(txRepo, accountRepo, categoryRepo, aiServ)

	ctx := context.Background()
	cleanDatabase(t)

	// Create test user
	testUser := &model.User{
		Email:        "budgeter@example.com",
		PasswordHash: "hashedPassword",
		Name:         "Budgeter Test",
		Role:         "owner",
		IsActive:     true,
	}
	var err error
	testUser, err = userRepo.CreateUser(ctx, testUser)
	if err != nil {
		t.Fatalf("failed to create test user: %v", err)
	}

	// Create test account for spending
	prov := "BCA"
	num := "11111"
	isShared := true
	isEF := false
	accReq := dto.CreateAccountRequest{
		Name:            "Spend Account",
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
		t.Fatalf("failed to create account: %v", err)
	}

	// Get expense category
	categories, err := categoryRepo.GetAll(ctx, testUser.ID)
	if err != nil {
		t.Fatalf("failed to get categories: %v", err)
	}
	var expenseCatID string
	for _, c := range categories {
		if c.Type == "expense" {
			expenseCatID = c.ID
			break
		}
	}

	currentMonth := time.Now().Format("2006-01")
	var budgetID string

	t.Run("Set budget success", func(t *testing.T) {
		req := &dto.BudgetRequest{
			CategoryID: expenseCatID,
			Month:      currentMonth,
			Amount:     1000000,
		}

		resp, err := budgetServ.SetBudget(ctx, testUser.ID, req)
		if err != nil {
			t.Fatalf("failed to set budget: %v", err)
		}

		if resp.Amount != 1000000 {
			t.Errorf("expected budget amount 1000000, got %f", resp.Amount)
		}

		budgetID = resp.ID
	})

	t.Run("Get budgets realization tracking", func(t *testing.T) {
		// Log an expense in the same category
		desc := "Grocery shopping"
		ip := "127.0.0.1"
		ua := "Go-Test-Agent"
		txReq := dto.CreateTransactionRequest{
			Date:        time.Now(),
			Amount:      150000,
			Type:        "expense",
			AccountID:   account.ID,
			CategoryID:  &expenseCatID,
			Description: &desc,
		}
		_, err := txServ.CreateTransaction(ctx, testUser.ID, txReq, &ip, &ua)
		if err != nil {
			t.Fatalf("failed to record expense transaction: %v", err)
		}

		// Get budgets
		budgets, err := budgetServ.GetBudgets(ctx, testUser.ID, currentMonth)
		if err != nil {
			t.Fatalf("failed to get budgets: %v", err)
		}

		if len(budgets) != 1 {
			t.Fatalf("expected 1 budget, got %d", len(budgets))
		}

		b := budgets[0]
		if b.Spent != 150000 {
			t.Errorf("expected spent 150000, got %f", b.Spent)
		}
		if b.Remaining != 850000 {
			t.Errorf("expected remaining 850000, got %f", b.Remaining)
		}

		// Get summary
		sum, err := budgetServ.GetBudgetSummary(ctx, testUser.ID, currentMonth)
		if err != nil {
			t.Fatalf("failed to get budget summary: %v", err)
		}

		if sum.TotalSpent.Value != 150000 {
			t.Errorf("expected total spent 150000, got %f", sum.TotalSpent.Value)
		}
	})

	t.Run("Update budget success", func(t *testing.T) {
		req := &dto.UpdateBudgetRequest{
			Amount: 1200000,
		}
		resp, err := budgetServ.UpdateBudget(ctx, testUser.ID, budgetID, req)
		if err != nil {
			t.Fatalf("failed to update budget: %v", err)
		}

		if resp.Amount != 1200000 {
			t.Errorf("expected updated budget amount 1200000, got %f", resp.Amount)
		}
	})

	t.Run("Delete budget success", func(t *testing.T) {
		err := budgetServ.DeleteBudget(ctx, testUser.ID, budgetID)
		if err != nil {
			t.Fatalf("failed to delete budget: %v", err)
		}

		budgets, err := budgetServ.GetBudgets(ctx, testUser.ID, currentMonth)
		if err != nil {
			t.Fatalf("failed to get budgets: %v", err)
		}
		if len(budgets) != 0 {
			t.Errorf("expected 0 budgets after deletion, got %d", len(budgets))
		}
	})
}
