package dto

type ProtectionGap struct {
	Category    string  `json:"category"`
	Severity    string  `json:"severity"` // high, medium, low
	Description string  `json:"description"`
	Amount      float64 `json:"amount,omitempty"`
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
	Recommendations     []string        `json:"recommendations"` // legacy alias of guidance

	// protection-v1 needs-based fields
	AsOf               string   `json:"as_of,omitempty"`
	FormulaVersion     string   `json:"formula_version,omitempty"`
	LifeCoverNeed      float64  `json:"life_cover_need"`
	ExistingLifeCover  float64  `json:"existing_life_cover"`
	LifeCoverGap       float64  `json:"life_cover_gap"`
	IncomeReplacement  float64  `json:"income_replacement"`
	DebtClearance      float64  `json:"debt_clearance"`
	DependentEducation float64  `json:"dependent_education_buffer"`
	FuneralBuffer      float64  `json:"funeral_buffer"`
	LiquidOffset       float64  `json:"liquid_offset"`
	ScoreLabel         string   `json:"score_label,omitempty"`
	DataConfidence     string   `json:"data_confidence,omitempty"`
	IsSufficient       bool     `json:"is_sufficient"`
	MissingFields      []string `json:"missing_fields,omitempty"`
	Guidance           []string `json:"guidance,omitempty"`
	Assumptions        []string `json:"assumptions,omitempty"`
	Methodology        []string `json:"methodology,omitempty"`
	Disclaimer         string   `json:"disclaimer,omitempty"`
	IsProductAdvice    bool     `json:"is_product_advice"`
}

type UpdateProtectionProfileRequest struct {
	HasHealthInsurance  *bool    `json:"has_health_insurance"`
	HasLifeInsurance    *bool    `json:"has_life_insurance"`
	IncomeEarnersCount  *int     `json:"income_earners_count"`
	DependentsCount     *int     `json:"dependents_count"`
	ExistingLifeCover   *float64 `json:"existing_life_cover"`
	YearsToIndependence *int     `json:"years_to_independence"`
}

type ProtectionProfile struct {
	HasHealthInsurance  bool    `json:"has_health_insurance"`
	HasLifeInsurance    bool    `json:"has_life_insurance"`
	IncomeEarnersCount  int     `json:"income_earners_count"`
	DependentsCount     int     `json:"dependents_count"`
	ExistingLifeCover   float64 `json:"existing_life_cover"`
	YearsToIndependence int     `json:"years_to_independence"`
}
