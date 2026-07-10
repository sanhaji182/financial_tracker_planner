package service

import (
	"context"
	"testing"
	"time"

	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/model"
	"github.com/user/financial-os/internal/repository"
)

func TestTransactionService(t *testing.T) {
	setupTestEnv()

	userRepo := repository.NewUserRepository(testDB)
	accountRepo := repository.NewAccountRepository(testDB)
	categoryRepo := repository.NewCategoryRepository(testDB)
	txRepo := repository.NewTransactionRepository(testDB)

	vaultServ := NewVaultService(t.TempDir())
	aiSettingsRepo := repository.NewAISettingsRepository(testDB)
	aiServ := NewAISettingsService(aiSettingsRepo, vaultServ)
	txServ := NewTransactionService(txRepo, accountRepo, categoryRepo, aiServ)

	ctx := context.Background()
	cleanDatabase(t)

	// Create test user
	testUser := &model.User{
		Email:        "transactor@example.com",
		PasswordHash: "hashedPassword",
		Name:         "Transactor Test",
		Role:         "owner",
		IsActive:     true,
	}
	var err error
	testUser, err = userRepo.CreateUser(ctx, testUser)
	if err != nil {
		t.Fatalf("failed to create test user: %v", err)
	}

	// Create test accounts
	prov := "BCA"
	num1 := "11111"
	isShared := true
	isEF := false
	accReq1 := dto.CreateAccountRequest{
		Name:            "Account 1",
		Type:            "bank",
		BankProvider:    &prov,
		AccountNumber:   &num1,
		InitialBalance:  1000000,
		Currency:        "IDR",
		IsShared:        &isShared,
		IsEmergencyFund: &isEF,
	}
	account1, err := NewAccountService(accountRepo).CreateAccount(ctx, testUser.ID, accReq1)
	if err != nil {
		t.Fatalf("failed to create account 1: %v", err)
	}

	num2 := "22222"
	accReq2 := dto.CreateAccountRequest{
		Name:            "Account 2",
		Type:            "bank",
		BankProvider:    &prov,
		AccountNumber:   &num2,
		InitialBalance:  500000,
		Currency:        "IDR",
		IsShared:        &isShared,
		IsEmergencyFund: &isEF,
	}
	account2, err := NewAccountService(accountRepo).CreateAccount(ctx, testUser.ID, accReq2)
	if err != nil {
		t.Fatalf("failed to create account 2: %v", err)
	}

	// Find expense and income categories
	categories, err := categoryRepo.GetAll(ctx, testUser.ID)
	if err != nil {
		t.Fatalf("failed to get categories: %v", err)
	}
	var incomeCatID, expenseCatID string
	for _, c := range categories {
		if c.Type == "income" && incomeCatID == "" {
			incomeCatID = c.ID
		}
		if c.Type == "expense" && expenseCatID == "" {
			expenseCatID = c.ID
		}
	}

	ip := "127.0.0.1"
	ua := "Go-Test-Agent"

	t.Run("Create income transaction impacts balance", func(t *testing.T) {
		desc := "Salary contribution"
		req := dto.CreateTransactionRequest{
			Date:        time.Now(),
			Amount:      200000,
			Type:        "income",
			AccountID:   account1.ID,
			CategoryID:  &incomeCatID,
			Description: &desc,
		}

		resp, err := txServ.CreateTransaction(ctx, testUser.ID, req, &ip, &ua)
		if err != nil {
			t.Fatalf("failed to create income transaction: %v", err)
		}

		// Verify account balance updated
		acc, _ := accountRepo.GetByID(ctx, account1.ID)
		if acc.Balance != 1200000 {
			t.Errorf("expected balance 1200000, got %f", acc.Balance)
		}

		// Verify audit log exists
		logs, err := txRepo.GetGlobalAuditLogs(ctx, testUser.ID, "", nil, nil, "")
		if err != nil {
			t.Fatalf("failed to get audit logs: %v", err)
		}
		if len(logs) == 0 {
			t.Fatal("expected audit log entry to be written")
		}
		found := false
		for _, l := range logs {
			if l.EntityType == "transaction" && l.EntityID == resp.ID && l.Action == "create" {
				found = true
				break
			}
		}
		if !found {
			t.Error("expected create transaction audit log entry")
		}
	})

	t.Run("Create expense transaction impacts balance", func(t *testing.T) {
		desc := "Snack"
		req := dto.CreateTransactionRequest{
			Date:        time.Now(),
			Amount:      50000,
			Type:        "expense",
			AccountID:   account1.ID,
			CategoryID:  &expenseCatID,
			Description: &desc,
		}

		_, err := txServ.CreateTransaction(ctx, testUser.ID, req, &ip, &ua)
		if err != nil {
			t.Fatalf("failed to create expense transaction: %v", err)
		}

		// Verify account balance updated
		acc, _ := accountRepo.GetByID(ctx, account1.ID)
		if acc.Balance != 1150000 {
			t.Errorf("expected balance 1150000, got %f", acc.Balance)
		}
	})

	t.Run("Create transfer transaction impacts both balances", func(t *testing.T) {
		desc := "Transfer out"
		req := dto.CreateTransactionRequest{
			Date:            time.Now(),
			Amount:          150000,
			Type:            "transfer",
			AccountID:       account1.ID,
			TargetAccountID: &account2.ID,
			Description:     &desc,
		}

		_, err := txServ.CreateTransaction(ctx, testUser.ID, req, &ip, &ua)
		if err != nil {
			t.Fatalf("failed to create transfer: %v", err)
		}

		// Verify account 1 balance
		acc1, _ := accountRepo.GetByID(ctx, account1.ID)
		if acc1.Balance != 1000000 {
			t.Errorf("expected account 1 balance 1000000, got %f", acc1.Balance)
		}

		// Verify account 2 balance
		acc2, _ := accountRepo.GetByID(ctx, account2.ID)
		if acc2.Balance != 650000 {
			t.Errorf("expected account 2 balance 650000, got %f", acc2.Balance)
		}
	})

	t.Run("Get transactions and filter", func(t *testing.T) {
		filters := map[string]interface{}{
			"type": "transfer",
		}
		resp, err := txServ.GetTransactions(ctx, testUser.ID, filters, 1, 10, "date", "desc")
		if err != nil {
			t.Fatalf("failed to get transactions: %v", err)
		}
		if len(resp.Data) != 1 {
			t.Errorf("expected 1 transfer transaction, got %d", len(resp.Data))
		}
	})
}
