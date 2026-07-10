CREATE TABLE forecasts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    month VARCHAR(7) NOT NULL,
    estimated_income DECIMAL(15,2),
    estimated_fixed_expenses DECIMAL(15,2),
    estimated_variable_expenses DECIMAL(15,2),
    projected_end_balance DECIMAL(15,2),
    lowest_balance DECIMAL(15,2),
    lowest_balance_date DATE,
    safe_to_spend DECIMAL(15,2),
    is_tight BOOLEAN DEFAULT false,
    daily_projections JSONB,
    calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_forecasts_user_month ON forecasts(user_id, month);
