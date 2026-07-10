CREATE TABLE IF NOT EXISTS assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL CHECK (type IN ('savings', 'property', 'vehicle', 'investment', 'cash', 'e_wallet', 'deposit', 'other')),
    current_value DECIMAL(15,2) NOT NULL,
    purchase_value DECIMAL(15,2),
    purchase_date DATE,
    currency VARCHAR(3) DEFAULT 'IDR',
    linked_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
    is_shared BOOLEAN DEFAULT false,
    is_liquid BOOLEAN DEFAULT false,
    notes TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_assets_user ON assets(user_id);
CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(type);

CREATE TABLE IF NOT EXISTS asset_valuations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    value DECIMAL(15,2) NOT NULL,
    valuation_date DATE NOT NULL,
    source VARCHAR(50) DEFAULT 'manual',
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_valuations_asset ON asset_valuations(asset_id);
CREATE INDEX IF NOT EXISTS idx_valuations_date ON asset_valuations(valuation_date);
