-- ============================================================
-- Migration: VAT moves from the PAYMENT to the ORDER, plus
--            soft-deleted (hidden) orders.
-- Run this SAME file on BOTH databases — the POS's local Postgres
-- AND the cloud Postgres.
-- Run: psql -U postgres -d tailors_db -f database/add-order-vat-and-soft-delete.sql
--
-- WHY
-- ---
-- VAT used to be worked out per payment: 5% of whatever was handed over,
-- on non-cash methods. That produced a balance that could never reach zero.
-- Price $50, customer pays $50 by bank:
--     VAT 2.50  ->  balance = 50 + 2.50 - 50 = 2.50   (PARTIAL)
--   pay that 2.50 -> VAT 0.125 -> balance 0.125       (STILL PARTIAL)
--   ... and so on forever, because every payment created new tax.
--
-- Now the VAT is decided ONCE, when the price is charged, and it is part of
-- what the customer owes from the very first moment:
--     Price   50.00
--     VAT      2.50   (5%, because the order is billed to a non-cash method)
--     Total   52.50   <- pay this and the order is PAID
-- Cash orders are not taxed at all, so Total = Price, exactly as before.
-- ============================================================

BEGIN;

-- ---------- 1. VAT now lives on the order ----------
-- vat_method  = the payment method the order is billed under. 'cash' means
--               no VAT. It is set when the order is created and can be
--               changed later by an admin editing the order.
-- vat_amount  = the money value of that VAT, frozen on the row so a receipt
--               printed today and the same receipt reprinted next year agree
--               even if the rate is ever changed.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS vat_method TEXT NOT NULL DEFAULT 'cash';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS vat_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

-- ---------- 2. Hidden (soft-deleted) orders ----------
-- Deleting an order no longer removes anything. The row stays exactly where
-- it is and simply stops being visible: it drops out of every list, report,
-- dashboard figure and finance total. Set deleted_at back to NULL to bring
-- it back, with its items, payments and history completely intact.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_orders_not_deleted ON orders (id) WHERE deleted_at IS NULL;

-- ---------- 3. Backfill existing orders ----------
-- Every order that already exists gets its VAT recalculated under the new
-- rule. An order counts as non-cash if the first payment taken against it
-- used a non-cash method — that is the same method the salesman would have
-- picked on the order form today. Orders with no payments yet, and orders
-- whose first payment was cash, become cash orders with no VAT.
UPDATE orders o
SET vat_method = COALESCE(first_pay.method, 'cash')
FROM (
  SELECT DISTINCT ON (order_id) order_id, method
  FROM payments
  ORDER BY order_id, created_at, id
) AS first_pay
WHERE first_pay.order_id = o.id;

UPDATE orders
SET vat_amount = CASE
  WHEN vat_method = 'cash' THEN 0
  ELSE ROUND(price * 0.05, 2)
END;

-- The per-payment VAT column is now purely historical. Zero it so nothing
-- can accidentally double-count tax that is already carried on the order.
UPDATE payments SET vat_amount = 0 WHERE vat_amount <> 0;

-- ---------- 4. Finance view ----------
-- Total  = price + the order's own VAT
-- Balance= that total, minus everything paid so far
-- Paid   = the customer has handed over the whole total
--
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
  (o.price + o.vat_amount - COALESCE(p.paid, 0))::NUMERIC(12,2) AS balance,
  CASE
    WHEN (o.price + o.vat_amount) > 0 AND COALESCE(p.paid,0) >= (o.price + o.vat_amount) THEN 'paid'
    WHEN COALESCE(p.paid,0) > 0 THEN 'partial'
    ELSE 'unpaid'
  END AS payment_status,
  o.vat_amount::NUMERIC(12,2) AS vat_collected,
  (o.price + o.vat_amount)::NUMERIC(12,2) AS total
FROM orders o
LEFT JOIN (
  SELECT order_id, SUM(amount) AS paid
  FROM payments GROUP BY order_id
) p ON p.order_id = o.id;

-- ---------- 5. Sync: allow the delete/restore events ----------
-- The old CHECK constraint did not list 'order_deleted', so deleting an
-- order crashed the API with:
--   new row for relation "sync_outbox" violates check constraint
--   "sync_outbox_entity_check"
ALTER TABLE sync_outbox DROP CONSTRAINT IF EXISTS sync_outbox_entity_check;
ALTER TABLE sync_outbox ADD CONSTRAINT sync_outbox_entity_check CHECK (entity IN (
  'order_created', 'order_status', 'order_cancelled',
  'order_edited', 'order_tailor',
  'order_payment', 'order_payment_deleted',
  'order_deleted', 'order_restored'
));

COMMIT;
