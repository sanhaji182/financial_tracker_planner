CREATE TABLE IF NOT EXISTS vault_references (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    vault_item_id VARCHAR(255) NOT NULL, -- reference to our mock vault item ID
    type VARCHAR(50) NOT NULL,            -- pin, password, api_key, token
    linked_entity_type VARCHAR(50),      -- account, service
    linked_entity_id UUID,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vault_user ON vault_references(user_id);

CREATE TABLE IF NOT EXISTS ai_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
    ai_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ai_provider VARCHAR(50) NOT NULL DEFAULT 'local', -- openai/anthropic/local
    ai_model VARCHAR(100) NOT NULL DEFAULT 'default',
    ocr_escalation_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    auto_categorization_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    advisor_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    anomaly_detection_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_settings_user ON ai_settings(user_id);
