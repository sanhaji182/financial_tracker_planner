package service

import (
	"context"
	"errors"
	"math"
	"sort"
	"time"

	"github.com/user/financial-os/internal/dto"
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

	// Calculate interest portion: interest_rate / 12 months / 100%
	var interestPortion, principalPortion float64
	if d.InterestRate != nil && *d.InterestRate > 0 {
		interestPortion = d.OutstandingBalance * ((*d.InterestRate) / 12 / 100)
		if interestPortion > req.Amount {
			interestPortion = req.Amount
		}
		principalPortion = req.Amount - interestPortion
	} else {
		principalPortion = req.Amount
	}

	// Construct payment log
	p := &model.DebtPayment{
		DebtID:           debtID,
		Amount:           req.Amount,
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

// Struct for internal simulation
type simDebt struct {
	id             string
	name           string
	balance        float64
	interestRate   float64
	minimumPayment float64
}

func (s *debtService) SimulateAvalanche(ctx context.Context, userID string, extraMonthly float64) (*dto.AvalancheSimulationResponse, error) {
	list, err := s.debtRepo.GetAllByUser(ctx, userID)
	if err != nil {
		return nil, err
	}

	// Filter active debts only
	var activeDebts []model.Debt
	for _, d := range list {
		if d.Status == "active" && d.OutstandingBalance > 0 {
			activeDebts = append(activeDebts, d)
		}
	}

	// If no active debts, return empty result
	if len(activeDebts) == 0 {
		return &dto.AvalancheSimulationResponse{
			SchedulesWithExtra:    []dto.AvalanchePaymentScheduleResponse{},
			SchedulesWithoutExtra: []dto.AvalanchePaymentScheduleResponse{},
		}, nil
	}

	// Run Simulation 1: Without Extra
	monthsNoExtra, interestNoExtra, schedNoExtra := runSim(activeDebts, 0)

	// Run Simulation 2: With Extra (Avalanche)
	monthsWithExtra, interestWithExtra, schedWithExtra := runSim(activeDebts, extraMonthly)

	savingsInterest := interestNoExtra - interestWithExtra
	savingsMonths := monthsNoExtra - monthsWithExtra
	if savingsMonths < 0 {
		savingsMonths = 0
	}
	if savingsInterest < 0 {
		savingsInterest = 0
	}

	// Build response DTOs
	var schedulesWithExtra []dto.AvalanchePaymentScheduleResponse
	for _, sc := range schedWithExtra {
		schedulesWithExtra = append(schedulesWithExtra, dto.AvalanchePaymentScheduleResponse{
			DebtID:                 sc.DebtID,
			DebtName:               sc.DebtName,
			PayoffMonthIndex:       sc.PayoffMonthIndex,
			PayoffDate:             sc.PayoffDate,
			TotalInterestPaid:      sc.TotalInterestPaid,
			FormattedTotalInterest: dto.FormatRupiah(sc.TotalInterestPaid),
		})
	}

	var schedulesWithoutExtra []dto.AvalanchePaymentScheduleResponse
	for _, sc := range schedNoExtra {
		schedulesWithoutExtra = append(schedulesWithoutExtra, dto.AvalanchePaymentScheduleResponse{
			DebtID:                 sc.DebtID,
			DebtName:               sc.DebtName,
			PayoffMonthIndex:       sc.PayoffMonthIndex,
			PayoffDate:             sc.PayoffDate,
			TotalInterestPaid:      sc.TotalInterestPaid,
			FormattedTotalInterest: dto.FormatRupiah(sc.TotalInterestPaid),
		})
	}

	return &dto.AvalancheSimulationResponse{
		MonthsToPayoff:                monthsWithExtra,
		TotalInterestPaid:             interestWithExtra,
		FormattedTotalInterest:        dto.FormatRupiah(interestWithExtra),
		MonthsToPayoffWithoutExtra:    monthsNoExtra,
		TotalInterestPaidWithoutExtra: interestNoExtra,
		FormattedInterestWithoutExtra: dto.FormatRupiah(interestNoExtra),
		SavingsInterest:               savingsInterest,
		FormattedSavingsInterest:      dto.FormatRupiah(savingsInterest),
		SavingsMonths:                 savingsMonths,
		SchedulesWithExtra:            schedulesWithExtra,
		SchedulesWithoutExtra:         schedulesWithoutExtra,
	}, nil
}

// Simulator core function
func runSim(debts []model.Debt, extraMonthly float64) (int, float64, []model.AvalanchePaymentSchedule) {
	// Initialize simulation debts
	var simDebts []*simDebt
	for _, d := range debts {
		rate := 0.0
		if d.InterestRate != nil {
			rate = *d.InterestRate
		}
		minPay := 0.0
		if d.MinimumPayment != nil {
			minPay = *d.MinimumPayment
		}
		simDebts = append(simDebts, &simDebt{
			id:             d.ID,
			name:           d.Name,
			balance:        d.OutstandingBalance,
			interestRate:   rate,
			minimumPayment: minPay,
		})
	}

	// Sort by interest rate DESC (Avalanche prioritizes highest interest rate)
	sort.Slice(simDebts, func(i, j int) bool {
		return simDebts[i].interestRate > simDebts[j].interestRate
	})

	totalInterest := 0.0
	monthCount := 0
	maxMonths := 1200 // 100 years guard
	stalled := false

	// Avalanche keeps the original monthly debt-payment budget constant. When one
	// debt is paid off, its former minimum payment rolls into the next target.
	monthlyBudget := extraMonthly
	for _, d := range simDebts {
		monthlyBudget += d.minimumPayment
	}

	// Map to record schedules
	payoffSchedules := make(map[string]model.AvalanchePaymentSchedule)

	// Keep simulating month by month until all balances are zero
	for monthCount < maxMonths {
		activeCount := 0
		for _, d := range simDebts {
			if d.balance > 0 {
				activeCount++
			}
		}
		if activeCount == 0 {
			break
		}

		monthCount++
		currentDate := time.Now().AddDate(0, monthCount, 0)

		// 1. Apply monthly interest first
		for _, d := range simDebts {
			if d.balance > 0 {
				interest := d.balance * (d.interestRate / 12 / 100)
				d.balance += interest
				totalInterest += interest

				// Record interest paid per debt inside payoffSchedules
				sched := payoffSchedules[d.id]
				sched.TotalInterestPaid += interest
				payoffSchedules[d.id] = sched
			}
		}

		// 2. Pay minimums on all active debts, then roll every unused rupiah
		// (including paid-off minimums) into the highest-interest active debt.
		remainingBudget := monthlyBudget
		for _, d := range simDebts {
			if d.balance <= 0 {
				continue
			}
			payment := math.Min(d.minimumPayment, d.balance)
			d.balance -= payment
			remainingBudget -= payment
		}
		for _, d := range simDebts {
			if d.balance <= 0 || remainingBudget <= 0 {
				continue
			}
			payment := math.Min(remainingBudget, d.balance)
			d.balance -= payment
			remainingBudget -= payment
		}

		// Record payoffs after the complete monthly budget has been applied.
		for _, d := range simDebts {
			if d.balance <= 0 {
				d.balance = 0
				sched := payoffSchedules[d.id]
				if sched.PayoffMonthIndex == 0 {
					sched.DebtID = d.id
					sched.DebtName = d.name
					sched.PayoffMonthIndex = monthCount
					sched.PayoffDate = currentDate
					payoffSchedules[d.id] = sched
				}
			}
		}

		// If the fixed budget cannot cover this month's interest, balances can
		// never amortize under these assumptions. Stop instead of returning a
		// misleading 100-year payoff date.
		monthlyInterest := 0.0
		for _, d := range simDebts {
			if d.balance > 0 {
				monthlyInterest += d.balance * (d.interestRate / 12 / 100)
			}
		}
		if monthlyBudget <= monthlyInterest && monthlyInterest > 0 {
			stalled = true
			break
		}
	}

	// Compile schedules list in matching order
	var schedules []model.AvalanchePaymentSchedule
	for _, d := range debts {
		sched, found := payoffSchedules[d.ID]
		if !found && !stalled {
			sched = model.AvalanchePaymentSchedule{
				DebtID:           d.ID,
				DebtName:         d.Name,
				PayoffMonthIndex: monthCount,
				PayoffDate:       time.Now().AddDate(0, monthCount, 0),
			}
		} else if !found {
			// A zero payoff index/date explicitly means the payment budget does
			// not amortize this debt under the supplied assumptions.
			sched = model.AvalanchePaymentSchedule{DebtID: d.ID, DebtName: d.Name}
		}
		schedules = append(schedules, sched)
	}

	return monthCount, totalInterest, schedules
}
