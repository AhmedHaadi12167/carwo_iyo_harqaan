-- ============================================================
-- Migration: expand payment methods to the shop's actual banks
-- Run: psql -U postgres -d tailors_db -f database/add-payment-methods.sql
--
-- Existing payment rows keep their old method value (cash/evc/edahab/bank/
-- other) — nothing is renamed or touched, so old records display exactly as
-- before. Only NEW payments going forward use the 10 methods below.
-- ============================================================

BEGIN;

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_method_check;

ALTER TABLE payments ADD CONSTRAINT payments_method_check CHECK (
  method IN (
    -- legacy values — kept so old rows stay valid, not offered in the UI anymore
    'evc', 'bank', 'other',
    -- current 10 methods
    'premier_bank', 'ibs_bank', 'salaam_bank', 'my_bank', 'dahabshiil_bank',
    'edahab', 'merchant', 'evc_plus', 'my_cash', 'cash'
  )
);

COMMIT;
