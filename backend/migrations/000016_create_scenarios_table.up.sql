-- Up migration: create scenarios table

CREATE TABLE scenarios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    changes JSONB NOT NULL,              -- simulated changes list [{type, params}]
    result JSONB NOT NULL,               -- simulation impact comparison
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_scenarios_user ON scenarios(user_id);
CREATE INDEX idx_scenarios_created ON scenarios(created_at DESC);
