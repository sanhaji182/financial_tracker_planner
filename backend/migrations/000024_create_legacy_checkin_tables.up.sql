CREATE TABLE IF NOT EXISTS legacy_checkin_configs (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    is_paused BOOLEAN NOT NULL DEFAULT FALSE,
    paused_until TIMESTAMPTZ,
    interval_days INT NOT NULL DEFAULT 7 CHECK (interval_days BETWEEN 1 AND 90),
    grace_period_days INT NOT NULL DEFAULT 3 CHECK (grace_period_days BETWEEN 1 AND 14),
    reminder_hour INT NOT NULL DEFAULT 20 CHECK (reminder_hour BETWEEN 0 AND 23),
    timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Jakarta',
    auto_reset_on_activity BOOLEAN NOT NULL DEFAULT FALSE,
    delivery_mode VARCHAR(20) NOT NULL DEFAULT 'e2ee_portal' CHECK (delivery_mode IN ('e2ee_portal', 'email_summary')),
    owner_notify_email BOOLEAN NOT NULL DEFAULT TRUE,
    owner_notify_telegram BOOLEAN NOT NULL DEFAULT TRUE,
    status VARCHAR(20) NOT NULL DEFAULT 'inactive' CHECK (status IN ('inactive', 'active', 'paused', 'grace_period', 'triggered')),
    last_checkin_at TIMESTAMPTZ,
    next_due_at TIMESTAMPTZ,
    grace_started_at TIMESTAMPTZ,
    trigger_deadline_at TIMESTAMPTZ,
    triggered_at TIMESTAMPTZ,
    last_reminder_sent_date DATE,
    last_grace_alert_sent_date DATE,
    encrypted_package_json JSONB,
    plaintext_summary_note TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_legacy_checkin_due
    ON legacy_checkin_configs (enabled, is_paused, status, next_due_at, trigger_deadline_at);

CREATE TABLE IF NOT EXISTS legacy_beneficiaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    relationship VARCHAR(80) NOT NULL DEFAULT 'Pasangan',
    email VARCHAR(255) NOT NULL,
    telegram_chat_id VARCHAR(64) NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_legacy_beneficiaries_user
    ON legacy_beneficiaries (user_id, created_at ASC);

CREATE TABLE IF NOT EXISTS legacy_checkin_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_type VARCHAR(40) NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_legacy_checkin_events_user
    ON legacy_checkin_events (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS legacy_claim_tokens (
    token_hash VARCHAR(128) PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    beneficiary_id UUID REFERENCES legacy_beneficiaries(id) ON DELETE CASCADE,
    beneficiary_name VARCHAR(120) NOT NULL,
    beneficiary_email VARCHAR(255) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    claimed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_legacy_claim_tokens_user
    ON legacy_claim_tokens (user_id, expires_at DESC);
