package service

import (
	"context"
	"errors"
	"time"

	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/model"
	"github.com/user/financial-os/internal/repository"
)

type AssetService interface {
	CreateAsset(ctx context.Context, userID string, req dto.CreateAssetRequest) (*dto.AssetResponse, error)
	GetAssets(ctx context.Context, userID string, typeFilter *string, isSharedFilter *bool) ([]dto.AssetResponse, error)
	GetAssetByID(ctx context.Context, assetID string, userID string) (*dto.AssetResponse, error)
	UpdateAsset(ctx context.Context, assetID string, userID string, req dto.UpdateAssetRequest) (*dto.AssetResponse, error)
	DeleteAsset(ctx context.Context, assetID string, userID string) error
	AddValuation(ctx context.Context, assetID string, userID string, req dto.CreateValuationRequest) (*dto.ValuationResponse, error)
	GetAssetSummary(ctx context.Context, userID string) (*dto.AssetSummaryResponse, error)
}

type assetService struct {
	assetRepo   repository.AssetRepository
	accountRepo repository.AccountRepository
}

func NewAssetService(assetRepo repository.AssetRepository, accountRepo repository.AccountRepository) AssetService {
	return &assetService{
		assetRepo:   assetRepo,
		accountRepo: accountRepo,
	}
}

func (s *assetService) CreateAsset(ctx context.Context, userID string, req dto.CreateAssetRequest) (*dto.AssetResponse, error) {
	currentVal := req.CurrentValue

	// 1. Linked account balance sync
	if req.LinkedAccountID != nil && *req.LinkedAccountID != "" {
		acc, err := s.accountRepo.GetByID(ctx, *req.LinkedAccountID)
		if err != nil {
			return nil, errors.New("linked account not found")
		}
		if acc.UserID != userID {
			return nil, errors.New("unauthorized account link")
		}
		// Sync current value with account balance
		currentVal = acc.Balance
	}

	newAsset := &model.Asset{
		UserID:          userID,
		Name:            req.Name,
		Type:            req.Type,
		CurrentValue:    currentVal,
		PurchaseValue:   req.PurchaseValue,
		PurchaseDate:    req.PurchaseDate,
		Currency:        req.Currency,
		LinkedAccountID: req.LinkedAccountID,
		IsShared:        req.IsShared,
		IsLiquid:        req.IsLiquid,
		Notes:           req.Notes,
		Metadata:        req.Metadata,
	}

	created, err := s.assetRepo.Create(ctx, newAsset)
	if err != nil {
		return nil, err
	}

	// Create initial valuation entry
	initialValuation := &model.AssetValuation{
		AssetID:       created.ID,
		Value:         created.CurrentValue,
		ValuationDate: time.Now(),
		Source:        "manual",
	}
	if req.LinkedAccountID != nil {
		initialValuation.Source = "sync"
		notes := "Initial balance sync from linked account"
		initialValuation.Notes = &notes
	}

	_, _ = s.assetRepo.CreateValuation(ctx, initialValuation)

	res := dto.ToAssetResponse(created, []model.AssetValuation{*initialValuation})
	return &res, nil
}

func (s *assetService) GetAssets(ctx context.Context, userID string, typeFilter *string, isSharedFilter *bool) ([]dto.AssetResponse, error) {
	list, err := s.assetRepo.GetAllByUser(ctx, userID, typeFilter, isSharedFilter)
	if err != nil {
		return nil, err
	}

	var resList []dto.AssetResponse
	for _, a := range list {
		// Sync with linked account balance if applicable
		if a.LinkedAccountID != nil {
			if acc, err := s.accountRepo.GetByID(ctx, *a.LinkedAccountID); err == nil {
				if acc.Balance != a.CurrentValue {
					a.CurrentValue = acc.Balance
					_ = s.assetRepo.Update(ctx, &a)
					// Create valuation log for sync update
					syncValuation := &model.AssetValuation{
						AssetID:       a.ID,
						Value:         acc.Balance,
						ValuationDate: time.Now(),
						Source:        "sync",
					}
					notes := "Auto balance sync from linked account"
					syncValuation.Notes = &notes
					_, _ = s.assetRepo.CreateValuation(ctx, syncValuation)
				}
			}
		}

		resList = append(resList, dto.ToAssetResponse(&a, nil))
	}

	return resList, nil
}

func (s *assetService) GetAssetByID(ctx context.Context, assetID string, userID string) (*dto.AssetResponse, error) {
	a, err := s.assetRepo.GetByID(ctx, assetID)
	if err != nil {
		return nil, err
	}

	if a.UserID != userID {
		return nil, errors.New("unauthorized asset access")
	}

	// Sync linked account balance if applicable
	if a.LinkedAccountID != nil {
		if acc, err := s.accountRepo.GetByID(ctx, *a.LinkedAccountID); err == nil {
			if acc.Balance != a.CurrentValue {
				a.CurrentValue = acc.Balance
				_ = s.assetRepo.Update(ctx, a)
				syncValuation := &model.AssetValuation{
					AssetID:       a.ID,
					Value:         acc.Balance,
					ValuationDate: time.Now(),
					Source:        "sync",
				}
				notes := "Auto balance sync from linked account"
				syncValuation.Notes = &notes
				_, _ = s.assetRepo.CreateValuation(ctx, syncValuation)
			}
		}
	}

	// Fetch valuations
	valuations, err := s.assetRepo.GetValuationsByAsset(ctx, assetID)
	if err != nil {
		valuations = []model.AssetValuation{}
	}

	res := dto.ToAssetResponse(a, valuations)
	return &res, nil
}

func (s *assetService) UpdateAsset(ctx context.Context, assetID string, userID string, req dto.UpdateAssetRequest) (*dto.AssetResponse, error) {
	a, err := s.assetRepo.GetByID(ctx, assetID)
	if err != nil {
		return nil, err
	}

	if a.UserID != userID {
		return nil, errors.New("unauthorized asset update")
	}

	oldValue := a.CurrentValue
	newValue := req.CurrentValue

	// If linked, keep value in sync with account balance (ignore manual changes)
	if a.LinkedAccountID != nil {
		if acc, err := s.accountRepo.GetByID(ctx, *a.LinkedAccountID); err == nil {
			newValue = acc.Balance
		}
	}

	a.Name = req.Name
	a.CurrentValue = newValue
	a.PurchaseValue = req.PurchaseValue
	a.PurchaseDate = req.PurchaseDate
	a.IsShared = req.IsShared
	a.IsLiquid = req.IsLiquid
	a.Notes = req.Notes
	if req.Currency != "" {
		a.Currency = req.Currency
	}
	a.Metadata = req.Metadata

	if err := s.assetRepo.Update(ctx, a); err != nil {
		return nil, err
	}

	// If current value changed, log new valuation
	if oldValue != newValue {
		val := &model.AssetValuation{
			AssetID:       a.ID,
			Value:         newValue,
			ValuationDate: time.Now(),
			Source:        "manual",
		}
		if a.LinkedAccountID != nil {
			val.Source = "sync"
			notes := "Auto balance sync on asset update"
			val.Notes = &notes
		}
		_, _ = s.assetRepo.CreateValuation(ctx, val)
	}

	// Fetch fresh valuations
	valuations, _ := s.assetRepo.GetValuationsByAsset(ctx, assetID)

	res := dto.ToAssetResponse(a, valuations)
	return &res, nil
}

func (s *assetService) DeleteAsset(ctx context.Context, assetID string, userID string) error {
	a, err := s.assetRepo.GetByID(ctx, assetID)
	if err != nil {
		return err
	}

	if a.UserID != userID {
		return errors.New("unauthorized asset deletion")
	}

	return s.assetRepo.SoftDelete(ctx, assetID)
}

func (s *assetService) AddValuation(ctx context.Context, assetID string, userID string, req dto.CreateValuationRequest) (*dto.ValuationResponse, error) {
	a, err := s.assetRepo.GetByID(ctx, assetID)
	if err != nil {
		return nil, err
	}

	if a.UserID != userID {
		return nil, errors.New("unauthorized valuation entry")
	}

	// If linked, valuation is locked to balance sync
	if a.LinkedAccountID != nil {
		return nil, errors.New("cannot manually update valuation of a linked bank account asset")
	}

	v := &model.AssetValuation{
		AssetID:       assetID,
		Value:         req.Value,
		ValuationDate: req.ValuationDate,
		Source:        req.Source,
		Notes:         req.Notes,
	}

	created, err := s.assetRepo.CreateValuation(ctx, v)
	if err != nil {
		return nil, err
	}

	// Update asset current_value
	a.CurrentValue = req.Value
	_ = s.assetRepo.Update(ctx, a)

	res := dto.ValuationResponse{
		ID:             created.ID,
		AssetID:        created.AssetID,
		Value:          created.Value,
		FormattedValue: dto.FormatRupiah(created.Value),
		ValuationDate:  created.ValuationDate,
		Source:         created.Source,
		Notes:          created.Notes,
		CreatedAt:      created.CreatedAt,
	}

	return &res, nil
}

func (s *assetService) GetAssetSummary(ctx context.Context, userID string) (*dto.AssetSummaryResponse, error) {
	// Sync linked account assets first to make sure summary is accurate
	assetsList, err := s.assetRepo.GetAllByUser(ctx, userID, nil, nil)
	if err == nil {
		for _, a := range assetsList {
			if a.LinkedAccountID != nil {
				if acc, err := s.accountRepo.GetByID(ctx, *a.LinkedAccountID); err == nil {
					if acc.Balance != a.CurrentValue {
						a.CurrentValue = acc.Balance
						_ = s.assetRepo.Update(ctx, &a)
						syncVal := &model.AssetValuation{
							AssetID:       a.ID,
							Value:         acc.Balance,
							ValuationDate: time.Now(),
							Source:        "sync",
						}
						notes := "Auto balance sync for summary calculation"
						syncVal.Notes = &notes
						_, _ = s.assetRepo.CreateValuation(ctx, syncVal)
					}
				}
			}
		}
	}

	summary, err := s.assetRepo.GetSummaryByUser(ctx, userID)
	if err != nil {
		return nil, err
	}

	res := dto.ToAssetSummaryResponse(summary)
	return &res, nil
}
