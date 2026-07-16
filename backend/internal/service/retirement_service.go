package service

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/kernel"
)

type RetirementService interface {
	GetEducation(ctx context.Context, userID string) (*dto.RetirementEducationResponse, error)
	UpdateProfile(ctx context.Context, userID string, req *dto.UpdateRetirementProfileRequest) error
}

type retirementService struct {
	dbPool   *pgxpool.Pool
	filePath string
	mu       sync.RWMutex
}

func NewRetirementService(dbPool *pgxpool.Pool, dataDir string) RetirementService {
	return &retirementService{
		dbPool:   dbPool,
		filePath: filepath.Join(dataDir, "retirement_profiles.json"),
	}
}

func (s *retirementService) resolveOwnerID(ctx context.Context, userID string) (string, error) {
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

func (s *retirementService) loadProfiles() (map[string]*dto.RetirementProfile, error) {
	if _, err := os.Stat(s.filePath); os.IsNotExist(err) {
		return make(map[string]*dto.RetirementProfile), nil
	}
	data, err := os.ReadFile(s.filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to read retirement profiles: %w", err)
	}
	var profiles map[string]*dto.RetirementProfile
	if err := json.Unmarshal(data, &profiles); err != nil {
		return nil, fmt.Errorf("failed to parse retirement profiles: %w", err)
	}
	return profiles, nil
}

func (s *retirementService) saveProfiles(profiles map[string]*dto.RetirementProfile) error {
	data, err := json.MarshalIndent(profiles, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.filePath), 0755); err != nil {
		return err
	}
	return os.WriteFile(s.filePath, data, 0600)
}

func (s *retirementService) GetEducation(ctx context.Context, userID string) (*dto.RetirementEducationResponse, error) {
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
	profile := profiles[ownerID]
	if profile == nil {
		profile = &dto.RetirementProfile{}
	}

	// Estimate monthly expenses from last 3 completed months
	now := time.Now()
	startOfMonth := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
	threeMonthsAgo := startOfMonth.AddDate(0, -3, 0)

	var totalExpenses float64
	_ = s.dbPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(t.amount * COALESCE(c.exchange_rate_to_idr,t.exchange_rate,1)), 0)
		FROM transactions t LEFT JOIN currencies c ON c.code=t.currency
		WHERE t.user_id = $1 AND t.type = 'expense' AND t.status = 'confirmed'
		AND date >= $2 AND date < $3 AND deleted_at IS NULL
	`, ownerID, threeMonthsAgo, startOfMonth).Scan(&totalExpenses)
	monthlyExpenses := totalExpenses / 3.0

	// Liquid + investment-ish balances as savings baseline if profile savings not set
	var liquid float64
	_ = s.dbPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(a.balance * COALESCE(c.exchange_rate_to_idr,1)), 0)
		FROM accounts a LEFT JOIN currencies c ON c.code=a.currency
		WHERE a.user_id = $1 AND a.is_active = true AND a.deleted_at IS NULL
	`, ownerID).Scan(&liquid)

	savings := profile.CurrentSavings
	if savings <= 0 {
		savings = liquid
	}

	in := kernel.RetirementInputs{
		AsOf:               now,
		CurrentAge:         profile.CurrentAge,
		RetirementAge:      profile.RetirementAge,
		CurrentSavings:     savings,
		MonthlyContrib:     profile.MonthlyContrib,
		MonthlyExpenses:    monthlyExpenses,
		InflationRate:      profile.InflationRate,
		NominalReturnRate:  profile.NominalReturnRate,
		IncomeReplaceRatio: profile.IncomeReplaceRatio,
		LongevityLow:       profile.LongevityLow,
		LongevityMid:       profile.LongevityMid,
		LongevityHigh:      profile.LongevityHigh,
	}
	res := kernel.ComputeRetirementEducation(in)

	scenarios := make([]dto.RetirementScenarioDTO, 0, len(res.Scenarios))
	for _, sc := range res.Scenarios {
		scenarios = append(scenarios, dto.RetirementScenarioDTO{
			Label: sc.Label, LongevityAge: sc.LongevityAge, YearsInRetirement: sc.YearsInRetirement,
			CorpusNeeded: sc.CorpusNeeded, ProjectedCorpus: sc.ProjectedCorpus,
			FundingGap: sc.FundingGap, MonthlyShortfall: sc.MonthlyShortfall,
			IsFunded: sc.IsFunded, Note: sc.Note,
		})
	}

	return &dto.RetirementEducationResponse{
		AsOf: res.AsOf.Format(time.RFC3339), FormulaVersion: res.FormulaVersion,
		CurrentAge: res.CurrentAge, RetirementAge: res.RetirementAge, YearsToRetire: res.YearsToRetire,
		CurrentSavings: res.CurrentSavings, MonthlyContribution: res.MonthlyContrib,
		MonthlyExpenses: res.MonthlyExpenses, InflationRate: res.InflationRate,
		NominalReturnRate: res.NominalReturnRate, RealReturnRate: res.RealReturnRate,
		IncomeReplaceRatio: res.IncomeReplaceRatio, TargetMonthlyAtRetire: res.TargetMonthlyAtRetire,
		PrimaryCorpusNeeded: res.PrimaryCorpusNeeded, ProjectedCorpus: res.ProjectedCorpus,
		PrimaryFundingGap: res.PrimaryFundingGap, RequiredMonthlyContrib: res.RequiredMonthlyContrib,
		ContributionGap: res.ContributionGap, Scenarios: scenarios,
		DataConfidence: res.DataConfidence, IsSufficient: res.IsSufficient,
		MissingFields: res.MissingFields, Assumptions: res.Assumptions,
		Methodology: res.Methodology, Guidance: res.Guidance, Disclaimer: res.Disclaimer,
		IsGuaranteedReturn: false, IsProductAdvice: false,
	}, nil
}

func (s *retirementService) UpdateProfile(ctx context.Context, userID string, req *dto.UpdateRetirementProfileRequest) error {
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
	p := profiles[ownerID]
	if p == nil {
		p = &dto.RetirementProfile{}
	}
	if req.CurrentAge != nil {
		p.CurrentAge = *req.CurrentAge
	}
	if req.RetirementAge != nil {
		p.RetirementAge = *req.RetirementAge
	}
	if req.CurrentSavings != nil {
		p.CurrentSavings = *req.CurrentSavings
	}
	if req.MonthlyContrib != nil {
		p.MonthlyContrib = *req.MonthlyContrib
	}
	if req.InflationRate != nil {
		p.InflationRate = *req.InflationRate
	}
	if req.NominalReturnRate != nil {
		p.NominalReturnRate = *req.NominalReturnRate
	}
	if req.IncomeReplaceRatio != nil {
		p.IncomeReplaceRatio = *req.IncomeReplaceRatio
	}
	if req.LongevityLow != nil {
		p.LongevityLow = *req.LongevityLow
	}
	if req.LongevityMid != nil {
		p.LongevityMid = *req.LongevityMid
	}
	if req.LongevityHigh != nil {
		p.LongevityHigh = *req.LongevityHigh
	}
	profiles[ownerID] = p
	return s.saveProfiles(profiles)
}
