CREATE TABLE bills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    name VARCHAR(255) NOT NULL,
    amount DECIMAL(15,2) NOT NULL,
    category_id UUID REFERENCES categories(id),
    account_id UUID REFERENCES accounts(id),
    frequency VARCHAR(20) NOT NULL CHECK (frequency IN ('monthly', 'yearly', 'quarterly', 'weekly', 'custom')),
    due_day INTEGER,
    due_date DATE,
    next_due_date DATE NOT NULL,
    custom_interval_days INTEGER,
    auto_remind BOOLEAN DEFAULT true,
    reminder_days_before INTEGER DEFAULT 3,
    status VARCHAR(20) DEFAULT 'unpaid' CHECK (status IN ('paid', 'unpaid', 'overdue', 'cancelled')),
    is_active BOOLEAN DEFAULT true,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_bills_user ON bills(user_id);
CREATE INDEX idx_bills_next_due ON bills(next_due_date);
CREATE INDEX idx_bills_status ON bills(status);

CREATE TABLE bill_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bill_id UUID NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
    amount DECIMAL(15,2) NOT NULL,
    payment_date DATE NOT NULL,
    is_partial BOOLEAN DEFAULT false,
    remaining_amount DECIMAL(15,2) DEFAULT 0,
    transaction_id UUID REFERENCES transactions(id),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bill_payments_bill ON bill_payments(bill_id);
