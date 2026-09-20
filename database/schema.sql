-- ============================================================
-- Tailor System — Management System
-- PostgreSQL schema
-- Run: psql -U postgres -d tailors_db -f schema.sql
-- ============================================================

BEGIN;

-- ---------- Users (Admin / Salesman) ----------
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  username      TEXT UNIQUE NOT NULL,
  phone         TEXT,                              -- staff phone; can be used to log in
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','salesman','tailor')),
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone ON users (phone) WHERE phone IS NOT NULL;

-- ---------- Fabrics (each has its own scannable code) ----------
CREATE TABLE IF NOT EXISTS fabrics (
  id              SERIAL PRIMARY KEY,
  code            TEXT UNIQUE NOT NULL,          -- barcode, e.g. SS0098
  name            TEXT NOT NULL,                 -- e.g. X125, K4
  component       TEXT,                          -- e.g. W70P30
  weight          TEXT,                          -- e.g. 275G/M
  color           TEXT,
  brand           TEXT,                          -- e.g. Ultrafine Australian
  cost_per_meter  NUMERIC(10,2) NOT NULL DEFAULT 0,   -- what the shop paid
  price_per_meter NUMERIC(10,2) NOT NULL DEFAULT 0,   -- selling price
  quantity_meters NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (quantity_meters >= 0),
  reorder_level   NUMERIC(10,2) NOT NULL DEFAULT 10,  -- low-stock alert threshold
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fabrics_code ON fabrics (code);

-- ---------- Fabric stock movements (shipments in, order usage out) ----------
CREATE TABLE IF NOT EXISTS fabric_movements (
  id         SERIAL PRIMARY KEY,
  fabric_id  INT NOT NULL REFERENCES fabrics(id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK (type IN ('in','out','adjustment')),
  meters     NUMERIC(10,2) NOT NULL,             -- positive number; direction from type
  note       TEXT,
  order_id   INT,                                -- set when type='out' for an order
  created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_movements_fabric ON fabric_movements (fabric_id, created_at);

-- ---------- Customers ----------
CREATE TABLE IF NOT EXISTS customers (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  phone      TEXT,
  email      TEXT,
  address    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers (phone);

-- ---------- Orders ----------
CREATE TABLE IF NOT EXISTS orders (
  id            SERIAL PRIMARY KEY,
  order_no      TEXT UNIQUE NOT NULL,            -- e.g. BT-2026-0001
  customer_id   INT NOT NULL REFERENCES customers(id),
  measurements  JSONB NOT NULL DEFAULT '{}',     -- trouser/shalwar + coat/kameez fields
  notes         TEXT,
  price         NUMERIC(12,2) NOT NULL DEFAULT 0,     -- total charged
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','in_progress','completed','delivered','cancelled')),
  delivery_date DATE,                            -- appointment / pickup date
  tailor_id     INT REFERENCES users(id),        -- tailor who claimed the job
  claimed_at    TIMESTAMPTZ,
  created_by    INT REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders (created_at);
CREATE INDEX IF NOT EXISTS idx_orders_delivery ON orders (delivery_date);

-- ---------- Order items (a bill can hold several garments) ----------
CREATE TABLE IF NOT EXISTS order_items (
  id           SERIAL PRIMARY KEY,
  order_id     INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  garment_type TEXT NOT NULL,                    -- suit, shirt, khamiis, safari_suit, jacket, trouser, other
  fabric_id    INT REFERENCES fabrics(id),
  meters       NUMERIC(10,2) NOT NULL DEFAULT 0, -- meters used per unit x qty (total)
  qty          INT NOT NULL DEFAULT 1,
  unit_price   NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount       NUMERIC(12,2) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items (order_id);

-- ---------- Payments (advance + later payments) ----------
CREATE TABLE IF NOT EXISTS payments (
  id          SERIAL PRIMARY KEY,
  order_id    INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  amount      NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  method      TEXT NOT NULL DEFAULT 'cash' CHECK (method IN ('cash','evc','edahab','bank','other')),
  note        TEXT,
  received_by INT REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments (order_id);

-- ---------- Finance view: paid total, balance, payment_status ----------
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
  (o.price - COALESCE(p.paid, 0))::NUMERIC(12,2) AS balance,
  CASE
    WHEN o.price > 0 AND COALESCE(p.paid,0) >= o.price THEN 'paid'
    WHEN COALESCE(p.paid,0) > 0 THEN 'partial'
    ELSE 'unpaid'
  END AS payment_status
FROM orders o
LEFT JOIN (
  SELECT order_id, SUM(amount) AS paid FROM payments GROUP BY order_id
) p ON p.order_id = o.id;

-- ---------- updated_at triggers ----------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fabrics_updated ON fabrics;
CREATE TRIGGER trg_fabrics_updated BEFORE UPDATE ON fabrics
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_orders_updated ON orders;
CREATE TRIGGER trg_orders_updated BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- Order number sequence ----------
CREATE SEQUENCE IF NOT EXISTS order_no_seq START 1;

COMMIT;
