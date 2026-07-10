package service

import (
	"context"
	"errors"

	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/model"
	"github.com/user/financial-os/internal/repository"
)

type CategoryService interface {
	CreateCategory(ctx context.Context, userID string, req dto.CreateCategoryRequest) (*dto.CategoryResponse, error)
	GetCategories(ctx context.Context, userID string) ([]dto.CategoryResponse, error)
	GetCategoryByID(ctx context.Context, categoryID string, userID string) (*dto.CategoryResponse, error)
	UpdateCategory(ctx context.Context, categoryID string, userID string, req dto.UpdateCategoryRequest) (*dto.CategoryResponse, error)
	DeleteCategory(ctx context.Context, categoryID string, userID string) error
}

type categoryService struct {
	categoryRepo repository.CategoryRepository
}

func NewCategoryService(categoryRepo repository.CategoryRepository) CategoryService {
	return &categoryService{categoryRepo: categoryRepo}
}

func (s *categoryService) CreateCategory(ctx context.Context, userID string, req dto.CreateCategoryRequest) (*dto.CategoryResponse, error) {
	if req.Type != "income" && req.Type != "expense" {
		return nil, errors.New("invalid category type, must be income or expense")
	}

	newCat := &model.Category{
		UserID:    &userID,
		ParentID:  req.ParentID,
		Name:      req.Name,
		Type:      req.Type,
		Icon:      req.Icon,
		Color:     req.Color,
		IsSystem:  false,
		SortOrder: 0,
	}

	created, err := s.categoryRepo.Create(ctx, newCat)
	if err != nil {
		return nil, err
	}

	res := dto.ToCategoryResponse(created)
	return &res, nil
}

func (s *categoryService) GetCategories(ctx context.Context, userID string) ([]dto.CategoryResponse, error) {
	list, err := s.categoryRepo.GetAll(ctx, userID)
	if err != nil {
		return nil, err
	}

	resList := make([]dto.CategoryResponse, len(list))
	for i, c := range list {
		resList[i] = dto.ToCategoryResponse(&c)
	}
	return resList, nil
}

func (s *categoryService) GetCategoryByID(ctx context.Context, categoryID string, userID string) (*dto.CategoryResponse, error) {
	c, err := s.categoryRepo.GetByID(ctx, categoryID)
	if err != nil {
		return nil, err
	}

	// Verify owner/access permissions (userID can read system categories where UserID is nil)
	if c.UserID != nil && *c.UserID != userID {
		return nil, errors.New("unauthorized access to category")
	}

	res := dto.ToCategoryResponse(c)
	return &res, nil
}

func (s *categoryService) UpdateCategory(ctx context.Context, categoryID string, userID string, req dto.UpdateCategoryRequest) (*dto.CategoryResponse, error) {
	c, err := s.categoryRepo.GetByID(ctx, categoryID)
	if err != nil {
		return nil, err
	}

	if c.IsSystem {
		return nil, errors.New("system default categories cannot be modified")
	}

	if c.UserID == nil || *c.UserID != userID {
		return nil, errors.New("unauthorized to update this category")
	}

	c.Name = req.Name
	c.Icon = req.Icon
	c.Color = req.Color

	if err := s.categoryRepo.Update(ctx, c); err != nil {
		return nil, err
	}

	res := dto.ToCategoryResponse(c)
	return &res, nil
}

func (s *categoryService) DeleteCategory(ctx context.Context, categoryID string, userID string) error {
	c, err := s.categoryRepo.GetByID(ctx, categoryID)
	if err != nil {
		return err
	}

	if c.IsSystem {
		return errors.New("system default categories cannot be deleted")
	}

	if c.UserID == nil || *c.UserID != userID {
		return errors.New("unauthorized to delete this category")
	}

	return s.categoryRepo.SoftDelete(ctx, categoryID)
}
