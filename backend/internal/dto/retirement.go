package dto

// Retirement DTOs (retirement-v1)

type RetirementScenarioDTO struct {
	Label             string  `json:"label"`
	LongevityAge      int     `json:"longevity_age"`
	YearsInRetirement int     `json:"years_in_retirement"`
	CorpusNeeded      float64 `json:"corpus_needed"`
	ProjectedCorpus   float64 `json:"projected_corpus"`
	FundingGap        float64 `json:"funding_gap"`
	MonthlyShortfall  float64 `json:"monthly_shortfall"`
	IsFunded          bool    `json:"is_funded"`
	Note              string  `json:"note"`
}

type RetirementEducationResponse struct {
	AsOf                   string                  `json:"as_of"`
	FormulaVersion         string                  `json:"formula_version"`
	CurrentAge             int                     `json:"current_age"`
	RetirementAge          int                     `json:"retirement_age"`
	YearsToRetire          int                     `json:"years_to_retire"`
	CurrentSavings         float64                 `json:"current_savings"`
	MonthlyContribution    float64                 `json:"monthly_contribution"`
	MonthlyExpenses        float64                 `json:"monthly_expenses"`
	InflationRate          float64                 `json:"inflation_rate"`
	NominalReturnRate      float64                 `json:"nominal_return_rate"`
	RealReturnRate         float64                 `json:"real_return_rate"`
	IncomeReplaceRatio     float64                 `json:"income_replace_ratio"`
	TargetMonthlyAtRetire  float64                 `json:"target_monthly_at_retire"`
	PrimaryCorpusNeeded    float64                 `json:"primary_corpus_needed"`
	ProjectedCorpus        float64                 `json:"projected_corpus"`
	PrimaryFundingGap      float64                 `json:"primary_funding_gap"`
	RequiredMonthlyContrib float64                 `json:"required_monthly_contribution"`
	ContributionGap        float64                 `json:"contribution_gap"`
	Scenarios              []RetirementScenarioDTO `json:"scenarios"`
	DataConfidence         string                  `json:"data_confidence"`
	IsSufficient           bool                    `json:"is_sufficient"`
	MissingFields          []string                `json:"missing_fields,omitempty"`
	Assumptions            []string                `json:"assumptions"`
	Methodology            []string                `json:"methodology"`
	Guidance               []string                `json:"guidance"`
	Disclaimer             string                  `json:"disclaimer"`
	IsGuaranteedReturn     bool                    `json:"is_guaranteed_return"`
	IsProductAdvice        bool                    `json:"is_product_advice"`
}

type UpdateRetirementProfileRequest struct {
	CurrentAge         *int     `json:"current_age"`
	RetirementAge      *int     `json:"retirement_age"`
	CurrentSavings     *float64 `json:"current_savings"`
	MonthlyContrib     *float64 `json:"monthly_contribution"`
	InflationRate      *float64 `json:"inflation_rate"`
	NominalReturnRate  *float64 `json:"nominal_return_rate"`
	IncomeReplaceRatio *float64 `json:"income_replace_ratio"`
	LongevityLow       *int     `json:"longevity_low"`
	LongevityMid       *int     `json:"longevity_mid"`
	LongevityHigh      *int     `json:"longevity_high"`
}

type RetirementProfile struct {
	CurrentAge         int     `json:"current_age"`
	RetirementAge      int     `json:"retirement_age"`
	CurrentSavings     float64 `json:"current_savings"`
	MonthlyContrib     float64 `json:"monthly_contribution"`
	InflationRate      float64 `json:"inflation_rate"`
	NominalReturnRate  float64 `json:"nominal_return_rate"`
	IncomeReplaceRatio float64 `json:"income_replace_ratio"`
	LongevityLow       int     `json:"longevity_low"`
	LongevityMid       int     `json:"longevity_mid"`
	LongevityHigh      int     `json:"longevity_high"`
}
