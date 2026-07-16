package handler

import (
	"errors"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"

	"github.com/user/financial-os/internal/middleware"
	"github.com/user/financial-os/internal/service"
)

type BackupHandler struct {
	backupService service.BackupService
	dbPool        *pgxpool.Pool
}

func NewBackupHandler(backupService service.BackupService, dbPool *pgxpool.Pool) *BackupHandler {
	return &BackupHandler{
		backupService: backupService,
		dbPool:        dbPool,
	}
}

func (h *BackupHandler) RegisterRoutes(rg *gin.RouterGroup) {
	group := rg.Group("/backup")
	group.Use(middleware.AuthMiddleware(), middleware.RoleMiddleware("owner"))
	{
		group.POST("/create", h.CreateBackup)
		group.GET("/list", h.ListBackups)
		group.POST("/restore", h.RestoreBackup)
		group.POST("/verify", h.VerifyBackup)
		group.GET("/download/:filename", h.DownloadBackupFile)
	}
}

func (h *BackupHandler) CreateBackup(c *gin.Context) {
	resp, err := h.backupService.CreateBackup(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()},
		})
		return
	}

	// Trigger Audit Trail Log for creating backup
	userID := c.GetString("user_id")
	_, _ = h.dbPool.Exec(c.Request.Context(), `
		INSERT INTO audit_logs (user_id, entity_type, action, new_value)
		VALUES ($1, 'backup', 'create', $2)
	`, userID, resp)

	c.JSON(http.StatusCreated, resp)
}

func (h *BackupHandler) ListBackups(c *gin.Context) {
	resp, err := h.backupService.ListBackups(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()},
		})
		return
	}

	c.JSON(http.StatusOK, resp)
}

type RestoreRequest struct {
	FileName string `json:"file_name" binding:"required"`
	Password string `json:"password" binding:"required"`
}

func (h *BackupHandler) RestoreBackup(c *gin.Context) {
	userID := c.GetString("user_id")

	var req RestoreRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{"code": "BAD_REQUEST", "message": err.Error()},
		})
		return
	}

	// Double Confirmation: Verify owner's password for re-auth
	var passwordHash string
	err := h.dbPool.QueryRow(c.Request.Context(), `
		SELECT password_hash FROM users WHERE id = $1 AND is_active = true
	`, userID).Scan(&passwordHash)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": "Failed to fetch user credentials"},
		})
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(req.Password)); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": gin.H{"code": "UNAUTHORIZED", "message": "Password salah. Proses restore dibatalkan."},
		})
		return
	}

	// Execute Restore
	err = h.backupService.RestoreBackup(c.Request.Context(), req.FileName)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()},
		})
		return
	}

	// Trigger Audit Trail Log for restore backup
	_, _ = h.dbPool.Exec(c.Request.Context(), `
		INSERT INTO audit_logs (user_id, entity_type, action, new_value)
		VALUES ($1, 'backup', 'restore', $2)
	`, userID, req.FileName)

	c.JSON(http.StatusOK, gin.H{"message": "Database successfully restored to snapshot"})
}

func (h *BackupHandler) DownloadBackupFile(c *gin.Context) {
	fileName := c.Param("filename")
	filePath := h.backupService.GetBackupFilePath(fileName)

	if _, err := os.Stat(filePath); errors.Is(err, os.ErrNotExist) {
		c.JSON(http.StatusNotFound, gin.H{
			"error": gin.H{"code": "NOT_FOUND", "message": "Backup file not found"},
		})
		return
	}

	c.Header("Content-Description", "File Transfer")
	c.Header("Content-Disposition", "attachment; filename="+fileName)
	c.File(filePath)
}

// VerifyBackup runs isolated restore rehearsal; backup valid only after success.
func (h *BackupHandler) VerifyBackup(c *gin.Context) {
	userID := c.GetString("user_id")
	var req struct {
		FileName     string `json:"file_name" binding:"required"`
		TargetDBName string `json:"target_db_name"`
		Password     string `json:"password" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{"code": "BAD_REQUEST", "message": err.Error()},
		})
		return
	}

	var passwordHash string
	err := h.dbPool.QueryRow(c.Request.Context(), `
		SELECT password_hash FROM users WHERE id = $1 AND is_active = true
	`, userID).Scan(&passwordHash)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": "Failed to fetch user credentials"},
		})
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(req.Password)); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": gin.H{"code": "UNAUTHORIZED", "message": "Password salah. Proses verify dibatalkan."},
		})
		return
	}

	resp, err := h.backupService.VerifyRestoreRehearsal(c.Request.Context(), req.FileName, req.TargetDBName)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"code": "INTERNAL_SERVER_ERROR", "message": err.Error()},
		})
		return
	}
	_, _ = h.dbPool.Exec(c.Request.Context(), `
		INSERT INTO audit_logs (user_id, entity_type, action, new_value)
		VALUES ($1, 'backup', 'verify', $2)
	`, userID, req.FileName)
	c.JSON(http.StatusOK, gin.H{"data": resp, "message": "Restore rehearsal verified — backup marked valid"})
}
