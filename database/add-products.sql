-- ============================================================
-- Migration: READY-MADE PRODUCTS + three kinds of order line + DISCOUNT
-- Run this SAME file on BOTH databases (POS and cloud).
-- Run: psql -U postgres -d tailors_db -f database/add-products.sql
--
-- WHAT THIS ADDS
-- --------------
-- The shop now sells three different things, and an order may mix them
-- freely on one receipt, with one balance and one payment:
--
--   1. 'tailoring' — customer picks cloth, we cut yards and sew it.
--                    Cloth is priced automatically from the fabric's
--                    price per yard; staff type only the SEWING CHARGE.
--   2. 'fabric'    — customer buys cut cloth and walks out. No sewing,
--                    no measurements, never enters the workshop.
--   3. 'product'   — ready-made goods (cabaayad, kabo, surwaal...).
--                    No cloth at all; sold from counted stock.
--
-- STOCK LIVES ON THE VARIANT, NOT THE PRODUCT
-- -------------------------------------------
-- "Cabaayad Dubai" is not a stock item. "Cabaayad Dubai, size M, black"
-- is. Counting stock on the product would let you sell a size M when only
-- size L is on the shelf, and no later fix could tell you which size a
-- past sale actually took.
--
-- DISCOUNT
-- --------
-- One discount for the whole order, stored as MONEY (never a percentage —
-- a stored percentage silently re-values itself if the order is edited
-- later, and old receipts stop reconciling). VAT is charged on the NET,
-- after discount, because tax is owed on what the customer actually pays.
--
-- Safe to run more than once.
-- ============================================================

BEGIN;

-- ---------- 1. Settings (currently just the discount ceiling) ----------
-- A table rather than a hard-coded constant so the owner can change the
-- limit without a new release.
CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fixed ceiling, in money. A salesman may discount up to this on one
-- order; anything larger needs an admin. 0 would mean "no discounts".
INSERT INTO app_settings (key, value)
VALUES ('salesman_discount_limit', '20')
ON CONFLICT (key) DO NOTHING;

-- ---------- 2. Product categories ----------
-- Shared across branches: every branch should mean the same thing by
-- "Kabo". attribute_schema declares the EXTRA fields a category needs
-- beyond size and colour, so adding a category later is a row of data
-- rather than a schema migration.
CREATE TABLE IF NOT EXISTS product_categories (
  id               SERIAL PRIMARY KEY,
  name             TEXT NOT NULL UNIQUE,
  attribute_schema JSONB NOT NULL DEFAULT '[]',
  active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO product_categories (name, attribute_schema) VALUES
  ('Cabaayad', '[{"key":"fabric_type","label":"Nooca maryaha","type":"text"},
                 {"key":"length","label":"Dhererka","type":"text"},
                 {"key":"sleeve","label":"Gacmaha","type":"text"}]'),
  ('Kabo',     '[{"key":"material","label":"Nooca","type":"text"},
                 {"key":"heel","label":"Caaradda","type":"text"}]'),
  ('Surwaal',  '[{"key":"material","label":"Nooca","type":"text"},
                 {"key":"length","label":"Dhererka","type":"text"}]'),
  ('Shaati',   '[{"key":"sleeve","label":"Gacmaha","type":"text"},
                 {"key":"material","label":"Nooca","type":"text"}]'),
  ('Goono',    '[{"key":"length","label":"Dhererka","type":"text"},
                 {"key":"material","label":"Nooca","type":"text"}]'),
  ('Dirac',    '[{"key":"fabric_type","label":"Nooca maryaha","type":"text"},
                 {"key":"style","label":"Qaabka","type":"text"}]')
ON CONFLICT (name) DO NOTHING;

-- ---------- 3. Products (the model) ----------
-- Branch-scoped exactly like fabrics: Hodan selling its last cabaayad
-- must not change what Bakara has on the shelf.
CREATE TABLE IF NOT EXISTS products (
  id          SERIAL PRIMARY KEY,
  branch_id   INT NOT NULL REFERENCES branches(id),
  category_id INT REFERENCES product_categories(id),
  name        TEXT NOT NULL,
  brand       TEXT,
  description TEXT,
  image       TEXT,                     -- compressed JPEG data URL, like fabrics
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Found by NAME, never by barcode — there is no scanning for products.
-- Unique per branch so two branches may both stock "Cabaayad Dubai".
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_branch_name
  ON products (branch_id, LOWER(name), LOWER(COALESCE(brand, '')));
CREATE INDEX IF NOT EXISTS idx_products_branch ON products (branch_id);
CREATE INDEX IF NOT EXISTS idx_products_name ON products (LOWER(name));

-- ---------- 4. Variants (the sellable thing) ----------
CREATE TABLE IF NOT EXISTS product_variants (
  id            SERIAL PRIMARY KEY,
  product_id    INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  size          TEXT,
  color         TEXT,
  -- Category-specific extras (material, sleeve, heel...). Kept as JSONB so
  -- a new category needs no migration — same approach as orders.measurements.
  attributes    JSONB NOT NULL DEFAULT '{}',
  cost_price    NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
  sell_price    NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (sell_price >= 0),
  quantity      INT NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  reorder_level INT NOT NULL DEFAULT 3,
  -- Text sorting puts shoe size "10" before "9"; this keeps them in order.
  sort_order    INT NOT NULL DEFAULT 0,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per real-world combination. COALESCE so that a product with no
-- sizes (a perfume, say) still cannot be entered twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_variants_unique
  ON product_variants (product_id, LOWER(COALESCE(size, '')), LOWER(COALESCE(color, '')));
CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants (product_id);
CREATE INDEX IF NOT EXISTS idx_variants_low_stock
  ON product_variants (product_id) WHERE quantity <= reorder_level;

-- ---------- 5. Stock ledger ----------
-- Mirrors fabric_movements deliberately: same shape, same rules, so the
-- code that maintains it is the code you already trust.
CREATE TABLE IF NOT EXISTS product_movements (
  id         SERIAL PRIMARY KEY,
  variant_id INT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK (type IN ('in','out','adjustment')),
  qty        INT NOT NULL,             -- always positive; direction comes from type
  note       TEXT,
  order_id   INT,                      -- set when type='out' for a sale
  created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pmovements_variant ON product_movements (variant_id, created_at);

-- ---------- 6. Order lines gain a type ----------
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS line_type TEXT;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS variant_id INT REFERENCES product_variants(id);
-- The cloth portion of a tailoring line, priced from the fabric's price
-- per yard. unit_price on a tailoring line now means the SEWING CHARGE
-- per garment, so the receipt can show the customer both figures.
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS fabric_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

-- Everything that already exists is a tailoring line, by definition —
-- it is the only kind the system could create until now.
UPDATE order_items SET line_type = 'tailoring' WHERE line_type IS NULL;
ALTER TABLE order_items ALTER COLUMN line_type SET NOT NULL;

-- A garment type only makes sense on a tailoring line. The column itself
-- is untouched and keeps every value it has ever held; it simply stops
-- being mandatory for lines that are not garments.
ALTER TABLE order_items ALTER COLUMN garment_type DROP NOT NULL;

ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_line_shape;
ALTER TABLE order_items ADD CONSTRAINT order_items_line_shape CHECK (
  -- Sewing: needs a garment, never a product variant. fabric_id may be
  -- NULL because a customer is allowed to bring their own cloth.
  (line_type = 'tailoring' AND garment_type IS NOT NULL AND variant_id IS NULL)
  -- Cut cloth to take away: needs fabric, no garment, no variant.
  OR (line_type = 'fabric' AND fabric_id IS NOT NULL AND garment_type IS NULL AND variant_id IS NULL)
  -- Ready-made: needs a variant, no cloth, no garment.
  OR (line_type = 'product' AND variant_id IS NOT NULL AND garment_type IS NULL AND fabric_id IS NULL)
);
CREATE INDEX IF NOT EXISTS idx_items_line_type ON order_items (line_type);
CREATE INDEX IF NOT EXISTS idx_items_variant ON order_items (variant_id);

-- ---------- 7. Discount on the order ----------
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0
  CHECK (discount_amount >= 0);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_reason TEXT;

-- A discount can never exceed the order value; a negative bill is not a
-- thing, and this stops a typo turning into money owed to the customer.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_discount_within_price;
ALTER TABLE orders ADD CONSTRAINT orders_discount_within_price
  CHECK (discount_amount <= price);

-- ---------- 8. Finance view: discount before VAT ----------
-- Order of operations matters and is the whole reason this view changes:
--     subtotal − discount = net
--     VAT = 5% of NET   (not of the subtotal)
--     total owed = net + VAT
-- Charging VAT on the pre-discount figure over-collects tax on every
-- discounted sale — a small error repeated hundreds of times.
--
-- vat_amount is stored on the order (frozen when it was created), so this
-- view only has to subtract the discount in the right places.
DROP VIEW IF EXISTS order_finance;
CREATE VIEW order_finance AS
SELECT
  o.id AS order_id,
  o.price,
  o.discount_amount,
  (o.price - o.discount_amount)::NUMERIC(12,2) AS net_price,
  COALESCE(p.paid, 0)::NUMERIC(12,2) AS paid,
  (o.price - o.discount_amount + o.vat_amount - COALESCE(p.paid, 0))::NUMERIC(12,2) AS balance,
  CASE
    WHEN (o.price - o.discount_amount + o.vat_amount) > 0
         AND COALESCE(p.paid,0) >= (o.price - o.discount_amount + o.vat_amount) THEN 'paid'
    WHEN COALESCE(p.paid,0) > 0 THEN 'partial'
    ELSE 'unpaid'
  END AS payment_status,
  o.vat_amount::NUMERIC(12,2) AS vat_collected,
  (o.price - o.discount_amount + o.vat_amount)::NUMERIC(12,2) AS total
FROM orders o
LEFT JOIN (
  SELECT order_id, SUM(amount) AS paid
  FROM payments GROUP BY order_id
) p ON p.order_id = o.id;

-- ---------- 9. updated_at triggers ----------
DROP TRIGGER IF EXISTS trg_products_updated ON products;
CREATE TRIGGER trg_products_updated BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_variants_updated ON product_variants;
CREATE TRIGGER trg_variants_updated BEFORE UPDATE ON product_variants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;

-- ---------- verification ----------
SELECT 'product categories'        AS check, COUNT(*)::text AS result FROM product_categories
UNION ALL SELECT 'order lines without a type', COUNT(*)::text FROM order_items WHERE line_type IS NULL
UNION ALL SELECT 'existing lines marked tailoring', COUNT(*)::text FROM order_items WHERE line_type = 'tailoring'
UNION ALL SELECT 'orders with a discount', COUNT(*)::text FROM orders WHERE discount_amount > 0
UNION ALL SELECT 'discount limit ($)', value FROM app_settings WHERE key = 'salesman_discount_limit';
