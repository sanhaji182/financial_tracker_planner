package service

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/kernel"
)

type ProtectionService interface {
	GetAssessment(ctx context.Context, userID string) (*dto.ProtectionAssessmentResponse, error)
	UpdateProfile(ctx context.Context, userID string, req *dto.UpdateProtectionProfileRequest) error
}

type protectionService struct {
	dbPool   *pgxpool.Pool
	filePath string
	mu       sync.RWMutex
}

func NewProtectionService(dbPool *pgxpool.Pool, dataDir string) ProtectionService {
	filePath := filepath.Join(dataDir, "protection_profiles.json")
	return &protectionService{dbPool: dbPool, filePath: filePath}
}

func (s *protectionService) resolveOwnerID(ctx context.Context, userID string) (string, error) {
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

func (s *protectionService) loadProfiles() (map[string]*dto.ProtectionProfile, error) {
	if _, err := os.Stat(s.filePath); os.IsNotExist(err) {
		return make(map[string]*dto.ProtectionProfile), nil
	}
	data, err := os.ReadFile(s.filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to read profiles: %w", err)
	}
	var profiles map[string]*dto.ProtectionProfile
	if err := json.Unmarshal(data, &profiles); err != nil {
		return nil, fmt.Errorf("failed to parse profiles: %w", err)
	}
	return profiles, nil
}

func (s *protectionService) saveProfiles(profiles map[string]*dto.ProtectionProfile) error {
	data, err := json.MarshalIndent(profiles, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to serialize profiles: %w", err)
	}
	dir := filepath.Dir(s.filePath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create profiles directory: %w", err)
	}
	if err := os.WriteFile(s.filePath, data, 0600); err != nil {
		return fmt.Errorf("failed to write profiles: %w", err)
	}
	return nil
}

func (s *protectionService) GetAssessment(ctx context.Context, userID string) (*dto.ProtectionAssessmentResponse, error) {
	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		return nil, err
	}

	s.mu.RLock()
	profiles, err := s.loadProfiles()
	s.mu.RUnlock()
	if err != nil {
		return nil, err
	}
	profile, _ := profiles[ownerID]
	if profile == nil {
		profile = &dto.ProtectionProfile{
			IncomeEarnersCount: 1,
			DependentsCount:    0,
		}
	}

	now := time.Now()
	startOfMonth := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
	threeMonthsAgo := startOfMonth.AddDate(0, -3, 0)

	var efTotal float64
	_ = s.dbPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(a.balance * COALESCE(c.exchange_rate_to_idr,1)), 0) FROM accounts a LEFT JOIN currencies c ON c.code=a.currency
		WHERE a.user_id = $1 AND a.is_emergency_fund = true AND a.is_active = true AND a.deleted_at IS NULL
	`, ownerID).Scan(&efTotal)

	var totalExpenses float64
	_ = s.dbPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(t.amount * COALESCE(c.exchange_rate_to_idr,t.exchange_rate,1)), 0) FROM transactions t LEFT JOIN currencies c ON c.code=t.currency
		WHERE t.user_id = $1 AND t.type = 'expense' AND t.status = 'confirmed'
		AND date >= $2 AND date < $3 AND deleted_at IS NULL
	`, ownerID, threeMonthsAgo, startOfMonth).Scan(&totalExpenses)
	monthlyExpenses := totalExpenses / 3.0

	var totalIncome float64
	_ = s.dbPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(t.amount * COALESCE(c.exchange_rate_to_idr,t.exchange_rate,1)), 0) FROM transactions t LEFT JOIN currencies c ON c.code=t.currency
		WHERE t.user_id = $1 AND t.type = 'income' AND t.status = 'confirmed'
		AND date >= $2 AND date < $3 AND deleted_at IS NULL
	`, ownerID, threeMonthsAgo, startOfMonth).Scan(&totalIncome)
	monthlyIncome := totalIncome / 3.0

	var outstandingDebts float64
	_ = s.dbPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(d.outstanding_balance * COALESCE(c.exchange_rate_to_idr,1)), 0)
		FROM debts d LEFT JOIN currencies c ON c.code=d.currency
		WHERE d.user_id = $1 AND d.status = 'active' AND d.deleted_at IS NULL
	`, ownerID).Scan(&outstandingDebts)

	var minIncome, maxIncome float64
	_ = s.dbPool.QueryRow(ctx, `
		SELECT COALESCE(MIN(monthly), 0), COALESCE(MAX(monthly), 0) FROM (
			SELECT SUM(t.amount * COALESCE(c.exchange_rate_to_idr,t.exchange_rate,1)) as monthly
			FROM transactions t LEFT JOIN currencies c ON c.code=t.currency
			WHERE t.user_id = $1 AND t.type = 'income' AND t.status = 'confirmed'
			AND date >= $2 AND date < $3 AND deleted_at IS NULL
			GROUP BY TO_CHAR(date, 'YYYY-MM')
		) sub
	`, ownerID, threeMonthsAgo, startOfMonth).Scan(&minIncome, &maxIncome)

	efRes := kernel.ComputeEF(kernel.EFInputs{
		AsOf:                   now,
		EFBalance:              efTotal,
		MonthlyLivingCost:      monthlyExpenses,
		ConfiguredTargetMonths: kernel.EFDefaultTargetMonths,
		UseAdaptive:            true,
		MinMonthlyIncome:       minIncome,
		MaxMonthlyIncome:       maxIncome,
	})

	kr := kernel.ComputeProtectionAssessment(kernel.ProtectionInputs{
		AsOf:               now.UTC(),
		MonthlyIncome:      monthlyIncome,
		MonthlyExpenses:    monthlyExpenses,
		EFBalance:          efTotal,
		EFCoverageMonths:   efRes.CoverageMonths,
		EFTargetMonths:     float64(efRes.TargetMonths),
		OutstandingDebts:   outstandingDebts,
		DependentsCount:    profile.DependentsCount,
		IncomeEarnersCount: profile.IncomeEarnersCount,
		HasHealthInsurance: profile.HasHealthInsurance,
		HasLifeInsurance:   profile.HasLifeInsurance,
		ExistingLifeCover:  profile.ExistingLifeCover,
		YearsToIndependence: profile.YearsToIndependence,
		MinMonthlyIncome:   minIncome,
		MaxMonthlyIncome:   maxIncome,
	})

	gaps := make([]dto.ProtectionGap, 0, len(kr.Gaps))
	for _, g := range kr.Gaps {
		gaps = append(gaps, dto.ProtectionGap{
			Category: g.Category, Severity: g.Severity, Description: g.Description, Amount: g.Amount,
		})
	}
	// Legacy recommendations field mirrors guidance
	recs := append([]string{}, kr.Guidance...)

	return &dto.ProtectionAssessmentResponse{
		HasHealthInsurance:  profile.HasHealthInsurance,
		HasLifeInsurance:    profile.HasLifeInsurance,
		HasEmergencyFund:    efTotal > 0,
		EmergencyFundMonths: efRes.CoverageMonths,
		IncomeEarnersCount:  profile.IncomeEarnersCount,
		DependentsCount:     profile.DependentsCount,
		ProtectionScore:     kr.ProtectionScore,
		Gaps:                gaps,
		Recommendations:     recs,
		AsOf:                kr.AsOf.Format(time.RFC3339),
		FormulaVersion:      kr.FormulaVersion,
		LifeCoverNeed:       kr.LifeCoverNeed,
		ExistingLifeCover:   kr.ExistingLifeCover,
		LifeCoverGap:        kr.LifeCoverGap,
		IncomeReplacement:   kr.IncomeReplacement,
		DebtClearance:       kr.DebtClearance,
		DependentEducation:  kr.DependentEducation,
		FuneralBuffer:       kr.FuneralBuffer,
		LiquidOffset:        kr.LiquidOffset,
		ScoreLabel:          kr.ScoreLabel,
		DataConfidence:      kr.DataConfidence,
		IsSufficient:        kr.IsSufficient,
		MissingFields:       kr.MissingFields,
		Guidance:            kr.Guidance,
		Assumptions:         kr.Assumptions,
		Methodology:         kr.Methodology,
		Disclaimer:          kr.Disclaimer,
		IsProductAdvice:     false,
	}, nil
}

func (s *protectionService) UpdateProfile(ctx context.Context, userID string, req *dto.UpdateProtectionProfileRequest) error {
	ownerID, err := s.resolveOwnerID(ctx, userID)
	if err != nil {
		return err
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	profiles, err := s.loadProfiles()
	if err != nil {
		return err
	}

	profile, _ := profiles[ownerID]
	if profile == nil {
		profile = &dto.ProtectionProfile{IncomeEarnersCount: 1}
	}

	if req.HasHealthInsurance != nil {
		profile.HasHealthInsurance = *req.HasHealthInsurance
	}
	if req.HasLifeInsurance != nil {
		profile.HasLifeInsurance = *req.HasLifeInsurance
	}
	if req.IncomeEarnersCount != nil {
		profile.IncomeEarnersCount = *req.IncomeEarnersCount
	}
	if req.DependentsCount != nil {
		profile.DependentsCount = *req.DependentsCount
	}
	if req.ExistingLifeCover != nil {
		profile.ExistingLifeCover = math.Max(0, *req.ExistingLifeCover)
	}
	if req.YearsToIndependence != nil {
		profile.YearsToIndependence = *req.YearsToIndependence
	}

	profiles[ownerID] = profile
	return s.saveProfiles(profiles)
}
