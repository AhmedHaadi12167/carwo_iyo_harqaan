const router = require('express').Router();
const db = require('../db');
const { requireAuth, branchCond } = require('../middleware/auth');

router.use(requireAuth);

// period -> SQL condition on a timestamp column
function periodCond(col, period) {
  switch (period) {
    case 'daily':   return `${col} >= date_trunc('day', now())`;
    case 'weekly':  return `${col} >= date_trunc('week', now())`;
    case 'monthly': return `${col} >= date_trunc('month', now())`;
    default:        return 'TRUE'; // all time
  }
}

// previous equivalent window (yesterday / last week / last month)
function prevPeriodCond(col, period) {
  switch (period) {
    case 'daily':
      return `${col} >= date_trunc('day', now()) - INTERVAL '1 day' AND ${col} < date_trunc('day', now())`;
    case 'weekly':
      return `${col} >= date_trunc('week', now()) - INTERVAL '1 week' AND ${col} < date_trunc('week', now())`;
    case 'monthly':
      return `${col} >= date_trunc('month', now()) - INTERVAL '1 month' AND ${col} < date_trunc('month', now())`;
    default:
      return null; // no trend for all-time
  }
}

// % change helper
function pct(curr, prev) {
  const c = Number(curr) || 0;
  const p = Number(prev) || 0;
  if (p === 0) return c > 0 ? 100 : 0;
  return Math.round(((c - p) / p) * 1000) / 10;
}

// GET /api/dashboard/summary?period=daily|weekly|monthly|all
router.get('/summary', async (req, res, next) => {
  try {
    const isAdmin = ['admin', 'superadmin'].includes(req.user.role);
    const period = req.query.period || 'all';
    // Deleted (hidden) orders are excluded from every dashboard figure by
    // folding the check straight into the guard each query already uses.
    // The branch condition rides along in the same guard, so every figure on
    // the dashboard is branch-scoped by construction — there is no query here
    // that could accidentally be left global.
    const guard = `o.deleted_at IS NULL AND ${branchCond(req, 'o')} AND `
      + (isAdmin ? 'TRUE' : `NOT (o.status = 'delivered' AND f.payment_status = 'paid')`);
    const inPeriod = periodCond('o.created_at', period);
    const payInPeriod = periodCond('p.created_at', period);

    const queries = [
      // Order counts + money for orders created in the period
      db.query(`
        SELECT COUNT(*)::int AS total_orders,
               COUNT(*) FILTER (WHERE o.status = 'pending')::int AS pending,
               COUNT(*) FILTER (WHERE o.status = 'in_progress')::int AS in_progress,
               COUNT(*) FILTER (WHERE o.status = 'completed')::int AS completed,
               COUNT(*) FILTER (WHERE o.status = 'delivered')::int AS delivered,
               COUNT(*) FILTER (WHERE o.status = 'cancelled')::int AS cancelled,
               COALESCE(SUM(o.price - o.discount_amount) FILTER (WHERE o.status <> 'cancelled'), 0) AS revenue,
               COALESCE(SUM(f.balance) FILTER (WHERE o.status <> 'cancelled'), 0) AS uncollected
        FROM orders o JOIN order_finance f ON f.order_id = o.id
        WHERE ${guard} AND ${inPeriod}`),
      // Money actually collected during the period (by payment date)
      db.query(`
        SELECT COALESCE(SUM(p.amount), 0) AS collected
        FROM payments p JOIN orders o ON o.id = p.order_id
        WHERE o.status <> 'cancelled' AND o.deleted_at IS NULL
          AND ${branchCond(req, 'o')} AND ${payInPeriod}`),
      // Cloth AND ready-made goods in one list. Two kinds of stock with one
      // alert panel, so nothing runs out unnoticed just because it is not cloth.
      db.query(`
        (SELECT 'fabric' AS kind, f.id, f.code, f.name, f.color,
                f.quantity_meters::numeric AS qty, f.reorder_level::numeric AS reorder_level,
                'yd' AS unit
           FROM fabrics f
          WHERE f.active = TRUE AND f.quantity_meters <= f.reorder_level AND ${branchCond(req, 'f')})
        UNION ALL
        (SELECT 'product' AS kind, v.id, NULL AS code,
                p.name || COALESCE(' · ' || v.size, '') AS name, v.color,
                v.quantity::numeric AS qty, v.reorder_level::numeric AS reorder_level,
                'pcs' AS unit
           FROM product_variants v
           JOIN products p ON p.id = v.product_id
          WHERE v.active AND p.active AND v.quantity <= v.reorder_level AND ${branchCond(req, 'p')})
        ORDER BY qty ASC LIMIT 10`),
      db.query(`
        SELECT o.id, o.order_no, o.delivery_date, o.status, c.name AS customer_name, f.payment_status, f.balance
        FROM orders o JOIN customers c ON c.id = o.customer_id JOIN order_finance f ON f.order_id = o.id
        WHERE o.status NOT IN ('delivered','cancelled') AND o.delivery_date IS NOT NULL AND ${guard}
        ORDER BY o.delivery_date ASC LIMIT 8`),
      // Customers coming TODAY — both admin and salesman must prepare these
      db.query(`
        SELECT o.id, o.order_no, o.status, c.name AS customer_name, f.payment_status, f.balance,
               (SELECT STRING_AGG(oi.qty || ' × ' || REPLACE(oi.garment_type,'_',' '), ', ')
                  FROM order_items oi WHERE oi.order_id = o.id) AS garments
        FROM orders o JOIN customers c ON c.id = o.customer_id JOIN order_finance f ON f.order_id = o.id
        WHERE o.delivery_date = CURRENT_DATE
          AND o.status NOT IN ('cancelled','delivered')  -- delivered = done, no need to show
          AND ${guard}
        ORDER BY o.id ASC LIMIT 20`),
      db.query(`
        SELECT o.id, o.order_no, o.status, o.price, o.created_at, c.name AS customer_name,
               f.paid, f.balance, f.payment_status
        FROM orders o JOIN customers c ON c.id = o.customer_id JOIN order_finance f ON f.order_id = o.id
        WHERE ${guard}
        ORDER BY o.created_at DESC LIMIT 8`),
      // DELAYED orders — past their appointment date and still not delivered
      db.query(`
        SELECT o.id, o.order_no, o.status, o.delivery_date,
               (CURRENT_DATE - o.delivery_date)::int AS days_late,
               c.name AS customer_name, f.payment_status, f.balance,
               tl.name AS tailor_name,
               (SELECT STRING_AGG(oi.qty || ' × ' || REPLACE(oi.garment_type,'_',' '), ', ')
                  FROM order_items oi WHERE oi.order_id = o.id) AS garments
        FROM orders o
        JOIN customers c ON c.id = o.customer_id
        JOIN order_finance f ON f.order_id = o.id
        LEFT JOIN users tl ON tl.id = o.tailor_id
        WHERE o.delivery_date < CURRENT_DATE AND o.status NOT IN ('delivered','cancelled') AND ${guard}
        ORDER BY o.delivery_date ASC LIMIT 50`),
    ];

    // Previous-period comparison for trend arrows
    const prevOrders = prevPeriodCond('o.created_at', period);
    const prevPay = prevPeriodCond('p.created_at', period);
    if (prevOrders) {
      queries.push(db.query(`
        SELECT COUNT(*)::int AS total_orders,
               COALESCE(SUM(o.price - o.discount_amount) FILTER (WHERE o.status <> 'cancelled'), 0) AS revenue,
               COALESCE(SUM(f.balance) FILTER (WHERE o.status <> 'cancelled'), 0) AS uncollected
        FROM orders o JOIN order_finance f ON f.order_id = o.id
        WHERE ${guard} AND ${prevOrders}`));
      queries.push(db.query(`
        SELECT COALESCE(SUM(p.amount), 0) AS collected
        FROM payments p JOIN orders o ON o.id = p.order_id
        WHERE o.status <> 'cancelled' AND o.deleted_at IS NULL
          AND ${branchCond(req, 'o')} AND ${prevPay}`));
    }

    const [totals, collected, lowStock, upcoming, today, recent, delayed, prevTotals, prevCollected] = await Promise.all(queries);

    const t = { ...totals.rows[0], collected: collected.rows[0].collected };

    let trends = null;
    if (prevTotals) {
      const pv = prevTotals.rows[0];
      trends = {
        total_orders: pct(t.total_orders, pv.total_orders),
        revenue: pct(t.revenue, pv.revenue),
        collected: pct(t.collected, prevCollected.rows[0].collected),
        uncollected: pct(t.uncollected, pv.uncollected),
      };
    }

    // Salesmen never see revenue / collected totals
    if (!isAdmin) {
      delete t.revenue; delete t.collected;
      if (trends) { delete trends.revenue; delete trends.collected; }
    }

    res.json({
      period,
      totals: t,
      trends,
      low_stock: lowStock.rows,
      upcoming_deliveries: upcoming.rows,
      today_appointments: today.rows,
      recent_orders: recent.rows,
      delayed_orders: isAdmin ? delayed.rows : [], // delayed tracking is an admin feature
    });
  } catch (err) { next(err); }
});

// GET /api/dashboard/monthly?months=12 — chart data
// Admin: money (paid/unpaid/billed). Salesman: order counts only.
router.get('/monthly', async (req, res, next) => {
  try {
    const isAdmin = ['admin', 'superadmin'].includes(req.user.role);
    const months = Math.min(Number(req.query.months) || 12, 24);
    const { rows } = await db.query(`
      WITH months AS (
        SELECT date_trunc('month', now()) - (INTERVAL '1 month' * g) AS month
        FROM generate_series(0, $1 - 1) g
      )
      -- The branch condition belongs in the LEFT JOIN, not a WHERE: putting it
      -- in WHERE would drop whole months that happen to have no orders at this
      -- branch, leaving gaps in the chart instead of honest zeros.
      SELECT to_char(m.month, 'FMMonth') AS label,
             to_char(m.month, 'YYYY-MM') AS ym,
             COALESCE(SUM(o.price), 0) AS billed,
             COALESCE(SUM(f.paid), 0) AS paid,
             COALESCE(SUM(f.balance), 0) AS unpaid,
             COUNT(o.id)::int AS orders,
             COUNT(o.id) FILTER (WHERE f.payment_status = 'paid')::int AS paid_orders,
             COUNT(o.id) FILTER (WHERE f.payment_status <> 'paid')::int AS unpaid_orders
      FROM months m
      LEFT JOIN orders o ON date_trunc('month', o.created_at) = m.month AND o.status <> 'cancelled'
                        AND o.deleted_at IS NULL AND ${branchCond(req, 'o')}
      LEFT JOIN order_finance f ON f.order_id = o.id
      GROUP BY m.month ORDER BY m.month`,
      [months]
    );
    if (!isAdmin) {
      return res.json(rows.map(({ label, ym, orders, paid_orders, unpaid_orders }) =>
        ({ label, ym, orders, paid_orders, unpaid_orders })));
    }
    res.json(rows);
  } catch (err) { next(err); }
});

module.exports = router;
