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

	// Load profile from file
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

	// Calculate from DB data
	now := time.Now()
	startOfMonth := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
	threeMonthsAgo := startOfMonth.AddDate(0, -3, 0)

	// Emergency fund
	var efTotal float64
	_ = s.dbPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(balance), 0) FROM accounts
		WHERE user_id = $1 AND is_emergency_fund = true AND is_active = true AND deleted_at IS NULL
	`, ownerID).Scan(&efTotal)

	// Monthly expenses (last 3 months average)
	var totalExpenses float64
	_ = s.dbPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount), 0) FROM transactions
		WHERE user_id = $1 AND type = 'expense' AND status = 'confirmed'
		AND date >= $2 AND date < $3 AND deleted_at IS NULL
	`, ownerID, threeMonthsAgo, startOfMonth).Scan(&totalExpenses)
	monthlyExpenses := totalExpenses / 3.0

	// Monthly income (last 3 months average)
	var totalIncome float64
	_ = s.dbPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount), 0) FROM transactions
		WHERE user_id = $1 AND type = 'income' AND status = 'confirmed'
		AND date >= $2 AND date < $3 AND deleted_at IS NULL
	`, ownerID, threeMonthsAgo, startOfMonth).Scan(&totalIncome)
	monthlyIncome := totalIncome / 3.0

	// Total debt payments
	var totalDebtPayments float64
	_ = s.dbPool.QueryRow(ctx, `
		SELECT COALESCE(SUM(minimum_payment), 0) FROM debts
		WHERE user_id = $1 AND status = 'active' AND deleted_at IS NULL
	`, ownerID).Scan(&totalDebtPayments)

	// Calculate metrics
	efMonths := 0.0
	if monthlyExpenses > 0 {
		efMonths = efTotal / monthlyExpenses
	}

	dtiRatio := 0.0
	if monthlyIncome > 0 {
		dtiRatio = (totalDebtPayments / monthlyIncome) * 100
	}

	// Income variance (simple: range / avg for now)
	var minIncome, maxIncome float64
	_ = s.dbPool.QueryRow(ctx, `
		SELECT COALESCE(MIN(monthly), 0), COALESCE(MAX(monthly), 0) FROM (
			SELECT SUM(amount) as monthly FROM transactions
			WHERE user_id = $1 AND type = 'income' AND status = 'confirmed'
			AND date >= $2 AND date < $3 AND deleted_at IS NULL
			GROUP BY TO_CHAR(date, 'YYYY-MM')
		) sub
	`, ownerID, threeMonthsAgo, startOfMonth).Scan(&minIncome, &maxIncome)

	incomeStable := true
	if monthlyIncome > 0 && maxIncome > 0 {
		variance := (maxIncome - minIncome) / monthlyIncome
		incomeStable = variance < 0.5
	}

	// Build assessment
	var gaps []dto.ProtectionGap
	var recommendations []string
	score := 0

	// Health insurance
	if profile.HasHealthInsurance {
		score += 15
	} else {
		gaps = append(gaps, dto.ProtectionGap{Category: "health_insurance", Severity: "high", Description: "Anda belum memiliki asuransi kesehatan. Ini adalah prioritas perlindungan utama."})
		recommendations = append(recommendations, "Daftarkan BPJS Kesehatan atau asuransi kesehatan swasta untuk seluruh anggota keluarga.")
	}

	// Life insurance
	if profile.HasLifeInsurance {
		score += 20
	} else if profile.DependentsCount > 0 || profile.IncomeEarnersCount <= 1 {
		gaps = append(gaps, dto.ProtectionGap{Category: "life_insurance", Severity: "high", Description: fmt.Sprintf("Dengan %d tanggungan dan %d pencari nafkah, asuransi jiwa sangat diperlukan.", profile.DependentsCount, profile.IncomeEarnersCount)})
		recommendations = append(recommendations, "Pertimbangkan asuransi jiwa dengan pertanggungan minimal 10x penghasilan tahunan.")
	} else {
		score += 10 // partial credit if no dependents
	}

	// Emergency fund
	if efMonths >= 3.0 {
		score += 25
	} else if efMonths > 0 {
		score += int(efMonths / 3.0 * 25)
		gaps = append(gaps, dto.ProtectionGap{Category: "emergency_fund", Severity: "medium", Description: fmt.Sprintf("Dana darurat hanya mencakup %.1f bulan. Target minimal 3-6 bulan.", efMonths)})
		recommendations = append(recommendations, fmt.Sprintf("Tingkatkan dana darurat hingga mencapai minimal 3 bulan pengeluaran (kekurangan ~%s).", formatRupiahProtection(monthlyExpenses*3-efTotal)))
	} else {
		gaps = append(gaps, dto.ProtectionGap{Category: "emergency_fund", Severity: "high", Description: "Anda belum memiliki dana darurat. Ini adalah fondasi keamanan finansial."})
		recommendations = append(recommendations, "Mulai alokasikan minimal 10% penghasilan bulanan ke rekening dana darurat.")
	}

	// DTI
	if dtiRatio < 30 {
		score += 15
	} else if dtiRatio < 50 {
		score += 8
		gaps = append(gaps, dto.ProtectionGap{Category: "debt_load", Severity: "medium", Description: fmt.Sprintf("DTI %.1f%% cukup tinggi. Target ideal < 30%%.", dtiRatio)})
	} else {
		gaps = append(gaps, dto.ProtectionGap{Category: "debt_load", Severity: "high", Description: fmt.Sprintf("DTI %.1f%% sangat tinggi. Prioritaskan pelunasan utang bunga tinggi.", dtiRatio)})
		recommendations = append(recommendations, "Gunakan metode debt avalanche untuk mempercepat pelunasan utang berbunga tinggi.")
	}

	// Income stability
	if incomeStable {
		score += 15
	} else {
		score += 5
		gaps = append(gaps, dto.ProtectionGap{Category: "income_stability", Severity: "medium", Description: "Variasi penghasilan bulanan cukup besar. Pertimbangkan dana cadangan ekstra."})
	}

	// Multiple earners
	if profile.IncomeEarnersCount >= 2 {
		score += 10
	} else {
		score += 3
	}

	if len(recommendations) == 0 {
		recommendations = append(recommendations, "Proteksi finansial Anda sudah cukup baik. Lakukan review berkala setiap 6 bulan.")
	}

	return &dto.ProtectionAssessmentResponse{
		HasHealthInsurance:  profile.HasHealthInsurance,
		HasLifeInsurance:    profile.HasLifeInsurance,
		HasEmergencyFund:    efTotal > 0,
		EmergencyFundMonths: efMonths,
		IncomeEarnersCount:  profile.IncomeEarnersCount,
		DependentsCount:     profile.DependentsCount,
		ProtectionScore:     score,
		Gaps:                gaps,
		Recommendations:     recommendations,
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

	profiles[ownerID] = profile
	return s.saveProfiles(profiles)
}

func formatRupiahProtection(amount float64) string {
	isNegative := amount < 0
	if isNegative {
		amount = -amount
	}

	formatted := formatNumber(math.Round(amount))
	if isNegative {
		return "-Rp " + formatted
	}
	return "Rp " + formatted
}
