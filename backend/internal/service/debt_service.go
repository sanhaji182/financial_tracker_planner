package service

import (
	"context"
	"errors"
	"time"

	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/kernel"
	"github.com/user/financial-os/internal/model"
	"github.com/user/financial-os/internal/repository"
)

type DebtService interface {
	CreateDebt(ctx context.Context, userID string, req dto.CreateDebtRequest) (*dto.DebtResponse, error)
	GetDebts(ctx context.Context, userID string) ([]dto.DebtResponse, error)
	GetDebtByID(ctx context.Context, debtID string, userID string) (*dto.DebtResponse, error)
	UpdateDebt(ctx context.Context, debtID string, userID string, req dto.UpdateDebtRequest) (*dto.DebtResponse, error)
	DeleteDebt(ctx context.Context, debtID string, userID string) error
	RecordPayment(ctx context.Context, debtID string, userID string, req dto.RecordDebtPaymentRequest) (*dto.DebtPaymentResponse, error)
	GetDebtSummary(ctx context.Context, userID string) (*dto.DebtSummaryResponse, error)
	SimulateAvalanche(ctx context.Context, userID string, extraMonthly float64) (*dto.AvalancheSimulationResponse, error)
}

type debtService struct {
	debtRepo     repository.DebtRepository
	accountRepo  repository.AccountRepository
	categoryRepo repository.CategoryRepository
}

func NewDebtService(debtRepo repository.DebtRepository, accountRepo repository.AccountRepository, categoryRepo repository.CategoryRepository) DebtService {
	return &debtService{
		debtRepo:     debtRepo,
		accountRepo:  accountRepo,
		categoryRepo: categoryRepo,
	}
}

func (s *debtService) CreateDebt(ctx context.Context, userID string, req dto.CreateDebtRequest) (*dto.DebtResponse, error) {
	// If linked account exists, verify it
	if req.AccountID != nil && *req.AccountID != "" {
		acc, err := s.accountRepo.GetByID(ctx, *req.AccountID)
		if err != nil {
			return nil, errors.New("default payment account not found")
		}
		if acc.UserID != userID {
			return nil, errors.New("unauthorized account link")
		}
	}

	d := &model.Debt{
		UserID:             userID,
		Name:               req.Name,
		Type:               req.Type,
		Creditor:           req.Creditor,
		OriginalAmount:     req.OriginalAmount,
		OutstandingBalance: req.Outstanding,
		InterestRate:       req.InterestRate,
		MinimumPayment:     req.MinimumPayment,
		DueDay:             req.DueDay,
		StartDate:          req.StartDate,
		EndDate:            req.EndDate,
		TenorMonths:        req.TenorMonths,
		AccountID:          req.AccountID,
		Currency: func() string {
			if req.Currency != "" {
				return req.Currency
			}
			return "IDR"
		}(),
		Status:   "active",
		Notes:    req.Notes,
		IsShared: req.IsShared,
	}

	created, err := s.debtRepo.Create(ctx, d)
	if err != nil {
		return nil, err
	}

	res := dto.ToDebtResponse(created, nil)
	return &res, nil
}

func (s *debtService) GetDebts(ctx context.Context, userID string) ([]dto.DebtResponse, error) {
	list, err := s.debtRepo.GetAllByUser(ctx, userID)
	if err != nil {
		return nil, err
	}

	var res []dto.DebtResponse
	for _, d := range list {
		res = append(res, dto.ToDebtResponse(&d, nil))
	}
	return res, nil
}

func (s *debtService) GetDebtByID(ctx context.Context, debtID string, userID string) (*dto.DebtResponse, error) {
	d, err := s.debtRepo.GetByID(ctx, debtID)
	if err != nil {
		return nil, err
	}

	if d.UserID != userID {
		return nil, errors.New("unauthorized debt access")
	}

	payments, err := s.debtRepo.GetPaymentsByDebt(ctx, debtID)
	if err != nil {
		payments = []model.DebtPayment{}
	}

	res := dto.ToDebtResponse(d, payments)
	return &res, nil
}

func (s *debtService) UpdateDebt(ctx context.Context, debtID string, userID string, req dto.UpdateDebtRequest) (*dto.DebtResponse, error) {
	d, err := s.debtRepo.GetByID(ctx, debtID)
	if err != nil {
		return nil, err
	}

	if d.UserID != userID {
		return nil, errors.New("unauthorized debt update")
	}

	d.Name = req.Name
	d.Creditor = req.Creditor
	d.OutstandingBalance = req.Outstanding
	d.InterestRate = req.InterestRate
	d.MinimumPayment = req.MinimumPayment
	d.DueDay = req.DueDay
	d.StartDate = req.StartDate
	d.EndDate = req.EndDate
	d.TenorMonths = req.TenorMonths
	d.AccountID = req.AccountID
	d.Notes = req.Notes
	if req.Currency != "" {
		d.Currency = req.Currency
	}
	d.IsShared = req.IsShared
	d.Status = req.Status

	if err := s.debtRepo.Update(ctx, d); err != nil {
		return nil, err
	}

	payments, _ := s.debtRepo.GetPaymentsByDebt(ctx, debtID)
	res := dto.ToDebtResponse(d, payments)
	return &res, nil
}

func (s *debtService) DeleteDebt(ctx context.Context, debtID string, userID string) error {
	d, err := s.debtRepo.GetByID(ctx, debtID)
	if err != nil {
		return err
	}

	if d.UserID != userID {
		return errors.New("unauthorized debt deletion")
	}

	return s.debtRepo.SoftDelete(ctx, debtID)
}

func (s *debtService) RecordPayment(ctx context.Context, debtID string, userID string, req dto.RecordDebtPaymentRequest) (*dto.DebtPaymentResponse, error) {
	d, err := s.debtRepo.GetByID(ctx, debtID)
	if err != nil {
		return nil, err
	}

	if d.UserID != userID {
		return nil, errors.New("unauthorized debt payment logging")
	}

	// Verify payment account
	acc, err := s.accountRepo.GetByID(ctx, req.AccountID)
	if err != nil {
		return nil, errors.New("payment account not found")
	}
	if acc.UserID != userID {
		return nil, errors.New("unauthorized account payment source")
	}

	// Find category for expense transaction (fallback to "Lain-lain" or type: expense)
	categories, err := s.categoryRepo.GetAll(ctx, userID)
	var categoryID string
	if err == nil {
		// Prefer categories with "Cicilan", "Utang", or fallback to "Lain-lain"
		for _, cat := range categories {
			if cat.Type == "expense" {
				if cat.Name == "Lain-lain" || cat.Name == "Cicilan & Utang" {
					categoryID = cat.ID
					break
				}
			}
		}
		// If still empty, choose first expense category
		if categoryID == "" {
			for _, cat := range categories {
				if cat.Type == "expense" {
					categoryID = cat.ID
					break
				}
			}
		}
	}

	// Calculate interest/principal via shared ledger-v1 + debt-v1 money policy.
	rate := 0.0
	if d.InterestRate != nil {
		rate = *d.InterestRate
	}
	split, err := kernel.SplitDebtPayment(kernel.DebtPaymentSplit{
		PaymentAmount:     req.Amount,
		OutstandingBefore: d.OutstandingBalance,
		AnnualInterestPct: rate,
	}, kernel.DefaultMoneyScale)
	if err != nil {
		return nil, err
	}
	interestPortion := split.Interest
	principalPortion := split.Principal
	// Cash leaving the account is the full payment (rounded).
	paymentAmount := kernel.RoundIDR(req.Amount)

	// Construct payment log
	p := &model.DebtPayment{
		DebtID:           debtID,
		Amount:           paymentAmount,
		PaymentDate:      req.PaymentDate,
		IsExtraPayment:   req.IsExtraPayment,
		PrincipalPortion: &principalPortion,
		InterestPortion:  &interestPortion,
		Notes:            req.Notes,
	}

	// Construct ledger expense transaction
	txDesc := "Pembayaran Utang: " + d.Name
	if req.IsExtraPayment {
		txDesc = "Pembayaran Ekstra Utang: " + d.Name
	}

	var categoryPtr *string
	if categoryID != "" {
		categoryPtr = &categoryID
	}

	// Only financing cost is an expense. Principal is a balance-sheet movement:
	// cash decreases while the liability decreases by the same amount.
	// When interest is 0, skip zero-amount expense row (repo still deducts cash
	// by payment amount and reduces outstanding by principal).
	expense := &model.Transaction{
		UserID:      userID,
		AccountID:   req.AccountID,
		CategoryID:  categoryPtr,
		Type:        "expense",
		Amount:      interestPortion,
		Date:        req.PaymentDate,
		Description: &txDesc,
		Notes:       req.Notes,
		Status:      "confirmed",
		Currency:    "IDR",
	}

	createdPayment, err := s.debtRepo.CreatePayment(ctx, p, expense, req.AccountID)
	if err != nil {
		return nil, err
	}

	res := dto.ToDebtPaymentResponse(createdPayment)
	return &res, nil
}

func (s *debtService) GetDebtSummary(ctx context.Context, userID string) (*dto.DebtSummaryResponse, error) {
	sum, err := s.debtRepo.GetSummaryByUser(ctx, userID)
	if err != nil {
		return nil, err
	}

	res := dto.ToDebtSummaryResponse(sum)
	return &res, nil
}

func (s *debtService) SimulateAvalanche(ctx context.Context, userID string, extraMonthly float64) (*dto.AvalancheSimulationResponse, error) {
	list, err := s.debtRepo.GetAllByUser(ctx, userID)
	if err != nil {
		return nil, err
	}

	var inputs []kernel.DebtInput
	for _, d := range list {
		if d.Status != "active" || d.OutstandingBalance <= 0 {
			continue
		}
		rate := 0.0
		if d.InterestRate != nil {
			rate = *d.InterestRate
		}
		minPay := 0.0
		if d.MinimumPayment != nil {
			minPay = *d.MinimumPayment
		}
		inputs = append(inputs, kernel.DebtInput{
			ID:                d.ID,
			Name:              d.Name,
			Type:              d.Type,
			Balance:           d.OutstandingBalance,
			AnnualInterestPct: rate,
			MinimumPayment:    minPay,
		})
	}

	if len(inputs) == 0 {
		return &dto.AvalancheSimulationResponse{
			SchedulesWithExtra:    []dto.AvalanchePaymentScheduleResponse{},
			SchedulesWithoutExtra: []dto.AvalanchePaymentScheduleResponse{},
			IsEstimate:            true,
			FormulaVersion:        kernel.DebtFormulaVersion,
		}, nil
	}

	asOf := time.Now()
	sim := kernel.SimulateAvalanche(inputs, extraMonthly, asOf)

	toSchedules := func(in []kernel.DebtPayoffSchedule) []dto.AvalanchePaymentScheduleResponse {
		out := make([]dto.AvalanchePaymentScheduleResponse, 0, len(in))
		for _, sc := range in {
			out = append(out, dto.AvalanchePaymentScheduleResponse{
				DebtID:                 sc.DebtID,
				DebtName:               sc.DebtName,
				PayoffMonthIndex:       sc.PayoffMonthIndex,
				PayoffDate:             sc.PayoffDate,
				TotalInterestPaid:      sc.TotalInterestPaid,
				FormattedTotalInterest: dto.FormatRupiah(sc.TotalInterestPaid),
			})
		}
		return out
	}

	return &dto.AvalancheSimulationResponse{
		MonthsToPayoff:                sim.WithExtra.MonthsToPayoff,
		TotalInterestPaid:             sim.WithExtra.TotalInterestPaid,
		FormattedTotalInterest:        dto.FormatRupiah(sim.WithExtra.TotalInterestPaid),
		MonthsToPayoffWithoutExtra:    sim.WithoutExtra.MonthsToPayoff,
		TotalInterestPaidWithoutExtra: sim.WithoutExtra.TotalInterestPaid,
		FormattedInterestWithoutExtra: dto.FormatRupiah(sim.WithoutExtra.TotalInterestPaid),
		SavingsInterest:               sim.SavingsInterest,
		FormattedSavingsInterest:      dto.FormatRupiah(sim.SavingsInterest),
		SavingsMonths:                 sim.SavingsMonths,
		SchedulesWithExtra:            toSchedules(sim.WithExtra.Schedules),
		SchedulesWithoutExtra:         toSchedules(sim.WithoutExtra.Schedules),
		AsOf:                          sim.AsOf.Format(time.RFC3339),
		FormulaVersion:                sim.FormulaVersion,
		Assumptions:                   sim.Assumptions,
		NegativeAmortization:          sim.NegativeAmortization,
		IsEstimate:                    true,
	}, nil
}

// runSim is a thin adapter for legacy unit tests; production path uses kernel.SimulateAvalanche.
func runSim(debts []model.Debt, extraMonthly float64) (int, float64, []model.AvalanchePaymentSchedule) {
	inputs := make([]kernel.DebtInput, 0, len(debts))
	for _, d := range debts {
		rate := 0.0
		if d.InterestRate != nil {
			rate = *d.InterestRate
		}
		minPay := 0.0
		if d.MinimumPayment != nil {
			minPay = *d.MinimumPayment
		}
		inputs = append(inputs, kernel.DebtInput{
			ID:                d.ID,
			Name:              d.Name,
			Type:              d.Type,
			Balance:           d.OutstandingBalance,
			AnnualInterestPct: rate,
			MinimumPayment:    minPay,
		})
	}
	// Kernel returns with/without-extra; runSim is a single-side call so extra is the budget delta.
	run := kernel.SimulateAvalanche(inputs, extraMonthly, time.Now()).WithExtra
	out := make([]model.AvalanchePaymentSchedule, 0, len(run.Schedules))
	for _, sc := range run.Schedules {
		out = append(out, model.AvalanchePaymentSchedule{
			DebtID:            sc.DebtID,
			DebtName:          sc.DebtName,
			PayoffMonthIndex:  sc.PayoffMonthIndex,
			PayoffDate:        sc.PayoffDate,
			TotalInterestPaid: sc.TotalInterestPaid,
		})
	}
	return run.MonthsToPayoff, run.TotalInterestPaid, out
}
