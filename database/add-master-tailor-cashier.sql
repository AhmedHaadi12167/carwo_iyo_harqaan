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

BEGIN;

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

COMMIT;
