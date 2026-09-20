-- ============================================================
-- Clear ALL test data before going live with real customers.
-- Keeps the `users` table untouched — every staff login stays exactly
-- as it is (admin, salesman, tailor, master_tailor, cashier accounts,
-- staff numbers, passwords — nothing here is touched).
--
-- Wipes: customers, orders, order items, payments, fabrics, fabric
-- movements, expenses, capital entries, assets, recurring expenses/
-- postings, and the sync outbox/cursor/dedupe tables.
--
-- RESTART IDENTITY resets every id counter back to 1, so your first
-- real customer/order/fabric starts clean at id 1 again.
--
-- Run: psql -U postgres -d tailors_db -f database/reset-test-data.sql
-- ============================================================

BEGIN;

TRUNCATE TABLE
  order_items,
  payments,
  fabric_movements,
  orders,
  customers,
  fabrics,
  expenses,
  capital_entries,
  assets,
  recurring_postings,
  recurring_expenses,
  sync_outbox,
  sync_cursor,
  sync_applied
RESTART IDENTITY CASCADE;

COMMIT;
