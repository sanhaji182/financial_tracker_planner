package service

import (
	"context"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/user/financial-os/internal/dto"
)

type BudgetService interface {
	SetBudget(ctx context.Context, userID string, req *dto.BudgetRequest) (*dto.BudgetDto, error)
	UpdateBudget(ctx context.Context, userID string, id string, req *dto.UpdateBudgetRequest) (*dto.BudgetDto, error)
	DeleteBudget(ctx context.Context, userID string, id string) error
	GetBudgets(ctx context.Context, userID string, month string) ([]dto.BudgetDto, error)
	GetBudgetSummary(ctx context.Context, userID string, month string) (*dto.BudgetSummaryResponse, error)
	CopyFromPreviousMonth(ctx context.Context, userID string, fromMonth string, toMonth string) error
}

type budgetService struct {
	dbPool *pgxpool.Pool
}

func NewBudgetService(dbPool *pgxpool.Pool) BudgetService {
	return &budgetService{dbPool: dbPool}
}

func (s *budgetService) resolveOwnerID(ctx context.Context, userID string) (string, error) {
	var role string
	var invitedBy *string
	err := s.dbPool.QueryRow(ctx, `
		SELECT role, invited_by FROM users WHERE id = $1 AND is_active = true
	`, userID).Scan(&role, &invitedBy)
	if err != nil {
		return "", err
	}
	if role == "spouse_viewer" && invitedBy != nil && *invitedBy != "" {
		return *invitedBy, nil
	}
	return userID, nil
}

func (s *budgetService) checkWriteAccess(ctx context.Context, userID string) error {
	var role string
	err := s.dbPool.QueryRow(ctx, "SELECT role FROM users WHERE id = $1", userID).Scan(&role)
	if err != nil {
		return err
	}
	if role == "spouse_viewer" {
		return errors.New("unauthorized: spouse cannot modify budgets")
	}
	return nil
}

func (s *budgetService) SetBudget(ctx context.Context, userID string, req *dto.BudgetRequest) (*dto.BudgetDto, error) {
	if err := s.checkWriteAccess(ctx, userID); err != nil {
		return nil, err
	}

	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	var budgetID string
	err = s.dbPool.QueryRow(ctx, `
		INSERT INTO budgets (user_id, category_id, month, amount, updated_at)
		VALUES ($1, $2, $3, $4, NOW())
		ON CONFLICT (user_id, category_id, month) 
		DO UPDATE SET amount = EXCLUDED.amount, updated_at = NOW()
		RETURNING id
	`, ownerID, req.CategoryID, req.Month, req.Amount).Scan(&budgetID)
	if err != nil {
		return nil, fmt.Errorf("failed to upsert budget: %w", err)
	}

	return s.getBudgetByID(ctx, ownerID, budgetID)
}

func (s *budgetService) UpdateBudget(ctx context.Context, userID string, id string, req *dto.UpdateBudgetRequest) (*dto.BudgetDto, error) {
	if err := s.checkWriteAccess(ctx, userID); err != nil {
		return nil, err
	}

	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	var exists bool
	err = s.dbPool.QueryRow(ctx, `
		SELECT EXISTS(SELECT 1 FROM budgets WHERE id = $1 AND user_id = $2)
	`, id, ownerID).Scan(&exists)
	if err != nil || !exists {
		return nil, errors.New("budget not found or access denied")
	}

	_, err = s.dbPool.Exec(ctx, `
		UPDATE budgets
		SET amount = $1, updated_at = NOW()
		WHERE id = $2 AND user_id = $3
	`, req.Amount, id, ownerID)
	if err != nil {
		return nil, fmt.Errorf("failed to update budget: %w", err)
	}

	return s.getBudgetByID(ctx, ownerID, id)
}

func (s *budgetService) DeleteBudget(ctx context.Context, userID string, id string) error {
	if err := s.checkWriteAccess(ctx, userID); err != nil {
		return err
	}

	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	_, err = s.dbPool.Exec(ctx, `
		DELETE FROM budgets WHERE id = $1 AND user_id = $2
	`, id, ownerID)
	return err
}

func (s *budgetService) GetBudgets(ctx context.Context, userID string, month string) ([]dto.BudgetDto, error) {
	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	rows, err := s.dbPool.Query(ctx, `
		SELECT b.id, b.category_id, c.name, COALESCE(c.icon, ''), COALESCE(c.color, ''), b.month, b.amount
		FROM budgets b
		JOIN categories c ON b.category_id = c.id
		WHERE b.user_id = $1 AND b.month = $2
	`, ownerID, month)
	if err != nil {
		return nil, fmt.Errorf("failed to list budgets: %w", err)
	}
	defer rows.Close()

	var budgets []dto.BudgetDto
	for rows.Next() {
		var b dto.BudgetDto
		err = rows.Scan(&b.ID, &b.CategoryID, &b.CategoryName, &b.CategoryIcon, &b.CategoryColor, &b.Month, &b.Amount)
		if err == nil {
			budgets = append(budgets, b)
		}
	}

	// Calculate realisations
	for i := range budgets {
		var spent float64
		_ = s.dbPool.QueryRow(ctx, `
			SELECT COALESCE((
				SELECT SUM(amount) FROM transactions
				WHERE user_id = $1 AND category_id = $2 AND type = 'expense' AND status = 'confirmed'
				  AND TO_CHAR(date, 'YYYY-MM') = $3 AND deleted_at IS NULL AND is_split = false
			), 0) + COALESCE((
				SELECT SUM(s.amount) FROM transaction_splits s
				JOIN transactions t ON s.transaction_id = t.id
				WHERE t.user_id = $1 AND s.category_id = $2 AND t.type = 'expense' AND t.status = 'confirmed'
				  AND TO_CHAR(t.date, 'YYYY-MM') = $3 AND t.deleted_at IS NULL
			), 0)
		`, ownerID, budgets[i].CategoryID, month).Scan(&spent)

		budgets[i].Spent = spent
		budgets[i].FormattedSpent = formatRupiah(spent)
		budgets[i].Remaining = budgets[i].Amount - spent
		budgets[i].FormattedRemaining = formatRupiah(budgets[i].Remaining)
		
		var pct float64
		if budgets[i].Amount > 0 {
			pct = (spent / budgets[i].Amount) * 100.0
		}
		budgets[i].UsedPercentage = pct

		// Status threshold
		if pct < 60.0 {
			budgets[i].Status = "on_track"
		} else if pct >= 60.0 && pct < 80.0 {
			budgets[i].Status = "attention"
		} else if pct >= 80.0 && pct <= 100.0 {
			budgets[i].Status = "almost"
		} else {
			budgets[i].Status = "over"
		}
		budgets[i].FormattedAmount = formatRupiah(budgets[i].Amount)
	}

	return budgets, nil
}

func (s *budgetService) GetBudgetSummary(ctx context.Context, userID string, month string) (*dto.BudgetSummaryResponse, error) {
	budgets, err := s.GetBudgets(ctx, userID, month)
	if err != nil {
		return nil, err
	}

	var totalBudget, totalSpent, remaining float64
	var overCount int

	for _, b := range budgets {
		totalBudget += b.Amount
		totalSpent += b.Spent
		if b.Spent > b.Amount {
			overCount++
		}
	}
	remaining = totalBudget - totalSpent

	return &dto.BudgetSummaryResponse{
		TotalBudget: dto.MoneyValue{
			Value:          totalBudget,
			FormattedValue: formatRupiah(totalBudget),
		},
		TotalSpent: dto.MoneyValue{
			Value:          totalSpent,
			FormattedValue: formatRupiah(totalSpent),
		},
		Remaining: dto.MoneyValue{
			Value:          remaining,
			FormattedValue: formatRupiah(remaining),
		},
		CategoriesOver: overCount,
		Month:          month,
	}, nil
}

func (s *budgetService) CopyFromPreviousMonth(ctx context.Context, userID string, fromMonth string, toMonth string) error {
	if err := s.checkWriteAccess(ctx, userID); err != nil {
		return err
	}

	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	_, err = s.dbPool.Exec(ctx, `
		INSERT INTO budgets (user_id, category_id, month, amount)
		SELECT user_id, category_id, $1, amount
		FROM budgets
		WHERE user_id = $2 AND month = $3
		ON CONFLICT (user_id, category_id, month) 
		DO UPDATE SET amount = EXCLUDED.amount, updated_at = NOW()
	`, toMonth, ownerID, fromMonth)
	return err
}

func (s *budgetService) getBudgetByID(ctx context.Context, ownerID string, budgetID string) (*dto.BudgetDto, error) {
	var b dto.BudgetDto
	err := s.dbPool.QueryRow(ctx, `
		SELECT b.id, b.category_id, c.name, COALESCE(c.icon, ''), COALESCE(c.color, ''), b.month, b.amount
		FROM budgets b
		JOIN categories c ON b.category_id = c.id
		WHERE b.user_id = $1 AND b.id = $2
	`, ownerID, budgetID).Scan(&b.ID, &b.CategoryID, &b.CategoryName, &b.CategoryIcon, &b.CategoryColor, &b.Month, &b.Amount)
	if err != nil {
		return nil, err
	}

	var spent float64
	_ = s.dbPool.QueryRow(ctx, `
		SELECT COALESCE((
			SELECT SUM(amount) FROM transactions
			WHERE user_id = $1 AND category_id = $2 AND type = 'expense' AND status = 'confirmed'
			  AND TO_CHAR(date, 'YYYY-MM') = $3 AND deleted_at IS NULL AND is_split = false
		), 0) + COALESCE((
			SELECT SUM(s.amount) FROM transaction_splits s
			JOIN transactions t ON s.transaction_id = t.id
			WHERE t.user_id = $1 AND s.category_id = $2 AND t.type = 'expense' AND t.status = 'confirmed'
			  AND TO_CHAR(t.date, 'YYYY-MM') = $3 AND t.deleted_at IS NULL
		), 0)
	`, ownerID, b.CategoryID, b.Month).Scan(&spent)

	b.Spent = spent
	b.FormattedSpent = formatRupiah(spent)
	b.Remaining = b.Amount - spent
	b.FormattedRemaining = formatRupiah(b.Remaining)

	var pct float64
	if b.Amount > 0 {
		pct = (spent / b.Amount) * 100.0
	}
	b.UsedPercentage = pct

	if pct < 60.0 {
		b.Status = "on_track"
	} else if pct >= 60.0 && pct < 80.0 {
		b.Status = "attention"
	} else if pct >= 80.0 && pct <= 100.0 {
		b.Status = "almost"
	} else {
		b.Status = "over"
	}
	b.FormattedAmount = formatRupiah(b.Amount)

	return &b, nil
}
