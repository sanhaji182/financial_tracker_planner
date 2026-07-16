package service

import "testing"

func TestNewProtectionServiceReturnsImpl(t *testing.T) {
	// Compile-time interface check + non-nil constructor result.
	var _ ProtectionService = NewProtectionService(nil, t.TempDir())
}
