package service

import (
	"context"
	"errors"
	"strings"

	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/model"
	"github.com/user/financial-os/internal/repository"
)

type AccountService interface {
	CreateAccount(ctx context.Context, userID string, req dto.CreateAccountRequest) (*dto.AccountResponse, error)
	GetAccounts(ctx context.Context, userID string) ([]dto.AccountResponse, error)
	GetAccountByID(ctx context.Context, accountID string, userID string) (*dto.AccountResponse, error)
	UpdateAccount(ctx context.Context, accountID string, userID string, req dto.UpdateAccountRequest) (*dto.AccountResponse, error)
	DeleteAccount(ctx context.Context, accountID string, userID string) error
	GetAccountSummary(ctx context.Context, userID string) (*dto.AccountSummaryResponse, error)
}

type accountService struct {
	accountRepo repository.AccountRepository
}

func NewAccountService(accountRepo repository.AccountRepository) AccountService {
	return &accountService{accountRepo: accountRepo}
}

func maskAccountNumber(num string) string {
	cleaned := strings.TrimSpace(num)
	if cleaned == "" {
		return ""
	}
	if len(cleaned) > 4 {
		return "****" + cleaned[len(cleaned)-4:]
	}
	return "****" + cleaned
}

func (s *accountService) CreateAccount(ctx context.Context, userID string, req dto.CreateAccountRequest) (*dto.AccountResponse, error) {
	// Account type validation
	allowedTypes := map[string]bool{
		"bank":       true,
		"e_wallet":   true,
		"cash":       true,
		"investment": true,
		"deposit":    true,
	}
	if !allowedTypes[req.Type] {
		return nil, errors.New("invalid account type")
	}

	currency := "IDR"
	if req.Currency != "" {
		currency = req.Currency
	}

	var masked *string
	if req.AccountNumber != nil && *req.AccountNumber != "" {
		m := maskAccountNumber(*req.AccountNumber)
		masked = &m
	}

	isShared := false
	if req.IsShared != nil {
		isShared = *req.IsShared
	}

	isEmergency := false
	if req.IsEmergencyFund != nil {
		isEmergency = *req.IsEmergencyFund
	}

	newAccount := &model.Account{
		UserID:              userID,
		Name:                req.Name,
		Type:                req.Type,
		BankProvider:        req.BankProvider,
		AccountNumberMasked: masked,
		Balance:             req.InitialBalance, // Initial balance sets initial balance and current balance
		InitialBalance:      req.InitialBalance,
		Currency:            currency,
		Icon:                req.Icon,
		Color:               req.Color,
		IsActive:            true,
		IsShared:            isShared,
		IsEmergencyFund:     isEmergency,
		SortOrder:           0,
		Notes:               req.Notes,
	}

	created, err := s.accountRepo.Create(ctx, newAccount)
	if err != nil {
		return nil, err
	}

	res := dto.ToAccountResponse(created)
	return &res, nil
}

func (s *accountService) GetAccounts(ctx context.Context, userID string) ([]dto.AccountResponse, error) {
	accounts, err := s.accountRepo.GetAllByUser(ctx, userID)
	if err != nil {
		return nil, err
	}

	resList := make([]dto.AccountResponse, len(accounts))
	for i, a := range accounts {
		resList[i] = dto.ToAccountResponse(&a)
	}
	return resList, nil
}

func (s *accountService) GetAccountByID(ctx context.Context, accountID string, userID string) (*dto.AccountResponse, error) {
	a, err := s.accountRepo.GetByID(ctx, accountID)
	if err != nil {
		return nil, err
	}

	if a.UserID != userID {
		return nil, errors.New("unauthorized access to account")
	}

	res := dto.ToAccountResponse(a)
	return &res, nil
}

func (s *accountService) UpdateAccount(ctx context.Context, accountID string, userID string, req dto.UpdateAccountRequest) (*dto.AccountResponse, error) {
	a, err := s.accountRepo.GetByID(ctx, accountID)
	if err != nil {
		return nil, err
	}

	if a.UserID != userID {
		return nil, errors.New("unauthorized to update account")
	}

	// Update mutable fields (type and initial_balance cannot be updated)
	a.Name = req.Name
	a.BankProvider = req.BankProvider
	a.Icon = req.Icon
	a.Color = req.Color
	a.Notes = req.Notes

	if req.IsActive != nil {
		a.IsActive = *req.IsActive
	}
	if req.IsShared != nil {
		a.IsShared = *req.IsShared
	}
	if req.IsEmergencyFund != nil {
		a.IsEmergencyFund = *req.IsEmergencyFund
	}

	if err := s.accountRepo.Update(ctx, a); err != nil {
		return nil, err
	}

	res := dto.ToAccountResponse(a)
	return &res, nil
}

func (s *accountService) DeleteAccount(ctx context.Context, accountID string, userID string) error {
	a, err := s.accountRepo.GetByID(ctx, accountID)
	if err != nil {
		return err
	}

	if a.UserID != userID {
		return errors.New("unauthorized to delete account")
	}

	// Verify no active transactions reference this account
	hasTx, err := s.accountRepo.HasActiveTransactions(ctx, accountID)
	if err != nil {
		return err
	}
	if hasTx {
		return errors.New("cannot delete account with active transactions")
	}

	return s.accountRepo.SoftDelete(ctx, accountID)
}

func (s *accountService) GetAccountSummary(ctx context.Context, userID string) (*dto.AccountSummaryResponse, error) {
	summary, err := s.accountRepo.GetSummaryByUser(ctx, userID)
	if err != nil {
		return nil, err
	}

	res := dto.ToAccountSummaryResponse(summary)
	return &res, nil
}
