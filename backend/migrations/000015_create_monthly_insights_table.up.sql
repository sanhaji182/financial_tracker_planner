-- Up migration: create monthly_insights table

CREATE TABLE monthly_insights (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    month VARCHAR(7) NOT NULL,           -- YYYY-MM format
    insight_type VARCHAR(50) NOT NULL,   -- spending_increase, top_categories, subscription_change, cashflow_risk, networth_trend, recommendation
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    data JSONB,                          -- supporting data (numbers, chart data, etc.)
    severity VARCHAR(20) CHECK (severity IN ('positive', 'neutral', 'negative')),
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_insights_user_month ON monthly_insights(user_id, month);
CREATE INDEX idx_insights_user_type ON monthly_insights(user_id, insight_type);
