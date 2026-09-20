-- ============================================================
-- Migration: FINANCE module (expenses, capital, fixed assets)
-- Run: psql -U postgres -d tailors_db -f database/add-finance.sql
-- ============================================================

BEGIN;

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

COMMIT;
