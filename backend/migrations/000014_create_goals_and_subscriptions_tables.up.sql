CREATE TABLE IF NOT EXISTS goals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) CHECK (type IN ('emergency_fund', 'debt_payoff', 'down_payment', 'vacation', 'education', 'custom')),
    target_amount DECIMAL(15,2) NOT NULL,
    current_amount DECIMAL(15,2) DEFAULT 0,
    target_date DATE,
    linked_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
    linked_debt_id UUID REFERENCES debts(id) ON DELETE SET NULL,
    icon VARCHAR(50),
    color VARCHAR(7),
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'achieved', 'paused', 'cancelled')),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_goals_user ON goals(user_id);

CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    name VARCHAR(255) NOT NULL,
    provider VARCHAR(255),
    amount DECIMAL(15,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'IDR',
    frequency VARCHAR(20) DEFAULT 'monthly' CHECK (frequency IN ('monthly', 'yearly', 'weekly')),
    category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    next_renewal_date DATE,
    last_used_date DATE,
    is_active BOOLEAN DEFAULT true,
    auto_renew BOOLEAN DEFAULT true,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);

-- Alter transactions table to add optional goal reference for tracking contributions
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS goal_id UUID REFERENCES goals(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_goal ON transactions(goal_id);
