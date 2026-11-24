package handler

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/middleware"
	"github.com/user/financial-os/internal/service"
)

var (
	errApprovalNotFound = errors.New("permintaan persetujuan tidak ditemukan")
	errApprovalResolved = errors.New("permintaan persetujuan sudah diproses sebelumnya")
)

type ApprovalSetting struct {
	HouseholdOwnerID string    `json:"household_owner_id"`
	ThresholdIDR     int64     `json:"threshold_idr"`
	UpdatedAt        time.Time `json:"updated_at"`
}

type TransactionApproval struct {
	ID               string     `json:"id"`
	HouseholdOwnerID string     `json:"household_owner_id"`
	RequestedBy      string     `json:"requested_by"`
	RequesterName    string     `json:"requester_name"`
	AccountID        string     `json:"account_id"`
	CategoryID       *string    `json:"category_id,omitempty"`
	TxType           string     `json:"tx_type"`
	Amount           int64      `json:"amount"`
	Date             string     `json:"date"`
	Description      string     `json:"description"`
	Notes            *string    `json:"notes,omitempty"`
	Status           string     `json:"status"` // pending | approved | rejected
	ReviewedBy       *string    `json:"reviewed_by,omitempty"`
	ReviewNote       *string    `json:"review_note,omitempty"`
	ReviewedAt       *time.Time `json:"reviewed_at,omitempty"`
	TransactionID    *string    `json:"transaction_id,omitempty"`
	CreatedAt        time.Time  `json:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at"`
}

type CreateApprovalRequest struct {
	AccountID   string  `json:"account_id" binding:"required"`
	CategoryID  *string `json:"category_id"`
	TxType      string  `json:"tx_type" binding:"omitempty,oneof=income expense transfer"`
	Amount      int64   `json:"amount" binding:"required,gt=0"`
	Date        string  `json:"date"`
	Description string  `json:"description" binding:"required"`
	Notes       *string `json:"notes"`
}

type ReviewApprovalRequest struct {
	ReviewNote string `json:"review_note"`
}

type UpdateApprovalSettingsRequest struct {
	ThresholdIDR int64 `json:"threshold_idr" binding:"min=0"`
}

type TransactionCreator func(ctx context.Context, ownerID string, req dto.CreateTransactionRequest) (*dto.TransactionResponse, error)

type ApprovalStore interface {
	GetSetting(ctx context.Context, ownerID string) (*ApprovalSetting, error)
	UpsertSetting(ctx context.Context, ownerID string, thresholdIDR int64) (*ApprovalSetting, error)
	ListApprovals(ctx context.Context, ownerID, status string) ([]TransactionApproval, error)
	GetApprovalByID(ctx context.Context, ownerID, approvalID string) (*TransactionApproval, error)
	CreateApproval(ctx context.Context, item *TransactionApproval) (*TransactionApproval, error)
	ResolveApproval(ctx context.Context, ownerID, approvalID, status, reviewedBy, reviewNote, transactionID string) (*TransactionApproval, error)
}

type PgApprovalStore struct {
	db *pgxpool.Pool
}

func NewPgApprovalStore(db *pgxpool.Pool) *PgApprovalStore {
	return &PgApprovalStore{db: db}
}

func (s *PgApprovalStore) GetSetting(ctx context.Context, ownerID string) (*ApprovalSetting, error) {
	var out ApprovalSetting
	err := s.db.QueryRow(ctx, `
		SELECT household_owner_id::text, threshold_idr, updated_at
		FROM household_approval_settings
		WHERE household_owner_id = $1
	`, ownerID).Scan(&out.HouseholdOwnerID, &out.ThresholdIDR, &out.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return &ApprovalSetting{
			HouseholdOwnerID: ownerID,
			ThresholdIDR:     0,
			UpdatedAt:        time.Now(),
		}, nil
	}
	if err != nil {
		return nil, err
	}
	return &out, nil
}

func (s *PgApprovalStore) UpsertSetting(ctx context.Context, ownerID string, thresholdIDR int64) (*ApprovalSetting, error) {
	var out ApprovalSetting
	err := s.db.QueryRow(ctx, `
		INSERT INTO household_approval_settings (household_owner_id, threshold_idr, updated_at)
		VALUES ($1, $2, NOW())
		ON CONFLICT (household_owner_id) DO UPDATE
		SET threshold_idr = EXCLUDED.threshold_idr,
		    updated_at = NOW()
		RETURNING household_owner_id::text, threshold_idr, updated_at
	`, ownerID, thresholdIDR).Scan(&out.HouseholdOwnerID, &out.ThresholdIDR, &out.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &out, nil
}

func (s *PgApprovalStore) ListApprovals(ctx context.Context, ownerID, status string) ([]TransactionApproval, error) {
	query := `
		SELECT id::text, household_owner_id::text, requested_by::text, requester_name,
		       account_id::text, category_id::text, tx_type, amount, TO_CHAR(date, 'YYYY-MM-DD'),
		       description, notes, status, reviewed_by::text, review_note, reviewed_at,
		       transaction_id::text, created_at, updated_at
		FROM transaction_approvals
		WHERE household_owner_id = $1
	`
	args := []interface{}{ownerID}
	if strings.TrimSpace(status) != "" {
		query += ` AND status = $2`
		args = append(args, strings.TrimSpace(status))
	}
	query += ` ORDER BY created_at DESC LIMIT 50`

	rows, err := s.db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := make([]TransactionApproval, 0)
	for rows.Next() {
		var item TransactionApproval
		if err := rows.Scan(
			&item.ID, &item.HouseholdOwnerID, &item.RequestedBy, &item.RequesterName,
			&item.AccountID, &item.CategoryID, &item.TxType, &item.Amount, &item.Date,
			&item.Description, &item.Notes, &item.Status, &item.ReviewedBy, &item.ReviewNote,
			&item.ReviewedAt, &item.TransactionID, &item.CreatedAt, &item.UpdatedAt,
		); err != nil {
			return nil, err
		}
		list = append(list, item)
	}
	return list, rows.Err()
}

func (s *PgApprovalStore) GetApprovalByID(ctx context.Context, ownerID, approvalID string) (*TransactionApproval, error) {
	var item TransactionApproval
	err := s.db.QueryRow(ctx, `
		SELECT id::text, household_owner_id::text, requested_by::text, requester_name,
		       account_id::text, category_id::text, tx_type, amount, TO_CHAR(date, 'YYYY-MM-DD'),
		       description, notes, status, reviewed_by::text, review_note, reviewed_at,
		       transaction_id::text, created_at, updated_at
		FROM transaction_approvals
		WHERE id = $1 AND household_owner_id = $2
	`, approvalID, ownerID).Scan(
		&item.ID, &item.HouseholdOwnerID, &item.RequestedBy, &item.RequesterName,
		&item.AccountID, &item.CategoryID, &item.TxType, &item.Amount, &item.Date,
		&item.Description, &item.Notes, &item.Status, &item.ReviewedBy, &item.ReviewNote,
		&item.ReviewedAt, &item.TransactionID, &item.CreatedAt, &item.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errApprovalNotFound
	}
	if err != nil {
		return nil, err
	}
	return &item, nil
}

func (s *PgApprovalStore) CreateApproval(ctx context.Context, item *TransactionApproval) (*TransactionApproval, error) {
	var saved TransactionApproval
	err := s.db.QueryRow(ctx, `
		INSERT INTO transaction_approvals (
			household_owner_id, requested_by, requester_name, account_id, category_id,
			tx_type, amount, date, description, notes, status
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date, $9, $10, 'pending')
		RETURNING id::text, household_owner_id::text, requested_by::text, requester_name,
		          account_id::text, category_id::text, tx_type, amount, TO_CHAR(date, 'YYYY-MM-DD'),
		          description, notes, status, reviewed_by::text, review_note, reviewed_at,
		          transaction_id::text, created_at, updated_at
	`,
		item.HouseholdOwnerID, item.RequestedBy, item.RequesterName,
		item.AccountID, item.CategoryID, item.TxType, item.Amount,
		item.Date, item.Description, item.Notes,
	).Scan(
		&saved.ID, &saved.HouseholdOwnerID, &saved.RequestedBy, &saved.RequesterName,
		&saved.AccountID, &saved.CategoryID, &saved.TxType, &saved.Amount, &saved.Date,
		&saved.Description, &saved.Notes, &saved.Status, &saved.ReviewedBy, &saved.ReviewNote,
		&saved.ReviewedAt, &saved.TransactionID, &saved.CreatedAt, &saved.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &saved, nil
}

func (s *PgApprovalStore) ResolveApproval(
	ctx context.Context, ownerID, approvalID, status, reviewedBy, reviewNote, transactionID string,
) (*TransactionApproval, error) {
	var txIDPtr *string
	if strings.TrimSpace(transactionID) != "" {
		txIDPtr = &transactionID
	}
	var notePtr *string
	if strings.TrimSpace(reviewNote) != "" {
		notePtr = &reviewNote
	}

	var updated TransactionApproval
	err := s.db.QueryRow(ctx, `
		UPDATE transaction_approvals
		SET status = $3,
		    reviewed_by = $4,
		    review_note = $5,
		    transaction_id = $6,
		    reviewed_at = NOW(),
		    updated_at = NOW()
		WHERE id = $1 AND household_owner_id = $2 AND status = 'pending'
		RETURNING id::text, household_owner_id::text, requested_by::text, requester_name,
		          account_id::text, category_id::text, tx_type, amount, TO_CHAR(date, 'YYYY-MM-DD'),
		          description, notes, status, reviewed_by::text, review_note, reviewed_at,
		          transaction_id::text, created_at, updated_at
	`, approvalID, ownerID, status, reviewedBy, notePtr, txIDPtr).Scan(
		&updated.ID, &updated.HouseholdOwnerID, &updated.RequestedBy, &updated.RequesterName,
		&updated.AccountID, &updated.CategoryID, &updated.TxType, &updated.Amount, &updated.Date,
		&updated.Description, &updated.Notes, &updated.Status, &updated.ReviewedBy, &updated.ReviewNote,
		&updated.ReviewedAt, &updated.TransactionID, &updated.CreatedAt, &updated.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errApprovalResolved
	}
	if err != nil {
		return nil, err
	}
	return &updated, nil
}

// MemoryApprovalStore implements ApprovalStore in memory for deterministic unit testing.
type MemoryApprovalStore struct {
	mu        sync.RWMutex
	settings  map[string]*ApprovalSetting
	approvals map[string]*TransactionApproval
}

func NewMemoryApprovalStore() *MemoryApprovalStore {
	return &MemoryApprovalStore{
		settings:  make(map[string]*ApprovalSetting),
		approvals: make(map[string]*TransactionApproval),
	}
}

func (m *MemoryApprovalStore) GetSetting(_ context.Context, ownerID string) (*ApprovalSetting, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if s, ok := m.settings[ownerID]; ok {
		cp := *s
		return &cp, nil
	}
	return &ApprovalSetting{HouseholdOwnerID: ownerID, ThresholdIDR: 0, UpdatedAt: time.Now()}, nil
}

func (m *MemoryApprovalStore) UpsertSetting(_ context.Context, ownerID string, thresholdIDR int64) (*ApprovalSetting, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s := &ApprovalSetting{
		HouseholdOwnerID: ownerID,
		ThresholdIDR:     thresholdIDR,
		UpdatedAt:        time.Now(),
	}
	m.settings[ownerID] = s
	cp := *s
	return &cp, nil
}

func (m *MemoryApprovalStore) ListApprovals(_ context.Context, ownerID, status string) ([]TransactionApproval, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	list := make([]TransactionApproval, 0)
	for _, item := range m.approvals {
		if item.HouseholdOwnerID != ownerID {
			continue
		}
		if status != "" && item.Status != status {
			continue
		}
		list = append(list, *item)
	}
	sort.Slice(list, func(i, j int) bool {
		return list[i].CreatedAt.After(list[j].CreatedAt)
	})
	return list, nil
}

func (m *MemoryApprovalStore) GetApprovalByID(_ context.Context, ownerID, approvalID string) (*TransactionApproval, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	item, ok := m.approvals[approvalID]
	if !ok || item.HouseholdOwnerID != ownerID {
		return nil, errApprovalNotFound
	}
	cp := *item
	return &cp, nil
}

func (m *MemoryApprovalStore) CreateApproval(_ context.Context, item *TransactionApproval) (*TransactionApproval, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now()
	cp := *item
	cp.ID = uuid.NewString()
	cp.Status = "pending"
	cp.CreatedAt = now
	cp.UpdatedAt = now
	m.approvals[cp.ID] = &cp
	out := cp
	return &out, nil
}

func (m *MemoryApprovalStore) ResolveApproval(
	_ context.Context, ownerID, approvalID, status, reviewedBy, reviewNote, transactionID string,
) (*TransactionApproval, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	item, ok := m.approvals[approvalID]
	if !ok || item.HouseholdOwnerID != ownerID {
		return nil, errApprovalNotFound
	}
	if item.Status != "pending" {
		return nil, errApprovalResolved
	}
	now := time.Now()
	item.Status = status
	item.ReviewedBy = &reviewedBy
	if reviewNote != "" {
		item.ReviewNote = &reviewNote
	}
	if transactionID != "" {
		item.TransactionID = &transactionID
	}
	item.ReviewedAt = &now
	item.UpdatedAt = now
	out := *item
	return &out, nil
}

type ApprovalHandler struct {
	store             ApprovalStore
	householdResolver HouseholdOwnerResolver
	accountService    service.AccountService
	categoryService   service.CategoryService
	txCreator         TransactionCreator
	telegram          service.TelegramService
}

func NewApprovalHandler(
	store ApprovalStore,
	resolver HouseholdOwnerResolver,
	accountService service.AccountService,
	categoryService service.CategoryService,
	txCreator TransactionCreator,
) *ApprovalHandler {
	return &ApprovalHandler{
		store:             store,
		householdResolver: resolver,
		accountService:    accountService,
		categoryService:   categoryService,
		txCreator:         txCreator,
	}
}

func (h *ApprovalHandler) WithTelegram(telegram service.TelegramService) *ApprovalHandler {
	h.telegram = telegram
	return h
}

func (h *ApprovalHandler) RegisterRoutes(rg *gin.RouterGroup) {
	grp := rg.Group("/approvals")
	grp.Use(middleware.AuthMiddleware())
	{
		grp.GET("/settings", middleware.RoleMiddleware("owner", "spouse_co_owner", "spouse_viewer"), h.GetSettings)
		grp.PUT("/settings", middleware.RoleMiddleware("owner"), h.UpdateSettings)
		grp.GET("", middleware.RoleMiddleware("owner", "spouse_co_owner", "spouse_viewer"), h.List)
		grp.POST("", middleware.RoleMiddleware("owner", "spouse_co_owner"), h.Create)
		grp.POST("/:id/approve", middleware.RoleMiddleware("owner", "spouse_co_owner"), h.Approve)
		grp.POST("/:id/reject", middleware.RoleMiddleware("owner", "spouse_co_owner"), h.Reject)
	}
}

func (h *ApprovalHandler) resolveHouseholdOwner(c *gin.Context) (string, string, string, bool) {
	userID := c.GetString("user_id")
	role := c.GetString("role")
	if role != "spouse_co_owner" && role != "spouse_viewer" {
		return userID, userID, role, true
	}
	if h.householdResolver == nil {
		return userID, userID, role, true
	}
	ownerID, err := h.householdResolver(c.Request.Context(), userID, role)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{
			"error": gin.H{"code": "FORBIDDEN", "message": err.Error()},
		})
		return "", userID, role, false
	}
	return ownerID, userID, role, true
}

func (h *ApprovalHandler) GetSettings(c *gin.Context) {
	ownerID, _, _, ok := h.resolveHouseholdOwner(c)
	if !ok {
		return
	}
	setting, err := h.store.GetSetting(c.Request.Context(), ownerID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()}})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": setting})
}

func (h *ApprovalHandler) UpdateSettings(c *gin.Context) {
	ownerID := c.GetString("user_id")
	var req UpdateApprovalSettingsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": gin.H{"code": "BAD_REQUEST", "message": err.Error()}})
		return
	}
	setting, err := h.store.UpsertSetting(c.Request.Context(), ownerID, req.ThresholdIDR)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()}})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": setting})
}

func (h *ApprovalHandler) List(c *gin.Context) {
	ownerID, _, _, ok := h.resolveHouseholdOwner(c)
	if !ok {
		return
	}
	status := c.Query("status")
	items, err := h.store.ListApprovals(c.Request.Context(), ownerID, status)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()}})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": items})
}

func (h *ApprovalHandler) Create(c *gin.Context) {
	ownerID, userID, role, ok := h.resolveHouseholdOwner(c)
	if !ok {
		return
	}

	var req CreateApprovalRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": gin.H{"code": "BAD_REQUEST", "message": err.Error()}})
		return
	}

	if h.accountService != nil {
		acc, err := h.accountService.GetAccountByID(c.Request.Context(), req.AccountID, ownerID)
		if err != nil {
			c.JSON(http.StatusForbidden, gin.H{
				"error": gin.H{"code": "FORBIDDEN", "message": "Rekening tidak ditemukan di keluarga ini"},
			})
			return
		}
		if role == "spouse_co_owner" && !acc.IsShared {
			c.JSON(http.StatusForbidden, gin.H{
				"error": gin.H{"code": "FORBIDDEN", "message": "Co-owner hanya dapat mengajukan transaksi pada rekening bersama"},
			})
			return
		}
	}

	txType := req.TxType
	if txType == "" {
		txType = "expense"
	}
	dateStr := strings.TrimSpace(req.Date)
	if dateStr == "" {
		dateStr = time.Now().Format("2006-01-02")
	}

	requesterName := c.GetString("email")
	if requesterName == "" {
		requesterName = role
	}

	saved, err := h.store.CreateApproval(c.Request.Context(), &TransactionApproval{
		HouseholdOwnerID: ownerID,
		RequestedBy:      userID,
		RequesterName:    requesterName,
		AccountID:        req.AccountID,
		CategoryID:       req.CategoryID,
		TxType:           txType,
		Amount:           req.Amount,
		Date:             dateStr,
		Description:      strings.TrimSpace(req.Description),
		Notes:            req.Notes,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()}})
		return
	}

	if h.telegram != nil {
		_ = h.telegram.SendMessage(
			"Permintaan Persetujuan Pengeluaran Bersama",
			fmt.Sprintf("%s mengajukan transaksi \"%s\" sebesar %s.", requesterName, saved.Description, dto.FormatRupiah(float64(saved.Amount))),
			"Buka aplikasi Keuangan Bersama untuk menyetujui atau menolak.",
		)
	}

	c.JSON(http.StatusCreated, gin.H{"data": saved})
}

func (h *ApprovalHandler) Approve(c *gin.Context) {
	ownerID, userID, role, ok := h.resolveHouseholdOwner(c)
	if !ok {
		return
	}
	approvalID := c.Param("id")
	var req ReviewApprovalRequest
	_ = c.ShouldBindJSON(&req)

	item, err := h.store.GetApprovalByID(c.Request.Context(), ownerID, approvalID)
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, errApprovalNotFound) {
			status = http.StatusNotFound
		}
		c.JSON(status, gin.H{"error": gin.H{"code": "APPROVAL_ERROR", "message": err.Error()}})
		return
	}
	if item.Status != "pending" {
		c.JSON(http.StatusConflict, gin.H{"error": gin.H{"code": "ALREADY_RESOLVED", "message": errApprovalResolved.Error()}})
		return
	}
	if role == "spouse_co_owner" && item.RequestedBy == userID {
		c.JSON(http.StatusForbidden, gin.H{
			"error": gin.H{"code": "FORBIDDEN", "message": "Pengaju tidak dapat menyetujui permintaannya sendiri"},
		})
		return
	}

	txID := ""
	if h.txCreator != nil {
		parsedDate, parseErr := time.Parse("2006-01-02", item.Date)
		if parseErr != nil {
			parsedDate = time.Now()
		}
		catID := item.CategoryID
		if (catID == nil || *catID == "") && h.categoryService != nil && item.TxType != "transfer" {
			if cats, catErr := h.categoryService.GetCategories(c.Request.Context(), ownerID); catErr == nil {
				for _, cat := range cats {
					if cat.Type == item.TxType {
						idCopy := cat.ID
						catID = &idCopy
						break
					}
				}
			}
		}
		desc := item.Description
		createdTx, txErr := h.txCreator(c.Request.Context(), ownerID, dto.CreateTransactionRequest{
			Date:        parsedDate,
			Amount:      float64(item.Amount),
			Type:        item.TxType,
			AccountID:   item.AccountID,
			CategoryID:  catID,
			Description: &desc,
			Notes:       item.Notes,
		})
		if txErr != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": gin.H{"code": "TRANSACTION_CREATE_FAILED", "message": txErr.Error()},
			})
			return
		}
		if createdTx != nil {
			txID = createdTx.ID
		}
	}

	updated, err := h.store.ResolveApproval(c.Request.Context(), ownerID, approvalID, "approved", userID, req.ReviewNote, txID)
	if err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": gin.H{"code": "CONFLICT", "message": err.Error()}})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": updated})
}

func (h *ApprovalHandler) Reject(c *gin.Context) {
	ownerID, userID, _, ok := h.resolveHouseholdOwner(c)
	if !ok {
		return
	}
	approvalID := c.Param("id")
	var req ReviewApprovalRequest
	_ = c.ShouldBindJSON(&req)

	item, err := h.store.GetApprovalByID(c.Request.Context(), ownerID, approvalID)
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, errApprovalNotFound) {
			status = http.StatusNotFound
		}
		c.JSON(status, gin.H{"error": gin.H{"code": "APPROVAL_ERROR", "message": err.Error()}})
		return
	}
	if item.Status != "pending" {
		c.JSON(http.StatusConflict, gin.H{"error": gin.H{"code": "ALREADY_RESOLVED", "message": errApprovalResolved.Error()}})
		return
	}

	updated, err := h.store.ResolveApproval(c.Request.Context(), ownerID, approvalID, "rejected", userID, req.ReviewNote, "")
	if err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": gin.H{"code": "CONFLICT", "message": err.Error()}})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": updated})
}
