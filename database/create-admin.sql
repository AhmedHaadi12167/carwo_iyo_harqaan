-- ============================================================
-- Create (or reset) the two top-level logins.
-- Run:  psql -U postgres -d tailors_db -f database/create-admin.sql
--
--   SUPERADMIN   username: owner   password: Haadi$2026#Admin
--   BRANCH ADMIN username: admin   password: Haadi$2026#Admin
--
-- owner : sees every branch, creates branches, compares them.
-- admin : runs ONE branch (the main branch) and sees only its figures.
--
-- Change both passwords from your profile once you are logged in.
-- Safe to run more than once: an existing account has its password reset
-- and is re-activated rather than causing an error.
--
-- Deliberately plain ASCII, so it behaves identically whatever client
-- encoding psql picks on Windows.
-- ============================================================

\echo 'Creating superadmin (owner) and branch admin (admin)...'

-- A superadmin belongs to NO branch. That is exactly what "sees all
-- branches" means, and users_branch_role_check enforces the pairing.
INSERT INTO users (name, username, password_hash, role, active, branch_id)
VALUES (
  'Owner',
  'owner',
  '$2a$10$S7O0uTdNBPPsph2lQHddnOvogj9/35Ls1ZeyS9uLDLgs1gQbZBWAm',
  'superadmin',
  TRUE,
  NULL
)
ON CONFLICT (username) DO UPDATE
  SET password_hash = EXCLUDED.password_hash,
      role          = 'superadmin',
      branch_id     = NULL,
      active        = TRUE;

-- Every other role MUST belong to a branch, so this admin joins the main one.
-- A DO block because the branch id has to be looked up, and because a CHECK
-- constraint is evaluated before ON CONFLICT is considered, so the branch has
-- to be right even on a re-run that changes nothing.
DO $mkadmin$
DECLARE
  main_id INT;
BEGIN
  SELECT id INTO main_id FROM branches ORDER BY (code = 'MAIN') DESC, id LIMIT 1;
  IF main_id IS NULL THEN
    RAISE EXCEPTION 'No branches exist yet - run migrate-all.sql first';
  END IF;

  INSERT INTO users (name, username, password_hash, role, active, branch_id)
  VALUES ('Ahmed Haadi', 'admin',
          '$2a$10$S7O0uTdNBPPsph2lQHddnOvogj9/35Ls1ZeyS9uLDLgs1gQbZBWAm',
          'admin', TRUE, main_id)
  ON CONFLICT (username) DO UPDATE
    SET password_hash = EXCLUDED.password_hash,
        role          = 'admin',
        branch_id     = EXCLUDED.branch_id,
        active        = TRUE;
END
$mkadmin$;

-- Optional: set the email so "Forgot password?" can send an OTP.
-- The column only exists after add-password-reset.sql has been run.
--
-- Set on the SUPERADMIN ONLY. Staff emails are unique (an address is what a
-- password-reset code is sent to, so two accounts sharing one would let one
-- person reset the other's password) - putting the same address on both
-- accounts here would violate that constraint and abort the script.
-- Give the branch admin their own address from the Staff page.
DO $mkemail$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'email'
  ) THEN
    UPDATE users SET email = 'ahmedhaadi645@gmail.com'
    WHERE username = 'owner'
      AND email IS NULL
      -- ...unless another account already holds that address.
      AND NOT EXISTS (
        SELECT 1 FROM users u2
        WHERE LOWER(u2.email) = 'ahmedhaadi645@gmail.com' AND u2.username <> 'owner'
      );
  END IF;
END
$mkemail$;

-- ---------- result ----------
-- If you do not see BOTH rows below, the script did not run.
SELECT u.username,
       u.role,
       COALESCE(b.name, 'ALL BRANCHES') AS branch,
       u.active,
       'Haadi$2026#Admin' AS password
FROM users u
LEFT JOIN branches b ON b.id = u.branch_id
WHERE u.username IN ('owner', 'admin')
ORDER BY u.role;
