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

BEGIN;

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

COMMIT;

-- ---------- verification ----------
SELECT 'staff with an email'        AS check, COUNT(*)::text AS result FROM users WHERE email IS NOT NULL
UNION ALL SELECT 'distinct emails',  COUNT(DISTINCT LOWER(email))::text FROM users WHERE email IS NOT NULL
UNION ALL SELECT 'staff with a phone', COUNT(*)::text FROM users WHERE phone IS NOT NULL
UNION ALL SELECT 'distinct phones',  COUNT(DISTINCT regexp_replace(phone,'[^0-9]','','g'))::text
  FROM users WHERE phone IS NOT NULL;
