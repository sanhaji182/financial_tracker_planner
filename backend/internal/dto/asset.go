package dto

import (
	"encoding/json"
	"time"

	"github.com/user/financial-os/internal/model"
)

type CreateAssetRequest struct {
	Name            string          `json:"name" binding:"required"`
	Type            string          `json:"type" binding:"required,oneof=savings property vehicle investment cash e_wallet deposit other"`
	CurrentValue    float64         `json:"current_value" binding:"gte=0"`
	PurchaseValue   *float64        `json:"purchase_value"`
	PurchaseDate    *time.Time      `json:"purchase_date"`
	LinkedAccountID *string         `json:"linked_account_id"`
	IsShared        bool            `json:"is_shared"`
	IsLiquid        bool            `json:"is_liquid"`
	Notes           *string         `json:"notes"`
	Currency        string          `json:"currency"`
	Metadata        json.RawMessage `json:"metadata"`
}

type UpdateAssetRequest struct {
	Name          string          `json:"name" binding:"required"`
	CurrentValue  float64         `json:"current_value" binding:"gte=0"`
	PurchaseValue *float64        `json:"purchase_value"`
	PurchaseDate  *time.Time      `json:"purchase_date"`
	IsShared      bool            `json:"is_shared"`
	IsLiquid      bool            `json:"is_liquid"`
	Notes         *string         `json:"notes"`
	Currency      string          `json:"currency"`
	Metadata      json.RawMessage `json:"metadata"`
}

type CreateValuationRequest struct {
	Value         float64   `json:"value" binding:"gte=0"`
	ValuationDate time.Time `json:"valuation_date" binding:"required"`
	Source        string    `json:"source" binding:"required,oneof=manual market appraisal"`
	Notes         *string   `json:"notes"`
}

type AssetResponse struct {
	ID                string            `json:"id"`
	UserID            string            `json:"user_id"`
	Name              string            `json:"name"`
	Type              string            `json:"type"`
	CurrentValue      float64           `json:"current_value"`
	FormattedValue    string            `json:"formatted_value"`
	PurchaseValue     *float64          `json:"purchase_value,omitempty"`
	FormattedPurchase *string           `json:"formatted_purchase,omitempty"`
	PurchaseDate      *time.Time        `json:"purchase_date,omitempty"`
	Currency          string            `json:"currency"`
	LinkedAccountID   *string           `json:"linked_account_id,omitempty"`
	LinkedAccountName *string           `json:"linked_account_name,omitempty"`
	IsShared          bool              `json:"is_shared"`
	IsLiquid          bool              `json:"is_liquid"`
	Notes             *string           `json:"notes,omitempty"`
	Metadata          json.RawMessage   `json:"metadata,omitempty"`
	CreatedAt         time.Time         `json:"created_at"`
	UpdatedAt         time.Time         `json:"updated_at"`
	Valuations        []ValuationResponse `json:"valuations,omitempty"`
}

type ValuationResponse struct {
	ID            string    `json:"id"`
	AssetID       string    `json:"asset_id"`
	Value         float64   `json:"value"`
	FormattedValue string   `json:"formatted_value"`
	ValuationDate time.Time `json:"valuation_date"`
	Source        string    `json:"source"`
	Notes         *string   `json:"notes,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
}

type AssetTypeSummaryResponse struct {
	Type           string  `json:"type"`
	Total          float64 `json:"total"`
	FormattedTotal string  `json:"formatted_total"`
}

type AssetSummaryResponse struct {
	TotalAssets          float64                    `json:"total_assets"`
	FormattedTotalAssets string                     `json:"formatted_total_assets"`
	TotalLiquid          float64                    `json:"total_liquid"`
	FormattedTotalLiquid string                     `json:"formatted_total_liquid"`
	TotalShared          float64                    `json:"total_shared"`
	FormattedTotalShared string                     `json:"formatted_total_shared"`
	TotalPrivate         float64                    `json:"total_private"`
	FormattedTotalPrivate string                     `json:"formatted_total_private"`
	BreakdownByType      []AssetTypeSummaryResponse `json:"breakdown_by_type"`
}

func ToAssetResponse(a *model.Asset, valuations []model.AssetValuation) AssetResponse {
	var valResponses []ValuationResponse
	for _, val := range valuations {
		valResponses = append(valResponses, ValuationResponse{
			ID:             val.ID,
			AssetID:        val.AssetID,
			Value:          val.Value,
			FormattedValue: FormatRupiah(val.Value),
			ValuationDate:  val.ValuationDate,
			Source:         val.Source,
			Notes:          val.Notes,
			CreatedAt:      val.CreatedAt,
		})
	}

	var fmtPurchase *string
	if a.PurchaseValue != nil {
		str := FormatRupiah(*a.PurchaseValue)
		fmtPurchase = &str
	}

	return AssetResponse{
		ID:                a.ID,
		UserID:            a.UserID,
		Name:              a.Name,
		Type:              a.Type,
		CurrentValue:      a.CurrentValue,
		FormattedValue:    FormatRupiah(a.CurrentValue),
		PurchaseValue:     a.PurchaseValue,
		FormattedPurchase: fmtPurchase,
		PurchaseDate:      a.PurchaseDate,
		Currency:          a.Currency,
		LinkedAccountID:   a.LinkedAccountID,
		LinkedAccountName: a.LinkedAccountName,
		IsShared:          a.IsShared,
		IsLiquid:          a.IsLiquid,
		Notes:             a.Notes,
		Metadata:          a.Metadata,
		CreatedAt:         a.CreatedAt,
		UpdatedAt:         a.UpdatedAt,
		Valuations:        valResponses,
	}
}

func ToAssetSummaryResponse(s *model.AssetSummary) AssetSummaryResponse {
	var breakdown []AssetTypeSummaryResponse
	for _, b := range s.BreakdownByType {
		breakdown = append(breakdown, AssetTypeSummaryResponse{
			Type:           b.Type,
			Total:          b.Total,
			FormattedTotal: FormatRupiah(b.Total),
		})
	}

	return AssetSummaryResponse{
		TotalAssets:            s.TotalAssets,
		FormattedTotalAssets:   FormatRupiah(s.TotalAssets),
		TotalLiquid:            s.TotalLiquid,
		FormattedTotalLiquid:   FormatRupiah(s.TotalLiquid),
		TotalShared:            s.TotalShared,
		FormattedTotalShared:   FormatRupiah(s.TotalShared),
		TotalPrivate:           s.TotalPrivate,
		FormattedTotalPrivate:   FormatRupiah(s.TotalPrivate),
		BreakdownByType:        breakdown,
	}
}
