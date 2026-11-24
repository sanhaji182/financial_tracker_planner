CREATE TABLE IF NOT EXISTS webauthn_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_id TEXT NOT NULL UNIQUE,
    public_key_spki_b64 TEXT NOT NULL,
    algorithm VARCHAR(32) NOT NULL DEFAULT 'ES256',
    device_name VARCHAR(120) NOT NULL DEFAULT 'Perangkat Browser',
    sign_count BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_user
    ON webauthn_credentials (user_id);

CREATE TABLE IF NOT EXISTS client_error_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,
    platform VARCHAR(40),
    app_version VARCHAR(40),
    message TEXT NOT NULL,
    stack TEXT,
    route VARCHAR(255),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_error_events_created_at
    ON client_error_events (created_at DESC);
