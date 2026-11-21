package dto

type DebtScanParsedData struct {
	Name               string   `json:"name"`
	Type               string   `json:"type"`
	Creditor           string   `json:"creditor"`
	OriginalAmount     float64  `json:"original_amount"`
	OutstandingBalance float64  `json:"outstanding_balance"`
	MinimumPayment     *float64 `json:"minimum_payment,omitempty"`
	InterestRate       *float64 `json:"interest_rate,omitempty"`
	DueDay             *int     `json:"due_day,omitempty"`
	TenorMonths        *int     `json:"tenor_months,omitempty"`
	Currency           string   `json:"currency"`
	Notes              string   `json:"notes"`
}

type DebtPaymentScanParsedData struct {
	Amount             float64 `json:"amount"`
	PaymentDate        string  `json:"payment_date"`
	SourceAccountHint  string  `json:"source_account_hint"`
	CreditorHint       string  `json:"creditor_hint"`
	ReferenceNumber    string  `json:"reference_number"`
	Notes              string  `json:"notes"`
	MatchedAccountID   string  `json:"matched_account_id,omitempty"`
	MatchedAccountName string  `json:"matched_account_name,omitempty"`
}

type DebtScanResponse struct {
	Mode              string                     `json:"mode"`
	Engine            string                     `json:"engine"`
	ExtractionMethod  string                     `json:"extraction_method"`
	RawText           string                     `json:"raw_text"`
	ParsedDebt        *DebtScanParsedData        `json:"parsed_debt,omitempty"`
	ParsedPayment     *DebtPaymentScanParsedData `json:"parsed_payment,omitempty"`
	ConfidenceScores  map[string]float64         `json:"confidence_scores"`
	OverallConfidence float64                    `json:"overall_confidence"`
	NeedsReview       bool                       `json:"needs_review"`
	Warnings          []string                   `json:"warnings"`
}

type AccountScanParsedData struct {
	Name          string  `json:"name"`
	Type          string  `json:"type"`
	BankProvider  string  `json:"bank_provider"`
	AccountNumber string  `json:"account_number"`
	Balance       float64 `json:"balance"`
	BalanceDate   string  `json:"balance_date"`
	Currency      string  `json:"currency"`
	Notes         string  `json:"notes"`
}

type AccountScanResponse struct {
	Engine             string                 `json:"engine"`
	ExtractionMethod   string                 `json:"extraction_method"`
	RawText            string                 `json:"raw_text"`
	ParsedAccount      *AccountScanParsedData `json:"parsed_account,omitempty"`
	MatchedAccountID   string                 `json:"matched_account_id,omitempty"`
	MatchedAccountName string                 `json:"matched_account_name,omitempty"`
	ConfidenceScores   map[string]float64     `json:"confidence_scores"`
	OverallConfidence  float64                `json:"overall_confidence"`
	NeedsReview        bool                   `json:"needs_review"`
	Warnings           []string               `json:"warnings"`
}
