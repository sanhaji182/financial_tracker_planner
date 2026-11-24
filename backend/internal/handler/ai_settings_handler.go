package handler

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/middleware"
	"github.com/user/financial-os/internal/service"
)

type AISettingsHandler struct {
	aiService         service.AISettingsService
	dashboardService  service.DashboardService
	efService         service.EFService
	budgetService     service.BudgetService
	auditService      service.AuditService
	accountService    service.AccountService
	categoryService   service.CategoryService
	householdResolver HouseholdOwnerResolver
}

func NewAISettingsHandler(
	aiService service.AISettingsService,
	dashboardService service.DashboardService,
	efService service.EFService,
	budgetService service.BudgetService,
	auditService service.AuditService,
) *AISettingsHandler {
	return &AISettingsHandler{
		aiService:        aiService,
		dashboardService: dashboardService,
		efService:        efService,
		budgetService:    budgetService,
		auditService:     auditService,
	}
}

// WithCatalogServices wires account & category services so Cloud AI Advisor can generate executable AgenticAction proposals.
func (h *AISettingsHandler) WithCatalogServices(
	accountService service.AccountService,
	categoryService service.CategoryService,
) *AISettingsHandler {
	h.accountService = accountService
	h.categoryService = categoryService
	return h
}

// WithHouseholdResolver maps spouse accounts to their household owner for shared AI advisor & voice notes.
func (h *AISettingsHandler) WithHouseholdResolver(resolver HouseholdOwnerResolver) *AISettingsHandler {
	h.householdResolver = resolver
	return h
}

func (h *AISettingsHandler) resolveHouseholdOwner(c *gin.Context) (string, bool, bool) {
	userID := c.GetString("user_id")
	role := c.GetString("role")
	if role != "spouse_co_owner" && role != "spouse_viewer" {
		return userID, false, true
	}
	if h.householdResolver == nil {
		return userID, true, true
	}
	ownerID, err := h.householdResolver(c.Request.Context(), userID, role)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{
			"error": gin.H{
				"code":    "FORBIDDEN",
				"message": err.Error(),
			},
		})
		return "", true, false
	}
	return ownerID, true, true
}

func (h *AISettingsHandler) RegisterRoutes(rg *gin.RouterGroup) {
	aiGroup := rg.Group("/settings/ai")
	aiGroup.Use(middleware.AuthMiddleware())
	{
		// Only owner can view or edit AI settings
		aiGroup.GET("", middleware.RoleMiddleware("owner"), h.GetSettings)
		aiGroup.PUT("", middleware.RoleMiddleware("owner"), h.UpdateSettings)
	}

	chatGroup := rg.Group("/ai")
	chatGroup.Use(middleware.AuthMiddleware())
	{
		// Owner and spouse roles can chat with advisor
		chatGroup.POST("/chat", middleware.RoleMiddleware("owner", "spouse_viewer", "spouse_co_owner"), h.Chat)
		chatGroup.POST("/chat/stream", middleware.RoleMiddleware("owner", "spouse_viewer", "spouse_co_owner"), h.ChatStream)
		chatGroup.POST("/voice-note", middleware.RoleMiddleware("owner", "spouse_co_owner"), h.VoiceNote)
		// Only owner can trigger manual anomaly detection
		chatGroup.POST("/detect-anomaly", middleware.RoleMiddleware("owner"), h.DetectAnomaly)
	}
}

func (h *AISettingsHandler) GetSettings(c *gin.Context) {
	userID := c.GetString("user_id")

	res, err := h.aiService.GetSettings(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{
				"code":    "INTERNAL_SERVER_ERROR",
				"message": err.Error(),
			},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"data": res,
	})
}

func (h *AISettingsHandler) UpdateSettings(c *gin.Context) {
	userID := c.GetString("user_id")

	var req dto.UpdateAISettingsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{
				"code":    "BAD_REQUEST",
				"message": err.Error(),
			},
		})
		return
	}

	// Fetch old settings for audit log
	oldSettings, _ := h.aiService.GetSettings(c.Request.Context(), userID)

	err := h.aiService.UpdateSettings(c.Request.Context(), userID, &req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{
				"code":    "INTERNAL_SERVER_ERROR",
				"message": err.Error(),
			},
		})
		return
	}

	// Create audit log
	ip := c.ClientIP()
	ua := c.Request.UserAgent()
	_ = h.auditService.CreateAuditLog(
		c.Request.Context(),
		userID,
		"ai_settings",
		userID,
		"update",
		oldSettings,
		req,
		&ip,
		&ua,
	)

	c.JSON(http.StatusOK, gin.H{
		"message": "AI settings updated successfully",
	})
}

func (h *AISettingsHandler) buildCatalogContext(ctx context.Context, ownerID string, sharedOnly bool) ([]map[string]interface{}, []map[string]interface{}) {
	var accountCatalog []map[string]interface{}
	if h.accountService != nil {
		if accs, accErr := h.accountService.GetAccounts(ctx, ownerID); accErr == nil {
			for _, a := range accs {
				if !a.IsActive {
					continue
				}
				if sharedOnly && !a.IsShared {
					continue
				}
				entry := map[string]interface{}{
					"id":        a.ID,
					"name":      a.Name,
					"type":      a.Type,
					"is_active": a.IsActive,
				}
				if a.BankProvider != nil {
					entry["bank_provider"] = *a.BankProvider
				}
				accountCatalog = append(accountCatalog, entry)
			}
		}
	}

	var categoryCatalog []map[string]interface{}
	if h.categoryService != nil {
		if cats, catErr := h.categoryService.GetCategories(ctx, ownerID); catErr == nil {
			for _, c := range cats {
				categoryCatalog = append(categoryCatalog, map[string]interface{}{
					"id":   c.ID,
					"name": c.Name,
					"type": c.Type,
				})
			}
		}
	}
	return accountCatalog, categoryCatalog
}

func (h *AISettingsHandler) buildChatWorkerContext(ctx context.Context, ownerID string, sharedOnly bool) (map[string]interface{}, error) {
	dashboard, err := h.dashboardService.GetDashboardData(ctx, ownerID)
	if err != nil {
		return nil, err
	}

	efSummary, _ := h.efService.GetEFSummary(ctx, ownerID)
	currentMonth := time.Now().Format("2006-01")
	budgetSummary, _ := h.budgetService.GetBudgetSummary(ctx, ownerID, currentMonth)
	accountCatalog, categoryCatalog := h.buildCatalogContext(ctx, ownerID, sharedOnly)

	return map[string]interface{}{
		"dashboard":      dashboard,
		"emergency_fund": efSummary,
		"budget":         budgetSummary,
		"accounts":       accountCatalog,
		"categories":     categoryCatalog,
		"financial_guidance_policy": map[string]interface{}{
			"purpose":      "education_and_decision_support_only",
			"must_explain": []string{"data_used", "assumptions", "missing_data", "confidence", "alternatives"},
			"must_not":     []string{"guarantee_returns", "recommend_specific_security", "claim_safety_from_incomplete_data"},
			"disclaimer":   "Bukan nasihat investasi personal teregulasi; verifikasi keputusan material dengan profesional berizin.",
		},
	}, nil
}

func (h *AISettingsHandler) Chat(c *gin.Context) {
	ownerID, isSpouse, ok := h.resolveHouseholdOwner(c)
	if !ok {
		return
	}

	var req dto.AIChatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{
				"code":    "BAD_REQUEST",
				"message": err.Error(),
			},
		})
		return
	}

	ctx := c.Request.Context()
	workerContext, err := h.buildChatWorkerContext(ctx, ownerID, isSpouse)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{
				"code":    "INTERNAL_SERVER_ERROR",
				"message": "Failed to fetch dashboard data: " + err.Error(),
			},
		})
		return
	}

	workerPayload := map[string]interface{}{
		"message": req.Message,
		"context": workerContext,
		"history": req.History,
	}

	var workerResp dto.AIChatResponse
	err = h.aiService.CallWorkerAI(ctx, ownerID, "/ai/chat", workerPayload, &workerResp)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{
				"code":    "INTERNAL_SERVER_ERROR",
				"message": err.Error(),
			},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"data": workerResp,
	})
}

func (h *AISettingsHandler) ChatStream(c *gin.Context) {
	ownerID, isSpouse, ok := h.resolveHouseholdOwner(c)
	if !ok {
		return
	}

	var req dto.AIChatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{"code": "BAD_REQUEST", "message": err.Error()},
		})
		return
	}

	ctx := c.Request.Context()
	workerContext, err := h.buildChatWorkerContext(ctx, ownerID, isSpouse)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()},
		})
		return
	}

	workerPayload := map[string]interface{}{
		"message": req.Message,
		"context": workerContext,
		"history": req.History,
	}

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")

	if err := h.aiService.StreamWorkerAI(ctx, ownerID, "/ai/chat/stream", workerPayload, c.Writer); err != nil {
		errPayload, _ := json.Marshal(map[string]string{"type": "error", "message": err.Error()})
		_, _ = c.Writer.Write([]byte("data: " + string(errPayload) + "\n\n"))
		c.Writer.Flush()
	}
}

func (h *AISettingsHandler) VoiceNote(c *gin.Context) {
	ownerID, isSpouse, ok := h.resolveHouseholdOwner(c)
	if !ok {
		return
	}

	fileHeader, err := c.FormFile("audio")
	if err != nil {
		fileHeader, err = c.FormFile("file")
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": gin.H{"code": "BAD_REQUEST", "message": "File audio voice note wajib dilampirkan"},
			})
			return
		}
	}

	if fileHeader.Size > 10*1024*1024 {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{
			"error": gin.H{"code": "FILE_TOO_LARGE", "message": "Ukuran audio maksimal 10MB"},
		})
		return
	}

	f, err := fileHeader.Open()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{"code": "BAD_REQUEST", "message": "Gagal membaca file audio"},
		})
		return
	}
	defer f.Close()

	audioBytes, err := io.ReadAll(io.LimitReader(f, 10*1024*1024+1))
	if err != nil || len(audioBytes) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{"code": "BAD_REQUEST", "message": "File audio kosong atau rusak"},
		})
		return
	}

	ctx := c.Request.Context()
	accountCatalog, categoryCatalog := h.buildCatalogContext(ctx, ownerID, isSpouse)
	ctxJSON, _ := json.Marshal(map[string]interface{}{
		"accounts":   accountCatalog,
		"categories": categoryCatalog,
	})

	mimeType := fileHeader.Header.Get("Content-Type")
	if mimeType == "" {
		mimeType = "audio/webm"
	}

	res, err := h.aiService.TranscribeVoiceWorker(
		ctx,
		ownerID,
		audioBytes,
		fileHeader.Filename,
		mimeType,
		string(ctxJSON),
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"data": res,
	})
}

func (h *AISettingsHandler) DetectAnomaly(c *gin.Context) {
	userID := c.GetString("user_id")

	res, err := h.aiService.DetectAnomalies(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{
				"code":    "INTERNAL_SERVER_ERROR",
				"message": err.Error(),
			},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"data": res,
	})
}
