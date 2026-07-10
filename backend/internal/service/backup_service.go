package service

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/user/financial-os/internal/config"
	"github.com/user/financial-os/internal/dto"
)

type BackupService interface {
	CreateBackup(ctx context.Context) (*dto.BackupResponse, error)
	ListBackups(ctx context.Context) ([]dto.BackupResponse, error)
	RestoreBackup(ctx context.Context, fileName string) error
	GetBackupFilePath(fileName string) string
}

type backupService struct {
	cfg *config.Config
}

func NewBackupService(cfg *config.Config) BackupService {
	return &backupService{cfg: cfg}
}

func (s *backupService) getBackupDir() string {
	dir := "/app/uploads/backups"
	if _, err := os.Stat(dir); os.IsNotExist(err) {
		_ = os.MkdirAll(dir, os.ModePerm)
	}
	return dir
}

func (s *backupService) GetBackupFilePath(fileName string) string {
	// Sanitize file path traversal
	cleaned := filepath.Base(fileName)
	return filepath.Join(s.getBackupDir(), cleaned)
}

func (s *backupService) CreateBackup(ctx context.Context) (*dto.BackupResponse, error) {
	log.Info().Msg("Starting database backup creation process...")

	// Check if pg_dump is available
	if _, err := exec.LookPath("pg_dump"); err != nil {
		return nil, errors.New("program pg_dump tidak ditemukan di dalam sistem/container, silakan install postgresql-client")
	}

	// 1. Execute pg_dump to custom format binary output
	cmd := exec.Command("pg_dump", 
		"-h", s.cfg.DBHost, 
		"-p", s.cfg.DBPort, 
		"-U", s.cfg.DBUser, 
		"-d", s.cfg.DBName, 
		"-F", "c",
	)
	
	// Set password environment variable
	cmd.Env = append(os.Environ(), "PGPASSWORD="+s.cfg.DBPassword)

	var stdoutBuf bytes.Buffer
	var stderrBuf bytes.Buffer
	cmd.Stdout = &stdoutBuf
	cmd.Stderr = &stderrBuf

	err := cmd.Run()
	if err != nil {
		log.Error().Err(err).Str("stderr", stderrBuf.String()).Msg("pg_dump failed")
		return nil, fmt.Errorf("pg_dump execution failed: %s", stderrBuf.String())
	}

	rawBytes := stdoutBuf.Bytes()
	if len(rawBytes) == 0 {
		return nil, errors.New("pg_dump produced empty output")
	}

	// 2. Encrypt raw dump using AES-GCM-256 with AppSecret key
	encryptedBytes, err := s.encrypt(rawBytes, s.cfg.AppSecret)
	if err != nil {
		return nil, fmt.Errorf("failed to encrypt backup data: %w", err)
	}

	// 3. Save to storage
	timestamp := time.Now().Format("20060102_150405")
	fileName := fmt.Sprintf("backup_%s.sql.enc", timestamp)
	filePath := filepath.Join(s.getBackupDir(), fileName)

	err = os.WriteFile(filePath, encryptedBytes, 0600)
	if err != nil {
		return nil, fmt.Errorf("failed to write encrypted backup file: %w", err)
	}

	log.Info().Str("filename", fileName).Int("size", len(encryptedBytes)).Msg("Database backup created successfully")

	return &dto.BackupResponse{
		FileName:  fileName,
		Size:      int64(len(encryptedBytes)),
		CreatedAt: time.Now().Format(time.RFC3339),
	}, nil
}

func (s *backupService) ListBackups(ctx context.Context) ([]dto.BackupResponse, error) {
	files, err := os.ReadDir(s.getBackupDir())
	if err != nil {
		return nil, err
	}

	list := make([]dto.BackupResponse, 0)
	for _, f := range files {
		if !f.IsDir() && strings.HasSuffix(f.Name(), ".enc") {
			info, err := f.Info()
			if err == nil {
				list = append(list, dto.BackupResponse{
					FileName:  f.Name(),
					Size:      info.Size(),
					CreatedAt: info.ModTime().Format(time.RFC3339),
				})
			}
		}
	}

	// Sort backups by latest first
	sort.Slice(list, func(i, j int) bool {
		return list[i].CreatedAt > list[j].CreatedAt
	})

	return list, nil
}

func (s *backupService) RestoreBackup(ctx context.Context, fileName string) error {
	log.Info().Str("filename", fileName).Msg("Starting database restore process...")

	// Check if pg_restore is available
	if _, err := exec.LookPath("pg_restore"); err != nil {
		return errors.New("program pg_restore tidak ditemukan di dalam sistem/container, silakan install postgresql-client")
	}

	filePath := s.GetBackupFilePath(fileName)
	encryptedBytes, err := os.ReadFile(filePath)
	if err != nil {
		return fmt.Errorf("failed to read backup file: %w", err)
	}

	// 1. Decrypt data
	decryptedBytes, err := s.decrypt(encryptedBytes, s.cfg.AppSecret)
	if err != nil {
		return fmt.Errorf("failed to decrypt backup file (invalid key or corrupted file): %w", err)
	}

	// 2. Write to a temporary file for pg_restore to ingest
	tempFilePath := filepath.Join(s.getBackupDir(), "temp_restore.dump")
	err = os.WriteFile(tempFilePath, decryptedBytes, 0600)
	if err != nil {
		return fmt.Errorf("failed to write decrypted temp file: %w", err)
	}
	defer os.Remove(tempFilePath) // Clean up decrypted data immediately after function exit

	// 3. Execute pg_restore
	// -c drops database objects before recreating, --clean
	// --if-exists avoids errors during drops if tables don't exist yet
	cmd := exec.Command("pg_restore",
		"-h", s.cfg.DBHost,
		"-p", s.cfg.DBPort,
		"-U", s.cfg.DBUser,
		"-d", s.cfg.DBName,
		"-c",
		"--clean",
		"--if-exists",
		tempFilePath,
	)

	cmd.Env = append(os.Environ(), "PGPASSWORD="+s.cfg.DBPassword)

	var stderrBuf bytes.Buffer
	cmd.Stderr = &stderrBuf

	err = cmd.Run()
	if err != nil {
		log.Error().Err(err).Str("stderr", stderrBuf.String()).Msg("pg_restore failed")
		return fmt.Errorf("pg_restore failed: %s", stderrBuf.String())
	}

	log.Info().Str("filename", fileName).Msg("Database restored successfully")
	return nil
}

// AES-GCM-256 encryption helper
func (s *backupService) encrypt(data []byte, passphrase string) ([]byte, error) {
	key := sha256.Sum256([]byte(passphrase))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err = io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}

	ciphertext := gcm.Seal(nonce, nonce, data, nil)
	return ciphertext, nil
}

// AES-GCM-256 decryption helper
func (s *backupService) decrypt(data []byte, passphrase string) ([]byte, error) {
	key := sha256.Sum256([]byte(passphrase))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}

	nonceSize := gcm.NonceSize()
	if len(data) < nonceSize {
		return nil, errors.New("ciphertext too short")
	}

	nonce, ciphertext := data[:nonceSize], data[nonceSize:]
	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return nil, err
	}

	return plaintext, nil
}
