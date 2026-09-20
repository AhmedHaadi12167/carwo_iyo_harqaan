-- ============================================================
-- RUN ALL MIGRATIONS, in dependency order, on a fresh tailors_db
-- that has only had schema.sql loaded.
--
--   pgAdmin:  right-click tailors_db -> Query Tool -> Open File -> F5
--   cmd:      psql -U postgres -d tailors_db -f database/migrate-all.sql
--
-- Every step uses IF NOT EXISTS / DROP IF EXISTS, so this is safe to run
-- more than once. The whole thing is ONE transaction: if any step fails,
-- nothing is applied and you can re-run after fixing it.
--
-- Order matters in three places:
--   * add-vat  must precede  add-order-vat-and-soft-delete
--     (the latter does UPDATE payments SET vat_amount = 0)
--   * add-sync must precede  add-order-vat-and-soft-delete
--     (the latter alters the sync_outbox CHECK constraint)
--   * add-branches must come after add-finance and add-recurring (it adds
--     branch_id to the tables they create)
--   * add-staff-unique-contacts replaces the phone index created by
--     add-staff-phone and needs every staff row already in place
--   * add-products runs LAST -- it rebuilds order_finance on top of the
--     VAT work and needs branches to exist before products can belong to one.
-- ============================================================

BEGIN;


-- ==========================================================
-- >>> add-tailor-role.sql
-- ==========================================================
-- ============================================================
-- Migration: add TAILOR role + order claiming
-- Run on your existing database:
--   psql -U postgres -d tailors_db -f database/add-tailor-role.sql
-- ============================================================

-- 1. Allow the new 'tailor' role in users
--
-- Written to only ever WIDEN the allowed set, never narrow it. Re-running this
-- file after later migrations have added master_tailor, cashier or superadmin
-- would otherwise re-impose the original three-role list and be rejected by
-- the rows those later migrations created:
--   ERROR: check constraint "users_role_check" is violated by some row
-- Any role already present in the table is therefore carried forward.
DO $roles$
DECLARE
  allowed TEXT[] := ARRAY['admin', 'salesman', 'tailor'];
  present TEXT[];
BEGIN
  SELECT COALESCE(array_agg(DISTINCT role), '{}') INTO present
  FROM users WHERE role <> ALL (allowed);

  allowed := allowed || present;

  EXECUTE 'ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check';
  EXECUTE format(
    'ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role = ANY (%L::text[]))',
    allowed);
END
$roles$;

-- 2. Track which tailor claimed each order (one tailor per order)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tailor_id INT REFERENCES users(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_orders_tailor ON orders (tailor_id);

-- 3. Example tailor account (password: tailor123 — CHANGE IT after login).
--    This hash is bcrypt for 'tailor123'.
--
--    Written as a DO block rather than INSERT ... ON CONFLICT DO NOTHING
--    because of two things that only bite once branches exist:
--      * CHECK constraints are evaluated BEFORE the ON CONFLICT clause is
--        considered, so on a re-run the row would fail
--        users_branch_role_check (no branch) even though the username
--        already exists and nothing needed inserting.
--      * Once add-branches.sql has run, every non-superadmin needs a
--        branch, so this sample account has to join the main branch.
--    The column may or may not exist yet depending on run order, so both
--    cases are handled explicitly.
DO $tailor$
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE LOWER(username) = 'tailor') THEN
    RETURN; -- already present, leave it exactly as it is
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'branch_id') THEN
    INSERT INTO users (name, username, password_hash, role, branch_id)
    SELECT 'Master Tailor', 'tailor',
           '$2b$10$NpORaupBkpGKQ2mE6jEByeFWmGnnDZHtORLIhBsm20giS.HhsUmly',
           'tailor', b.id
    FROM branches b
    ORDER BY (b.code = 'MAIN') DESC, b.id
    LIMIT 1;
  ELSE
    INSERT INTO users (name, username, password_hash, role)
    VALUES ('Master Tailor', 'tailor',
            '$2b$10$NpORaupBkpGKQ2mE6jEByeFWmGnnDZHtORLIhBsm20giS.HhsUmly',
            'tailor');
  END IF;
END
$tailor$;

-- To add more tailors later (or use the Staff page in the app):
-- INSERT INTO users (name, username, password_hash, role)
-- VALUES ('Tailor Name', 'username', '<bcrypt hash>', 'tailor');


-- ==========================================================
-- >>> add-staff-phone.sql
-- ==========================================================
-- ============================================================
-- Migration: staff phone numbers (login with username OR phone)
-- Run: psql -U postgres -d tailors_db -f database/add-staff-phone.sql
-- ============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;

-- Phone must be unique when set (it is a login identifier)
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone
  ON users (phone) WHERE phone IS NOT NULL;


-- ==========================================================
-- >>> add-finance.sql
-- ==========================================================
-- ============================================================
-- Migration: FINANCE module (expenses, capital, fixed assets)
-- Run: psql -U postgres -d tailors_db -f database/add-finance.sql
-- ============================================================

-- Operating expenses: salary, rent, tax, utilities, etc.
CREATE TABLE IF NOT EXISTS expenses (
  id           SERIAL PRIMARY KEY,
  category     TEXT NOT NULL CHECK (category IN ('salary','rent','tax','utilities','supplies','marketing','other')),
  description  TEXT,
  amount       NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by   INT REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses (expense_date);

-- Capital: money the owner puts IN (investment) or takes OUT (withdrawal)
CREATE TABLE IF NOT EXISTS capital_entries (
  id          SERIAL PRIMARY KEY,
  type        TEXT NOT NULL CHECK (type IN ('investment','withdrawal')),
  description TEXT,
  amount      NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  entry_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by  INT REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fixed assets: sewing machines, POS, furniture, vehicles…
CREATE TABLE IF NOT EXISTS assets (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  category      TEXT NOT NULL DEFAULT 'equipment' CHECK (category IN ('equipment','furniture','vehicle','electronics','other')),
  cost          NUMERIC(12,2) NOT NULL CHECK (cost >= 0),
  purchase_date DATE,
  notes         TEXT,
  active        BOOLEAN NOT NULL DEFAULT TRUE,   -- FALSE = sold / written off
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ==========================================================
-- >>> add-recurring.sql
-- ==========================================================
-- ============================================================
-- Migration: RECURRING expenses (rent…) + staff salaries
-- Run: psql -U postgres -d tailors_db -f database/add-recurring.sql
-- ============================================================

-- Monthly salary per staff member (0 = no automatic salary)
ALTER TABLE users ADD COLUMN IF NOT EXISTS salary NUMERIC(12,2) NOT NULL DEFAULT 0;

-- Fixed monthly costs recorded ONCE (rent, fixed utilities, tax…)
CREATE TABLE IF NOT EXISTS recurring_expenses (
  id          SERIAL PRIMARY KEY,
  category    TEXT NOT NULL CHECK (category IN ('rent','utilities','tax','other')),
  description TEXT,
  amount      NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ledger of what was auto-posted for which month (prevents double-posting;
-- if the admin deletes a posted expense, that month is NOT posted again)
CREATE TABLE IF NOT EXISTS recurring_postings (
  id         SERIAL PRIMARY KEY,
  source     TEXT NOT NULL CHECK (source IN ('recurring','salary')),
  source_id  INT NOT NULL,           -- recurring_expenses.id or users.id
  period     TEXT NOT NULL,          -- 'YYYY-MM'
  expense_id INT REFERENCES expenses(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, source_id, period)
);


-- ==========================================================
-- >>> add-fabric-image.sql
-- ==========================================================
-- ============================================================
-- Migration: fabric photos
-- Run: psql -U postgres -d tailors_db -f database/add-fabric-image.sql
-- ============================================================

ALTER TABLE fabrics ADD COLUMN IF NOT EXISTS image TEXT; -- compressed JPEG data URL


-- ==========================================================
-- >>> add-sync.sql
-- ==========================================================
-- ============================================================
-- Migration: OFFLINE-POS <-> CLOUD sync (outbox pattern)
-- Run this SAME file on BOTH databases — the POS's local Postgres
-- AND the cloud Postgres — since both sides need identical tables.
-- Run: psql -U postgres -d tailors_db -f database/add-sync.sql
-- ============================================================

-- Every meaningful write to an order/payment gets logged here, on the
-- database it was written to. The sync client reads new rows out of this
-- table and ships them to the other side. Nothing is ever deleted from here
-- automatically — it's a permanent audit trail as a side benefit.
CREATE TABLE IF NOT EXISTS sync_outbox (
  id         BIGSERIAL PRIMARY KEY,
  entity     TEXT NOT NULL CHECK (entity IN (
               'order_created', 'order_status', 'order_cancelled',
               'order_edited', 'order_tailor',
               'order_payment', 'order_payment_deleted'
             )),
  order_no   TEXT NOT NULL,           -- stable key shared by both databases
  payload    JSONB NOT NULL,
  origin     TEXT NOT NULL CHECK (origin IN ('pos','cloud')),
  client_ref TEXT,                    -- idempotency key (payments/deletes)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sync_outbox_origin_id ON sync_outbox (origin, id);
CREATE INDEX IF NOT EXISTS idx_sync_outbox_order_no ON sync_outbox (order_no);

-- Remembers how far the sync client has pushed/pulled, so a restart doesn't
-- resend or reprocess everything from the beginning.
CREATE TABLE IF NOT EXISTS sync_cursor (
  peer       TEXT PRIMARY KEY,        -- e.g. 'cloud_pushed', 'cloud_pulled'
  last_id    BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Guards against double-applying an incoming entry if a push/pull is retried
-- after a dropped connection (network hiccups are expected, not exceptional).
CREATE TABLE IF NOT EXISTS sync_applied (
  client_ref TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotency key for payments — generated once at creation time and carried
-- through the sync payload, so a replayed sync never creates a duplicate
-- payment row.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS client_ref TEXT UNIQUE;


-- ==========================================================
-- >>> add-payment-methods.sql
-- ==========================================================
-- ============================================================
-- Migration: expand payment methods to the shop's actual banks
-- Run: psql -U postgres -d tailors_db -f database/add-payment-methods.sql
--
-- Existing payment rows keep their old method value (cash/evc/edahab/bank/
-- other) — nothing is renamed or touched, so old records display exactly as
-- before. Only NEW payments going forward use the 10 methods below.
-- ============================================================

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


-- ==========================================================
-- >>> add-master-tailor-cashier.sql
-- ==========================================================
-- ============================================================
-- Migration: MASTER TAILOR + CASHIER roles, and staff numbers
-- Run: psql -U postgres -d tailors_db -f database/add-master-tailor-cashier.sql
--
--  master_tailor — sees ALL orders that need tailoring (measurements/items/
--                  dates only, never money), assigns/reassigns any tailor by
--                  staff number, marks jobs In Progress / Completed, and can
--                  print the same money-free job sheet as the salesman.
--  cashier       — cannot create orders; only sees orders with a balance due
--                  and can collect payment. No status changes, no cancelling,
--                  no tailor assignment, no editing.
-- ============================================================

-- 1. Allow the two new roles.
-- Only ever WIDENS the allowed set: re-running this after add-branches.sql has
-- introduced 'superadmin' must not re-impose a list that excludes it. See the
-- same guard in add-tailor-role.sql.
DO $roles$
DECLARE
  allowed TEXT[] := ARRAY['admin', 'salesman', 'tailor', 'master_tailor', 'cashier'];
  present TEXT[];
BEGIN
  SELECT COALESCE(array_agg(DISTINCT role), '{}') INTO present
  FROM users WHERE role <> ALL (allowed);

  allowed := allowed || present;

  EXECUTE 'ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check';
  EXECUTE format(
    'ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role = ANY (%L::text[]))',
    allowed);
END
$roles$;

-- 2. Staff number — every role except admin gets one (ST001, ST002, ...)
ALTER TABLE users ADD COLUMN IF NOT EXISTS staff_no TEXT UNIQUE;

-- 3. Backfill existing non-admin staff with numbers, oldest account first,
--    so nobody who's already on the team is left without one. Starts after
--    the highest number already in use, so this is safe to run more than once.
DO $$
DECLARE
  u RECORD;
  n INT;
BEGIN
  SELECT COALESCE(MAX(SUBSTRING(staff_no FROM 3)::int), 0) INTO n
  FROM users WHERE staff_no ~ '^ST[0-9]+$';

  -- Superadmin excluded alongside admin: neither carries a staff number
  -- (they are not assignable workers), and on a re-run this loop would
  -- otherwise hand one to a superadmin created by a later migration.
  FOR u IN SELECT id FROM users WHERE role NOT IN ('admin', 'superadmin') AND staff_no IS NULL ORDER BY id LOOP
    n := n + 1;
    UPDATE users SET staff_no = 'ST' || LPAD(n::text, 3, '0') WHERE id = u.id;
  END LOOP;
END $$;


-- ==========================================================
-- >>> add-order-completed-at.sql
-- ==========================================================
-- Tracks the exact moment a garment was finished, independent of updated_at
-- (which shifts on any edit — price change, note edit, etc.). Used for the
-- tailor performance report (daily / weekly / monthly / all-time).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- Best-effort backfill for orders that were already completed/delivered
-- before this column existed — updated_at is the closest approximation we
-- have for historical rows.
UPDATE orders SET completed_at = updated_at
WHERE status IN ('completed', 'delivered') AND completed_at IS NULL;


-- ==========================================================
-- >>> add-vat.sql
-- ==========================================================
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


-- ==========================================================
-- >>> add-order-vat-and-soft-delete.sql
-- ==========================================================
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


-- ==========================================================
-- >>> add-password-reset.sql
-- ==========================================================
-- Adds an optional email address to staff accounts, and a table to back
-- the "Forgot password" flow (email OTP → verify → reset).
-- Run: psql -U postgres -d tailors_db -f database/add-password-reset.sql

ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;

-- One row per requested reset. The OTP is stored hashed (never plaintext),
-- expires quickly, and can only be used once — same pattern as a login
-- password, just short-lived.
CREATE TABLE IF NOT EXISTS password_resets (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  otp_hash    TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  verified    BOOLEAN NOT NULL DEFAULT FALSE,
  used        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets (user_id);


-- ==========================================================
-- >>> add-branches.sql
-- ==========================================================
-- ============================================================
-- Migration: BRANCHES (multi-branch support) + SUPERADMIN role
-- Run this SAME file on BOTH databases — the POS's local Postgres
-- AND the cloud Postgres.
-- Run: psql -U postgres -d tailors_db -f database/add-branches.sql
--
-- WHAT THIS DOES
-- --------------
-- Every piece of trading activity becomes owned by a branch: orders,
-- fabrics, staff, expenses, capital and assets. A branch admin sees only
-- their own branch. A new `superadmin` role sits above all branches and
-- sees everything, plus a combined report.
--
-- Customers stay SHARED across branches on purpose — the same person can
-- walk into two branches and should not become two records. Their orders
-- each carry a branch, so per-branch revenue and statements still split
-- correctly.
--
-- MIGRATING EXISTING DATA
-- -----------------------
-- Everything that already exists is moved into one branch called
-- 'Main Branch' (code MAIN), so nothing is orphaned and the system behaves
-- exactly as before until you add a second branch.
--
-- Safe to run more than once.
-- ============================================================

-- ---------- 1. The branches table ----------
CREATE TABLE IF NOT EXISTS branches (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  -- Short uppercase prefix used in order numbers (MAIN, HDN, BKR...).
  -- Kept deliberately short because it appears on every receipt.
  code       TEXT NOT NULL UNIQUE CHECK (code ~ '^[A-Z][A-Z0-9]{1,7}$'),
  phone      TEXT,
  address    TEXT,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- 2. The default branch that existing data belongs to ----------
INSERT INTO branches (name, code, active)
VALUES ('Main Branch', 'MAIN', TRUE)
ON CONFLICT (code) DO NOTHING;

-- ---------- 3. Roles: add superadmin ----------
-- A superadmin is the only role allowed to have branch_id = NULL, which is
-- what "belongs to no single branch, sees all of them" means.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('superadmin','admin','salesman','tailor','master_tailor','cashier'));

-- ---------- 4. branch_id on everything that trades ----------
ALTER TABLE users    ADD COLUMN IF NOT EXISTS branch_id INT REFERENCES branches(id);
ALTER TABLE fabrics  ADD COLUMN IF NOT EXISTS branch_id INT REFERENCES branches(id);
ALTER TABLE orders   ADD COLUMN IF NOT EXISTS branch_id INT REFERENCES branches(id);

-- Finance tables only exist once add-finance.sql / add-recurring.sql have
-- been run, so each is guarded independently.
DO $do$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['expenses','capital_entries','assets','recurring_expenses']
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD COLUMN IF NOT EXISTS branch_id INT REFERENCES branches(id)', t);
    END IF;
  END LOOP;
END
$do$;

-- ---------- 5. Backfill: everything existing joins Main Branch ----------
DO $do$
DECLARE
  main_id INT;
  t       TEXT;
BEGIN
  SELECT id INTO main_id FROM branches WHERE code = 'MAIN';

  -- Staff: every existing account belongs to Main Branch. The one exception
  -- is admins, who become branch admins of Main Branch — promote to
  -- superadmin deliberately afterwards, never silently here.
  --
  -- Superadmins are skipped explicitly. On a first run there are none, but on
  -- a RE-RUN (this file is meant to be safe to repeat) giving a superadmin a
  -- branch would violate users_branch_role_check, which requires their
  -- branch_id to stay NULL — that is what "belongs to every branch" means.
  UPDATE users   SET branch_id = main_id WHERE branch_id IS NULL AND role <> 'superadmin';
  UPDATE fabrics SET branch_id = main_id WHERE branch_id IS NULL;
  UPDATE orders  SET branch_id = main_id WHERE branch_id IS NULL;

  FOREACH t IN ARRAY ARRAY['expenses','capital_entries','assets','recurring_expenses']
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('UPDATE %I SET branch_id = $1 WHERE branch_id IS NULL', t)
        USING main_id;
    END IF;
  END LOOP;
END
$do$;

-- ---------- 6. Now that nothing is NULL, require it ----------
-- Orders and fabrics must always have a branch — an order that belongs to
-- nobody would silently vanish from every branch report.
ALTER TABLE orders  ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE fabrics ALTER COLUMN branch_id SET NOT NULL;

-- users.branch_id stays NULLABLE: NULL is precisely how a superadmin is
-- represented. Enforce the pairing instead, so no other role can be
-- branchless and no superadmin can be pinned to one branch.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_branch_role_check;
ALTER TABLE users ADD CONSTRAINT users_branch_role_check CHECK (
  (role = 'superadmin' AND branch_id IS NULL)
  OR (role <> 'superadmin' AND branch_id IS NOT NULL)
);

-- ---------- 7. Fabric codes are unique PER BRANCH, not globally ----------
-- Two branches legitimately stock the same fabric code as separate rolls,
-- each with its own quantity, cost and price.
ALTER TABLE fabrics DROP CONSTRAINT IF EXISTS fabrics_code_key;
DROP INDEX IF EXISTS fabrics_code_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_fabrics_branch_code
  ON fabrics (branch_id, UPPER(code));

-- ---------- 8. Indexes for the branch filter on every hot query ----------
CREATE INDEX IF NOT EXISTS idx_orders_branch        ON orders (branch_id);
CREATE INDEX IF NOT EXISTS idx_orders_branch_created ON orders (branch_id, created_at);
CREATE INDEX IF NOT EXISTS idx_fabrics_branch       ON fabrics (branch_id);
CREATE INDEX IF NOT EXISTS idx_users_branch         ON users (branch_id);

DO $do$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['expenses','capital_entries','assets','recurring_expenses']
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_branch ON %I (branch_id)', t, t);
    END IF;
  END LOOP;
END
$do$;

-- ---------- 9. Sync: branch travels with every order event ----------
-- Branch IDs are assigned independently by each database, so they can never
-- be sent over the wire. The branch CODE is what travels, and each side
-- resolves it to its own local id (see sync/apply.js).
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'sync_outbox') THEN
    ALTER TABLE sync_outbox ADD COLUMN IF NOT EXISTS branch_code TEXT;
  END IF;
END
$do$;


-- ==========================================================
-- >>> add-staff-unique-contacts.sql
-- ==========================================================
-- ============================================================
-- Migration: staff EMAIL and PHONE must each identify one person
-- Run this SAME file on BOTH databases (POS and cloud).
-- Run: psql -U postgres -d tailors_db -f database/add-staff-unique-contacts.sql
--
-- WHY
-- ---
-- email had no constraint at all, so the same address could sit on several
-- staff accounts. That matters because email is what "Forgot password" sends
-- the reset code to: with duplicates, the lookup picks a row arbitrarily and
-- one person can end up resetting another person's password.
--
-- phone already had a unique index, but only on the EXACT text. So
-- "+252 61 234 5678" and "+252612345678" were treated as two different
-- numbers even though they are one phone. Since phone is also a login
-- identifier, that ambiguity has the same consequence.
--
-- Both are now compared in a NORMALISED form:
--   email -> lower-cased and trimmed
--   phone -> digits only (spaces, dashes and + ignored)
--
-- Safe to run more than once.
-- ============================================================

-- ---------- 1. Normalise what is already stored ----------
-- Done first so the indexes below are built over clean values, and so the
-- duplicate detection sees the same thing the index will.
UPDATE users SET email = LOWER(TRIM(email))
WHERE email IS NOT NULL AND email <> LOWER(TRIM(email));

UPDATE users SET email = NULL
WHERE email IS NOT NULL AND TRIM(email) = '';

UPDATE users SET phone = TRIM(phone)
WHERE phone IS NOT NULL AND phone <> TRIM(phone);

UPDATE users SET phone = NULL
WHERE phone IS NOT NULL AND TRIM(phone) = '';

-- ---------- 2. Resolve duplicate EMAILS automatically ----------
-- The address stays on the account that has held it longest and is cleared
-- from the newer ones. This is deliberately automatic and deliberately
-- non-destructive: email is optional, is used only for password resets, and
-- an admin can simply type the right address back onto the right person.
-- Nobody loses the ability to log in, because email is not a login field.
DO $dedupe_email$
DECLARE
  r RECORD;
  n INT := 0;
BEGIN
  FOR r IN
    SELECT id, name, email FROM users u
    WHERE email IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM users u2
        WHERE u2.email = u.email AND u2.id < u.id
      )
  LOOP
    RAISE NOTICE 'Duplicate email "%" removed from % (id %) - kept on the older account',
      r.email, r.name, r.id;
    UPDATE users SET email = NULL WHERE id = r.id;
    n := n + 1;
  END LOOP;

  IF n > 0 THEN
    RAISE NOTICE '% duplicate email(s) cleared. Re-enter the correct address on the Staff page.', n;
  END IF;
END
$dedupe_email$;

-- ---------- 3. Refuse to guess about duplicate PHONES ----------
-- Phone IS a login identifier, so clearing one would silently stop a real
-- member of staff signing in. That is not a decision a migration should make
-- on its own, so this stops with a message naming exactly who is affected.
-- The whole migration rolls back; fix the numbers and run it again.
DO $check_phone$
DECLARE
  dupes TEXT;
BEGIN
  SELECT string_agg(detail, E'\n  ') INTO dupes
  FROM (
    SELECT regexp_replace(phone, '[^0-9]', '', 'g') || '  ->  ' ||
           string_agg(name || ' (' || username || ')', ', ' ORDER BY id) AS detail
    FROM users
    WHERE phone IS NOT NULL AND regexp_replace(phone, '[^0-9]', '', 'g') <> ''
    GROUP BY regexp_replace(phone, '[^0-9]', '', 'g')
    HAVING COUNT(*) > 1
  ) d;

  IF dupes IS NOT NULL THEN
    RAISE EXCEPTION E'Two or more staff share a phone number (ignoring spaces and dashes):\n  %\n\nPhone is a login identifier, so this migration will not choose which account keeps it. Correct the numbers on the Staff page, then run this file again.', dupes;
  END IF;
END
$check_phone$;

-- ---------- 4. The constraints themselves ----------
-- Expression indexes rather than plain UNIQUE columns, so that formatting
-- differences can never reintroduce a duplicate. Both are partial (WHERE ...
-- IS NOT NULL) because both fields are optional and any number of staff may
-- legitimately have none.
DROP INDEX IF EXISTS idx_users_email_unique;
CREATE UNIQUE INDEX idx_users_email_unique
  ON users (LOWER(email)) WHERE email IS NOT NULL;

-- Replaces the old exact-text index from add-staff-phone.sql.
DROP INDEX IF EXISTS idx_users_phone;
DROP INDEX IF EXISTS idx_users_phone_unique;
CREATE UNIQUE INDEX idx_users_phone_unique
  ON users (regexp_replace(phone, '[^0-9]', '', 'g')) WHERE phone IS NOT NULL;


-- ==========================================================
-- >>> add-products.sql
-- ==========================================================
-- ============================================================
-- Migration: READY-MADE PRODUCTS + three kinds of order line + DISCOUNT
-- Run this SAME file on BOTH databases (POS and cloud).
-- Run: psql -U postgres -d tailors_db -f database/add-products.sql
--
-- WHAT THIS ADDS
-- --------------
-- The shop now sells three different things, and an order may mix them
-- freely on one receipt, with one balance and one payment:
--
--   1. 'tailoring' — customer picks cloth, we cut yards and sew it.
--                    Cloth is priced automatically from the fabric's
--                    price per yard; staff type only the SEWING CHARGE.
--   2. 'fabric'    — customer buys cut cloth and walks out. No sewing,
--                    no measurements, never enters the workshop.
--   3. 'product'   — ready-made goods (cabaayad, kabo, surwaal...).
--                    No cloth at all; sold from counted stock.
--
-- STOCK LIVES ON THE VARIANT, NOT THE PRODUCT
-- -------------------------------------------
-- "Cabaayad Dubai" is not a stock item. "Cabaayad Dubai, size M, black"
-- is. Counting stock on the product would let you sell a size M when only
-- size L is on the shelf, and no later fix could tell you which size a
-- past sale actually took.
--
-- DISCOUNT
-- --------
-- One discount for the whole order, stored as MONEY (never a percentage —
-- a stored percentage silently re-values itself if the order is edited
-- later, and old receipts stop reconciling). VAT is charged on the NET,
-- after discount, because tax is owed on what the customer actually pays.
--
-- Safe to run more than once.
-- ============================================================

-- ---------- 1. Settings (currently just the discount ceiling) ----------
-- A table rather than a hard-coded constant so the owner can change the
-- limit without a new release.
CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fixed ceiling, in money. A salesman may discount up to this on one
-- order; anything larger needs an admin. 0 would mean "no discounts".
INSERT INTO app_settings (key, value)
VALUES ('salesman_discount_limit', '20')
ON CONFLICT (key) DO NOTHING;

-- ---------- 2. Product categories ----------
-- Shared across branches: every branch should mean the same thing by
-- "Kabo". attribute_schema declares the EXTRA fields a category needs
-- beyond size and colour, so adding a category later is a row of data
-- rather than a schema migration.
CREATE TABLE IF NOT EXISTS product_categories (
  id               SERIAL PRIMARY KEY,
  name             TEXT NOT NULL UNIQUE,
  attribute_schema JSONB NOT NULL DEFAULT '[]',
  active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO product_categories (name, attribute_schema) VALUES
  ('Cabaayad', '[{"key":"fabric_type","label":"Nooca maryaha","type":"text"},
                 {"key":"length","label":"Dhererka","type":"text"},
                 {"key":"sleeve","label":"Gacmaha","type":"text"}]'),
  ('Kabo',     '[{"key":"material","label":"Nooca","type":"text"},
                 {"key":"heel","label":"Caaradda","type":"text"}]'),
  ('Surwaal',  '[{"key":"material","label":"Nooca","type":"text"},
                 {"key":"length","label":"Dhererka","type":"text"}]'),
  ('Shaati',   '[{"key":"sleeve","label":"Gacmaha","type":"text"},
                 {"key":"material","label":"Nooca","type":"text"}]'),
  ('Goono',    '[{"key":"length","label":"Dhererka","type":"text"},
                 {"key":"material","label":"Nooca","type":"text"}]'),
  ('Dirac',    '[{"key":"fabric_type","label":"Nooca maryaha","type":"text"},
                 {"key":"style","label":"Qaabka","type":"text"}]')
ON CONFLICT (name) DO NOTHING;

-- ---------- 3. Products (the model) ----------
-- Branch-scoped exactly like fabrics: Hodan selling its last cabaayad
-- must not change what Bakara has on the shelf.
CREATE TABLE IF NOT EXISTS products (
  id          SERIAL PRIMARY KEY,
  branch_id   INT NOT NULL REFERENCES branches(id),
  category_id INT REFERENCES product_categories(id),
  name        TEXT NOT NULL,
  brand       TEXT,
  description TEXT,
  image       TEXT,                     -- compressed JPEG data URL, like fabrics
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Found by NAME, never by barcode — there is no scanning for products.
-- Unique per branch so two branches may both stock "Cabaayad Dubai".
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_branch_name
  ON products (branch_id, LOWER(name), LOWER(COALESCE(brand, '')));
CREATE INDEX IF NOT EXISTS idx_products_branch ON products (branch_id);
CREATE INDEX IF NOT EXISTS idx_products_name ON products (LOWER(name));

-- ---------- 4. Variants (the sellable thing) ----------
CREATE TABLE IF NOT EXISTS product_variants (
  id            SERIAL PRIMARY KEY,
  product_id    INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  size          TEXT,
  color         TEXT,
  -- Category-specific extras (material, sleeve, heel...). Kept as JSONB so
  -- a new category needs no migration — same approach as orders.measurements.
  attributes    JSONB NOT NULL DEFAULT '{}',
  cost_price    NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
  sell_price    NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (sell_price >= 0),
  quantity      INT NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  reorder_level INT NOT NULL DEFAULT 3,
  -- Text sorting puts shoe size "10" before "9"; this keeps them in order.
  sort_order    INT NOT NULL DEFAULT 0,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per real-world combination. COALESCE so that a product with no
-- sizes (a perfume, say) still cannot be entered twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_variants_unique
  ON product_variants (product_id, LOWER(COALESCE(size, '')), LOWER(COALESCE(color, '')));
CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants (product_id);
CREATE INDEX IF NOT EXISTS idx_variants_low_stock
  ON product_variants (product_id) WHERE quantity <= reorder_level;

-- ---------- 5. Stock ledger ----------
-- Mirrors fabric_movements deliberately: same shape, same rules, so the
-- code that maintains it is the code you already trust.
CREATE TABLE IF NOT EXISTS product_movements (
  id         SERIAL PRIMARY KEY,
  variant_id INT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK (type IN ('in','out','adjustment')),
  qty        INT NOT NULL,             -- always positive; direction comes from type
  note       TEXT,
  order_id   INT,                      -- set when type='out' for a sale
  created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pmovements_variant ON product_movements (variant_id, created_at);

-- ---------- 6. Order lines gain a type ----------
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS line_type TEXT;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS variant_id INT REFERENCES product_variants(id);
-- The cloth portion of a tailoring line, priced from the fabric's price
-- per yard. unit_price on a tailoring line now means the SEWING CHARGE
-- per garment, so the receipt can show the customer both figures.
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS fabric_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

-- Everything that already exists is a tailoring line, by definition —
-- it is the only kind the system could create until now.
UPDATE order_items SET line_type = 'tailoring' WHERE line_type IS NULL;
ALTER TABLE order_items ALTER COLUMN line_type SET NOT NULL;

-- A garment type only makes sense on a tailoring line. The column itself
-- is untouched and keeps every value it has ever held; it simply stops
-- being mandatory for lines that are not garments.
ALTER TABLE order_items ALTER COLUMN garment_type DROP NOT NULL;

ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_line_shape;
ALTER TABLE order_items ADD CONSTRAINT order_items_line_shape CHECK (
  -- Sewing: needs a garment, never a product variant. fabric_id may be
  -- NULL because a customer is allowed to bring their own cloth.
  (line_type = 'tailoring' AND garment_type IS NOT NULL AND variant_id IS NULL)
  -- Cut cloth to take away: needs fabric, no garment, no variant.
  OR (line_type = 'fabric' AND fabric_id IS NOT NULL AND garment_type IS NULL AND variant_id IS NULL)
  -- Ready-made: needs a variant, no cloth, no garment.
  OR (line_type = 'product' AND variant_id IS NOT NULL AND garment_type IS NULL AND fabric_id IS NULL)
);
CREATE INDEX IF NOT EXISTS idx_items_line_type ON order_items (line_type);
CREATE INDEX IF NOT EXISTS idx_items_variant ON order_items (variant_id);

-- ---------- 7. Discount on the order ----------
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0
  CHECK (discount_amount >= 0);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_reason TEXT;

-- A discount can never exceed the order value; a negative bill is not a
-- thing, and this stops a typo turning into money owed to the customer.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_discount_within_price;
ALTER TABLE orders ADD CONSTRAINT orders_discount_within_price
  CHECK (discount_amount <= price);

-- ---------- 8. Finance view: discount before VAT ----------
-- Order of operations matters and is the whole reason this view changes:
--     subtotal − discount = net
--     VAT = 5% of NET   (not of the subtotal)
--     total owed = net + VAT
-- Charging VAT on the pre-discount figure over-collects tax on every
-- discounted sale — a small error repeated hundreds of times.
--
-- vat_amount is stored on the order (frozen when it was created), so this
-- view only has to subtract the discount in the right places.
DROP VIEW IF EXISTS order_finance;
CREATE VIEW order_finance AS
SELECT
  o.id AS order_id,
  o.price,
  o.discount_amount,
  (o.price - o.discount_amount)::NUMERIC(12,2) AS net_price,
  COALESCE(p.paid, 0)::NUMERIC(12,2) AS paid,
  (o.price - o.discount_amount + o.vat_amount - COALESCE(p.paid, 0))::NUMERIC(12,2) AS balance,
  CASE
    WHEN (o.price - o.discount_amount + o.vat_amount) > 0
         AND COALESCE(p.paid,0) >= (o.price - o.discount_amount + o.vat_amount) THEN 'paid'
    WHEN COALESCE(p.paid,0) > 0 THEN 'partial'
    ELSE 'unpaid'
  END AS payment_status,
  o.vat_amount::NUMERIC(12,2) AS vat_collected,
  (o.price - o.discount_amount + o.vat_amount)::NUMERIC(12,2) AS total
FROM orders o
LEFT JOIN (
  SELECT order_id, SUM(amount) AS paid
  FROM payments GROUP BY order_id
) p ON p.order_id = o.id;

-- ---------- 9. updated_at triggers ----------
DROP TRIGGER IF EXISTS trg_products_updated ON products;
CREATE TRIGGER trg_products_updated BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_variants_updated ON product_variants;
CREATE TRIGGER trg_variants_updated BEFORE UPDATE ON product_variants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


COMMIT;

-- ---------- verification ----------
SELECT 'tables (expect 22)'            AS check, COUNT(*)::text AS result
  FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'
UNION ALL SELECT 'branches', COUNT(*)::text FROM branches
UNION ALL SELECT 'product categories', COUNT(*)::text FROM product_categories
UNION ALL SELECT 'orders without branch', COUNT(*)::text FROM orders WHERE branch_id IS NULL
UNION ALL SELECT 'order lines without a type', COUNT(*)::text FROM order_items WHERE line_type IS NULL
UNION ALL SELECT 'staff without branch', COUNT(*)::text
  FROM users WHERE role <> 'superadmin' AND branch_id IS NULL
UNION ALL SELECT 'duplicate staff emails', COUNT(*)::text FROM (
  SELECT LOWER(email) FROM users WHERE email IS NOT NULL GROUP BY 1 HAVING COUNT(*)>1) d;
