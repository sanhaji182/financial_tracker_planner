package service

import (
	"context"
	"errors"
	"strings"
	"testing"

	"golang.org/x/crypto/bcrypt"

	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/model"
)

type inMemoryUserRepo struct {
	user          *model.User
	updated       bool
	revokedAll    bool
	revokedUserID string
}

func (r *inMemoryUserRepo) CreateUser(_ context.Context, user *model.User) (*model.User, error) {
	return user, nil
}

func (r *inMemoryUserRepo) GetUserByEmail(_ context.Context, email string) (*model.User, error) {
	if r.user != nil && r.user.Email == email && r.user.DeletedAt == nil {
		return r.user, nil
	}
	return nil, errors.New("user not found")
}

func (r *inMemoryUserRepo) GetUserByID(_ context.Context, id string) (*model.User, error) {
	if r.user != nil && r.user.ID == id && r.user.DeletedAt == nil {
		return r.user, nil
	}
	return nil, errors.New("user not found")
}

func (r *inMemoryUserRepo) UpdateUser(_ context.Context, user *model.User) error {
	r.updated = true
	r.user = user
	return nil
}

func (r *inMemoryUserRepo) CreateRefreshToken(_ context.Context, _ *model.RefreshToken) error {
	return nil
}

func (r *inMemoryUserRepo) GetRefreshToken(_ context.Context, _ string) (*model.RefreshToken, error) {
	return nil, errors.New("not found")
}

func (r *inMemoryUserRepo) RevokeRefreshToken(_ context.Context, _ string) error {
	return nil
}

func (r *inMemoryUserRepo) RevokeAllUserTokens(_ context.Context, userID string) error {
	r.revokedAll = true
	r.revokedUserID = userID
	return nil
}

func TestDeleteAccount(t *testing.T) {
	hash, err := bcrypt.GenerateFromPassword([]byte("MySecret123!"), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("failed to hash password: %v", err)
	}

	t.Run("rejects wrong password without mutating user", func(t *testing.T) {
		repo := &inMemoryUserRepo{
			user: &model.User{
				ID:           "user-1",
				Email:        "owner@example.com",
				PasswordHash: string(hash),
				Role:         "owner",
				IsActive:     true,
			},
		}
		svc := NewAuthService(repo, nil)

		err := svc.DeleteAccount(context.Background(), "user-1", dto.DeleteAccountRequest{
			Password: "wrong-password",
		})
		if err == nil || err.Error() != "incorrect password" {
			t.Fatalf("expected incorrect password error, got %v", err)
		}
		if repo.updated || repo.revokedAll {
			t.Fatal("expected user and tokens not to be modified on wrong password")
		}
	})

	t.Run("soft-deletes user, anonymizes email, and revokes all refresh tokens", func(t *testing.T) {
		repo := &inMemoryUserRepo{
			user: &model.User{
				ID:           "user-1",
				Email:        "owner@example.com",
				PasswordHash: string(hash),
				Role:         "owner",
				IsActive:     true,
			},
		}
		svc := NewAuthService(repo, nil)

		err := svc.DeleteAccount(context.Background(), "user-1", dto.DeleteAccountRequest{
			Password: "MySecret123!",
		})
		if err != nil {
			t.Fatalf("expected nil error, got %v", err)
		}
		if !repo.updated {
			t.Fatal("expected UpdateUser to be called")
		}
		if repo.user.DeletedAt == nil {
			t.Fatal("expected DeletedAt to be set")
		}
		if repo.user.IsActive {
			t.Fatal("expected IsActive to be false")
		}
		if !strings.HasPrefix(repo.user.Email, "deleted_") || !strings.HasSuffix(repo.user.Email, "_owner@example.com") {
			t.Fatalf("expected anonymized email, got %s", repo.user.Email)
		}
		if !repo.revokedAll || repo.revokedUserID != "user-1" {
			t.Fatalf("expected RevokeAllUserTokens for user-1")
		}
	})
}
