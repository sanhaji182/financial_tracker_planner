-- Up migration: create currencies and automation_rules tables

CREATE TABLE IF NOT EXISTS currencies (
    code VARCHAR(3) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    symbol VARCHAR(10) NOT NULL,
    exchange_rate_to_idr DECIMAL(15,6) NOT NULL DEFAULT 1,
    last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed currencies
INSERT INTO currencies (code, name, symbol, exchange_rate_to_idr) VALUES
    ('IDR', 'Indonesian Rupiah', 'Rp', 1.000000),
    ('USD', 'US Dollar', '$', 16500.000000),
    ('SGD', 'Singapore Dollar', 'S$', 12300.000000),
    ('EUR', 'Euro', '€', 17800.000000)
ON CONFLICT (code) DO UPDATE 
SET name = EXCLUDED.name, 
    symbol = EXCLUDED.symbol, 
    exchange_rate_to_idr = EXCLUDED.exchange_rate_to_idr;

CREATE TABLE IF NOT EXISTS automation_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    trigger_type VARCHAR(50) NOT NULL,   -- balance_below, bill_due_soon, budget_exceeded, recurring_transaction
    condition JSONB NOT NULL,            -- threshold, account_id, days_before, percentage, etc.
    action_type VARCHAR(50) NOT NULL,    -- send_alert, send_telegram, create_transaction
    action_config JSONB NOT NULL,        -- config parameters for the action
    is_active BOOLEAN DEFAULT true,
    last_triggered_at TIMESTAMPTZ,
    trigger_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rules_user ON automation_rules(user_id);
CREATE INDEX IF NOT EXISTS idx_rules_trigger ON automation_rules(trigger_type);
