-- ============================================================
-- Migration: staff phone numbers (login with username OR phone)
-- Run: psql -U postgres -d tailors_db -f database/add-staff-phone.sql
-- ============================================================

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;

-- Phone must be unique when set (it is a login identifier)
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone
  ON users (phone) WHERE phone IS NOT NULL;

COMMIT;
