package service

import (
	"context"
	"testing"

	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/repository"
)

func TestAuthService(t *testing.T) {
	setupTestEnv(t)

	userRepo := repository.NewUserRepository(testDB)
	authServ := NewAuthService(userRepo, testRedis)

	t.Run("Register success", func(t *testing.T) {
		cleanDatabase(t)
		ctx := context.Background()

		req := dto.RegisterRequest{
			Email:    "owner@example.com",
			Password: "securePassword123",
			Name:     "Owner Test",
		}

		resp, err := authServ.Register(ctx, req)
		if err != nil {
			t.Fatalf("expected no error, got %v", err)
		}

		if resp.User.Email != req.Email {
			t.Errorf("expected email %s, got %s", req.Email, resp.User.Email)
		}
		if resp.User.Role != "owner" {
			t.Errorf("expected default role to be owner, got %s", resp.User.Role)
		}
		if resp.AccessToken == "" || resp.RefreshToken == "" {
			t.Error("expected tokens to be returned")
		}
	})

	t.Run("Register duplicate email fails", func(t *testing.T) {
		ctx := context.Background()
		req := dto.RegisterRequest{
			Email:    "owner@example.com",
			Password: "securePassword123",
			Name:     "Owner Test 2",
		}

		_, err := authServ.Register(ctx, req)
		if err == nil {
			t.Fatal("expected duplicate email registration to fail")
		}
	})

	t.Run("Login success", func(t *testing.T) {
		ctx := context.Background()
		req := dto.LoginRequest{
			Email:    "owner@example.com",
			Password: "securePassword123",
		}

		resp, err := authServ.Login(ctx, req)
		if err != nil {
			t.Fatalf("expected no error, got %v", err)
		}

		if resp.AccessToken == "" || resp.RefreshToken == "" {
			t.Error("expected tokens to be returned")
		}
	})

	t.Run("Login incorrect password fails", func(t *testing.T) {
		ctx := context.Background()
		req := dto.LoginRequest{
			Email:    "owner@example.com",
			Password: "wrongPassword",
		}

		_, err := authServ.Login(ctx, req)
		if err == nil {
			t.Fatal("expected login with wrong password to fail")
		}
	})

	t.Run("Refresh token and Logout success", func(t *testing.T) {
		ctx := context.Background()
		loginReq := dto.LoginRequest{
			Email:    "owner@example.com",
			Password: "securePassword123",
		}

		loginResp, err := authServ.Login(ctx, loginReq)
		if err != nil {
			t.Fatalf("login failed: %v", err)
		}

		// Refresh
		refreshResp, err := authServ.RefreshToken(ctx, loginResp.RefreshToken)
		if err != nil {
			t.Fatalf("expected no error on refresh, got %v", err)
		}
		if refreshResp.AccessToken == "" {
			t.Error("expected new access token")
		}

		// Logout
		err = authServ.Logout(ctx, refreshResp.RefreshToken)
		if err != nil {
			t.Fatalf("expected no error on logout, got %v", err)
		}

		// Refresh again should fail since revoked
		_, err = authServ.RefreshToken(ctx, refreshResp.RefreshToken)
		if err == nil {
			t.Fatal("expected refresh with revoked token to fail")
		}
	})

	t.Run("Invite and Register Spouse", func(t *testing.T) {
		ctx := context.Background()
		// Get owner ID
		owner, err := userRepo.GetUserByEmail(ctx, "owner@example.com")
		if err != nil {
			t.Fatalf("failed to get owner: %v", err)
		}

		inviteReq := dto.InviteSpouseRequest{
			Email: "spouse@example.com",
		}

		inviteLink, err := authServ.InviteSpouse(ctx, owner.ID, inviteReq)
		if err != nil {
			t.Fatalf("failed to invite spouse: %v", err)
		}

		if inviteLink.Token == "" {
			t.Fatal("expected non-empty invitation token")
		}

		// Register Spouse
		spouseReq := dto.RegisterRequest{
			Email:    "spouse@example.com",
			Password: "spousePassword123",
			Name:     "Spouse Test",
		}

		resp, err := authServ.RegisterSpouse(ctx, inviteLink.Token, spouseReq)
		if err != nil {
			t.Fatalf("failed to register spouse: %v", err)
		}

		if resp.User.Role != "spouse_viewer" {
			t.Errorf("expected spouse role to be spouse_viewer, got %s", resp.User.Role)
		}
	})

	t.Run("Delete account verifies password and revokes sessions", func(t *testing.T) {
		cleanDatabase(t)
		ctx := context.Background()

		regReq := dto.RegisterRequest{
			Email:    "delete-me@example.com",
			Password: "securePassword123",
			Name:     "Delete Candidate",
		}
		regResp, err := authServ.Register(ctx, regReq)
		if err != nil {
			t.Fatalf("register failed: %v", err)
		}

		// Wrong password should fail
		err = authServ.DeleteAccount(ctx, regResp.User.ID, dto.DeleteAccountRequest{
			Password: "wrongPassword",
		})
		if err == nil {
			t.Fatal("expected delete account with wrong password to fail")
		}

		// Valid password succeeds
		err = authServ.DeleteAccount(ctx, regResp.User.ID, dto.DeleteAccountRequest{
			Password: "securePassword123",
		})
		if err != nil {
			t.Fatalf("expected delete account to succeed, got %v", err)
		}

		// Refresh token must be revoked & user not found by email
		if _, err := authServ.RefreshToken(ctx, regResp.RefreshToken); err == nil {
			t.Fatal("expected refresh token to be revoked after account deletion")
		}
		if _, err := userRepo.GetUserByEmail(ctx, "delete-me@example.com"); err == nil {
			t.Fatal("expected deleted user not to be returned by email")
		}
	})
}

func TestParseSpouseInviteValue(t *testing.T) {
	owner1, role1 := ParseSpouseInviteValue("owner-uuid-1")
	if owner1 != "owner-uuid-1" || role1 != "spouse_viewer" {
		t.Fatalf("legacy invite parse mismatch: %s %s", owner1, role1)
	}
	owner2, role2 := ParseSpouseInviteValue("owner-uuid-2|spouse_co_owner")
	if owner2 != "owner-uuid-2" || role2 != "spouse_co_owner" {
		t.Fatalf("co-owner invite parse mismatch: %s %s", owner2, role2)
	}
}
