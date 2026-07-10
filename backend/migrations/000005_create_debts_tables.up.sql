CREATE TABLE IF NOT EXISTS debts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL CHECK (type IN ('kpr', 'credit_card', 'installment', 'personal_loan', 'other')),
    creditor VARCHAR(255),
    original_amount DECIMAL(15,2) NOT NULL,
    outstanding_balance DECIMAL(15,2) NOT NULL,
    interest_rate DECIMAL(5,2),
    minimum_payment DECIMAL(15,2),
    due_day INTEGER CHECK (due_day BETWEEN 1 AND 31),
    start_date DATE,
    end_date DATE,
    tenor_months INTEGER,
    account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
    currency VARCHAR(3) DEFAULT 'IDR',
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'paid_off', 'defaulted', 'restructured')),
    notes TEXT,
    is_shared BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_debts_user ON debts(user_id);
CREATE INDEX IF NOT EXISTS idx_debts_status ON debts(status);

CREATE TABLE IF NOT EXISTS debt_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    debt_id UUID NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
    amount DECIMAL(15,2) NOT NULL,
    payment_date DATE NOT NULL,
    is_extra_payment BOOLEAN DEFAULT false,
    principal_portion DECIMAL(15,2),
    interest_portion DECIMAL(15,2),
    remaining_balance DECIMAL(15,2),
    transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_debt_payments_debt ON debt_payments(debt_id);
CREATE INDEX IF NOT EXISTS idx_debt_payments_date ON debt_payments(payment_date);
