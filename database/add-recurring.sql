-- ============================================================
-- Migration: RECURRING expenses (rent…) + staff salaries
-- Run: psql -U postgres -d tailors_db -f database/add-recurring.sql
-- ============================================================

BEGIN;

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

COMMIT;
