const router = require('express').Router();
const db = require('../db');
const { requireAuth, requireAdmin, readBranch } = require('../middleware/auth');

// Reports and statements are ADMIN ONLY
router.use(requireAuth, requireAdmin);

// GET /api/reports?fabric_id=&customer_id=&status=&from=&to=&branch_id=
// Orders + revenue filtered by fabric, customer and date range.
//
// A branch admin's report covers their branch only. A superadmin gets the
// whole business by default, or one branch with ?branch_id=, and additionally
// has /by-branch below to compare branches side by side.
router.get('/', async (req, res, next) => {
  try {
    const { fabric_id, customer_id, status, from, to } = req.query;
    const params = [];
    // Hidden orders never appear in any report or revenue total.
    const where = ['o.deleted_at IS NULL'];

    const branch = readBranch(req);
    if (branch != null) { params.push(branch); where.push(`o.branch_id = $${params.length}`); }

    if (customer_id) { params.push(customer_id); where.push(`o.customer_id = $${params.length}`); }
    if (status) { params.push(status); where.push(`o.status = $${params.length}`); }
    if (from) { params.push(from); where.push(`o.created_at >= $${params.length}`); }
    if (to) { params.push(to); where.push(`o.created_at < ($${params.length}::date + 1)`); }
    if (fabric_id) {
      params.push(fabric_id);
      where.push(`EXISTS (SELECT 1 FROM order_items x WHERE x.order_id = o.id AND x.fabric_id = $${params.length})`);
    }
    const W = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const [agg, rows, byFabric, byType, byProduct] = await Promise.all([
      db.query(`
        SELECT COUNT(*)::int AS orders,
               -- Revenue is what the customer was actually billed, after any
               -- discount. Counting the pre-discount figure would report money
               -- the shop never received.
               COALESCE(SUM(f.net_price) FILTER (WHERE o.status <> 'cancelled'), 0) AS revenue,
               COALESCE(SUM(o.discount_amount) FILTER (WHERE o.status <> 'cancelled'), 0) AS discounts,
               COUNT(*) FILTER (WHERE o.status <> 'cancelled' AND o.discount_amount > 0)::int AS discounted_orders,
               COALESCE(SUM(f.paid) FILTER (WHERE o.status <> 'cancelled'), 0) AS collected,
               COALESCE(SUM(f.balance) FILTER (WHERE o.status <> 'cancelled'), 0) AS uncollected
        FROM orders o JOIN order_finance f ON f.order_id = o.id ${W}`, params),
      db.query(`
        SELECT o.id, o.order_no, o.status, o.price, o.created_at, o.delivery_date,
               c.name AS customer_name, c.phone AS customer_phone,
               b.name AS branch_name, b.code AS branch_code,
               f.paid, f.balance, f.payment_status,
               (SELECT STRING_AGG(DISTINCT COALESCE(fb.code, 'own fabric'), ', ')
                  FROM order_items oi LEFT JOIN fabrics fb ON fb.id = oi.fabric_id
                 WHERE oi.order_id = o.id) AS fabrics,
               (SELECT COALESCE(SUM(oi.meters), 0) FROM order_items oi WHERE oi.order_id = o.id) AS meters
        FROM orders o
        JOIN customers c ON c.id = o.customer_id
        JOIN branches b ON b.id = o.branch_id
        JOIN order_finance f ON f.order_id = o.id
        ${W} ORDER BY o.created_at DESC LIMIT 500`, params),
      // Revenue grouped by fabric within the same filters. cost_per_meter and
      // price_per_meter are reported alongside, so the margin on each fabric is
      // visible rather than having to be worked out by hand.
      db.query(`
        SELECT fb.id, fb.code, fb.name, fb.color,
               fb.cost_per_meter, fb.price_per_meter,
               COUNT(DISTINCT o.id)::int AS orders,
               COALESCE(SUM(oi.meters), 0) AS meters_used,
               COALESCE(SUM(oi.amount), 0) AS revenue,
               COALESCE(SUM(oi.meters * fb.cost_per_meter), 0) AS cost,
               COALESCE(SUM(oi.amount) - SUM(oi.meters * fb.cost_per_meter), 0) AS margin
        FROM order_items oi
        JOIN fabrics fb ON fb.id = oi.fabric_id
        JOIN orders o ON o.id = oi.order_id
        JOIN order_finance f ON f.order_id = o.id
        ${W ? W + ' AND ' : 'WHERE '} o.status <> 'cancelled'
        GROUP BY fb.id ORDER BY revenue DESC LIMIT 20`, params),

      // ---- Which revenue stream actually earns? ----
      // Sewing vs cut cloth vs ready-made, side by side. This is the question
      // an owner with three streams keeps asking, and it could not be answered
      // at all before line_type existed.
      db.query(`
        SELECT oi.line_type,
               COUNT(DISTINCT o.id)::int AS orders,
               COALESCE(SUM(oi.qty), 0)::int AS units,
               COALESCE(SUM(oi.amount), 0) AS revenue,
               COALESCE(SUM(
                 CASE WHEN oi.variant_id IS NOT NULL THEN oi.qty * COALESCE(pv.cost_price, 0)
                      ELSE oi.meters * COALESCE(fb.cost_per_meter, 0) END), 0) AS cost,
               COALESCE(SUM(oi.amount), 0) - COALESCE(SUM(
                 CASE WHEN oi.variant_id IS NOT NULL THEN oi.qty * COALESCE(pv.cost_price, 0)
                      ELSE oi.meters * COALESCE(fb.cost_per_meter, 0) END), 0) AS margin
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        JOIN order_finance f ON f.order_id = o.id
        LEFT JOIN fabrics fb ON fb.id = oi.fabric_id
        LEFT JOIN product_variants pv ON pv.id = oi.variant_id
        ${W ? W + ' AND ' : 'WHERE '} o.status <> 'cancelled'
        GROUP BY oi.line_type ORDER BY revenue DESC`, params),

      // ---- Best sellers, per size/colour ----
      // Reported at VARIANT level, not product level: knowing "Cabaayad Dubai
      // sells well" is far less useful than knowing size M sells out while
      // size XL sits on the shelf.
      db.query(`
        SELECT pv.id, p.name AS product_name, p.brand, pc.name AS category_name,
               pv.size, pv.color, pv.quantity AS in_stock,
               pv.cost_price, pv.sell_price,
               COUNT(DISTINCT o.id)::int AS orders,
               COALESCE(SUM(oi.qty), 0)::int AS units_sold,
               COALESCE(SUM(oi.amount), 0) AS revenue,
               COALESCE(SUM(oi.qty * pv.cost_price), 0) AS cost,
               COALESCE(SUM(oi.amount) - SUM(oi.qty * pv.cost_price), 0) AS margin
        FROM order_items oi
        JOIN product_variants pv ON pv.id = oi.variant_id
        JOIN products p ON p.id = pv.product_id
        LEFT JOIN product_categories pc ON pc.id = p.category_id
        JOIN orders o ON o.id = oi.order_id
        JOIN order_finance f ON f.order_id = o.id
        ${W ? W + ' AND ' : 'WHERE '} o.status <> 'cancelled'
        GROUP BY pv.id, p.name, p.brand, pc.name
        ORDER BY units_sold DESC, revenue DESC LIMIT 50`, params),
    ]);

    res.json({
      summary: agg.rows[0],
      orders: rows.rows,
      by_fabric: byFabric.rows,
      by_line_type: byType.rows,
      by_product: byProduct.rows,
      branch_id: branch,
    });
  } catch (err) { next(err); }
});

// GET /api/reports/by-branch?from=&to= — one row per branch, side by side.
// This is the superadmin's whole-business view. A branch admin is refused
// rather than shown a one-row table, because the point of the endpoint is
// comparison and they have nothing to compare against.
router.get('/by-branch', async (req, res, next) => {
  try {
    if (readBranch(req) != null) {
      return res.status(403).json({ error: 'Only a superadmin can compare branches' });
    }
    const { from, to } = req.query;
    const params = [];
    const range = [];
    if (from) { params.push(from); range.push(`AND o.created_at >= $${params.length}`); }
    if (to) { params.push(to); range.push(`AND o.created_at < ($${params.length}::date + 1)`); }
    const r = range.join(' ');

    // Every condition sits in the LEFT JOIN, not a WHERE, so a branch with no
    // orders in the period still appears — as a row of zeros. Dropping it
    // would quietly hide a branch that had a bad month, which is exactly the
    // branch the owner most needs to see.
    const { rows } = await db.query(`
      SELECT b.id, b.name, b.code, b.active,
             COUNT(DISTINCT o.id)::int AS orders,
             COUNT(DISTINCT o.id) FILTER (WHERE o.status = 'pending')::int     AS pending,
             COUNT(DISTINCT o.id) FILTER (WHERE o.status = 'in_progress')::int AS in_progress,
             COUNT(DISTINCT o.id) FILTER (WHERE o.status = 'completed')::int   AS completed,
             COUNT(DISTINCT o.id) FILTER (WHERE o.status = 'delivered')::int   AS delivered,
             COUNT(DISTINCT o.id) FILTER (WHERE o.status = 'cancelled')::int   AS cancelled,
             COALESCE(SUM(o.price - o.discount_amount) FILTER (WHERE o.status <> 'cancelled'), 0) AS revenue,
             COALESCE(SUM(f.paid)    FILTER (WHERE o.status <> 'cancelled'), 0) AS collected,
             COALESCE(SUM(f.balance) FILTER (WHERE o.status <> 'cancelled'), 0) AS uncollected,
             (SELECT COUNT(*)::int FROM users u WHERE u.branch_id = b.id AND u.active) AS staff,
             (SELECT COUNT(*)::int FROM fabrics fb WHERE fb.branch_id = b.id AND fb.active) AS fabrics,
             (SELECT COALESCE(SUM(fb.quantity_meters * fb.cost_per_meter), 0)
                FROM fabrics fb WHERE fb.branch_id = b.id AND fb.active) AS stock_value
      FROM branches b
      LEFT JOIN orders o ON o.branch_id = b.id AND o.deleted_at IS NULL ${r}
      LEFT JOIN order_finance f ON f.order_id = o.id
      GROUP BY b.id, b.name, b.code, b.active
      ORDER BY revenue DESC, b.name ASC`, params);

    const num = (k) => rows.reduce((s, x) => s + Number(x[k] || 0), 0);
    res.json({
      from: from || null,
      to: to || null,
      branches: rows,
      combined: {
        branches: rows.length,
        orders: num('orders'),
        revenue: num('revenue'),
        collected: num('collected'),
        uncollected: num('uncollected'),
        staff: num('staff'),
        stock_value: num('stock_value'),
      },
    });
  } catch (err) { next(err); }
});

// GET /api/reports/tailors?tailor_id= — tailor performance (one tailor or all)
router.get('/tailors', async (req, res, next) => {
  try {
    const { tailor_id } = req.query;
    const params = [];
    const userWhere = [`u.role = 'tailor'`];
    let orderBranch = '';

    // As in /orders/tailor-performance: the branch has to constrain BOTH which
    // tailors are listed and which of their orders are counted.
    const branch = readBranch(req);
    if (branch != null) {
      params.push(branch);
      userWhere.push(`u.branch_id = $${params.length}`);
      orderBranch = `AND o.branch_id = $${params.length}`;
    }
    if (tailor_id) { params.push(tailor_id); userWhere.push(`u.id = $${params.length}`); }

    const { rows } = await db.query(`
      SELECT u.id, u.name, u.username, u.phone, u.active, u.staff_no,
             u.branch_id, b.name AS branch_name,
             COUNT(o.id)::int AS total_jobs,
             COUNT(o.id) FILTER (WHERE o.status = 'in_progress')::int AS in_progress,
             COUNT(o.id) FILTER (WHERE o.status IN ('completed','delivered'))::int AS completed,
             MAX(o.claimed_at) AS last_claimed
      FROM users u
      LEFT JOIN branches b ON b.id = u.branch_id
      LEFT JOIN orders o ON o.tailor_id = u.id AND o.status <> 'cancelled' ${orderBranch}
      WHERE ${userWhere.join(' AND ')}
      GROUP BY u.id, u.branch_id, b.name
      ORDER BY completed DESC, total_jobs DESC`, params);
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /api/reports/statement/:customerId?from=&to=
// Customer statement: all orders in the period, payments, balances.
router.get('/statement/:customerId', async (req, res, next) => {
  try {
    const { from, to } = req.query;
    const cust = await db.query('SELECT * FROM customers WHERE id = $1', [req.params.customerId]);
    if (!cust.rows[0]) return res.status(404).json({ error: 'Customer not found' });

    const params = [req.params.customerId];
    let range = '';
    // A statement only ever shows what the customer owes THIS branch. Two
    // branches billing the same person produce two separate statements, which
    // is correct — each branch collects its own money.
    const branch = readBranch(req);
    if (branch != null) { params.push(branch); range += ` AND o.branch_id = $${params.length}`; }
    if (from) { params.push(from); range += ` AND o.created_at >= $${params.length}`; }
    if (to) { params.push(to); range += ` AND o.created_at < ($${params.length}::date + 1)`; }

    const orders = await db.query(`
      SELECT o.id, o.order_no, o.status, o.price, o.created_at, o.delivery_date,
             f.paid, f.balance, f.payment_status,
             (SELECT STRING_AGG(oi.qty || ' × ' || REPLACE(oi.garment_type, '_', ' ') ||
                                COALESCE(' (' || fb.code || ')', ''), ', ')
                FROM order_items oi LEFT JOIN fabrics fb ON fb.id = oi.fabric_id
               WHERE oi.order_id = o.id) AS items_summary
      FROM orders o JOIN order_finance f ON f.order_id = o.id
      WHERE o.customer_id = $1 AND o.status <> 'cancelled' AND o.deleted_at IS NULL ${range}
      ORDER BY o.created_at ASC`, params);

    const totals = orders.rows.reduce((a, o) => ({
      billed: a.billed + Number(o.price),
      paid: a.paid + Number(o.paid),
      balance: a.balance + Number(o.balance),
    }), { billed: 0, paid: 0, balance: 0 });

    res.json({
      customer: cust.rows[0],
      from: from || null,
      to: to || null,
      orders: orders.rows,
      totals,
      unpaid_orders: orders.rows.filter((o) => o.payment_status !== 'paid').length,
    });
  } catch (err) { next(err); }
});

module.exports = router;
