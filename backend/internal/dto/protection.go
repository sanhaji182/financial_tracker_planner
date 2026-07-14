package dto

type ProtectionGap struct {
	Category    string `json:"category"`
	Severity    string `json:"severity"` // high, medium, low
	Description string `json:"description"`
}

type ProtectionAssessmentResponse struct {
	HasHealthInsurance  bool            `json:"has_health_insurance"`
	HasLifeInsurance    bool            `json:"has_life_insurance"`
	HasEmergencyFund    bool            `json:"has_emergency_fund"`
	EmergencyFundMonths float64         `json:"emergency_fund_months"`
	IncomeEarnersCount  int             `json:"income_earners_count"`
	DependentsCount     int             `json:"dependents_count"`
	ProtectionScore     int             `json:"protection_score"` // 0-100
	Gaps                []ProtectionGap `json:"gaps"`
	Recommendations     []string        `json:"recommendations"`
}

type UpdateProtectionProfileRequest struct {
	HasHealthInsurance *bool `json:"has_health_insurance"`
	HasLifeInsurance   *bool `json:"has_life_insurance"`
	IncomeEarnersCount *int  `json:"income_earners_count"`
	DependentsCount    *int  `json:"dependents_count"`
}

type ProtectionProfile struct {
	HasHealthInsurance bool `json:"has_health_insurance"`
	HasLifeInsurance   bool `json:"has_life_insurance"`
	IncomeEarnersCount int  `json:"income_earners_count"`
	DependentsCount    int  `json:"dependents_count"`
}
