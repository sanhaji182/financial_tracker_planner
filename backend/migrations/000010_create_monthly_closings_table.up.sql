CREATE TABLE monthly_closings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    month VARCHAR(7) NOT NULL,
    snapshot JSONB NOT NULL,
    total_income DECIMAL(15,2),
    total_expense DECIMAL(15,2),
    net_worth DECIMAL(15,2),
    total_assets DECIMAL(15,2),
    total_debts DECIMAL(15,2),
    total_cash DECIMAL(15,2),
    dti_ratio DECIMAL(5,2),
    ef_coverage_months DECIMAL(4,1),
    is_confirmed BOOLEAN DEFAULT false,
    confirmed_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, month)
);

CREATE INDEX idx_closings_user ON monthly_closings(user_id);
