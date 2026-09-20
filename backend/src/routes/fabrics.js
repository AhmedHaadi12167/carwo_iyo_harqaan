const router = require('express').Router();
const db = require('../db');
const { requireAuth, requireAdmin, readBranch, writeBranch, isSuperadmin } = require('../middleware/auth');

router.use(requireAuth);

// Cost price is what the shop PAID — it is management information, not
// something a salesman standing at the counter should see. Selling price is
// the opposite: staff need it to quote a customer, so it always goes out.
function hideCost(req, rows) {
  if (['admin', 'superadmin'].includes(req.user.role)) return rows;
  for (const r of rows) delete r.cost_per_meter;
  return rows;
}

// GET /api/fabrics?search=&low=1&branch_id=
// Each branch has its own rolls of cloth, so a fabric list is always the
// caller's own branch. A superadmin sees every branch's stock, with the
// branch name attached so identical codes stay tellable apart.
router.get('/', async (req, res, next) => {
  try {
    const { search, low } = req.query;
    const params = [];
    const where = ['f.active = TRUE'];

    const branch = readBranch(req);
    if (branch != null) { params.push(branch); where.push(`f.branch_id = $${params.length}`); }

    if (search) {
      params.push(`%${search}%`);
      where.push(`(f.code ILIKE $${params.length} OR f.name ILIKE $${params.length} OR f.color ILIKE $${params.length})`);
    }
    if (low === '1') where.push('f.quantity_meters <= f.reorder_level');

    const { rows } = await db.query(
      `SELECT f.*, b.name AS branch_name, b.code AS branch_code
       FROM fabrics f JOIN branches b ON b.id = f.branch_id
       WHERE ${where.join(' AND ')}
       ORDER BY f.created_at DESC`, params
    );
    res.json(hideCost(req, rows));
  } catch (err) { next(err); }
});

// GET /api/fabrics/code/:code — barcode scan lookup
//
// The same code can now exist in several branches as genuinely different
// rolls, so a scan resolves within the scanner's OWN branch only. Without
// that, a salesman in Bakara scanning SS0098 could pull Hodan's roll and
// deduct stock from the wrong shelf.
router.get('/code/:code', async (req, res, next) => {
  try {
    const params = [req.params.code.trim()];
    const where = ['UPPER(f.code) = UPPER($1)', 'f.active = TRUE'];
    const branch = readBranch(req);
    if (branch != null) { params.push(branch); where.push(`f.branch_id = $${params.length}`); }

    const { rows } = await db.query(
      `SELECT f.*, b.name AS branch_name, b.code AS branch_code
       FROM fabrics f JOIN branches b ON b.id = f.branch_id
       WHERE ${where.join(' AND ')}
       ORDER BY f.branch_id LIMIT 1`,
      params
    );
    if (!rows[0]) return res.status(404).json({ error: `No fabric found with code "${req.params.code}" in this branch` });
    const [fabric] = hideCost(req, rows);
    res.json({ ...fabric, available: Number(fabric.quantity_meters) > 0 });
  } catch (err) { next(err); }
});

// POST /api/fabrics — register a new fabric (shipment arrival)
router.post('/', requireAdmin, async (req, res, next) => {
  const client = await db.getClient();
  try {
    const { code, name, component, weight, color, brand, image,
            cost_per_meter = 0, price_per_meter = 0, quantity_meters = 0, reorder_level = 10 } = req.body;
    if (!code || !name) return res.status(400).json({ error: 'Fabric code and name are required' });
    if (image && image.length > 500000) return res.status(400).json({ error: 'Image too large — retake the photo' });

    // A superadmin has no branch of their own, so they must say which branch
    // the shipment landed at. A branch admin can only ever stock their own.
    const branchId = writeBranch(req);
    if (!branchId) {
      return res.status(400).json({ error: 'Choose which branch this fabric belongs to' });
    }
    for (const [label, v] of [['Cost per meter', cost_per_meter], ['Price per meter', price_per_meter]]) {
      if (Number(v) < 0 || Number.isNaN(Number(v))) {
        return res.status(400).json({ error: `${label} must be a number and cannot be negative` });
      }
    }

    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO fabrics (branch_id, code, name, component, weight, color, brand, image, cost_per_meter, price_per_meter, quantity_meters, reorder_level)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [branchId, code.trim().toUpperCase(), name.trim(), component || null, weight || null, color, brand, image || null,
       cost_per_meter, price_per_meter, quantity_meters, reorder_level]
    );
    if (Number(quantity_meters) > 0) {
      await client.query(
        `INSERT INTO fabric_movements (fabric_id, type, meters, note, created_by)
         VALUES ($1,'in',$2,'Initial shipment',$3)`,
        [rows[0].id, quantity_meters, req.user.id]
      );
    }
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error: 'This branch already has a fabric with that code' });
    }
    next(err);
  } finally { client.release(); }
});

// POST /api/fabrics/:id/stock — add stock when a new shipment arrives (plus existing qty)
router.post('/:id/stock', requireAdmin, async (req, res, next) => {
  const client = await db.getClient();
  try {
    const { meters, type = 'in', note } = req.body;
    const m = Number(meters);
    if (!m || m <= 0) return res.status(400).json({ error: 'Meters must be a positive number' });
    if (!['in', 'adjustment'].includes(type)) return res.status(400).json({ error: 'Invalid movement type' });

    await client.query('BEGIN');
    const sign = type === 'in' ? '+' : (req.body.direction === 'decrease' ? '-' : '+');
    // The branch condition is part of the UPDATE itself, not a separate
    // lookup. A branch admin who guesses another branch's fabric id simply
    // matches no row and gets a 404 — there is no window where the wrong
    // shelf could be adjusted.
    const guard = [];
    const args = [m, req.params.id];
    const branch = readBranch(req);
    if (branch != null) { args.push(branch); guard.push(`AND branch_id = $${args.length}`); }

    const { rows } = await client.query(
      `UPDATE fabrics SET quantity_meters = quantity_meters ${sign} $1
       WHERE id = $2 ${guard.join(' ')} RETURNING *`,
      args
    );
    if (!rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Fabric not found' }); }
    await client.query(
      `INSERT INTO fabric_movements (fabric_id, type, meters, note, created_by) VALUES ($1,$2,$3,$4,$5)`,
      [req.params.id, type, m, note || (type === 'in' ? 'New shipment' : 'Stock adjustment'), req.user.id]
    );
    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23514') return res.status(400).json({ error: 'Stock cannot go below zero' });
    next(err);
  } finally { client.release(); }
});

// PUT /api/fabrics/:id — edit fabric details / prices
router.put('/:id', requireAdmin, async (req, res, next) => {
  try {
    const allowed = ['code','name','component','weight','color','brand','cost_per_meter','price_per_meter','reorder_level','active','image'];
    if (req.body.image && req.body.image.length > 500000) {
      return res.status(400).json({ error: 'Image too large — retake the photo' });
    }
    // Which branch owns this fabric? Established first, because the
    // duplicate-code check below is only meaningful within that branch.
    const own = await db.query('SELECT branch_id FROM fabrics WHERE id = $1', [req.params.id]);
    if (!own.rows[0]) return res.status(404).json({ error: 'Fabric not found' });
    const ownerBranch = own.rows[0].branch_id;

    const scope = readBranch(req);
    if (scope != null && scope !== ownerBranch) {
      // Same answer as a genuinely missing fabric, so probing ids tells an
      // admin nothing about what other branches hold.
      return res.status(404).json({ error: 'Fabric not found' });
    }

    // Code is admin-editable (e.g. correcting a mistyped label) — kept
    // uppercase/trimmed, and unique WITHIN THE OWNING BRANCH. Another branch
    // legitimately having the same code is not a clash.
    if (req.body.code !== undefined) {
      if (!req.body.code.trim()) return res.status(400).json({ error: 'Fabric code cannot be empty' });
      req.body.code = req.body.code.trim().toUpperCase();
      const dupe = await db.query(
        'SELECT id FROM fabrics WHERE UPPER(code) = $1 AND branch_id = $2 AND id <> $3',
        [req.body.code, ownerBranch, req.params.id]
      );
      if (dupe.rows[0]) {
        return res.status(409).json({ error: `This branch already has a fabric with code "${req.body.code}". Choose a different code.` });
      }
    }
    const fields = [];
    const values = [];
    let i = 1;
    for (const key of allowed) {
      if (req.body[key] !== undefined) { fields.push(`${key} = $${i++}`); values.push(req.body[key]); }
    }
    if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
    values.push(req.params.id);
    const { rows } = await db.query(
      `UPDATE fabrics SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, values
    );
    if (!rows[0]) return res.status(404).json({ error: 'Fabric not found' });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: `This branch already has a fabric with code "${req.body.code}". Choose a different code.` });
    }
    next(err);
  }
});

// GET /api/fabrics/:id/movements — stock history
router.get('/:id/movements', requireAdmin, async (req, res, next) => {
  try {
    const params = [req.params.id];
    const where = ['fm.fabric_id = $1'];
    const branch = readBranch(req);
    if (branch != null) { params.push(branch); where.push(`f.branch_id = $${params.length}`); }

    // Confirm the fabric is actually in scope first. The branch filter below
    // already prevents any other branch's movements being returned, but on its
    // own it answers with an empty list — which is indistinguishable from "a
    // fabric you own that has no history yet", and quietly implies the id
    // exists. Every other :id route 404s here, so this one does too.
    if (branch != null) {
      const owned = await db.query(
        'SELECT 1 FROM fabrics WHERE id = $1 AND branch_id = $2', [req.params.id, branch]);
      if (!owned.rows[0]) return res.status(404).json({ error: 'Fabric not found' });
    }

    const { rows } = await db.query(
      `SELECT fm.*, u.name AS user_name
       FROM fabric_movements fm
       JOIN fabrics f ON f.id = fm.fabric_id
       LEFT JOIN users u ON u.id = fm.created_by
       WHERE ${where.join(' AND ')}
       ORDER BY fm.created_at DESC LIMIT 100`,
      params
    );
    res.json(rows);
  } catch (err) { next(err); }
});

module.exports = router;
