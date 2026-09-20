-- ============================================================
-- Wipe all orders and customers, and permanently purge the staff
-- accounts that were already removed (active = FALSE).
--
-- THIS CANNOT BE UNDONE. Take a backup first:
--   pg_dump -U postgres tailors_db > backup-before-wipe.sql
--
-- Run: psql -U postgres -d tailors_db -f database/wipe-orders-customers.sql
--
-- RUN IT ON BOTH DATABASES (the shop POS and the cloud VPS).
-- If you wipe only one side, the other side still holds the orders and
-- will push them straight back the next time it syncs — which is also why
-- the sync bookkeeping tables are cleared below. Clearing them on both
-- sides at the same time is what makes the wipe stick.
--
-- WHAT IS KEPT
--   * every ACTIVE staff account (Yahya and anyone else still switched on)
--   * the whole fabric catalogue
--   * expenses, capital entries, assets, recurring expenses
--
-- WHAT IS REMOVED
--   * every order, order item and payment
--   * every customer
--   * stock movements that belonged to those orders
--   * staff accounts already marked removed
--
-- NOTE ON FABRIC STOCK: metres consumed by the deleted orders are NOT put
-- back on the shelf. Deleting the paperwork does not un-cut the cloth. If
-- this is test data and you do want the stock returned, see the optional
-- block at the very bottom.
-- ============================================================

BEGIN;

-- ---------- 1. Show what is about to go (appears in the psql output) ----------
\echo '--- BEFORE ---'
SELECT
  (SELECT COUNT(*) FROM orders)    AS orders,
  (SELECT COUNT(*) FROM payments)  AS payments,
  (SELECT COUNT(*) FROM customers) AS customers,
  (SELECT COUNT(*) FROM users WHERE active)       AS staff_kept,
  (SELECT COUNT(*) FROM users WHERE NOT active)   AS staff_to_purge;

\echo '--- staff being KEPT ---'
SELECT id, name, username, role FROM users WHERE active ORDER BY id;

\echo '--- staff being DELETED ---'
SELECT id, name, username, role FROM users WHERE NOT active ORDER BY id;

-- ---------- 2. Safety catch ----------
-- Refuse to run if it would leave the system with no admin to log in as.
DO $$
BEGIN
  IF (SELECT COUNT(*) FROM users WHERE active AND role = 'admin') = 0 THEN
    RAISE EXCEPTION 'Refusing to run: no ACTIVE admin account would be left. '
                    'Re-activate an admin first.';
  END IF;
END $$;

-- ---------- 3. Orders, payments, customers ----------
-- Stock movements point at orders by plain id with no foreign key, so they
-- are cleared explicitly rather than being carried off by the cascade.
DELETE FROM fabric_movements WHERE order_id IS NOT NULL;

-- order_items and payments carry ON DELETE CASCADE from orders; customers
-- are only reachable once the orders referencing them are gone. RESTART
-- IDENTITY puts the id counters back to 1 so the next real order is #1.
TRUNCATE TABLE order_items, payments, orders, customers
  RESTART IDENTITY CASCADE;

-- ---------- 4. Sync bookkeeping ----------
-- The outbox is a replay log of every order ever written. Left in place it
-- would re-create everything just deleted on the next sync tick.
TRUNCATE TABLE sync_outbox, sync_cursor, sync_applied RESTART IDENTITY;

-- ---------- 5. Purge removed staff ----------
-- Anything still pointing at those accounts is detached first, so the
-- delete cannot fail on a foreign key. Their expenses and stock movements
-- survive with a blank "handled by" rather than disappearing.
UPDATE fabric_movements SET created_by = NULL
  WHERE created_by IN (SELECT id FROM users WHERE NOT active);
UPDATE expenses SET created_by = NULL
  WHERE created_by IN (SELECT id FROM users WHERE NOT active);
UPDATE capital_entries SET created_by = NULL
  WHERE created_by IN (SELECT id FROM users WHERE NOT active);

DELETE FROM users WHERE NOT active;

-- ---------- 6. Confirm ----------
\echo '--- AFTER ---'
SELECT
  (SELECT COUNT(*) FROM orders)    AS orders,
  (SELECT COUNT(*) FROM payments)  AS payments,
  (SELECT COUNT(*) FROM customers) AS customers,
  (SELECT COUNT(*) FROM users)     AS staff_remaining;

SELECT id, name, username, role, active FROM users ORDER BY id;

COMMIT;

-- ============================================================
-- OPTIONAL — only if this was test data and you want the fabric
-- metres those orders consumed put back on the shelf. Run it BEFORE
-- the script above, never after (once the orders are gone there is
-- nothing left to work out the quantities from).
--
--   BEGIN;
--   UPDATE fabrics f SET quantity_meters = quantity_meters + x.m
--   FROM (SELECT fabric_id, SUM(meters) AS m FROM order_items
--         WHERE fabric_id IS NOT NULL GROUP BY fabric_id) x
--   WHERE f.id = x.fabric_id;
--   COMMIT;
-- ============================================================
