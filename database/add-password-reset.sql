-- Adds an optional email address to staff accounts, and a table to back
-- the "Forgot password" flow (email OTP → verify → reset).
-- Run: psql -U postgres -d tailors_db -f database/add-password-reset.sql

BEGIN;

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

COMMIT;
