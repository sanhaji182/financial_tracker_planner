-- Add CHECK constraints to prevent invalid financial data
-- These constraints enforce data integrity at the database level

-- Transactions: amount must be positive
ALTER TABLE transactions ADD CONSTRAINT chk_transactions_amount_positive
    CHECK (amount > 0);

-- Transactions: source_confidence must be between 0 and 1
ALTER TABLE transactions ADD CONSTRAINT chk_transactions_confidence_range
    CHECK (source_confidence IS NULL OR (source_confidence >= 0 AND source_confidence <= 1));

-- Transaction splits: amount must be positive
ALTER TABLE transaction_splits ADD CONSTRAINT chk_splits_amount_positive
    CHECK (amount > 0);

-- Transaction attachments: file_size must be positive
ALTER TABLE transaction_attachments ADD CONSTRAINT chk_attachments_size_positive
    CHECK (file_size IS NULL OR file_size > 0);

-- Bills: amount must be positive
ALTER TABLE bills ADD CONSTRAINT chk_bills_amount_positive
    CHECK (amount > 0);

-- Bill payments: amount must be positive
ALTER TABLE bill_payments ADD CONSTRAINT chk_bill_payments_amount_positive
    CHECK (amount > 0);

-- Debts: outstanding_balance must be non-negative
ALTER TABLE debts ADD CONSTRAINT chk_debts_outstanding_non_negative
    CHECK (outstanding_balance >= 0);

-- Debts: interest_rate must be non-negative
ALTER TABLE debts ADD CONSTRAINT chk_debts_rate_non_negative
    CHECK (interest_rate IS NULL OR interest_rate >= 0);

-- Debts: minimum_payment must be non-negative
ALTER TABLE debts ADD CONSTRAINT chk_debts_min_payment_non_negative
    CHECK (minimum_payment IS NULL OR minimum_payment >= 0);

-- Debt payments: amount must be positive
ALTER TABLE debt_payments ADD CONSTRAINT chk_debt_payments_amount_positive
    CHECK (amount > 0);

-- Debt payments: principal_portion must be non-negative
ALTER TABLE debt_payments ADD CONSTRAINT chk_debt_payments_principal_non_negative
    CHECK (principal_portion IS NULL OR principal_portion >= 0);

-- Debt payments: interest_portion must be non-negative
ALTER TABLE debt_payments ADD CONSTRAINT chk_debt_payments_interest_non_negative
    CHECK (interest_portion IS NULL OR interest_portion >= 0);

-- Assets: current_value must be non-negative
ALTER TABLE assets ADD CONSTRAINT chk_assets_current_value_non_negative
    CHECK (current_value >= 0);

-- Asset valuations: value must be non-negative
ALTER TABLE asset_valuations ADD CONSTRAINT chk_asset_valuations_value_non_negative
    CHECK (value >= 0);

-- Transactions: exchange_rate must be positive
ALTER TABLE transactions ADD CONSTRAINT chk_transactions_exchange_rate_positive
    CHECK (exchange_rate > 0);
