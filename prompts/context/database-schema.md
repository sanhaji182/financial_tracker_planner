# Database Schema Reference — Financial Operating System

Dokumen ini berisi referensi lengkap schema database. Agent HARUS mengacu pada dokumen ini saat membuat migration files dan model.

---

## Konvensi Umum

- **Primary Key**: UUID v4 (`id UUID PRIMARY KEY DEFAULT gen_random_uuid()`)
- **Timestamps**: `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`, `deleted_at TIMESTAMPTZ` (soft delete)
- **Money**: `DECIMAL(15,2)` — TIDAK BOLEH float
- **Enums**: Gunakan PostgreSQL enum type atau varchar dengan check constraint
- **Naming**: snake_case untuk semua nama tabel dan kolom

---

## Tabel — Core

### users
```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'spouse_viewer')),
    invited_by UUID REFERENCES users(id),
    avatar_url TEXT,
    timezone VARCHAR(50) DEFAULT 'Asia/Jakarta',
    currency_default VARCHAR(3) DEFAULT 'IDR',
    is_active BOOLEAN DEFAULT true,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);
```

### accounts
```sql
CREATE TABLE accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL CHECK (type IN ('bank', 'e_wallet', 'cash', 'investment', 'deposit')),
    bank_provider VARCHAR(100),          -- BCA, Mandiri, GoPay, etc.
    account_number_masked VARCHAR(20),   -- ****1234
    balance DECIMAL(15,2) NOT NULL DEFAULT 0,
    initial_balance DECIMAL(15,2) NOT NULL DEFAULT 0,
    currency VARCHAR(3) DEFAULT 'IDR',
    icon VARCHAR(50),
    color VARCHAR(7),                    -- hex color
    is_active BOOLEAN DEFAULT true,
    is_shared BOOLEAN DEFAULT false,     -- visible to spouse
    is_emergency_fund BOOLEAN DEFAULT false,
    sort_order INTEGER DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_accounts_user ON accounts(user_id);
CREATE INDEX idx_accounts_type ON accounts(type);
```

### categories
```sql
CREATE TABLE categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),   -- NULL = system default
    parent_id UUID REFERENCES categories(id),
    name VARCHAR(100) NOT NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('income', 'expense')),
    icon VARCHAR(50),
    color VARCHAR(7),
    is_system BOOLEAN DEFAULT false,     -- system default, can't delete
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_categories_user ON categories(user_id);
CREATE INDEX idx_categories_parent ON categories(parent_id);
```

---

## Tabel — Transactions

### transactions
```sql
CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    account_id UUID NOT NULL REFERENCES accounts(id),
    target_account_id UUID REFERENCES accounts(id),  -- for transfers
    category_id UUID REFERENCES categories(id),
    type VARCHAR(20) NOT NULL CHECK (type IN ('income', 'expense', 'transfer')),
    amount DECIMAL(15,2) NOT NULL,
    date DATE NOT NULL,
    description TEXT,
    notes TEXT,
    is_split BOOLEAN DEFAULT false,
    source VARCHAR(20) DEFAULT 'manual' CHECK (source IN ('manual', 'ocr', 'pdf_parse', 'recurring', 'ai_suggested')),
    source_confidence DECIMAL(3,2),      -- 0.00 to 1.00 for OCR/AI
    status VARCHAR(20) DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'pending_review', 'draft')),
    reconciled BOOLEAN DEFAULT false,
    bill_id UUID REFERENCES bills(id),   -- linked to bill payment
    debt_payment_id UUID REFERENCES debt_payments(id),
    currency VARCHAR(3) DEFAULT 'IDR',
    exchange_rate DECIMAL(15,6) DEFAULT 1,
    tags TEXT[],                          -- PostgreSQL array
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_transactions_user ON transactions(user_id);
CREATE INDEX idx_transactions_account ON transactions(account_id);
CREATE INDEX idx_transactions_category ON transactions(category_id);
CREATE INDEX idx_transactions_date ON transactions(date);
CREATE INDEX idx_transactions_type ON transactions(type);
CREATE INDEX idx_transactions_status ON transactions(status);
```

### transaction_splits
```sql
CREATE TABLE transaction_splits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    category_id UUID NOT NULL REFERENCES categories(id),
    amount DECIMAL(15,2) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_splits_transaction ON transaction_splits(transaction_id);
```

### transaction_attachments
```sql
CREATE TABLE transaction_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    file_name VARCHAR(255) NOT NULL,
    file_path TEXT NOT NULL,
    file_type VARCHAR(50),               -- image/jpeg, application/pdf
    file_size INTEGER,                   -- bytes
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_attachments_transaction ON transaction_attachments(transaction_id);
```

---

## Tabel — Debts

### debts
```sql
CREATE TABLE debts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL CHECK (type IN ('kpr', 'credit_card', 'installment', 'personal_loan', 'other')),
    creditor VARCHAR(255),
    original_amount DECIMAL(15,2) NOT NULL,
    outstanding_balance DECIMAL(15,2) NOT NULL,
    interest_rate DECIMAL(5,2),          -- annual percentage
    minimum_payment DECIMAL(15,2),
    due_day INTEGER CHECK (due_day BETWEEN 1 AND 31),  -- day of month
    start_date DATE,
    end_date DATE,                       -- expected payoff date
    tenor_months INTEGER,
    account_id UUID REFERENCES accounts(id),  -- payment source
    currency VARCHAR(3) DEFAULT 'IDR',
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'paid_off', 'defaulted', 'restructured')),
    notes TEXT,
    is_shared BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_debts_user ON debts(user_id);
CREATE INDEX idx_debts_status ON debts(status);
```

### debt_payments
```sql
CREATE TABLE debt_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    debt_id UUID NOT NULL REFERENCES debts(id),
    amount DECIMAL(15,2) NOT NULL,
    payment_date DATE NOT NULL,
    is_extra_payment BOOLEAN DEFAULT false,
    principal_portion DECIMAL(15,2),
    interest_portion DECIMAL(15,2),
    remaining_balance DECIMAL(15,2),
    transaction_id UUID REFERENCES transactions(id),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_debt_payments_debt ON debt_payments(debt_id);
CREATE INDEX idx_debt_payments_date ON debt_payments(payment_date);
```

---

## Tabel — Assets

### assets
```sql
CREATE TABLE assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL CHECK (type IN ('savings', 'property', 'vehicle', 'investment', 'cash', 'e_wallet', 'deposit', 'other')),
    current_value DECIMAL(15,2) NOT NULL,
    purchase_value DECIMAL(15,2),
    purchase_date DATE,
    currency VARCHAR(3) DEFAULT 'IDR',
    linked_account_id UUID REFERENCES accounts(id),
    is_shared BOOLEAN DEFAULT false,
    is_liquid BOOLEAN DEFAULT false,     -- can be converted to cash quickly
    notes TEXT,
    metadata JSONB,                      -- flexible extra data (address, plate number, etc.)
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_assets_user ON assets(user_id);
CREATE INDEX idx_assets_type ON assets(type);
```

### asset_valuations
```sql
CREATE TABLE asset_valuations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    value DECIMAL(15,2) NOT NULL,
    valuation_date DATE NOT NULL,
    source VARCHAR(50) DEFAULT 'manual', -- manual, market, appraisal
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_valuations_asset ON asset_valuations(asset_id);
CREATE INDEX idx_valuations_date ON asset_valuations(valuation_date);
```

---

## Tabel — Bills

### bills
```sql
CREATE TABLE bills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    name VARCHAR(255) NOT NULL,
    amount DECIMAL(15,2) NOT NULL,
    category_id UUID REFERENCES categories(id),
    account_id UUID REFERENCES accounts(id),  -- payment source
    frequency VARCHAR(20) NOT NULL CHECK (frequency IN ('monthly', 'yearly', 'quarterly', 'weekly', 'custom')),
    due_day INTEGER,                     -- day of month (for monthly)
    due_date DATE,                       -- specific date (for yearly/custom)
    next_due_date DATE NOT NULL,
    custom_interval_days INTEGER,        -- for custom frequency
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
```

### bill_payments
```sql
CREATE TABLE bill_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bill_id UUID NOT NULL REFERENCES bills(id),
    amount DECIMAL(15,2) NOT NULL,
    payment_date DATE NOT NULL,
    is_partial BOOLEAN DEFAULT false,
    remaining_amount DECIMAL(15,2) DEFAULT 0,
    transaction_id UUID REFERENCES transactions(id),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_bill_payments_bill ON bill_payments(bill_id);
```

---

## Tabel — Budgets

### budgets
```sql
CREATE TABLE budgets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    category_id UUID NOT NULL REFERENCES categories(id),
    month VARCHAR(7) NOT NULL,           -- YYYY-MM format
    amount DECIMAL(15,2) NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, category_id, month)
);
CREATE INDEX idx_budgets_user_month ON budgets(user_id, month);
```

---

## Tabel — Goals

### goals
```sql
CREATE TABLE goals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) CHECK (type IN ('emergency_fund', 'debt_payoff', 'down_payment', 'vacation', 'education', 'custom')),
    target_amount DECIMAL(15,2) NOT NULL,
    current_amount DECIMAL(15,2) DEFAULT 0,
    target_date DATE,
    linked_account_id UUID REFERENCES accounts(id),
    linked_debt_id UUID REFERENCES debts(id),
    icon VARCHAR(50),
    color VARCHAR(7),
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'achieved', 'paused', 'cancelled')),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_goals_user ON goals(user_id);
```

---

## Tabel — Subscriptions

### subscriptions
```sql
CREATE TABLE subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    name VARCHAR(255) NOT NULL,
    provider VARCHAR(255),
    amount DECIMAL(15,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'IDR',
    frequency VARCHAR(20) DEFAULT 'monthly' CHECK (frequency IN ('monthly', 'yearly', 'weekly')),
    category_id UUID REFERENCES categories(id),
    next_renewal_date DATE,
    last_used_date DATE,
    is_active BOOLEAN DEFAULT true,
    auto_renew BOOLEAN DEFAULT true,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_subscriptions_user ON subscriptions(user_id);
```

---

## Tabel — Emergency Fund & Forecasts

### emergency_fund_configs
```sql
CREATE TABLE emergency_fund_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id),
    target_months INTEGER NOT NULL DEFAULT 6,
    monthly_living_cost_override DECIMAL(15,2),  -- NULL = auto-calculate
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### forecasts
```sql
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
    daily_projections JSONB,             -- [{date, projected_balance}]
    calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_forecasts_user_month ON forecasts(user_id, month);
```

---

## Tabel — Alerts & Insights

### alerts
```sql
CREATE TABLE alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    type VARCHAR(50) NOT NULL,           -- bill_due, budget_warning, forecast_low, subscription_renewal, ef_low, parsing_review
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('info', 'warning', 'danger')),
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    action_url TEXT,
    action_label VARCHAR(100),
    entity_type VARCHAR(50),             -- bill, budget, transaction, etc.
    entity_id UUID,
    is_read BOOLEAN DEFAULT false,
    is_dismissed BOOLEAN DEFAULT false,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_alerts_user ON alerts(user_id);
CREATE INDEX idx_alerts_read ON alerts(user_id, is_read);
CREATE INDEX idx_alerts_type ON alerts(type);
```

### monthly_insights
```sql
CREATE TABLE monthly_insights (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    month VARCHAR(7) NOT NULL,
    insight_type VARCHAR(50) NOT NULL,   -- spending_increase, top_categories, cashflow_risk, networth_trend, recommendation
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    data JSONB,                          -- supporting data
    severity VARCHAR(20) CHECK (severity IN ('positive', 'neutral', 'negative')),
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_insights_user_month ON monthly_insights(user_id, month);
```

---

## Tabel — Operations

### audit_logs
```sql
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    entity_type VARCHAR(50) NOT NULL,    -- transaction, debt, asset, bill, etc.
    entity_id UUID NOT NULL,
    action VARCHAR(20) NOT NULL,         -- create, update, delete, reconcile, close
    old_value JSONB,
    new_value JSONB,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_audit_user ON audit_logs(user_id);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_created ON audit_logs(created_at);
```

### monthly_closings
```sql
CREATE TABLE monthly_closings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    month VARCHAR(7) NOT NULL,
    snapshot JSONB NOT NULL,             -- full snapshot data
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
```

### documents
```sql
CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    file_name VARCHAR(255) NOT NULL,
    file_path TEXT NOT NULL,
    file_type VARCHAR(50),
    file_size INTEGER,
    linked_entity_type VARCHAR(50),      -- transaction, asset, debt, bill
    linked_entity_id UUID,
    tags TEXT[],
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_documents_user ON documents(user_id);
CREATE INDEX idx_documents_entity ON documents(linked_entity_type, linked_entity_id);
```

### household_notes
```sql
CREATE TABLE household_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    title VARCHAR(255) NOT NULL,
    content TEXT,
    tags TEXT[],
    note_date DATE DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_notes_user ON household_notes(user_id);
```

### task_checklists
```sql
CREATE TABLE task_checklists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    due_date DATE,
    frequency VARCHAR(20) CHECK (frequency IN ('once', 'monthly', 'quarterly', 'yearly')),
    category VARCHAR(50),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'overdue', 'skipped')),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_tasks_user ON task_checklists(user_id);
CREATE INDEX idx_tasks_due ON task_checklists(due_date);
```

### automation_rules
```sql
CREATE TABLE automation_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    name VARCHAR(255) NOT NULL,
    trigger_type VARCHAR(50) NOT NULL,   -- balance_below, bill_due_soon, budget_exceeded, recurring_transaction
    condition JSONB NOT NULL,            -- {threshold: 1000000, account_id: "..."} 
    action_type VARCHAR(50) NOT NULL,    -- send_alert, send_telegram, create_transaction
    action_config JSONB NOT NULL,        -- action-specific config
    is_active BOOLEAN DEFAULT true,
    last_triggered_at TIMESTAMPTZ,
    trigger_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_rules_user ON automation_rules(user_id);
```

### scenarios
```sql
CREATE TABLE scenarios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    name VARCHAR(255) NOT NULL,
    changes JSONB NOT NULL,              -- [{type: "extra_debt_payment", params: {...}}]
    result JSONB NOT NULL,               -- impact analysis result
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_scenarios_user ON scenarios(user_id);
```

---

## Tabel — Security & Config

### vault_references
```sql
CREATE TABLE vault_references (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    name VARCHAR(255) NOT NULL,
    vault_item_id VARCHAR(255) NOT NULL, -- reference to Vaultwarden item
    type VARCHAR(50),                    -- pin, password, api_key, token
    linked_entity_type VARCHAR(50),      -- account, service
    linked_entity_id UUID,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_vault_user ON vault_references(user_id);
```

### currencies
```sql
CREATE TABLE currencies (
    code VARCHAR(3) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    symbol VARCHAR(10) NOT NULL,
    exchange_rate_to_idr DECIMAL(15,6) NOT NULL DEFAULT 1,
    last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed data
INSERT INTO currencies (code, name, symbol, exchange_rate_to_idr) VALUES
    ('IDR', 'Indonesian Rupiah', 'Rp', 1),
    ('USD', 'US Dollar', '$', 16500),
    ('SGD', 'Singapore Dollar', 'S$', 12300),
    ('EUR', 'Euro', '€', 17800);
```

### refresh_tokens
```sql
CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    token_hash VARCHAR(255) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    is_revoked BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_hash ON refresh_tokens(token_hash);
```
