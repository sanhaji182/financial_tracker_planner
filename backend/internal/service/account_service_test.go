package service

import (
	"context"
	"testing"

	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/model"
	"github.com/user/financial-os/internal/repository"
)

func TestAccountService(t *testing.T) {
	setupTestEnv(t)

	userRepo := repository.NewUserRepository(testDB)
	accountRepo := repository.NewAccountRepository(testDB)
	accountServ := NewAccountService(accountRepo)

	// Setup a test user
	ctx := context.Background()
	cleanDatabase(t)

	testUser := &model.User{
		Email:        "user@example.com",
		PasswordHash: "hashedPassword",
		Name:         "User Test",
		Role:         "owner",
		IsActive:     true,
	}
	var err error
	testUser, err = userRepo.CreateUser(ctx, testUser)
	if err != nil {
		t.Fatalf("failed to create test user: %v", err)
	}

	var accountID string

	t.Run("Create account success", func(t *testing.T) {
		prov := "Mandiri"
		num := "1234567890"
		isShared := true
		isEF := false
		notes := "Main transaction account"

		req := dto.CreateAccountRequest{
			Name:            "Tabungan Mandiri",
			Type:            "bank",
			BankProvider:    &prov,
			AccountNumber:   &num,
			InitialBalance:  10000000,
			Currency:        "IDR",
			IsShared:        &isShared,
			IsEmergencyFund: &isEF,
			Notes:           &notes,
		}

		resp, err := accountServ.CreateAccount(ctx, testUser.ID, req)
		if err != nil {
			t.Fatalf("expected no error, got %v", err)
		}

		if resp.Name != req.Name {
			t.Errorf("expected name %s, got %s", req.Name, resp.Name)
		}
		if resp.Balance != req.InitialBalance {
			t.Errorf("expected balance %f, got %f", req.InitialBalance, resp.Balance)
		}
		if *resp.AccountNumberMasked != "****7890" {
			t.Errorf("expected masked account number ****7890, got %s", *resp.AccountNumberMasked)
		}

		accountID = resp.ID
	})

	t.Run("Get account by ID", func(t *testing.T) {
		resp, err := accountServ.GetAccountByID(ctx, accountID, testUser.ID)
		if err != nil {
			t.Fatalf("expected no error, got %v", err)
		}

		if resp.ID != accountID {
			t.Errorf("expected account ID %s, got %s", accountID, resp.ID)
		}
	})

	t.Run("Update account", func(t *testing.T) {
		prov := "Mandiri Utama"
		isShared := false
		isEF := true
		notes := "Emergency Fund Account"
		isActive := true

		req := dto.UpdateAccountRequest{
			Name:            "Tabungan Emergency",
			BankProvider:    &prov,
			IsShared:        &isShared,
			IsEmergencyFund: &isEF,
			Notes:           &notes,
			IsActive:        &isActive,
		}

		resp, err := accountServ.UpdateAccount(ctx, accountID, testUser.ID, req)
		if err != nil {
			t.Fatalf("expected no error, got %v", err)
		}

		if resp.Name != req.Name {
			t.Errorf("expected name %s, got %s", req.Name, resp.Name)
		}
		if resp.IsEmergencyFund != true {
			t.Error("expected IsEmergencyFund to be true")
		}
	})

	t.Run("Get accounts list", func(t *testing.T) {
		list, err := accountServ.GetAccounts(ctx, testUser.ID)
		if err != nil {
			t.Fatalf("expected no error, got %v", err)
		}

		if len(list) != 1 {
			t.Errorf("expected 1 account, got %d", len(list))
		}
	})

	t.Run("Get account summary", func(t *testing.T) {
		summary, err := accountServ.GetAccountSummary(ctx, testUser.ID)
		if err != nil {
			t.Fatalf("expected no error, got %v", err)
		}

		if summary.GrandTotal != 10000000 {
			t.Errorf("expected grand total 10000000, got %f", summary.GrandTotal)
		}
	})

	t.Run("Delete account", func(t *testing.T) {
		err := accountServ.DeleteAccount(ctx, accountID, testUser.ID)
		if err != nil {
			t.Fatalf("expected no error, got %v", err)
		}

		// Getting it now should return error
		_, err = accountServ.GetAccountByID(ctx, accountID, testUser.ID)
		if err == nil {
			t.Fatal("expected error getting deleted account")
		}
	})
}
