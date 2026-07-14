package service

import (
	"context"
	"testing"
	"time"

	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/model"
	"github.com/user/financial-os/internal/repository"
)

func TestBillService(t *testing.T) {
	setupTestEnv(t)

	userRepo := repository.NewUserRepository(testDB)
	accountRepo := repository.NewAccountRepository(testDB)
	categoryRepo := repository.NewCategoryRepository(testDB)
	billRepo := repository.NewBillRepository(testDB)
	billServ := NewBillService(testDB, billRepo, accountRepo, categoryRepo)

	ctx := context.Background()
	cleanDatabase(t)

	// Create test user
	testUser := &model.User{
		Email:        "biller@example.com",
		PasswordHash: "hashedPassword",
		Name:         "Biller Test",
		Role:         "owner",
		IsActive:     true,
	}
	var err error
	testUser, err = userRepo.CreateUser(ctx, testUser)
	if err != nil {
		t.Fatalf("failed to create test user: %v", err)
	}

	// Create test account for bill payment
	prov := "BCA"
	num := "11111"
	isShared := true
	isEF := false
	accReq := dto.CreateAccountRequest{
		Name:            "Bill Pay Account",
		Type:            "bank",
		BankProvider:    &prov,
		AccountNumber:   &num,
		InitialBalance:  2000000,
		Currency:        "IDR",
		IsShared:        &isShared,
		IsEmergencyFund: &isEF,
	}
	account, err := NewAccountService(accountRepo).CreateAccount(ctx, testUser.ID, accReq)
	if err != nil {
		t.Fatalf("failed to create payment account: %v", err)
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

	var billID string

	t.Run("Create bill success", func(t *testing.T) {
		dueDay := 5
		notes := "WiFi Monthly Bill"
		req := dto.CreateBillRequest{
			Name:               "Indihome",
			Amount:             450000,
			CategoryID:         &expenseCatID,
			AccountID:          &account.ID,
			Frequency:          "monthly",
			DueDay:             &dueDay,
			AutoRemind:         true,
			ReminderDaysBefore: 2,
			Notes:              &notes,
		}

		resp, err := billServ.CreateBill(ctx, testUser.ID, req)
		if err != nil {
			t.Fatalf("failed to create bill: %v", err)
		}

		if resp.Name != req.Name {
			t.Errorf("expected name %s, got %s", req.Name, resp.Name)
		}
		if resp.Amount != req.Amount {
			t.Errorf("expected amount %f, got %f", req.Amount, resp.Amount)
		}
		if resp.Status != "unpaid" {
			t.Errorf("expected initial status unpaid, got %s", resp.Status)
		}

		billID = resp.ID
	})

	t.Run("Get bill by ID", func(t *testing.T) {
		resp, err := billServ.GetBillByID(ctx, testUser.ID, billID)
		if err != nil {
			t.Fatalf("failed to get bill: %v", err)
		}
		if resp.ID != billID {
			t.Errorf("expected bill ID %s, got %s", billID, resp.ID)
		}
	})

	t.Run("Pay bill and check balance impact", func(t *testing.T) {
		notes := "WiFi Paid"
		req := dto.PayBillRequest{
			Amount:      450000,
			PaymentDate: time.Now(),
			Notes:       &notes,
			AccountID:   account.ID,
		}

		resp, err := billServ.PayBill(ctx, testUser.ID, billID, req)
		if err != nil {
			t.Fatalf("failed to pay bill: %v", err)
		}

		if resp.RemainingAmount != 0 {
			t.Errorf("expected remaining amount 0, got %f", resp.RemainingAmount)
		}

		// Check account balance decreased
		acc, err := accountRepo.GetByID(ctx, account.ID)
		if err != nil {
			t.Fatalf("failed to get account: %v", err)
		}
		// 2,000,000 - 450,000 = 1,550,000
		if acc.Balance != 1550000 {
			t.Errorf("expected balance 1550000, got %f", acc.Balance)
		}

		// Check bill status updated to paid
		b, err := billServ.GetBillByID(ctx, testUser.ID, billID)
		if err != nil {
			t.Fatalf("failed to get bill: %v", err)
		}
		if b.Status != "paid" {
			t.Errorf("expected bill status to be paid, got %s", b.Status)
		}
	})
}
