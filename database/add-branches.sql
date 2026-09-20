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

BEGIN;

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

COMMIT;

-- ---------- verification ----------
SELECT 'branches' AS check, COUNT(*)::text AS result FROM branches
UNION ALL
SELECT 'orders without branch', COUNT(*)::text FROM orders WHERE branch_id IS NULL
UNION ALL
SELECT 'fabrics without branch', COUNT(*)::text FROM fabrics WHERE branch_id IS NULL
UNION ALL
SELECT 'non-superadmin without branch', COUNT(*)::text
  FROM users WHERE role <> 'superadmin' AND branch_id IS NULL;
