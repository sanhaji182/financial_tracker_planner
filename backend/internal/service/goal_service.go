package service

import (
	"context"
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/model"
)

type GoalService interface {
	CreateGoal(ctx context.Context, userID string, req *dto.CreateGoalRequest) (*dto.GoalResponse, error)
	GetGoalByID(ctx context.Context, userID string, id string) (*dto.GoalResponse, error)
	UpdateGoal(ctx context.Context, userID string, id string, req *dto.UpdateGoalRequest) error
	DeleteGoal(ctx context.Context, userID string, id string) error
	ListGoals(ctx context.Context, userID string) ([]dto.GoalResponse, error)
	ContributeToGoal(ctx context.Context, userID string, id string, req *dto.GoalContributionRequest) error
}

type goalService struct {
	dbPool *pgxpool.Pool
}

func NewGoalService(dbPool *pgxpool.Pool) GoalService {
	return &goalService{dbPool: dbPool}
}

func (s *goalService) resolveOwnerID(ctx context.Context, userID string) (string, error) {
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

func (s *goalService) checkWriteAccess(ctx context.Context, userID string) error {
	var role string
	err := s.dbPool.QueryRow(ctx, "SELECT role FROM users WHERE id = $1", userID).Scan(&role)
	if err != nil {
		return err
	}
	if role == "spouse_viewer" {
		return errors.New("unauthorized: spouse has read-only access to goals")
	}
	return nil
}

func (s *goalService) CreateGoal(ctx context.Context, userID string, req *dto.CreateGoalRequest) (*dto.GoalResponse, error) {
	if err := s.checkWriteAccess(ctx, userID); err != nil {
		return nil, err
	}

	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	var targetDate *time.Time
	if req.TargetDate != "" {
		t, err := time.Parse("2006-01-02", req.TargetDate)
		if err != nil {
			return nil, fmt.Errorf("invalid target_date format: %w", err)
		}
		targetDate = &t
	}

	var linkedAccountID *string
	if req.LinkedAccountID != "" {
		// verify account
		var exists bool
		err = s.dbPool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM accounts WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL)", req.LinkedAccountID, ownerID).Scan(&exists)
		if err != nil || !exists {
			return nil, errors.New("linked_account_id not found or unauthorized")
		}
		linkedAccountID = &req.LinkedAccountID
	}

	var linkedDebtID *string
	if req.LinkedDebtID != "" {
		// verify debt
		var exists bool
		err = s.dbPool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM debts WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL)", req.LinkedDebtID, ownerID).Scan(&exists)
		if err != nil || !exists {
			return nil, errors.New("linked_debt_id not found or unauthorized")
		}
		linkedDebtID = &req.LinkedDebtID
	}

	var g model.Goal
	g.UserID = ownerID
	g.Name = req.Name
	g.Type = req.Type
	g.TargetAmount = req.TargetAmount
	g.CurrentAmount = req.CurrentAmount
	g.TargetDate = targetDate
	g.LinkedAccountID = linkedAccountID
	g.LinkedDebtID = linkedDebtID
	if req.Icon != "" {
		g.Icon = &req.Icon
	}
	if req.Color != "" {
		g.Color = &req.Color
	}
	g.Status = "active"
	if req.Notes != "" {
		g.Notes = &req.Notes
	}

	err = s.dbPool.QueryRow(ctx, `
		INSERT INTO goals (user_id, name, type, target_amount, current_amount, target_date, linked_account_id, linked_debt_id, icon, color, status, notes)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
		RETURNING id, created_at
	`, g.UserID, g.Name, g.Type, g.TargetAmount, g.CurrentAmount, g.TargetDate, g.LinkedAccountID, g.LinkedDebtID, g.Icon, g.Color, g.Status, g.Notes).Scan(&g.ID, &g.CreatedAt)

	if err != nil {
		return nil, fmt.Errorf("failed to create goal: %w", err)
	}

	// Trigger Audit trail log
	_, _ = s.dbPool.Exec(ctx, `
		INSERT INTO audit_logs (user_id, entity_type, entity_id, action, new_value)
		VALUES ($1, 'goal', $2::uuid, 'create', $3)
	`, ownerID, g.ID, req)

	return s.GetGoalByID(ctx, userID, g.ID)
}

func (s *goalService) GetGoalByID(ctx context.Context, userID string, id string) (*dto.GoalResponse, error) {
	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	var g model.Goal
	err = s.dbPool.QueryRow(ctx, `
		SELECT id, user_id, name, type, target_amount, current_amount, target_date, linked_account_id, linked_debt_id, icon, color, status, notes, created_at
		FROM goals WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
	`, id, ownerID).Scan(
		&g.ID, &g.UserID, &g.Name, &g.Type, &g.TargetAmount, &g.CurrentAmount, &g.TargetDate, &g.LinkedAccountID, &g.LinkedDebtID, &g.Icon, &g.Color, &g.Status, &g.Notes, &g.CreatedAt,
	)

	if err != nil {
		return nil, err
	}

	// Fetch dynamic calculated current_amount
	var currentAmt float64 = g.CurrentAmount

	if g.Type == "emergency_fund" {
		_ = s.dbPool.QueryRow(ctx, `
			SELECT COALESCE(SUM(balance), 0)
			FROM accounts
			WHERE user_id = $1 AND is_emergency_fund = true AND is_active = true AND deleted_at IS NULL
		`, ownerID).Scan(&currentAmt)
	} else if g.Type == "debt_payoff" && g.LinkedDebtID != nil {
		var originalAmt, outstandingAmt float64
		err := s.dbPool.QueryRow(ctx, `
			SELECT original_amount, outstanding_balance
			FROM debts
			WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
		`, *g.LinkedDebtID, ownerID).Scan(&originalAmt, &outstandingAmt)
		if err == nil {
			paid := originalAmt - outstandingAmt
			if paid > 0 {
				currentAmt = paid
			} else {
				currentAmt = 0
			}
		}
	} else {
		// normal goal: sum stored initial current_amount + any transaction contributions
		var contribSum float64
		_ = s.dbPool.QueryRow(ctx, `
			SELECT COALESCE(SUM(amount), 0)
			FROM transactions
			WHERE user_id = $1 AND goal_id = $2 AND deleted_at IS NULL
		`, ownerID, g.ID).Scan(&contribSum)
		currentAmt = g.CurrentAmount + contribSum
	}

	// Fetch account name
	var linkedAccName *string
	if g.LinkedAccountID != nil {
		var name string
		err := s.dbPool.QueryRow(ctx, "SELECT name FROM accounts WHERE id = $1", *g.LinkedAccountID).Scan(&name)
		if err == nil {
			linkedAccName = &name
		}
	}

	// Fetch debt name
	var linkedDebtName *string
	if g.LinkedDebtID != nil {
		var name string
		err := s.dbPool.QueryRow(ctx, "SELECT name FROM debts WHERE id = $1", *g.LinkedDebtID).Scan(&name)
		if err == nil {
			linkedDebtName = &name
		}
	}

	// Fetch contribution history
	contribHistory := []dto.GoalContributionItem{}
	rows, err := s.dbPool.Query(ctx, `
		SELECT t.id, t.amount, t.date, COALESCE(t.description, ''), a.name, COALESCE(t.notes, '')
		FROM transactions t
		LEFT JOIN accounts a ON t.account_id = a.id
		WHERE t.user_id = $1 AND t.goal_id = $2 AND t.deleted_at IS NULL
		ORDER BY t.date DESC
	`, ownerID, g.ID)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var item dto.GoalContributionItem
			var dateVal time.Time
			err := rows.Scan(&item.ID, &item.Amount, &dateVal, &item.Description, &item.SourceAccountName, &item.Notes)
			if err == nil {
				item.Date = dateVal.Format("2006-01-02")
				contribHistory = append(contribHistory, item)
			}
		}
	}

	// Calculate trends and completion projection
	var totalContributed float64 = 0
	for _, c := range contribHistory {
		totalContributed += c.Amount
	}

	monthsElapsed := time.Since(g.CreatedAt).Hours() / 24 / 30
	if monthsElapsed < 1.0 {
		monthsElapsed = 1.0
	}
	avgMonthly := totalContributed / monthsElapsed

	progress := (currentAmt / g.TargetAmount) * 100
	if progress > 100 {
		progress = 100
	}
	if progress < 0 {
		progress = 0
	}

	var projectedCompletion *string
	remaining := g.TargetAmount - currentAmt
	if remaining <= 0 {
		if g.TargetDate != nil {
			ds := g.TargetDate.Format("2006-01-02")
			projectedCompletion = &ds
		}
	} else if avgMonthly > 0 {
		monthsToComplete := remaining / avgMonthly
		if !math.IsNaN(monthsToComplete) && !math.IsInf(monthsToComplete, 0) {
			projDate := time.Now().AddDate(0, int(math.Ceil(monthsToComplete)), 0)
			ds := projDate.Format("2006-01-02")
			projectedCompletion = &ds
		}
	}

	var targetDateStr *string
	if g.TargetDate != nil {
		ds := g.TargetDate.Format("2006-01-02")
		targetDateStr = &ds
	}

	iconVal := ""
	if g.Icon != nil {
		iconVal = *g.Icon
	}
	colorVal := ""
	if g.Color != nil {
		colorVal = *g.Color
	}
	notesVal := ""
	if g.Notes != nil {
		notesVal = *g.Notes
	}

	return &dto.GoalResponse{
		ID:                         g.ID,
		UserID:                     g.UserID,
		Name:                       g.Name,
		Type:                       g.Type,
		TargetAmount:               g.TargetAmount,
		CurrentAmount:              currentAmt,
		TargetDate:                 targetDateStr,
		LinkedAccountID:            g.LinkedAccountID,
		LinkedAccountName:          linkedAccName,
		LinkedDebtID:               g.LinkedDebtID,
		LinkedDebtName:             linkedDebtName,
		Icon:                       iconVal,
		Color:                      colorVal,
		Status:                     g.Status,
		Notes:                      notesVal,
		Progress:                   progress,
		ProjectedCompletionDate:    projectedCompletion,
		AverageMonthlyContribution: avgMonthly,
		CreatedAt:                  g.CreatedAt,
		ContributionHistory:        contribHistory,
	}, nil
}

func (s *goalService) ListGoals(ctx context.Context, userID string) ([]dto.GoalResponse, error) {
	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	rows, err := s.dbPool.Query(ctx, `
		SELECT id FROM goals WHERE user_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC
	`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var res []dto.GoalResponse
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err == nil {
			gRes, err := s.GetGoalByID(ctx, userID, id)
			if err == nil {
				res = append(res, *gRes)
			}
		}
	}

	return res, nil
}

func (s *goalService) UpdateGoal(ctx context.Context, userID string, id string, req *dto.UpdateGoalRequest) error {
	if err := s.checkWriteAccess(ctx, userID); err != nil {
		return err
	}

	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	// Fetch old
	var g model.Goal
	err = s.dbPool.QueryRow(ctx, `
		SELECT name, type, target_amount, current_amount, target_date, linked_account_id, linked_debt_id, icon, color, status, notes
		FROM goals WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
	`, id, ownerID).Scan(
		&g.Name, &g.Type, &g.TargetAmount, &g.CurrentAmount, &g.TargetDate, &g.LinkedAccountID, &g.LinkedDebtID, &g.Icon, &g.Color, &g.Status, &g.Notes,
	)
	if err != nil {
		return err
	}

	if req.Name != nil {
		g.Name = *req.Name
	}
	if req.Type != nil {
		g.Type = *req.Type
	}
	if req.TargetAmount != nil {
		g.TargetAmount = *req.TargetAmount
	}
	if req.CurrentAmount != nil {
		g.CurrentAmount = *req.CurrentAmount
	}
	if req.TargetDate != nil {
		if *req.TargetDate == "" {
			g.TargetDate = nil
		} else {
			t, err := time.Parse("2006-01-02", *req.TargetDate)
			if err != nil {
				return fmt.Errorf("invalid target_date format: %w", err)
			}
			g.TargetDate = &t
		}
	}
	if req.LinkedAccountID != nil {
		if *req.LinkedAccountID == "" {
			g.LinkedAccountID = nil
		} else {
			// verify account
			var exists bool
			err = s.dbPool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM accounts WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL)", *req.LinkedAccountID, ownerID).Scan(&exists)
			if err != nil || !exists {
				return errors.New("linked_account_id not found or unauthorized")
			}
			g.LinkedAccountID = req.LinkedAccountID
		}
	}
	if req.LinkedDebtID != nil {
		if *req.LinkedDebtID == "" {
			g.LinkedDebtID = nil
		} else {
			// verify debt
			var exists bool
			err = s.dbPool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM debts WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL)", *req.LinkedDebtID, ownerID).Scan(&exists)
			if err != nil || !exists {
				return errors.New("linked_debt_id not found or unauthorized")
			}
			g.LinkedDebtID = req.LinkedDebtID
		}
	}
	if req.Icon != nil {
		g.Icon = req.Icon
	}
	if req.Color != nil {
		g.Color = req.Color
	}
	if req.Status != nil {
		g.Status = *req.Status
	}
	if req.Notes != nil {
		g.Notes = req.Notes
	}

	_, err = s.dbPool.Exec(ctx, `
		UPDATE goals
		SET name = $1, type = $2, target_amount = $3, current_amount = $4, target_date = $5, linked_account_id = $6, linked_debt_id = $7, icon = $8, color = $9, status = $10, notes = $11, updated_at = NOW()
		WHERE id = $12 AND user_id = $13 AND deleted_at IS NULL
	`, g.Name, g.Type, g.TargetAmount, g.CurrentAmount, g.TargetDate, g.LinkedAccountID, g.LinkedDebtID, g.Icon, g.Color, g.Status, g.Notes, id, ownerID)

	if err != nil {
		return fmt.Errorf("failed to update goal: %w", err)
	}

	// Trigger Audit trail log
	_, _ = s.dbPool.Exec(ctx, `
		INSERT INTO audit_logs (user_id, entity_type, entity_id, action, new_value)
		VALUES ($1, 'goal', $2::uuid, 'update', $3)
	`, ownerID, id, req)

	return nil
}

func (s *goalService) DeleteGoal(ctx context.Context, userID string, id string) error {
	if err := s.checkWriteAccess(ctx, userID); err != nil {
		return err
	}

	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	_, err = s.dbPool.Exec(ctx, `
		UPDATE goals SET deleted_at = NOW() WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
	`, id, ownerID)

	if err != nil {
		return err
	}

	// Trigger Audit trail log
	_, _ = s.dbPool.Exec(ctx, `
		INSERT INTO audit_logs (user_id, entity_type, entity_id, action, new_value)
		VALUES ($1, 'goal', $2::uuid, 'delete', NULL)
	`, ownerID, id)

	return nil
}

func (s *goalService) ContributeToGoal(ctx context.Context, userID string, id string, req *dto.GoalContributionRequest) error {
	if err := s.checkWriteAccess(ctx, userID); err != nil {
		return err
	}

	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		ownerID = userID
	}

	// Retrieve goal
	var goalName string
	var linkedAccID *string
	err = s.dbPool.QueryRow(ctx, `
		SELECT name, linked_account_id FROM goals WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
	`, id, ownerID).Scan(&goalName, &linkedAccID)
	if err != nil {
		return fmt.Errorf("goal not found: %w", err)
	}

	if linkedAccID == nil || *linkedAccID == "" {
		return errors.New("kontribusi tidak dapat diproses: target belum menautkan rekening penampung (linked account)")
	}

	targetAccID := *linkedAccID

	if req.SourceAccountID == targetAccID {
		return errors.New("rekening sumber dan rekening target goal tidak boleh sama")
	}

	// Begin DB transaction for money transfer
	tx, err := s.dbPool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// Verify and deduct source account balance
	var sourceBalance float64
	err = tx.QueryRow(ctx, `
		SELECT balance FROM accounts WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
	`, req.SourceAccountID, ownerID).Scan(&sourceBalance)
	if err != nil {
		return errors.New("rekening sumber tidak ditemukan")
	}

	if sourceBalance < req.Amount {
		return errors.New("saldo rekening sumber tidak mencukupi")
	}

	// Verify target account exists
	var targetExists bool
	err = tx.QueryRow(ctx, `
		SELECT EXISTS(SELECT 1 FROM accounts WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL)
	`, targetAccID, ownerID).Scan(&targetExists)
	if err != nil || !targetExists {
		return errors.New("rekening target goal tidak ditemukan")
	}

	// Perform balances updates
	_, err = tx.Exec(ctx, "UPDATE accounts SET balance = balance - $1 WHERE id = $2", req.Amount, req.SourceAccountID)
	if err != nil {
		return err
	}

	_, err = tx.Exec(ctx, "UPDATE accounts SET balance = balance + $1 WHERE id = $2", req.Amount, targetAccID)
	if err != nil {
		return err
	}

	parsedDate, err := time.Parse("2006-01-02", req.Date)
	if err != nil {
		parsedDate = time.Now()
	}

	// Insert transfer ledger transaction
	txDesc := "Kontribusi Goal: " + goalName
	var txID string
	err = tx.QueryRow(ctx, `
		INSERT INTO transactions (user_id, account_id, target_account_id, type, amount, date, description, notes, status, goal_id)
		VALUES ($1, $2, $3, 'transfer', $4, $5, $6, $7, 'confirmed', $8)
		RETURNING id
	`, ownerID, req.SourceAccountID, targetAccID, req.Amount, parsedDate, txDesc, req.Notes, id).Scan(&txID)
	if err != nil {
		return fmt.Errorf("failed to record contribution transaction: %w", err)
	}

	// Commit Transaction
	err = tx.Commit(ctx)
	if err != nil {
		return err
	}

	// Trigger Audit trail log
	_, _ = s.dbPool.Exec(ctx, `
		INSERT INTO audit_logs (user_id, entity_type, entity_id, action, new_value)
		VALUES ($1, 'goal_contribution', $2::uuid, 'create', $3)
	`, ownerID, id, req)

	return nil
}
