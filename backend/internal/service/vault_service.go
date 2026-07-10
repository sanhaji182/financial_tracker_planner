package service

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"github.com/google/uuid"
)

type VaultService interface {
	StoreSecret(ctx context.Context, secret string) (string, error)
	RetrieveSecret(ctx context.Context, itemID string) (string, error)
}

type fileVaultService struct {
	filePath string
	mu       sync.RWMutex
}

func NewVaultService(uploadsDir string) VaultService {
	filePath := filepath.Join(uploadsDir, "vault_secrets.json")
	return &fileVaultService{
		filePath: filePath,
	}
}

func (s *fileVaultService) loadSecrets() (map[string]string, error) {
	// If file does not exist, return empty map
	if _, err := os.Stat(s.filePath); os.IsNotExist(err) {
		return make(map[string]string), nil
	}

	data, err := os.ReadFile(s.filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to read vault file: %w", err)
	}

	var secrets map[string]string
	if err := json.Unmarshal(data, &secrets); err != nil {
		return nil, fmt.Errorf("failed to parse vault data: %w", err)
	}

	return secrets, nil
}

func (s *fileVaultService) saveSecrets(secrets map[string]string) error {
	data, err := json.MarshalIndent(secrets, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to serialize secrets: %w", err)
	}

	// Ensure directory exists
	dir := filepath.Dir(s.filePath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create vault directory: %w", err)
	}

	if err := os.WriteFile(s.filePath, data, 0600); err != nil {
		return fmt.Errorf("failed to write vault file: %w", err)
	}

	return nil
}

func (s *fileVaultService) StoreSecret(ctx context.Context, secret string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	secrets, err := s.loadSecrets()
	if err != nil {
		return "", err
	}

	itemID := uuid.New().String()
	secrets[itemID] = secret

	if err := s.saveSecrets(secrets); err != nil {
		return "", err
	}

	return itemID, nil
}

func (s *fileVaultService) RetrieveSecret(ctx context.Context, itemID string) (string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	secrets, err := s.loadSecrets()
	if err != nil {
		return "", err
	}

	secret, exists := secrets[itemID]
	if !exists {
		return "", fmt.Errorf("secret not found in vault")
	}

	return secret, nil
}
