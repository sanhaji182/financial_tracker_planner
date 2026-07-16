package kernel

import (
	"strings"
)

// ---- Household authorization matrix (authz-v1) ----

const AuthzMatrixVersion = "authz-v1"

// Roles
const (
	RoleOwner        = "owner"
	RoleSpouseViewer = "spouse_viewer"
)

// Resource classes for matrix checks.
const (
	ResAccount     = "account"
	ResTransaction = "transaction"
	ResAsset       = "asset"
	ResDebt        = "debt"
	ResDocument    = "document"
	ResVault       = "vault"
	ResBackup      = "backup"
	ResExport      = "export"
	ResAISettings  = "ai_settings"
	ResAIChat      = "ai_chat"
	ResDashboard   = "dashboard"
	ResForecast    = "forecast"
	ResGoal        = "goal"
	ResBill        = "bill"
	ResSharedView  = "shared_view"
	ResAudit       = "audit"
)

// Actions
const (
	ActRead   = "read"
	ActWrite  = "write"
	ActDelete = "delete"
	ActExport = "export"
	ActAdmin  = "admin"
)

// AuthzDecision is the result of a matrix lookup.
type AuthzDecision struct {
	Allowed        bool
	Reason         string
	RequiresShared bool // spouse may only see is_shared=true objects
	MatrixVersion  string
}

// HouseholdAuthz encodes deny-by-default role × resource × action.
// objectShared: for object-scoped reads, whether the resource is marked shared.
// ownerID/actorID: when actor is spouse, data must resolve to owner household.
func HouseholdAuthz(role, resource, action string, objectShared bool) AuthzDecision {
	role = strings.ToLower(strings.TrimSpace(role))
	resource = strings.ToLower(strings.TrimSpace(resource))
	action = strings.ToLower(strings.TrimSpace(action))
	v := AuthzMatrixVersion

	// Unknown role → deny
	if role != RoleOwner && role != RoleSpouseViewer {
		return AuthzDecision{Allowed: false, Reason: "unknown_role", MatrixVersion: v}
	}

	// Owner: full access on household resources
	if role == RoleOwner {
		return AuthzDecision{Allowed: true, Reason: "owner_full", MatrixVersion: v}
	}

	// spouse_viewer matrix (deny-by-default)
	switch resource {
	case ResDashboard, ResForecast, ResSharedView, ResBill, ResDebt, ResGoal, ResTransaction, ResAccount:
		if action == ActRead {
			// Object-level: private assets hidden unless shared — for generic list endpoints
			// RequiresShared signals service layer to filter is_shared / household scope.
			return AuthzDecision{Allowed: true, Reason: "spouse_read", RequiresShared: false, MatrixVersion: v}
		}
		return AuthzDecision{Allowed: false, Reason: "spouse_read_only", MatrixVersion: v}

	case ResAsset, ResDocument:
		if action == ActRead {
			if !objectShared {
				return AuthzDecision{Allowed: false, Reason: "private_object", RequiresShared: true, MatrixVersion: v}
			}
			return AuthzDecision{Allowed: true, Reason: "spouse_shared_read", RequiresShared: true, MatrixVersion: v}
		}
		return AuthzDecision{Allowed: false, Reason: "spouse_read_only", MatrixVersion: v}

	case ResVault, ResBackup, ResAISettings, ResAudit:
		// Never for spouse
		return AuthzDecision{Allowed: false, Reason: "spouse_denied_sensitive", MatrixVersion: v}

	case ResAIChat:
		// Chat allowed (handler already permits) but no settings admin
		if action == ActRead || action == ActWrite {
			return AuthzDecision{Allowed: true, Reason: "spouse_ai_chat", MatrixVersion: v}
		}
		return AuthzDecision{Allowed: false, Reason: "spouse_denied", MatrixVersion: v}

	case ResExport:
		// Export of household financials: deny spouse by default (PII / full ledger)
		return AuthzDecision{Allowed: false, Reason: "spouse_denied_export", MatrixVersion: v}

	default:
		return AuthzDecision{Allowed: false, Reason: "deny_by_default", MatrixVersion: v}
	}
}

// AuthzMatrixRows is a static documentation table for API consumers / methodology page.
type AuthzMatrixRow struct {
	Role     string `json:"role"`
	Resource string `json:"resource"`
	Action   string `json:"action"`
	Allowed  bool   `json:"allowed"`
	Notes    string `json:"notes"`
}

// BuildAuthzMatrix returns the documented endpoint-class matrix.
func BuildAuthzMatrix() []AuthzMatrixRow {
	resources := []string{
		ResDashboard, ResForecast, ResAccount, ResTransaction, ResDebt, ResBill, ResGoal,
		ResAsset, ResDocument, ResVault, ResBackup, ResExport, ResAISettings, ResAIChat, ResAudit, ResSharedView,
	}
	actions := []string{ActRead, ActWrite, ActDelete, ActExport}
	roles := []string{RoleOwner, RoleSpouseViewer}
	var rows []AuthzMatrixRow
	for _, role := range roles {
		for _, res := range resources {
			for _, act := range actions {
				// For matrix doc, assets/docs evaluated as shared=true for spouse read visibility note
				shared := res == ResAsset || res == ResDocument
				d := HouseholdAuthz(role, res, act, shared)
				note := d.Reason
				if d.RequiresShared {
					note += "; private objects filtered"
				}
				rows = append(rows, AuthzMatrixRow{
					Role: role, Resource: res, Action: act, Allowed: d.Allowed, Notes: note,
				})
			}
		}
	}
	return rows
}
