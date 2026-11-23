CREATE TABLE IF NOT EXISTS household_sync_envelopes (
    household_owner_id UUID PRIMARY KEY,
    revision BIGINT NOT NULL DEFAULT 1,
    ciphertext_b64 TEXT NOT NULL,
    iv_b64 TEXT NOT NULL,
    salt_b64 TEXT NOT NULL,
    kdf_iterations INT NOT NULL DEFAULT 100000,
    device_id VARCHAR(128) NOT NULL DEFAULT '',
    updated_by UUID NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
