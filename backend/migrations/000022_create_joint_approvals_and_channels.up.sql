CREATE TABLE IF NOT EXISTS household_approval_settings (
    household_owner_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    threshold_idr BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transaction_approvals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    requested_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    requester_name VARCHAR(120) NOT NULL DEFAULT '',
    account_id UUID NOT NULL,
    category_id UUID,
    tx_type VARCHAR(20) NOT NULL DEFAULT 'expense',
    amount BIGINT NOT NULL CHECK (amount > 0),
    date DATE NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    notes TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    reviewed_by UUID,
    review_note TEXT,
    reviewed_at TIMESTAMPTZ,
    transaction_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transaction_approvals_household_status
    ON transaction_approvals (household_owner_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS channel_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_type VARCHAR(20) NOT NULL CHECK (channel_type IN ('telegram', 'email_forward')),
    external_id VARCHAR(255) NOT NULL,
    secret_token VARCHAR(128) NOT NULL,
    default_account_id UUID,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (channel_type, external_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_links_household
    ON channel_links (household_owner_id, channel_type);
