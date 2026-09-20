const router = require('express').Router();
const db = require('../db');
const { requireAuth, requireSuperadmin, isSuperadmin } = require('../middleware/auth');

router.use(requireAuth);

const CODE_RE = /^[A-Z][A-Z0-9]{1,7}$/;

// GET /api/branches
// Superadmin sees every branch with live totals. Everyone else gets only
// their own branch, and only its name — enough to show "you are working in
// Bakara" in the sidebar, without leaking the existence of other branches.
router.get('/', async (req, res, next) => {
  try {
    if (!isSuperadmin(req)) {
      const { rows } = await db.query(
        'SELECT id, name, code, phone, address, active FROM branches WHERE id = $1',
        [req.user.branch_id]
      );
      return res.json(rows);
    }
    const { rows } = await db.query(`
      SELECT b.*,
             (SELECT COUNT(*)::int FROM users u   WHERE u.branch_id = b.id AND u.active) AS staff_count,
             (SELECT COUNT(*)::int FROM fabrics f WHERE f.branch_id = b.id AND f.active) AS fabric_count,
             (SELECT COUNT(*)::int FROM orders o  WHERE o.branch_id = b.id AND o.deleted_at IS NULL) AS order_count
      FROM branches b
      ORDER BY b.active DESC, b.name ASC`);
    res.json(rows);
  } catch (err) { next(err); }
});

// Everything below changes the shape of the business — superadmin only.
router.use(requireSuperadmin);

// POST /api/branches — register a new branch
router.post('/', async (req, res, next) => {
  try {
    const name = (req.body.name || '').trim();
    let code = (req.body.code || '').trim().toUpperCase();
    const phone = (req.body.phone || '').trim() || null;
    const address = (req.body.address || '').trim() || null;

    if (!name) return res.status(400).json({ error: 'Branch name is required' });
    if (!code) return res.status(400).json({ error: 'Branch code is required' });
    if (!CODE_RE.test(code)) {
      return res.status(400).json({
        error: 'Branch code must be 2–8 characters, start with a letter, and use only capital letters and numbers (e.g. HDN, BKR2)',
      });
    }

    const { rows } = await db.query(
      `INSERT INTO branches (name, code, phone, address) VALUES ($1,$2,$3,$4) RETURNING *`,
      [name, code, phone, address]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      const which = err.constraint === 'branches_code_key' ? 'code' : 'name';
      return res.status(409).json({ error: `A branch with this ${which} already exists` });
    }
    next(err);
  }
});

// PUT /api/branches/:id — rename / edit contact details / open-close
//
// The CODE is deliberately NOT editable. It is baked into every order number
// this branch has ever issued (HDN-1, HDN-2...), so changing it would orphan
// that history and break the per-branch numbering sequence.
router.put('/:id', async (req, res, next) => {
  try {
    const fields = [];
    const values = [];
    let i = 1;

    if (req.body.name !== undefined) {
      const name = (req.body.name || '').trim();
      if (!name) return res.status(400).json({ error: 'Branch name cannot be empty' });
      fields.push(`name = $${i++}`); values.push(name);
    }
    for (const key of ['phone', 'address']) {
      if (req.body[key] !== undefined) {
        fields.push(`${key} = $${i++}`);
        values.push((req.body[key] || '').trim() || null);
      }
    }
    if (req.body.active !== undefined) {
      const active = !!req.body.active;
      // Closing a branch locks its staff out at login, so refuse to do it
      // while orders are still open — that money would become invisible.
      if (!active) {
        const open = await db.query(
          `SELECT COUNT(*)::int AS n FROM orders o
           JOIN order_finance f ON f.order_id = o.id
           WHERE o.branch_id = $1 AND o.deleted_at IS NULL
             AND o.status <> 'cancelled' AND f.balance > 0`,
          [req.params.id]
        );
        if (open.rows[0].n > 0) {
          return res.status(400).json({
            error: `This branch still has ${open.rows[0].n} order(s) with money outstanding. Settle or cancel them before closing the branch.`,
          });
        }
      }
      fields.push(`active = $${i++}`); values.push(active);
    }

    if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
    values.push(req.params.id);
    const { rows } = await db.query(
      `UPDATE branches SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, values
    );
    if (!rows[0]) return res.status(404).json({ error: 'Branch not found' });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A branch with this name already exists' });
    next(err);
  }
});

// DELETE /api/branches/:id — only ever allowed while a branch is still empty.
// A branch that has traded is closed (active = false), never deleted, so its
// orders and revenue history stay intact and auditable.
router.delete('/:id', async (req, res, next) => {
  try {
    const counts = await db.query(`
      SELECT (SELECT COUNT(*)::int FROM orders  WHERE branch_id = $1) AS orders,
             (SELECT COUNT(*)::int FROM fabrics WHERE branch_id = $1) AS fabrics,
             (SELECT COUNT(*)::int FROM users   WHERE branch_id = $1) AS staff`,
      [req.params.id]
    );
    const c = counts.rows[0];
    if (c.orders || c.fabrics || c.staff) {
      return res.status(400).json({
        error: `This branch is in use (${c.orders} orders, ${c.fabrics} fabrics, ${c.staff} staff). Close it instead of deleting, so its history is kept.`,
      });
    }
    const { rows } = await db.query('DELETE FROM branches WHERE id = $1 RETURNING id', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Branch not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
