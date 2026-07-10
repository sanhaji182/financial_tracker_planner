package service

import (
	"context"
	"testing"

	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/repository"
)

func TestAuthService(t *testing.T) {
	setupTestEnv()

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
}
