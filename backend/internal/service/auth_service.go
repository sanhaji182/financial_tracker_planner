package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
	"golang.org/x/crypto/bcrypt"

	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/model"
	"github.com/user/financial-os/internal/repository"
	"github.com/user/financial-os/internal/util"
)

type AuthService interface {
	Register(ctx context.Context, req dto.RegisterRequest) (*dto.AuthResponse, error)
	Login(ctx context.Context, req dto.LoginRequest) (*dto.AuthResponse, error)
	RefreshToken(ctx context.Context, refreshToken string) (*dto.AuthResponse, error)
	Logout(ctx context.Context, refreshToken string) error
	
	InviteSpouse(ctx context.Context, ownerID string, req dto.InviteSpouseRequest) (*dto.InviteLink, error)
	RegisterSpouse(ctx context.Context, inviteToken string, req dto.RegisterRequest) (*dto.AuthResponse, error)
	ChangePassword(ctx context.Context, userID string, req dto.ChangePasswordRequest) error
	GetMe(ctx context.Context, userID string) (*model.User, error)
}

type authService struct {
	userRepo repository.UserRepository
	rdb      *redis.Client
}

func NewAuthService(userRepo repository.UserRepository, rdb *redis.Client) AuthService {
	return &authService{
		userRepo: userRepo,
		rdb:      rdb,
	}
}

func (s *authService) Register(ctx context.Context, req dto.RegisterRequest) (*dto.AuthResponse, error) {
	// Check email uniqueness
	existingUser, err := s.userRepo.GetUserByEmail(ctx, req.Email)
	if err == nil && existingUser != nil {
		return nil, errors.New("email already registered")
	}

	// Hash password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), 12)
	if err != nil {
		return nil, fmt.Errorf("failed to hash password: %w", err)
	}

	// Create user
	newUser := &model.User{
		Email:           req.Email,
		PasswordHash:    string(hashedPassword),
		Name:            req.Name,
		Role:            "owner",
		Timezone:        "Asia/Jakarta",
		CurrencyDefault: "IDR",
		IsActive:        true,
	}

	createdUser, err := s.userRepo.CreateUser(ctx, newUser)
	if err != nil {
		return nil, fmt.Errorf("failed to create user: %w", err)
	}

	// Generate tokens
	accessToken, refreshToken, err := s.generateTokenPair(ctx, createdUser)
	if err != nil {
		return nil, err
	}

	return &dto.AuthResponse{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		User:         createdUser.ToResponse(),
	}, nil
}

func (s *authService) Login(ctx context.Context, req dto.LoginRequest) (*dto.AuthResponse, error) {
	// Find user
	user, err := s.userRepo.GetUserByEmail(ctx, req.Email)
	if err != nil {
		return nil, errors.New("invalid email or password")
	}

	// Verify password
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		return nil, errors.New("invalid email or password")
	}

	// Update last login
	now := time.Now()
	user.LastLoginAt = &now
	if err := s.userRepo.UpdateUser(ctx, user); err != nil {
		return nil, fmt.Errorf("failed to update user login time: %w", err)
	}

	// Generate tokens
	accessToken, refreshToken, err := s.generateTokenPair(ctx, user)
	if err != nil {
		return nil, err
	}

	return &dto.AuthResponse{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		User:         user.ToResponse(),
	}, nil
}

func (s *authService) RefreshToken(ctx context.Context, refreshToken string) (*dto.AuthResponse, error) {
	tokenHash := util.HashToken(refreshToken)

	// Fetch token from repo
	tokenRecord, err := s.userRepo.GetRefreshToken(ctx, tokenHash)
	if err != nil {
		return nil, errors.New("invalid refresh token")
	}

	// Check if revoked or expired
	if tokenRecord.IsRevoked {
		return nil, errors.New("refresh token has been revoked")
	}
	if tokenRecord.ExpiresAt.Before(time.Now()) {
		return nil, errors.New("refresh token expired")
	}

	// Fetch user
	user, err := s.userRepo.GetUserByID(ctx, tokenRecord.UserID)
	if err != nil {
		return nil, errors.New("user not found")
	}

	// Revoke the old refresh token (Rotate)
	if err := s.userRepo.RevokeRefreshToken(ctx, tokenHash); err != nil {
		return nil, fmt.Errorf("failed to revoke old token: %w", err)
	}

	// Generate new token pair
	accessToken, newRefreshToken, err := s.generateTokenPair(ctx, user)
	if err != nil {
		return nil, err
	}

	return &dto.AuthResponse{
		AccessToken:  accessToken,
		RefreshToken: newRefreshToken,
		User:         user.ToResponse(),
	}, nil
}

func (s *authService) Logout(ctx context.Context, refreshToken string) error {
	tokenHash := util.HashToken(refreshToken)
	return s.userRepo.RevokeRefreshToken(ctx, tokenHash)
}

func (s *authService) InviteSpouse(ctx context.Context, ownerID string, req dto.InviteSpouseRequest) (*dto.InviteLink, error) {
	// Verify owner exists
	owner, err := s.userRepo.GetUserByID(ctx, ownerID)
	if err != nil {
		return nil, errors.New("owner user not found")
	}
	if owner.Role != "owner" {
		return nil, errors.New("only owner can invite a spouse")
	}

	// Generate unique token
	inviteToken, err := util.GenerateRefreshToken()
	if err != nil {
		return nil, fmt.Errorf("failed to generate invite token: %w", err)
	}

	// Save invite token in Redis, pointing to owner ID
	redisKey := fmt.Sprintf("spouse_invite:%s", inviteToken)
	err = s.rdb.Set(ctx, redisKey, ownerID, 24*time.Hour).Err()
	if err != nil {
		return nil, fmt.Errorf("failed to store invite token in Redis: %w", err)
	}

	// Construct link
	inviteLink := fmt.Sprintf("http://localhost:5173/register-spouse/%s", inviteToken)

	return &dto.InviteLink{
		Email:      req.Email,
		InviteLink: inviteLink,
		Token:      inviteToken,
	}, nil
}

func (s *authService) RegisterSpouse(ctx context.Context, inviteToken string, req dto.RegisterRequest) (*dto.AuthResponse, error) {
	// Look up invite token in Redis
	redisKey := fmt.Sprintf("spouse_invite:%s", inviteToken)
	ownerID, err := s.rdb.Get(ctx, redisKey).Result()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return nil, errors.New("invalid or expired invitation link")
		}
		return nil, fmt.Errorf("failed to read invite token from Redis: %w", err)
	}

	// Verify email uniqueness
	existingUser, err := s.userRepo.GetUserByEmail(ctx, req.Email)
	if err == nil && existingUser != nil {
		return nil, errors.New("email already registered")
	}

	// Hash password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), 12)
	if err != nil {
		return nil, fmt.Errorf("failed to hash password: %w", err)
	}

	// Create user with 'spouse_viewer' role
	newSpouse := &model.User{
		Email:           req.Email,
		PasswordHash:    string(hashedPassword),
		Name:            req.Name,
		Role:            "spouse_viewer",
		InvitedBy:       &ownerID,
		Timezone:        "Asia/Jakarta",
		CurrencyDefault: "IDR",
		IsActive:        true,
	}

	createdSpouse, err := s.userRepo.CreateUser(ctx, newSpouse)
	if err != nil {
		return nil, fmt.Errorf("failed to create spouse user: %w", err)
	}

	// Delete invitation from Redis
	s.rdb.Del(ctx, redisKey)

	// Generate token pair
	accessToken, refreshToken, err := s.generateTokenPair(ctx, createdSpouse)
	if err != nil {
		return nil, err
	}

	return &dto.AuthResponse{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		User:         createdSpouse.ToResponse(),
	}, nil
}

func (s *authService) ChangePassword(ctx context.Context, userID string, req dto.ChangePasswordRequest) error {
	user, err := s.userRepo.GetUserByID(ctx, userID)
	if err != nil {
		return errors.New("user not found")
	}

	// Verify old password
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.OldPassword)); err != nil {
		return errors.New("incorrect old password")
	}

	// Hash new password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), 12)
	if err != nil {
		return fmt.Errorf("failed to hash password: %w", err)
	}

	user.PasswordHash = string(hashedPassword)
	return s.userRepo.UpdateUser(ctx, user)
}

// helper to generate Access & Refresh tokens, saving the refresh token in DB
func (s *authService) generateTokenPair(ctx context.Context, user *model.User) (string, string, error) {
	accessToken, err := util.GenerateAccessToken(user.ID, user.Role, user.Email)
	if err != nil {
		return "", "", fmt.Errorf("failed to generate access token: %w", err)
	}

	refreshToken, err := util.GenerateRefreshToken()
	if err != nil {
		return "", "", fmt.Errorf("failed to generate refresh token: %w", err)
	}

	// Hash refresh token for DB storage
	tokenHash := util.HashToken(refreshToken)

	// Refresh token expires in 7 days (168 hours)
	expiresAt := time.Now().Add(7 * 24 * time.Hour)

	dbToken := &model.RefreshToken{
		UserID:    user.ID,
		TokenHash: tokenHash,
		ExpiresAt: expiresAt,
		IsRevoked: false,
	}

	if err := s.userRepo.CreateRefreshToken(ctx, dbToken); err != nil {
		return "", "", fmt.Errorf("failed to save refresh token in database: %w", err)
	}

	return accessToken, refreshToken, nil
}

func (s *authService) GetMe(ctx context.Context, userID string) (*model.User, error) {
	return s.userRepo.GetUserByID(ctx, userID)
}
