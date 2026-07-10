-- Categories table
CREATE TABLE IF NOT EXISTS categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES categories(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('income', 'expense')),
    icon VARCHAR(50),
    color VARCHAR(7),
    is_system BOOLEAN DEFAULT false,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_categories_user ON categories(user_id);
CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id);

-- Seed System Default Categories
-- Expense Categories
INSERT INTO categories (name, type, icon, color, is_system, sort_order) VALUES
('Makan & Minum', 'expense', 'Utensils', '#F59E0B', true, 1),
('Transportasi', 'expense', 'Car', '#3B82F6', true, 2),
('Listrik & Utilitas', 'expense', 'Zap', '#EF4444', true, 3),
('Hiburan & Rekreasi', 'expense', 'Gamepad2', '#EC4899', true, 4),
('Kesehatan & Medis', 'expense', 'HeartPulse', '#10B981', true, 5),
('Belanja Bulanan', 'expense', 'ShoppingBag', '#8B5CF6', true, 6),
('Pendidikan', 'expense', 'GraduationCap', '#F59E0B', true, 7),
('Donasi & Sosial', 'expense', 'Gift', '#EC4899', true, 8),
('Pengeluaran Lainnya', 'expense', 'HelpCircle', '#6B7280', true, 9)
ON CONFLICT DO NOTHING;

-- Income Categories
INSERT INTO categories (name, type, icon, color, is_system, sort_order) VALUES
('Gaji & Upah', 'income', 'Briefcase', '#10B981', true, 1),
('Investasi & Dividen', 'income', 'TrendingUp', '#8B5CF6', true, 2),
('Bisnis & Freelance', 'income', 'Store', '#3B82F6', true, 3),
('Pemasukan Lainnya', 'income', 'DollarSign', '#10B981', true, 4)
ON CONFLICT DO NOTHING;

-- Transactions table
CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    target_account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
    category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('income', 'expense', 'transfer')),
    amount DECIMAL(15,2) NOT NULL,
    date DATE NOT NULL,
    description TEXT,
    notes TEXT,
    is_split BOOLEAN DEFAULT false,
    source VARCHAR(20) DEFAULT 'manual' CHECK (source IN ('manual', 'ocr', 'pdf_parse', 'recurring', 'ai_suggested')),
    source_confidence DECIMAL(3,2),
    status VARCHAR(20) DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'pending_review', 'draft')),
    reconciled BOOLEAN DEFAULT false,
    bill_id UUID,
    debt_payment_id UUID,
    currency VARCHAR(3) DEFAULT 'IDR',
    exchange_rate DECIMAL(15,6) DEFAULT 1,
    tags TEXT[],
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);

-- Transaction splits table
CREATE TABLE IF NOT EXISTS transaction_splits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    amount DECIMAL(15,2) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_splits_transaction ON transaction_splits(transaction_id);

-- Transaction attachments table
CREATE TABLE IF NOT EXISTS transaction_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    file_name VARCHAR(255) NOT NULL,
    file_path TEXT NOT NULL,
    file_type VARCHAR(50),
    file_size INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attachments_transaction ON transaction_attachments(transaction_id);

-- Audit logs table
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID NOT NULL,
    action VARCHAR(20) NOT NULL,
    old_value JSONB,
    new_value JSONB,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
