package handler

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/user/financial-os/internal/kernel"
	"github.com/user/financial-os/internal/middleware"
)

// GovernanceHandler exposes methodology + authorization matrix (read-only).
type GovernanceHandler struct{}

func NewGovernanceHandler() *GovernanceHandler { return &GovernanceHandler{} }

func (h *GovernanceHandler) RegisterRoutes(rg *gin.RouterGroup) {
	g := rg.Group("/governance")
	g.Use(middleware.AuthMiddleware())
	{
		g.GET("/health-score", h.HealthMethodology)
		g.GET("/authz-matrix", middleware.RoleMiddleware("owner"), h.AuthzMatrix)
		g.GET("/debt-engine", h.DebtMethodology)
		g.GET("/backup-dr", middleware.RoleMiddleware("owner"), h.BackupDR)
		g.GET("/goals-plan", h.GoalsPlanMethodology)
		g.GET("/protection", h.ProtectionMethodology)
		g.GET("/scenario-compare", h.ScenarioMethodology)
	}
}

func (h *GovernanceHandler) HealthMethodology(c *gin.Context) {
	res := kernel.ComputeHealthScore(kernel.HealthInputs{})
	c.JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"formula_version": res.FormulaVersion,
			"methodology":     res.Methodology,
			"disclaimer":      res.Disclaimer,
			"is_credit_score": false,
			"weights": gin.H{
				"dti":     kernel.HealthWeightDTI,
				"ef":      kernel.HealthWeightEF,
				"cash":    kernel.HealthWeightCash,
				"savings": kernel.HealthWeightSavings,
			},
			"recon_floor": kernel.HealthReconFloor,
			"note":        "Missing income excludes DTI pillar (no false healthy). Opt-out supported via HealthInputs.OptOut.",
		},
	})
}

func (h *GovernanceHandler) AuthzMatrix(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"version": kernel.AuthzMatrixVersion,
			"matrix":  kernel.BuildAuthzMatrix(),
			"roles":   []string{kernel.RoleOwner, kernel.RoleSpouseViewer},
			"policy":  "deny-by-default; object ownership checked server-side; spouse cannot access private asset/document/vault/backup/export/audit",
		},
	})
}

func (h *GovernanceHandler) DebtMethodology(c *gin.Context) {
	sim := kernel.SimulateAvalanche(nil, 0, time.Time{})
	c.JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"formula_version": sim.FormulaVersion,
			"assumptions":     sim.Assumptions,
			"is_estimate":     true,
		},
	})
}

func (h *GovernanceHandler) BackupDR(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"version":          kernel.BackupMetaVersion,
			"rpo":              kernel.BackupRPO.String(),
			"rto":              kernel.BackupRTO.String(),
			"retention_days":   kernel.BackupRetentionDays,
			"encryption":       "AES-256-GCM",
			"valid_only_after": "isolated restore rehearsal (POST /api/v1/backup/verify)",
			"checksum":         "sha256 ciphertext + plaintext in sidecar manifest",
			"job_lock_version": kernel.JobLockVersion,
		},
	})
}

func (h *GovernanceHandler) GoalsPlanMethodology(c *gin.Context) {
	plan := kernel.ComputeGoalPlan(kernel.GoalPlanInputs{})
	c.JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"formula_version": plan.FormulaVersion,
			"assumptions":     plan.Assumptions,
			"priority_order":  []string{"emergency_fund", "debt_payoff", "sinking_fund", "custom"},
			"note":            "GET /api/v1/goals/plan returns household allocation + conflicts",
		},
	})
}

func (h *GovernanceHandler) ProtectionMethodology(c *gin.Context) {
	res := kernel.ComputeProtectionAssessment(kernel.ProtectionInputs{})
	c.JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"formula_version":  res.FormulaVersion,
			"methodology":      res.Methodology,
			"disclaimer":       res.Disclaimer,
			"is_product_advice": false,
			"note":             "Needs-based educational estimate only; no insurer/product recommendation",
		},
	})
}

func (h *GovernanceHandler) ScenarioMethodology(c *gin.Context) {
	res := kernel.ComputeScenarioCompare(kernel.ScenarioCompareInputs{})
	c.JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"formula_version": res.FormulaVersion,
			"assumptions":     res.Assumptions,
			"metrics": []string{
				"ending_balance", "total_debts", "ef_coverage", "cash_runway",
				"debt_interest_cost", "goal_funding_gap", "goal_delay_months", "downside_runway",
			},
		},
	})
}
