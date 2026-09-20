const router = require('express').Router();
const db = require('../db');
const { requireAuth, requireAdmin, readBranch } = require('../middleware/auth');

// PRIVACY: customers may be high-profile people. The whole customer
// MODULE (profiles, order history, statements, address/email) stays ADMIN
// ONLY. Counter staff get the customer's name and phone on the order itself
// instead — see the privacy note in routes/orders.js.
router.use(requireAuth, requireAdmin);

// A customer record is deliberately SHARED across branches, so the same
// person visiting two branches is one record rather than two. What is scoped
// is their ACTIVITY: a branch admin sees only the orders, order counts and
// balances that belong to their own branch. So the customer exists globally,
// but "what they owe" always means "what they owe this branch".

// GET /api/customers?search=
// Customers with no orders at this branch are filtered out — otherwise every
// branch's list would show every customer in the business with 0 orders.
router.get('/', async (req, res, next) => {
  try {
    const { search } = req.query;
    const params = [];
    const where = [];
    let branchJoin = '';

    const branch = readBranch(req);
    if (branch != null) {
      params.push(branch);
      branchJoin = `AND o.branch_id = $${params.length}`;
      where.push('o.id IS NOT NULL');
    }
    if (search) {
      params.push(`%${search}%`);
      where.push(`(c.name ILIKE $${params.length} OR c.phone ILIKE $${params.length})`);
    }

    const { rows } = await db.query(
      `SELECT c.*, COUNT(o.id)::int AS orders_count,
              COALESCE(SUM(f.balance) FILTER (WHERE o.status <> 'cancelled'), 0) AS total_balance
       FROM customers c
       LEFT JOIN orders o ON o.customer_id = c.id AND o.deleted_at IS NULL ${branchJoin}
       LEFT JOIN order_finance f ON f.order_id = o.id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       GROUP BY c.id ORDER BY c.created_at DESC LIMIT 2000`,
      params
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /api/customers/:id — profile with order history (this branch's only)
router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await db.query('SELECT * FROM customers WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Customer not found' });

    const params = [req.params.id];
    const where = ['o.customer_id = $1', 'o.deleted_at IS NULL'];
    const branch = readBranch(req);
    if (branch != null) { params.push(branch); where.push(`o.branch_id = $${params.length}`); }

    const orders = await db.query(
      `SELECT o.id, o.order_no, o.status, o.price, o.measurements, o.created_at,
              b.name AS branch_name, b.code AS branch_code,
              f.paid, f.payment_status, f.balance
       FROM orders o
       JOIN branches b ON b.id = o.branch_id
       JOIN order_finance f ON f.order_id = o.id
       WHERE ${where.join(' AND ')}
       ORDER BY o.created_at DESC LIMIT 50`,
      params
    );

    // A branch admin opening a customer who has only ever shopped elsewhere
    // would otherwise see a bare profile with no orders — say so plainly.
    if (branch != null && orders.rows.length === 0) {
      return res.status(404).json({ error: 'This customer has no orders at your branch' });
    }
    res.json({ ...rows[0], orders: orders.rows });
  } catch (err) { next(err); }
});

// PUT /api/customers/:id — admin updates customer info (name, phone)
router.put('/:id', async (req, res, next) => {
  try {
    const { name, phone } = req.body;
    const fields = [];
    const values = [];
    let i = 1;
    if (name !== undefined) {
      if (!name.trim()) return res.status(400).json({ error: 'Name cannot be empty' });
      fields.push(`name = $${i++}`); values.push(name.trim());
    }
    if (phone !== undefined) { fields.push(`phone = $${i++}`); values.push(phone ? phone.trim() : null); }
    if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
    values.push(req.params.id);
    const { rows } = await db.query(
      `UPDATE customers SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, values
    );
    if (!rows[0]) return res.status(404).json({ error: 'Customer not found' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;
