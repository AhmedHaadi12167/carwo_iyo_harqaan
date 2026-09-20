-- ============================================================
-- Migration: add TAILOR role + order claiming
-- Run on your existing database:
--   psql -U postgres -d tailors_db -f database/add-tailor-role.sql
-- ============================================================

BEGIN;

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

COMMIT;

-- To add more tailors later (or use the Staff page in the app):
-- INSERT INTO users (name, username, password_hash, role)
-- VALUES ('Tailor Name', 'username', '<bcrypt hash>', 'tailor');
