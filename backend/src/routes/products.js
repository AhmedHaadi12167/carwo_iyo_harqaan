const router = require('express').Router();
const db = require('../db');
const { requireAuth, requireAdmin, readBranch, writeBranch } = require('../middleware/auth');

router.use(requireAuth);

/**
 * Ready-made products (cabaayad, kabo, surwaal...).
 *
 * TWO LEVELS, and the distinction is the whole point:
 *   product  — the model: "Cabaayad Dubai" by Al Karam
 *   variant  — the sellable thing: size M, black — with its OWN stock,
 *              cost and price
 *
 * Stock lives on the VARIANT. Counting it on the product would let a
 * salesman sell a size M when only size L is on the shelf.
 *
 * Products are found by NAME — there is no barcode and no scanning, which
 * is the deliberate difference from fabrics.
 *
 * Branch rules are identical to fabrics: a product belongs to one branch,
 * and a branch admin can neither see nor touch another branch's stock.
 */

// Cost price is management information. Staff quoting a customer need the
// selling price; what the shop paid is not theirs to see.
function hideCost(req, rows) {
  if (['admin', 'superadmin'].includes(req.user.role)) return rows;
  for (const r of rows) {
    delete r.cost_price;
    if (Array.isArray(r.variants)) r.variants.forEach((v) => delete v.cost_price);
  }
  return rows;
}

const isManager = (req) => ['admin', 'superadmin'].includes(req.user.role);

// ---------------- Categories ----------------
// Shared across branches, so every branch means the same thing by "Kabo".
// attribute_schema tells the UI which extra fields to render for that
// category, which is why adding a category never needs a migration.
router.get('/categories', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT id, name, attribute_schema, active FROM product_categories
       WHERE active = TRUE ORDER BY name`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/categories', requireAdmin, async (req, res, next) => {
  try {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Category name is required' });
    const schema = Array.isArray(req.body.attribute_schema) ? req.body.attribute_schema : [];
    const { rows } = await db.query(
      `INSERT INTO product_categories (name, attribute_schema) VALUES ($1, $2) RETURNING *`,
      [name, JSON.stringify(schema)]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'That category already exists' });
    next(err);
  }
});

// ---------------- Products ----------------
// GET /api/products?search=&low=1&category_id=
// Each product comes back with its variants nested, because a product on
// its own is not sellable and the UI always needs both together.
router.get('/', async (req, res, next) => {
  try {
    const { search, low, category_id } = req.query;
    const params = [];
    const where = ['p.active = TRUE'];

    const branch = readBranch(req);
    if (branch != null) { params.push(branch); where.push(`p.branch_id = $${params.length}`); }

    // Name-driven search: no codes to type, which is the point.
    if (search) {
      params.push(`%${search}%`);
      where.push(`(p.name ILIKE $${params.length} OR p.brand ILIKE $${params.length}
                   OR EXISTS (SELECT 1 FROM product_variants v2
                              WHERE v2.product_id = p.id
                                AND (v2.color ILIKE $${params.length} OR v2.size ILIKE $${params.length})))`);
    }
    if (category_id) { params.push(category_id); where.push(`p.category_id = $${params.length}`); }
    // Anything at or below its reorder level, so restocking is one click.
    if (low === '1') {
      where.push(`EXISTS (SELECT 1 FROM product_variants v3
                          WHERE v3.product_id = p.id AND v3.active
                            AND v3.quantity <= v3.reorder_level)`);
    }

    const { rows } = await db.query(
      `SELECT p.*, c.name AS category_name, c.attribute_schema,
              b.name AS branch_name, b.code AS branch_code,
              COALESCE((
                SELECT json_agg(v ORDER BY v.sort_order, v.size, v.color)
                FROM (
                  SELECT id, size, color, attributes, cost_price, sell_price,
                         quantity, reorder_level, sort_order, active
                  FROM product_variants
                  WHERE product_id = p.id AND active = TRUE
                ) v
              ), '[]'::json) AS variants,
              (SELECT COALESCE(SUM(quantity),0) FROM product_variants
                WHERE product_id = p.id AND active) AS total_stock
       FROM products p
       LEFT JOIN product_categories c ON c.id = p.category_id
       JOIN branches b ON b.id = p.branch_id
       WHERE ${where.join(' AND ')}
       ORDER BY p.name`, params
    );
    res.json(hideCost(req, rows));
  } catch (err) { next(err); }
});

// GET /api/products/variants?search= — a flat list for the order screen.
// The salesman picks a sellable thing directly ("Cabaayad Dubai · M · Black")
// rather than drilling product → variant while a customer waits.
router.get('/variants', async (req, res, next) => {
  try {
    const params = [];
    const where = ['p.active = TRUE', 'v.active = TRUE'];
    const branch = readBranch(req);
    if (branch != null) { params.push(branch); where.push(`p.branch_id = $${params.length}`); }
    if (req.query.search) {
      params.push(`%${req.query.search}%`);
      where.push(`(p.name ILIKE $${params.length} OR p.brand ILIKE $${params.length}
                   OR v.color ILIKE $${params.length} OR v.size ILIKE $${params.length})`);
    }
    // Out-of-stock variants are still returned (marked), so staff can see a
    // thing exists and is finished rather than concluding it was never stocked.
    const { rows } = await db.query(
      `SELECT v.id, v.size, v.color, v.sell_price, v.cost_price, v.quantity,
              p.id AS product_id, p.name AS product_name, p.brand,
              c.name AS category_name, p.branch_id
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
       LEFT JOIN product_categories c ON c.id = p.category_id
       WHERE ${where.join(' AND ')}
       ORDER BY p.name, v.sort_order, v.size, v.color
       LIMIT 500`, params
    );
    res.json(hideCost(req, rows));
  } catch (err) { next(err); }
});

// Guard for every /:id route — a branch admin who guesses another branch's
// product id gets the same 404 as a product that does not exist, so ids
// reveal nothing. Same approach as orders and fabrics.
router.param('id', async (req, res, next, id) => {
  if (!/^\d+$/.test(String(id))) return res.status(400).json({ error: 'Invalid product id' });
  try {
    const { rows } = await db.query('SELECT id, branch_id, name FROM products WHERE id = $1', [id]);
    if (!rows[0]) return res.status(404).json({ error: 'Product not found' });
    const scope = readBranch(req);
    if (scope != null && rows[0].branch_id !== scope) {
      return res.status(404).json({ error: 'Product not found' });
    }
    req.product = rows[0];
    next();
  } catch (err) { next(err); }
});

// POST /api/products — create the model and its first variants in one go.
// A product with no variants cannot be sold, so creating them together
// stops half-made products accumulating.
router.post('/', requireAdmin, async (req, res, next) => {
  const client = await db.getClient();
  try {
    const { name, brand, category_id, description, image, variants = [] } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Product name is required' });
    if (image && image.length > 500000) return res.status(400).json({ error: 'Image too large — retake the photo' });

    const branchId = writeBranch(req);
    if (!branchId) return res.status(400).json({ error: 'Choose which branch this product belongs to' });
    if (!Array.isArray(variants) || !variants.length) {
      return res.status(400).json({ error: 'Add at least one size/colour — that is what actually gets sold' });
    }
    for (const v of variants) {
      if (Number(v.cost_price) < 0 || Number(v.sell_price) < 0 || Number(v.quantity) < 0) {
        return res.status(400).json({ error: 'Cost, price and quantity cannot be negative' });
      }
    }

    await client.query('BEGIN');
    const p = await client.query(
      `INSERT INTO products (branch_id, category_id, name, brand, description, image)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [branchId, category_id || null, name.trim(), brand?.trim() || null,
       description?.trim() || null, image || null]
    );
    const product = p.rows[0];

    for (const [i, v] of variants.entries()) {
      const qty = Number(v.quantity) || 0;
      const created = await client.query(
        `INSERT INTO product_variants
           (product_id, size, color, attributes, cost_price, sell_price, quantity, reorder_level, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [product.id, v.size?.trim() || null, v.color?.trim() || null,
         JSON.stringify(v.attributes || {}), Number(v.cost_price) || 0, Number(v.sell_price) || 0,
         qty, Number(v.reorder_level) || 3, Number(v.sort_order) || i]
      );
      // Opening stock is a real movement, so the ledger explains every unit
      // from the very first one rather than starting mid-story.
      if (qty > 0) {
        await client.query(
          `INSERT INTO product_movements (variant_id, type, qty, note, created_by)
           VALUES ($1,'in',$2,'Opening stock',$3)`,
          [created.rows[0].id, qty, req.user.id]
        );
      }
    }

    await client.query('COMMIT');
    res.status(201).json(product);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error: 'This branch already has a product with that name and brand' });
    }
    next(err);
  } finally { client.release(); }
});

// PUT /api/products/:id — edit the model itself (not stock)
router.put('/:id', requireAdmin, async (req, res, next) => {
  try {
    const allowed = ['name', 'brand', 'category_id', 'description', 'image', 'active'];
    if (req.body.image && req.body.image.length > 500000) {
      return res.status(400).json({ error: 'Image too large — retake the photo' });
    }
    const fields = []; const values = []; let i = 1;
    for (const key of allowed) {
      if (req.body[key] !== undefined) { fields.push(`${key} = $${i++}`); values.push(req.body[key]); }
    }
    if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
    values.push(req.params.id);
    const { rows } = await db.query(
      `UPDATE products SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, values);
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'This branch already has a product with that name and brand' });
    }
    next(err);
  }
});

// ---------------- Variants ----------------
// POST /api/products/:id/variants — add a new size/colour to a product
router.post('/:id/variants', requireAdmin, async (req, res, next) => {
  const client = await db.getClient();
  try {
    const { size, color, attributes, cost_price = 0, sell_price = 0,
            quantity = 0, reorder_level = 3, sort_order = 0 } = req.body;
    if (!size && !color) {
      return res.status(400).json({ error: 'Give at least a size or a colour so this can be told apart' });
    }
    const qty = Number(quantity) || 0;
    if (Number(cost_price) < 0 || Number(sell_price) < 0 || qty < 0) {
      return res.status(400).json({ error: 'Cost, price and quantity cannot be negative' });
    }

    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO product_variants
         (product_id, size, color, attributes, cost_price, sell_price, quantity, reorder_level, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.params.id, size?.trim() || null, color?.trim() || null,
       JSON.stringify(attributes || {}), cost_price, sell_price, qty, reorder_level, sort_order]
    );
    if (qty > 0) {
      await client.query(
        `INSERT INTO product_movements (variant_id, type, qty, note, created_by)
         VALUES ($1,'in',$2,'Opening stock',$3)`,
        [rows[0].id, qty, req.user.id]
      );
    }
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error: 'That size and colour already exists for this product' });
    }
    next(err);
  } finally { client.release(); }
});

// Variant-level routes verify ownership through the parent product, so the
// branch guard applies just as it does to the product itself.
async function ownedVariant(req, variantId) {
  const scope = readBranch(req);
  const params = [variantId];
  let guard = '';
  if (scope != null) { params.push(scope); guard = `AND p.branch_id = $2`; }
  const { rows } = await db.query(
    `SELECT v.*, p.branch_id, p.name AS product_name
     FROM product_variants v JOIN products p ON p.id = v.product_id
     WHERE v.id = $1 ${guard}`, params);
  return rows[0] || null;
}

// PUT /api/products/variants/:variantId — edit price/cost/reorder, NOT stock.
// Stock only ever moves through the ledger below, so quantity and the
// movement history can never disagree.
router.put('/variants/:variantId', requireAdmin, async (req, res, next) => {
  try {
    const v = await ownedVariant(req, req.params.variantId);
    if (!v) return res.status(404).json({ error: 'Item not found' });

    const allowed = ['size', 'color', 'attributes', 'cost_price', 'sell_price',
                     'reorder_level', 'sort_order', 'active'];
    const fields = []; const values = []; let i = 1;
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        fields.push(`${key} = $${i++}`);
        values.push(key === 'attributes' ? JSON.stringify(req.body[key]) : req.body[key]);
      }
    }
    if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
    values.push(req.params.variantId);
    const { rows } = await db.query(
      `UPDATE product_variants SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, values);
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'That size and colour already exists for this product' });
    }
    next(err);
  }
});

// POST /api/products/variants/:variantId/stock — receive or correct stock
//   type 'in'         — a delivery arrived
//   type 'adjustment' — a stock count correction, up or down
router.post('/variants/:variantId/stock', requireAdmin, async (req, res, next) => {
  const client = await db.getClient();
  try {
    const { qty, type = 'in', note, direction } = req.body;
    const n = Number(qty);
    if (!Number.isInteger(n) || n <= 0) {
      return res.status(400).json({ error: 'Quantity must be a whole number greater than zero' });
    }
    if (!['in', 'adjustment'].includes(type)) return res.status(400).json({ error: 'Invalid movement type' });

    const owned = await ownedVariant(req, req.params.variantId);
    if (!owned) return res.status(404).json({ error: 'Item not found' });

    await client.query('BEGIN');
    const sign = type === 'in' ? '+' : (direction === 'decrease' ? '-' : '+');
    const { rows } = await client.query(
      `UPDATE product_variants SET quantity = quantity ${sign} $1
       WHERE id = $2 RETURNING *`,
      [n, req.params.variantId]
    );
    await client.query(
      `INSERT INTO product_movements (variant_id, type, qty, note, created_by) VALUES ($1,$2,$3,$4,$5)`,
      [req.params.variantId, type, n,
       note || (type === 'in' ? 'New delivery' : 'Stock count correction'), req.user.id]
    );
    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    // The CHECK on quantity is what stops a correction driving stock negative.
    if (err.code === '23514') return res.status(400).json({ error: 'Stock cannot go below zero' });
    next(err);
  } finally { client.release(); }
});

// GET /api/products/variants/:variantId/movements — the audit trail
router.get('/variants/:variantId/movements', requireAdmin, async (req, res, next) => {
  try {
    const owned = await ownedVariant(req, req.params.variantId);
    if (!owned) return res.status(404).json({ error: 'Item not found' });
    const { rows } = await db.query(
      `SELECT m.*, u.name AS user_name, o.order_no
       FROM product_movements m
       LEFT JOIN users u ON u.id = m.created_by
       LEFT JOIN orders o ON o.id = m.order_id
       WHERE m.variant_id = $1 ORDER BY m.created_at DESC LIMIT 100`,
      [req.params.variantId]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

module.exports = router;
