-- Remove CHECK constraints added in 000019
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS chk_transactions_amount_positive;
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS chk_transactions_confidence_range;
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS chk_transactions_exchange_rate_positive;
ALTER TABLE transaction_splits DROP CONSTRAINT IF EXISTS chk_splits_amount_positive;
ALTER TABLE transaction_attachments DROP CONSTRAINT IF EXISTS chk_attachments_size_positive;
ALTER TABLE bills DROP CONSTRAINT IF EXISTS chk_bills_amount_positive;
ALTER TABLE bill_payments DROP CONSTRAINT IF EXISTS chk_bill_payments_amount_positive;
ALTER TABLE debts DROP CONSTRAINT IF EXISTS chk_debts_outstanding_non_negative;
ALTER TABLE debts DROP CONSTRAINT IF EXISTS chk_debts_rate_non_negative;
ALTER TABLE debts DROP CONSTRAINT IF EXISTS chk_debts_min_payment_non_negative;
ALTER TABLE debt_payments DROP CONSTRAINT IF EXISTS chk_debt_payments_amount_positive;
ALTER TABLE debt_payments DROP CONSTRAINT IF EXISTS chk_debt_payments_principal_non_negative;
ALTER TABLE debt_payments DROP CONSTRAINT IF EXISTS chk_debt_payments_interest_non_negative;
ALTER TABLE assets DROP CONSTRAINT IF EXISTS chk_assets_current_value_non_negative;
ALTER TABLE asset_valuations DROP CONSTRAINT IF EXISTS chk_asset_valuations_value_non_negative;
