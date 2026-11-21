package service

import (
	"context"
	"testing"

	"github.com/user/financial-os/internal/model"
	"github.com/user/financial-os/internal/repository"
)

func TestAllocationService(t *testing.T) {
	setupTestEnv(t)

	userRepo := repository.NewUserRepository(testDB)
	efServ := NewEFService(testDB)
	forecastServ := NewForecastService(testDB, testRedis)
	allocationServ := NewAllocationService(testDB, forecastServ, efServ)

	ctx := context.Background()
	cleanDatabase(t)

	// Create test user
	testUser := &model.User{
		Email:        "allocator@example.com",
		PasswordHash: "hashedPassword",
		Name:         "Allocator Test",
		Role:         "owner",
		IsActive:     true,
	}
	var err error
	testUser, err = userRepo.CreateUser(ctx, testUser)
	if err != nil {
		t.Fatalf("failed to create test user: %v", err)
	}

	t.Run("Get allocation advice success", func(t *testing.T) {
		resp, err := allocationServ.GetAllocationAdvice(ctx, testUser.ID)
		if err != nil {
			t.Fatalf("failed to get allocation advice: %v", err)
		}

		if len(resp.Advices) != 0 {
			t.Errorf("expected no allocation advice without income history, got %d", len(resp.Advices))
		}
		if resp.Surplus.Value != 0 {
			t.Errorf("expected zero surplus without income history, got %f", resp.Surplus.Value)
		}
		if resp.DataSufficiency == nil {
			t.Fatal("expected data_sufficiency on allocation response")
		}
		if resp.DataSufficiency.IsSufficient {
			t.Error("expected insufficient data without income history")
		}
		if len(resp.Hierarchy) == 0 {
			t.Error("expected hierarchy documentation")
		}
	})
}
