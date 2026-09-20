const router = require('express').Router();
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

function requireTailor(req, res, next) {
  if (req.user?.role !== 'tailor') return res.status(403).json({ error: 'Tailor access required' });
  next();
}

router.use(requireAuth, requireTailor);

// Tailors see garments + measurements — NEVER prices, balances or customer contacts.
const garments = `(SELECT STRING_AGG(oi.qty || ' × ' || REPLACE(oi.garment_type, '_', ' '), ', ')
                     FROM order_items oi WHERE oi.order_id = o.id)`;

// NOTE: Orders are ASSIGNED to tailors by the shop (salesman/admin).
// Tailors work only on their assigned jobs — no self-claiming.
//
// BRANCH: every query here is already keyed on `o.tailor_id = req.user.id`,
// and a tailor can only ever be assigned an order from their own branch, so
// nothing cross-branch can appear. The extra `o.branch_id = ...` below is
// defence-in-depth: if an assignment were ever created wrongly (a bad import,
// a future bug), the tailor still would not see another branch's job.

// ---------------- My jobs ----------------
router.get('/my', async (req, res, next) => {
  try {
    const { status } = req.query;
    const params = [req.user.id, req.user.branch_id];
    let extra = '';
    if (status) { params.push(status); extra = `AND o.status = $${params.length}`; }
    const { rows } = await db.query(`
      SELECT o.id, o.order_no, o.status, o.delivery_date, o.claimed_at, c.name AS customer_name,
             ${garments} AS garments
      FROM orders o JOIN customers c ON c.id = o.customer_id
      WHERE o.tailor_id = $1 AND o.branch_id = $2
        AND o.status <> 'cancelled' AND o.deleted_at IS NULL ${extra}
      ORDER BY (o.status = 'in_progress') DESC, o.delivery_date ASC NULLS LAST
      LIMIT 200`, params);
    res.json(rows);
  } catch (err) { next(err); }
});

// ---------------- My performance ----------------
router.get('/stats', async (req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE status = 'in_progress')::int AS in_progress,
             COUNT(*) FILTER (WHERE status IN ('completed','delivered'))::int AS completed
      FROM orders WHERE tailor_id = $1 AND branch_id = $2
        AND status <> 'cancelled' AND deleted_at IS NULL`, [req.user.id, req.user.branch_id]);
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// ---------------- Job detail (measurements, items — no money, no contacts) ----------------
router.get('/my/:id', async (req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT o.id, o.order_no, o.status, o.delivery_date, o.claimed_at, o.created_at,
             o.measurements, o.notes, c.name AS customer_name
      FROM orders o JOIN customers c ON c.id = o.customer_id
      WHERE o.id = $1 AND o.tailor_id = $2 AND o.branch_id = $3 AND o.deleted_at IS NULL`,
      [req.params.id, req.user.id, req.user.branch_id]);
    if (!rows[0]) return res.status(404).json({ error: 'Job not found in your list' });

    const items = await db.query(`
      SELECT oi.garment_type, oi.qty, oi.meters,
             fb.code AS fabric_code, fb.name AS fabric_name, fb.color AS fabric_color
      FROM order_items oi LEFT JOIN fabrics fb ON fb.id = oi.fabric_id
      WHERE oi.order_id = $1 ORDER BY oi.id`, [req.params.id]);

    res.json({ ...rows[0], items: items.rows });
  } catch (err) { next(err); }
});

// ---------------- Update job status (in_progress / completed only) ----------------
router.patch('/my/:id/status', async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!['in_progress', 'completed'].includes(status)) {
      return res.status(400).json({ error: 'Tailors can set In Progress or Completed only' });
    }
    const { rows } = await db.query(
      `UPDATE orders SET status = $1
       WHERE id = $2 AND tailor_id = $3 AND branch_id = $4
         AND status NOT IN ('delivered','cancelled')
       RETURNING id, order_no, status`,
      [status, req.params.id, req.user.id, req.user.branch_id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Job not found or already delivered' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;
