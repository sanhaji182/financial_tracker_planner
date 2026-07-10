package model

import (
	"encoding/json"
	"time"
)

type Asset struct {
	ID              string          `json:"id" db:"id"`
	UserID          string          `json:"user_id" db:"user_id"`
	Name            string          `json:"name" db:"name"`
	Type            string          `json:"type" db:"type"` // savings, property, vehicle, investment, cash, e_wallet, deposit, other
	CurrentValue    float64         `json:"current_value" db:"current_value"`
	PurchaseValue   *float64        `json:"purchase_value,omitempty" db:"purchase_value"`
	PurchaseDate    *time.Time      `json:"purchase_date,omitempty" db:"purchase_date"`
	Currency        string          `json:"currency" db:"currency"`
	LinkedAccountID *string         `json:"linked_account_id,omitempty" db:"linked_account_id"`
	LinkedAccountName *string       `json:"linked_account_name,omitempty"` // join field
	IsShared        bool            `json:"is_shared" db:"is_shared"`
	IsLiquid        bool            `json:"is_liquid" db:"is_liquid"`
	Notes           *string         `json:"notes,omitempty" db:"notes"`
	Metadata        json.RawMessage `json:"metadata,omitempty" db:"metadata"` // jsonb type
	CreatedAt       time.Time       `json:"created_at" db:"created_at"`
	UpdatedAt       time.Time       `json:"updated_at" db:"updated_at"`
	DeletedAt       *time.Time      `json:"-" db:"deleted_at"`
}

type AssetValuation struct {
	ID            string    `json:"id" db:"id"`
	AssetID       string    `json:"asset_id" db:"asset_id"`
	Value         float64   `json:"value" db:"value"`
	ValuationDate time.Time `json:"valuation_date" db:"valuation_date"`
	Source        string    `json:"source" db:"source"` // manual, market, appraisal
	Notes         *string   `json:"notes,omitempty" db:"notes"`
	CreatedAt     time.Time `json:"created_at" db:"created_at"`
}

type AssetTypeSummary struct {
	Type  string  `json:"type"`
	Total float64 `json:"total"`
}

type AssetSummary struct {
	TotalAssets      float64            `json:"total_assets"`
	TotalLiquid      float64            `json:"total_liquid"`
	TotalShared      float64            `json:"total_shared"`
	TotalPrivate     float64            `json:"total_private"`
	BreakdownByType  []AssetTypeSummary `json:"breakdown_by_type"`
}
