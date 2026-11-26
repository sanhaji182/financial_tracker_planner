-- V4 AI Advisor State Tables: Cross-Device Chat History, Learned Memory & Proactive Daily Briefings

CREATE TABLE IF NOT EXISTS ai_chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_message_id VARCHAR(128),
    role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL DEFAULT '',
    actions JSONB NOT NULL DEFAULT '[]'::jsonb,
    suggested_replies JSONB NOT NULL DEFAULT '[]'::jsonb,
    image_preview TEXT,
    attachments_meta JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_owner_created
    ON ai_chat_messages (owner_id, created_at ASC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_chat_messages_owner_client_id
    ON ai_chat_messages (owner_id, client_message_id)
    WHERE client_message_id IS NOT NULL AND client_message_id <> '';

CREATE TABLE IF NOT EXISTS ai_advisor_memories (
    owner_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    learned_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
    custom_notes JSONB NOT NULL DEFAULT '[]'::jsonb,
    preferred_payment_account VARCHAR(120) NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_briefing_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    briefing_date DATE NOT NULL,
    severity VARCHAR(20) NOT NULL DEFAULT 'info',
    title VARCHAR(255) NOT NULL,
    summary TEXT NOT NULL,
    highlights JSONB NOT NULL DEFAULT '[]'::jsonb,
    notified_email BOOLEAN NOT NULL DEFAULT FALSE,
    notified_telegram BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (owner_id, briefing_date)
);

CREATE INDEX IF NOT EXISTS idx_ai_briefing_runs_owner_date
    ON ai_briefing_runs (owner_id, briefing_date DESC);
