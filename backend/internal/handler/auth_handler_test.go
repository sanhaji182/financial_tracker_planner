package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/model"
	"github.com/user/financial-os/internal/util"
)

type mockAuthService struct {
	loginResp         *dto.AuthResponse
	deleteAccountErr  error
	deletedUserID     string
	deletedPassword   string
	deleteAccountCalled bool
}

func (m *mockAuthService) Register(_ context.Context, _ dto.RegisterRequest) (*dto.AuthResponse, error) {
	return m.loginResp, nil
}

func (m *mockAuthService) Login(_ context.Context, _ dto.LoginRequest) (*dto.AuthResponse, error) {
	return m.loginResp, nil
}

func (m *mockAuthService) RefreshToken(_ context.Context, _ string) (*dto.AuthResponse, error) {
	return m.loginResp, nil
}

func (m *mockAuthService) Logout(_ context.Context, _ string) error {
	return nil
}

func (m *mockAuthService) InviteSpouse(_ context.Context, _ string, req dto.InviteSpouseRequest) (*dto.InviteLink, error) {
	return &dto.InviteLink{Email: req.Email}, nil
}

func (m *mockAuthService) RegisterSpouse(_ context.Context, _ string, _ dto.RegisterRequest) (*dto.AuthResponse, error) {
	return m.loginResp, nil
}

func (m *mockAuthService) ChangePassword(_ context.Context, _ string, _ dto.ChangePasswordRequest) error {
	return nil
}

func (m *mockAuthService) DeleteAccount(_ context.Context, userID string, req dto.DeleteAccountRequest) error {
	m.deleteAccountCalled = true
	m.deletedUserID = userID
	m.deletedPassword = req.Password
	return m.deleteAccountErr
}

func (m *mockAuthService) GetMe(_ context.Context, _ string) (*model.User, error) {
	return &model.User{ID: "user-1", Email: "owner@example.com", Role: "owner"}, nil
}

func setupAuthHandlerRouter(svc *mockAuthService) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	rg := r.Group("/api/v1/auth")
	h := NewAuthHandler(svc)
	h.RegisterRoutes(rg)
	return r
}

func TestAuthHandlerMobileAndDeleteAccount(t *testing.T) {
	sampleResp := &dto.AuthResponse{
		AccessToken:  "access-token-123",
		RefreshToken: "refresh-token-456",
		User: model.UserResponse{
			ID:    "user-1",
			Email: "owner@example.com",
			Name:  "Owner",
			Role:  "owner",
		},
	}

	t.Run("web login omits refresh_token from JSON and sets HttpOnly cookie", func(t *testing.T) {
		svc := &mockAuthService{loginResp: sampleResp}
		router := setupAuthHandlerRouter(svc)

		body := bytes.NewBufferString(`{"email":"owner@example.com","password":"secret123"}`)
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", body)
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
		}

		var payload struct {
			Data map[string]interface{} `json:"data"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
			t.Fatalf("failed to unmarshal response: %v", err)
		}

		if payload.Data["access_token"] != "access-token-123" {
			t.Fatalf("expected access_token in response, got %v", payload.Data["access_token"])
		}
		if _, exists := payload.Data["refresh_token"]; exists {
			t.Fatalf("expected web login not to expose refresh_token in JSON body")
		}
		setCookie := rec.Header().Get("Set-Cookie")
		if !strings.Contains(setCookie, "refresh_token=refresh-token-456") || !strings.Contains(setCookie, "HttpOnly") {
			t.Fatalf("expected HttpOnly refresh_token cookie, got %q", setCookie)
		}
	})

	t.Run("mobile login returns refresh_token in JSON body when X-Client-Platform is mobile", func(t *testing.T) {
		svc := &mockAuthService{loginResp: sampleResp}
		router := setupAuthHandlerRouter(svc)

		body := bytes.NewBufferString(`{"email":"owner@example.com","password":"secret123"}`)
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", body)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Client-Platform", "mobile")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
		}

		var payload struct {
			Data map[string]interface{} `json:"data"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
			t.Fatalf("failed to unmarshal response: %v", err)
		}

		if payload.Data["refresh_token"] != "refresh-token-456" {
			t.Fatalf("expected refresh_token in mobile JSON response, got %v", payload.Data["refresh_token"])
		}
	})

	t.Run("DELETE /auth/account requires password and calls service", func(t *testing.T) {
		svc := &mockAuthService{loginResp: sampleResp}
		router := setupAuthHandlerRouter(svc)

		token, err := util.GenerateAccessToken("user-1", "owner", "owner@example.com")
		if err != nil {
			t.Fatalf("failed to generate token: %v", err)
		}

		// Missing password -> 422
		badReq := httptest.NewRequest(http.MethodDelete, "/api/v1/auth/account", bytes.NewBufferString(`{}`))
		badReq.Header.Set("Authorization", "Bearer "+token)
		badReq.Header.Set("Content-Type", "application/json")
		badRec := httptest.NewRecorder()
		router.ServeHTTP(badRec, badReq)
		if badRec.Code != http.StatusUnprocessableEntity {
			t.Fatalf("expected 422 for missing password, got %d", badRec.Code)
		}

		// Valid password -> 200 & clears cookie
		okReq := httptest.NewRequest(http.MethodDelete, "/api/v1/auth/account", bytes.NewBufferString(`{"password":"secret123"}`))
		okReq.Header.Set("Authorization", "Bearer "+token)
		okReq.Header.Set("Content-Type", "application/json")
		okRec := httptest.NewRecorder()
		router.ServeHTTP(okRec, okReq)

		if okRec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", okRec.Code, okRec.Body.String())
		}
		if !svc.deleteAccountCalled || svc.deletedUserID != "user-1" || svc.deletedPassword != "secret123" {
			t.Fatalf("expected DeleteAccount to be called with user-1 and secret123")
		}
		if !strings.Contains(okRec.Header().Get("Set-Cookie"), "Max-Age=0") {
			t.Fatalf("expected cleared refresh_token cookie, got %q", okRec.Header().Get("Set-Cookie"))
		}

		// Incorrect password service error -> 400
		svc.deleteAccountErr = errors.New("incorrect password")
		errReq := httptest.NewRequest(http.MethodDelete, "/api/v1/auth/account", bytes.NewBufferString(`{"password":"wrong"}`))
		errReq.Header.Set("Authorization", "Bearer "+token)
		errReq.Header.Set("Content-Type", "application/json")
		errRec := httptest.NewRecorder()
		router.ServeHTTP(errRec, errReq)
		if errRec.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 when service rejects password, got %d", errRec.Code)
		}
	})
}
