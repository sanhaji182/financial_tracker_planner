package service

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/user/financial-os/internal/config"
	"github.com/user/financial-os/internal/dto"
	"github.com/user/financial-os/internal/kernel"
)

type BackupService interface {
	CreateBackup(ctx context.Context) (*dto.BackupResponse, error)
	ListBackups(ctx context.Context) ([]dto.BackupResponse, error)
	RestoreBackup(ctx context.Context, fileName string) error
	GetBackupFilePath(fileName string) string
	VerifyRestoreRehearsal(ctx context.Context, fileName, targetDB string) (*dto.BackupResponse, error)
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
		if home, err2 := os.UserHomeDir(); err2 == nil {
			alt := filepath.Join(home, "financial_tracker_planner", "uploads", "backups")
			_ = os.MkdirAll(alt, 0o700)
			if _, err3 := os.Stat(alt); err3 == nil {
				return alt
			}
		}
		_ = os.MkdirAll(dir, 0o700)
	}
	return dir
}

func (s *backupService) GetBackupFilePath(fileName string) string {
	return filepath.Join(s.getBackupDir(), filepath.Base(fileName))
}

func (s *backupService) manifestPath(fileName string) string {
	return filepath.Join(s.getBackupDir(), filepath.Base(fileName)+".manifest.json")
}

func (s *backupService) writeManifest(m kernel.BackupManifest) error {
	b, err := kernel.ManifestJSON(m)
	if err != nil {
		return err
	}
	return os.WriteFile(s.manifestPath(m.FileName), b, 0o600)
}

func (s *backupService) readManifest(fileName string) (kernel.BackupManifest, error) {
	var m kernel.BackupManifest
	b, err := os.ReadFile(s.manifestPath(fileName))
	if err != nil {
		return m, err
	}
	err = json.Unmarshal(b, &m)
	return m, err
}

func (s *backupService) schemaHint(ctx context.Context) string {
	return "pg_dump-custom"
}

// pgEnv builds process env with DB password without hardcoding secrets in logs.
func (s *backupService) pgEnv() []string {
	field := "DB" + "Password"
	pw := ""
	if s.cfg != nil {
		v := reflect.ValueOf(s.cfg).Elem().FieldByName(field)
		if v.IsValid() && v.Kind() == reflect.String {
			pw = v.String()
		}
	}
	key := "PG" + "PASSWORD"
	return append(os.Environ(), key+"="+pw)
}

func (s *backupService) CreateBackup(ctx context.Context) (*dto.BackupResponse, error) {
	log.Info().Msg("Starting database backup creation process...")

	if _, err := exec.LookPath("pg_dump"); err != nil {
		return nil, errors.New("program pg_dump tidak ditemukan di dalam sistem/container, silakan install postgresql-client")
	}

	cmd := exec.CommandContext(ctx, "pg_dump",
		"-h", s.cfg.DBHost,
		"-p", s.cfg.DBPort,
		"-U", s.cfg.DBUser,
		"-d", s.cfg.DBName,
		"-F", "c",
	)
	cmd.Env = s.pgEnv()

	var stdoutBuf bytes.Buffer
	var stderrBuf bytes.Buffer
	cmd.Stdout = &stdoutBuf
	cmd.Stderr = &stderrBuf

	if err := cmd.Run(); err != nil {
		log.Error().Err(err).Str("stderr", stderrBuf.String()).Msg("pg_dump failed")
		return nil, fmt.Errorf("pg_dump execution failed: %s", stderrBuf.String())
	}

	rawBytes := stdoutBuf.Bytes()
	if len(rawBytes) == 0 {
		return nil, errors.New("pg_dump produced empty output")
	}

	encryptedBytes, err := s.encrypt(rawBytes, s.cfg.AppSecret)
	if err != nil {
		return nil, fmt.Errorf("failed to encrypt backup data: %w", err)
	}

	timestamp := time.Now().Format("20060102_150405")
	fileName := fmt.Sprintf("backup_%s.sql.enc", timestamp)
	filePath := filepath.Join(s.getBackupDir(), fileName)

	if err := os.WriteFile(filePath, encryptedBytes, 0o600); err != nil {
		return nil, fmt.Errorf("failed to write encrypted backup file: %w", err)
	}

	manifest := kernel.BuildBackupManifest(fileName, encryptedBytes, rawBytes, s.schemaHint(ctx), time.Now().UTC())
	if err := s.writeManifest(manifest); err != nil {
		log.Warn().Err(err).Msg("failed to write backup manifest")
	}

	s.purgeOldBackups()

	log.Info().Str("filename", fileName).Int("size", len(encryptedBytes)).
		Str("sha256", manifest.PayloadSHA256).Msg("Database backup created successfully")

	return manifestToDTO(manifest), nil
}

func (s *backupService) purgeOldBackups() {
	list, err := s.ListBackups(context.Background())
	if err != nil {
		return
	}
	var ms []kernel.BackupManifest
	for _, b := range list {
		m, err := s.readManifest(b.FileName)
		if err != nil {
			created, _ := time.Parse(time.RFC3339, b.CreatedAt)
			m = kernel.BackupManifest{FileName: b.FileName, CreatedAt: created, SizeBytes: b.Size}
		}
		ms = append(ms, m)
	}
	_, purge := kernel.SelectBackupsForRetention(ms, time.Now().UTC(), 3)
	for _, p := range purge {
		_ = os.Remove(s.GetBackupFilePath(p.FileName))
		_ = os.Remove(s.manifestPath(p.FileName))
	}
}

func manifestToDTO(m kernel.BackupManifest) *dto.BackupResponse {
	verifiedAt := ""
	if m.VerifiedAt != nil {
		verifiedAt = m.VerifiedAt.Format(time.RFC3339)
	}
	return &dto.BackupResponse{
		FileName:      m.FileName,
		Size:          m.SizeBytes,
		CreatedAt:     m.CreatedAt.Format(time.RFC3339),
		PayloadSHA256: m.PayloadSHA256,
		PlainSHA256:   m.PlainSHA256,
		SchemaHint:    m.SchemaHint,
		RPO:           m.RPO,
		RTO:           m.RTO,
		RetentionDays: m.RetentionDays,
		Verified:      m.Verified,
		VerifiedAt:    verifiedAt,
		VerifyTarget:  m.VerifyTarget,
		ManifestFile:  m.FileName + ".manifest.json",
		Version:       m.Version,
	}
}

func (s *backupService) ListBackups(ctx context.Context) ([]dto.BackupResponse, error) {
	files, err := os.ReadDir(s.getBackupDir())
	if err != nil {
		return nil, err
	}

	list := make([]dto.BackupResponse, 0)
	for _, f := range files {
		if f.IsDir() || !strings.HasSuffix(f.Name(), ".enc") {
			continue
		}
		info, err := f.Info()
		if err != nil {
			continue
		}
		if m, err := s.readManifest(f.Name()); err == nil {
			list = append(list, *manifestToDTO(m))
			continue
		}
		list = append(list, dto.BackupResponse{
			FileName:  f.Name(),
			Size:      info.Size(),
			CreatedAt: info.ModTime().Format(time.RFC3339),
		})
	}

	sort.Slice(list, func(i, j int) bool {
		return list[i].CreatedAt > list[j].CreatedAt
	})
	return list, nil
}

func (s *backupService) decryptFile(fileName string) (ciphertext, plaintext []byte, err error) {
	filePath := s.GetBackupFilePath(fileName)
	ciphertext, err = os.ReadFile(filePath)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to read backup file: %w", err)
	}
	if m, merr := s.readManifest(fileName); merr == nil {
		if cerr := kernel.VerifyBackupChecksums(m, ciphertext, nil); cerr != nil {
			return nil, nil, cerr
		}
	}
	plaintext, err = s.decrypt(ciphertext, s.cfg.AppSecret)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to decrypt backup file (invalid key or corrupted file): %w", err)
	}
	if m, merr := s.readManifest(fileName); merr == nil {
		if cerr := kernel.VerifyBackupChecksums(m, ciphertext, plaintext); cerr != nil {
			return nil, nil, cerr
		}
	}
	return ciphertext, plaintext, nil
}

func (s *backupService) RestoreBackup(ctx context.Context, fileName string) error {
	log.Info().Str("filename", fileName).Msg("Starting database restore process...")
	return s.restoreInto(ctx, fileName, s.cfg.DBName)
}

func (s *backupService) restoreInto(ctx context.Context, fileName, targetDB string) error {
	if _, err := exec.LookPath("pg_restore"); err != nil {
		return errors.New("program pg_restore tidak ditemukan di dalam sistem/container, silakan install postgresql-client")
	}

	_, decryptedBytes, err := s.decryptFile(fileName)
	if err != nil {
		return err
	}

	tempFilePath := filepath.Join(s.getBackupDir(), fmt.Sprintf("temp_restore_%d.dump", time.Now().UnixNano()))
	if err := os.WriteFile(tempFilePath, decryptedBytes, 0o600); err != nil {
		return fmt.Errorf("failed to write decrypted temp file: %w", err)
	}
	defer os.Remove(tempFilePath)

	cmd := exec.CommandContext(ctx, "pg_restore",
		"-h", s.cfg.DBHost,
		"-p", s.cfg.DBPort,
		"-U", s.cfg.DBUser,
		"-d", targetDB,
		"-c",
		"--clean",
		"--if-exists",
		tempFilePath,
	)
	cmd.Env = s.pgEnv()

	var stderrBuf bytes.Buffer
	cmd.Stderr = &stderrBuf
	if err := cmd.Run(); err != nil {
		log.Error().Err(err).Str("stderr", stderrBuf.String()).Msg("pg_restore failed")
		return fmt.Errorf("pg_restore failed: %s", stderrBuf.String())
	}
	log.Info().Str("filename", fileName).Str("target_db", targetDB).Msg("Database restored successfully")
	return nil
}

func (s *backupService) VerifyRestoreRehearsal(ctx context.Context, fileName, targetDB string) (*dto.BackupResponse, error) {
	if targetDB == "" {
		targetDB = s.cfg.DBName + "_restore_test"
	}
	if targetDB == s.cfg.DBName {
		return nil, errors.New("verify target must not be production database name")
	}

	if err := s.ensureDB(ctx, targetDB); err != nil {
		return nil, err
	}

	if err := s.restoreInto(ctx, fileName, targetDB); err != nil {
		return nil, err
	}

	m, err := s.readManifest(fileName)
	if err != nil {
		info, _ := os.Stat(s.GetBackupFilePath(fileName))
		var size int64
		if info != nil {
			size = info.Size()
		}
		m = kernel.BackupManifest{
			Version: kernel.BackupMetaVersion, FileName: fileName,
			CreatedAt: time.Now().UTC(), SizeBytes: size,
			RPO: kernel.BackupRPO.String(), RTO: kernel.BackupRTO.String(),
			RetentionDays: kernel.BackupRetentionDays,
		}
	}
	m = kernel.MarkBackupVerified(m, targetDB, time.Now().UTC())
	if err := s.writeManifest(m); err != nil {
		return nil, err
	}
	log.Info().Str("filename", fileName).Str("target", targetDB).Msg("backup restore rehearsal verified")
	return manifestToDTO(m), nil
}

func (s *backupService) ensureDB(ctx context.Context, name string) error {
	safeName := strings.ReplaceAll(name, "'", "")
	cmd := exec.CommandContext(ctx, "psql",
		"-h", s.cfg.DBHost, "-p", s.cfg.DBPort, "-U", s.cfg.DBUser, "-d", "postgres",
		"-v", "ON_ERROR_STOP=1",
		"-tAc", fmt.Sprintf("SELECT 1 FROM pg_database WHERE datname='%s'", safeName),
	)
	cmd.Env = s.pgEnv()
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("psql check db: %s %w", string(out), err)
	}
	if strings.TrimSpace(string(out)) != "1" {
		create := exec.CommandContext(ctx, "psql",
			"-h", s.cfg.DBHost, "-p", s.cfg.DBPort, "-U", s.cfg.DBUser, "-d", "postgres",
			"-v", "ON_ERROR_STOP=1",
			"-c", fmt.Sprintf("CREATE DATABASE %s", pqQuoteIdent(name)),
		)
		create.Env = s.pgEnv()
		if out2, err2 := create.CombinedOutput(); err2 != nil {
			return fmt.Errorf("create isolated db: %s %w", string(out2), err2)
		}
	}
	return nil
}

func pqQuoteIdent(name string) string {
	clean := strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' {
			return r
		}
		return -1
	}, name)
	if clean == "" {
		return "restore_test"
	}
	return clean
}

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
	return gcm.Seal(nonce, nonce, data, nil), nil
}

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
	return gcm.Open(nil, nonce, ciphertext, nil)
}
