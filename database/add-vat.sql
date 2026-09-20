-- ============================================================
-- Migration: 5% VAT on non-cash payment methods
-- Cash payments are never taxed; every other method (bank, mobile
-- money, EVC, eDahab, merchant, etc.) has 5% VAT calculated on the
-- payment amount and tracked alongside it.
--
-- VAT raises what the customer owes: Total = price + VAT collected so
-- far, and Balance = Total - amount paid so far. A cash-only order has
-- vat_collected = 0, so balance behaves exactly as before.
--
-- Run: psql -U postgres -d tailors_db -f database/add-vat.sql
-- ============================================================

BEGIN;

ALTER TABLE payments ADD COLUMN IF NOT EXISTS vat_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

-- The view is DROPped and recreated rather than CREATE OR REPLACE'd.
-- CREATE OR REPLACE VIEW can only ever APPEND columns, so replacing a
-- five-column definition over a later six-column one fails outright with
-- "cannot drop columns from view". That made the migrations order-dependent
-- and impossible to re-run. Dropping first removes the constraint entirely:
-- nothing else depends on this view, so it is safe, and column order no
-- longer matters.
DROP VIEW IF EXISTS order_finance;
CREATE VIEW order_finance AS
SELECT
  o.id AS order_id,
  o.price,
  COALESCE(p.paid, 0)::NUMERIC(12,2) AS paid,
  (o.price + COALESCE(p.vat, 0) - COALESCE(p.paid, 0))::NUMERIC(12,2) AS balance,
  CASE
    WHEN o.price > 0 AND COALESCE(p.paid,0) >= (o.price + COALESCE(p.vat, 0)) THEN 'paid'
    WHEN COALESCE(p.paid,0) > 0 THEN 'partial'
    ELSE 'unpaid'
  END AS payment_status,
  COALESCE(p.vat, 0)::NUMERIC(12,2) AS vat_collected
FROM orders o
LEFT JOIN (
  SELECT order_id, SUM(amount) AS paid, SUM(vat_amount) AS vat
  FROM payments GROUP BY order_id
) p ON p.order_id = o.id;

COMMIT;
