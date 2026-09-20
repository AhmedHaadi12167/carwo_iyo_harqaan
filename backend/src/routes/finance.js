const router = require('express').Router();
const db = require('../db');
const { requireAuth, requireAdmin, readBranch, writeBranch, branchCond } = require('../middleware/auth');
const { postMonthlyRecurring } = require('../recurring');

// The whole finance module is ADMIN ONLY.
// Before serving anything, make sure this month's rent & salaries are posted.
router.use(requireAuth, requireAdmin, async (req, res, next) => {
  try { await postMonthlyRecurring(); } catch { /* reports still work */ }
  next();
});

// EVERY figure in this module is branch-scoped. A branch admin sees their own
// branch's P&L and balance sheet; a superadmin sees the whole business
// combined, or one branch with ?branch_id=.
//
// Note what that means for the balance sheet: run per-branch it is a genuine
// per-branch balance sheet (that branch's cash, stock, receivables and its own
// share of capital), and the superadmin's combined view is the sum of them.
// Capital, expenses and assets are therefore recorded AGAINST a branch — head
// office costs belong to whichever branch actually bears them.

const EXPENSE_CATEGORIES = ['salary', 'rent', 'tax', 'utilities', 'supplies', 'marketing', 'other'];

function dateRange(col, from, to, params) {
  const parts = [];
  if (from) { params.push(from); parts.push(`${col} >= $${params.length}`); }
  if (to) { params.push(to); parts.push(`${col} <= $${params.length}`); }
  return parts.length ? 'AND ' + parts.join(' AND ') : '';
}

// Adds "AND <alias>.branch_id = $n" to a query that is already collecting
// bind parameters, so list/insert queries stay parameterised.
function andBranch(req, params, alias = '') {
  const b = readBranch(req);
  if (b == null) return '';
  params.push(b);
  return `AND ${alias ? `${alias}.` : ''}branch_id = $${params.length}`;
}

// For the /:id delete and update routes. Same trick as elsewhere: the branch
// goes into the statement itself, so a mismatched branch simply matches no
// row and returns 404 rather than touching another branch's books.
function branchGuardFor(req, params, alias = '') {
  return andBranch(req, params, alias);
}

/* ==================== PROFIT & LOSS ====================
   Revenue        = orders billed in the period (excl. cancelled)
   COGS           = cost of the fabric consumed by those orders
   Gross profit   = revenue − COGS
   Expenses       = salary, rent, tax… in the period
   NET PROFIT     = gross profit − expenses                     */
router.get('/pnl', async (req, res, next) => {
  try {
    const { from, to } = req.query;

    const p1 = []; const r1 = dateRange('o.created_at::date', from, to, p1); const b1 = andBranch(req, p1, 'o');
    const p2 = []; const r2 = dateRange('o.created_at::date', from, to, p2); const b2 = andBranch(req, p2, 'o');
    const p3 = []; const r3 = dateRange('e.expense_date', from, to, p3);     const b3 = andBranch(req, p3, 'e');
    const p4 = []; const r4 = dateRange('p.created_at::date', from, to, p4); const b4 = andBranch(req, p4, 'o');

    const [rev, cogs, exp, collected] = await Promise.all([
      // Revenue is NET of discount — a discount is money that never arrived,
      // so counting the pre-discount figure would invent income.
      db.query(`SELECT COALESCE(SUM(o.price - o.discount_amount),0) AS revenue,
                       COALESCE(SUM(o.discount_amount),0) AS discounts,
                       COUNT(*)::int AS orders
                FROM orders o WHERE o.status <> 'cancelled' AND o.deleted_at IS NULL ${r1} ${b1}`, p1),
      // COGS has TWO halves now. Cloth sold as cloth costs the shop exactly
      // what cloth sewn into a suit costs, so both fabric line types use the
      // same formula; ready-made goods cost the variant's purchase price.
      //
      // Leaving the product half out is the single most expensive mistake
      // available here: a product line has no yards and no fabric, so it
      // would contribute ZERO cost and every ready-made sale would report
      // 100% margin — inflating gross profit, net profit and, through
      // retained earnings, the balance sheet as well.
      db.query(`SELECT COALESCE(SUM(
                  CASE
                    WHEN oi.variant_id IS NOT NULL THEN oi.qty * COALESCE(pv.cost_price, 0)
                    ELSE oi.meters * COALESCE(fb.cost_per_meter, 0)
                  END), 0) AS cogs
                FROM order_items oi
                LEFT JOIN fabrics fb ON fb.id = oi.fabric_id
                LEFT JOIN product_variants pv ON pv.id = oi.variant_id
                JOIN orders o ON o.id = oi.order_id
                WHERE o.status <> 'cancelled' AND o.deleted_at IS NULL ${r2} ${b2}`, p2),
      db.query(`SELECT e.category, COALESCE(SUM(e.amount),0) AS total
                FROM expenses e WHERE TRUE ${r3} ${b3} GROUP BY e.category ORDER BY total DESC`, p3),
      db.query(`SELECT COALESCE(SUM(p.amount),0) AS collected
                FROM payments p JOIN orders o ON o.id = p.order_id
                WHERE o.status <> 'cancelled' AND o.deleted_at IS NULL ${r4} ${b4}`, p4),
    ]);

    const revenue = Number(rev.rows[0].revenue);
    const discounts = Number(rev.rows[0].discounts || 0);
    const cogsTotal = Number(cogs.rows[0].cogs);
    const grossProfit = revenue - cogsTotal;
    const expensesTotal = exp.rows.reduce((s, e) => s + Number(e.total), 0);

    res.json({
      from: from || null,
      to: to || null,
      branch_id: readBranch(req),
      orders: rev.rows[0].orders,
      revenue,
      discounts,
      cogs: cogsTotal,
      gross_profit: grossProfit,
      expenses: exp.rows,
      expenses_total: expensesTotal,
      net_profit: grossProfit - expensesTotal,
      collected: Number(collected.rows[0].collected),
    });
  } catch (err) { next(err); }
});

/* ==================== P&L PER BRANCH (superadmin) ====================
   One row per branch so the owner can compare them side by side. This is the
   view a branch admin must never have, so it is gated on being able to see
   more than one branch in the first place. */
router.get('/pnl-by-branch', async (req, res, next) => {
  try {
    if (readBranch(req) != null) {
      return res.status(403).json({ error: 'Only a superadmin can compare branches' });
    }
    const { from, to } = req.query;
    const p = [];
    const rOrders = dateRange('o.created_at::date', from, to, p);
    const pe = [];
    const rExp = dateRange('e.expense_date', from, to, pe);

    const [perBranch, perBranchExp] = await Promise.all([
      db.query(`
        SELECT b.id, b.name, b.code, b.active,
               COUNT(o.id)::int AS orders,
               COALESCE(SUM(o.price - o.discount_amount),0) AS revenue,
               COALESCE(SUM(o.discount_amount),0) AS discounts,
               COALESCE(SUM(fin.paid),0) AS collected,
               COALESCE(SUM(fin.balance),0) AS uncollected,
               COALESCE(SUM(
                 (SELECT COALESCE(SUM(
                     CASE WHEN oi.variant_id IS NOT NULL THEN oi.qty * COALESCE(pv.cost_price,0)
                          ELSE oi.meters * COALESCE(fb.cost_per_meter,0) END),0)
                    FROM order_items oi
                    LEFT JOIN fabrics fb ON fb.id = oi.fabric_id
                    LEFT JOIN product_variants pv ON pv.id = oi.variant_id
                   WHERE oi.order_id = o.id)
               ),0) AS cogs
        FROM branches b
        LEFT JOIN orders o ON o.branch_id = b.id AND o.status <> 'cancelled'
                          AND o.deleted_at IS NULL ${rOrders}
        LEFT JOIN order_finance fin ON fin.order_id = o.id
        GROUP BY b.id, b.name, b.code, b.active
        ORDER BY revenue DESC, b.name`, p),
      db.query(`
        SELECT b.id, COALESCE(SUM(e.amount),0) AS expenses
        FROM branches b
        LEFT JOIN expenses e ON e.branch_id = b.id ${rExp}
        GROUP BY b.id`, pe),
    ]);

    const expByBranch = Object.fromEntries(perBranchExp.rows.map((r) => [r.id, Number(r.expenses)]));
    const branches = perBranch.rows.map((r) => {
      const revenue = Number(r.revenue);
      const cogs = Number(r.cogs);
      const expenses = expByBranch[r.id] || 0;
      const gross = revenue - cogs;
      return {
        ...r,
        revenue, cogs,
        collected: Number(r.collected),
        uncollected: Number(r.uncollected),
        gross_profit: gross,
        expenses,
        net_profit: gross - expenses,
      };
    });

    const sum = (k) => branches.reduce((s, b) => s + Number(b[k] || 0), 0);
    res.json({
      from: from || null,
      to: to || null,
      branches,
      combined: {
        orders: branches.reduce((s, b) => s + b.orders, 0),
        revenue: sum('revenue'),
        cogs: sum('cogs'),
        gross_profit: sum('gross_profit'),
        expenses: sum('expenses'),
        net_profit: sum('net_profit'),
        collected: sum('collected'),
        uncollected: sum('uncollected'),
      },
    });
  } catch (err) { next(err); }
});

/* ==================== BALANCE SHEET ====================
   ASSETS                          EQUITY
   Cash (money in hand)            Capital (invested − withdrawn)
   Receivables (customers owe)     Retained earnings (profit kept in business)
   Inventory (fabric at cost)
   Fixed assets (machines…)
   TOTAL ASSETS          =         TOTAL EQUITY                   */
router.get('/balance-sheet', async (req, res, next) => {
  try {
    // These queries take no bind parameters, so the branch condition is
    // built by branchCond (integer-checked and inlined).
    const bo = branchCond(req, 'o');   // via orders
    const bf = branchCond(req, 'fb');  // via fabrics
    const bp = branchCond(req, '');    // table's own branch_id, no alias

    const [collected, receivables, inventory, fixedAssets, capital, purchases, expensesAll, revenueAll, cogsAll] =
      await Promise.all([
        db.query(`SELECT COALESCE(SUM(p.amount),0) AS v FROM payments p
                  JOIN orders o ON o.id = p.order_id
                  WHERE o.status <> 'cancelled' AND o.deleted_at IS NULL AND ${bo}`),
        db.query(`SELECT COALESCE(SUM(f.balance),0) AS v FROM order_finance f
                  JOIN orders o ON o.id = f.order_id
                  WHERE o.status <> 'cancelled' AND o.deleted_at IS NULL AND ${bo}`),
        // Inventory is cloth on the roll PLUS ready-made goods on the shelf.
        db.query(`SELECT
                    (SELECT COALESCE(SUM(quantity_meters * cost_per_meter),0)
                       FROM fabrics WHERE active = TRUE AND ${bp})
                  + (SELECT COALESCE(SUM(pv.quantity * pv.cost_price),0)
                       FROM product_variants pv JOIN products pr ON pr.id = pv.product_id
                      WHERE pv.active AND pr.active AND ${branchCond(req, 'pr')}) AS v`),
        db.query(`SELECT COALESCE(SUM(cost),0) AS v FROM assets WHERE active = TRUE AND ${bp}`),
        db.query(`SELECT
                    COALESCE(SUM(amount) FILTER (WHERE type = 'investment'),0) AS invested,
                    COALESCE(SUM(amount) FILTER (WHERE type = 'withdrawal'),0) AS withdrawn
                  FROM capital_entries WHERE ${bp}`),
        // Money spent on stock, both kinds. Restocks from cancelled orders are
        // excluded because nothing was bought — the goods came back.
        db.query(`SELECT
                    (SELECT COALESCE(SUM(fm.meters * fb.cost_per_meter),0)
                       FROM fabric_movements fm JOIN fabrics fb ON fb.id = fm.fabric_id
                      WHERE fm.type = 'in' AND COALESCE(fm.note,'') <> 'Restocked from cancelled order'
                        AND ${bf})
                  + (SELECT COALESCE(SUM(pm.qty * pv.cost_price),0)
                       FROM product_movements pm
                       JOIN product_variants pv ON pv.id = pm.variant_id
                       JOIN products pr ON pr.id = pv.product_id
                      WHERE pm.type = 'in' AND COALESCE(pm.note,'') <> 'Restocked from cancelled order'
                        AND ${branchCond(req, 'pr')}) AS v`),
        db.query(`SELECT COALESCE(SUM(amount),0) AS v FROM expenses WHERE ${bp}`),
        db.query(`SELECT COALESCE(SUM(o.price - o.discount_amount),0) AS v FROM orders o
                  WHERE o.status <> 'cancelled' AND o.deleted_at IS NULL AND ${bo}`),
        db.query(`SELECT COALESCE(SUM(
                    CASE WHEN oi.variant_id IS NOT NULL THEN oi.qty * COALESCE(pv.cost_price,0)
                         ELSE oi.meters * COALESCE(fb.cost_per_meter,0) END),0) AS v
                  FROM order_items oi
                  LEFT JOIN fabrics fb ON fb.id = oi.fabric_id
                  LEFT JOIN product_variants pv ON pv.id = oi.variant_id
                  JOIN orders o ON o.id = oi.order_id
                  WHERE o.status <> 'cancelled' AND o.deleted_at IS NULL AND ${bo}`),
      ]);

    const v = (q) => Number(q.rows[0].v);
    const invested = Number(capital.rows[0].invested);
    const withdrawn = Number(capital.rows[0].withdrawn);

    // Cash = capital in − out + customer payments − expenses − fabric purchases − asset purchases
    const cash = invested - withdrawn + v(collected) - v(expensesAll) - v(purchases) - v(fixedAssets);
    const totalAssets = cash + v(receivables) + v(inventory) + v(fixedAssets);

    const capitalNet = invested - withdrawn;
    const retainedEarnings = v(revenueAll) - v(cogsAll) - v(expensesAll);
    const totalEquity = capitalNet + retainedEarnings;

    res.json({
      as_of: new Date().toISOString().slice(0, 10),
      branch_id: readBranch(req),
      assets: {
        cash,
        receivables: v(receivables),
        inventory: v(inventory),
        fixed_assets: v(fixedAssets),
        total: totalAssets,
      },
      equity: {
        capital_invested: invested,
        capital_withdrawn: withdrawn,
        capital_net: capitalNet,
        retained_earnings: retainedEarnings,
        total: totalEquity,
      },
      balanced: Math.abs(totalAssets - totalEquity) < 0.01,
      difference: Math.round((totalAssets - totalEquity) * 100) / 100,
    });
  } catch (err) { next(err); }
});

/* ==================== EXPENSES ==================== */
router.get('/expenses', async (req, res, next) => {
  try {
    const params = [];
    const range = dateRange('e.expense_date', req.query.from, req.query.to, params);
    const branch = andBranch(req, params, 'e');
    const { rows } = await db.query(
      `SELECT e.*, u.name AS created_by_name, b.name AS branch_name
       FROM expenses e
       LEFT JOIN users u ON u.id = e.created_by
       LEFT JOIN branches b ON b.id = e.branch_id
       WHERE TRUE ${range} ${branch} ORDER BY e.expense_date DESC, e.id DESC LIMIT 1000`, params);
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/expenses', async (req, res, next) => {
  try {
    const { category, description, amount, expense_date } = req.body;
    if (!EXPENSE_CATEGORIES.includes(category)) return res.status(400).json({ error: 'Invalid category' });
    if (!Number(amount) || Number(amount) <= 0) return res.status(400).json({ error: 'Amount must be greater than zero' });
    const branchId = writeBranch(req);
    if (!branchId) return res.status(400).json({ error: 'Choose which branch this expense belongs to' });
    const { rows } = await db.query(
      `INSERT INTO expenses (category, description, amount, expense_date, created_by, branch_id)
       VALUES ($1,$2,$3,COALESCE($4, CURRENT_DATE),$5,$6) RETURNING *`,
      [category, description || null, amount, expense_date || null, req.user.id, branchId]);
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

router.delete('/expenses/:id', async (req, res, next) => {
  try {
    const params = [req.params.id];
    const guard = branchGuardFor(req, params);
    const { rows } = await db.query(
      `DELETE FROM expenses WHERE id = $1 ${guard} RETURNING id`, params);
    if (!rows[0]) return res.status(404).json({ error: 'Expense not found' });
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

/* ==================== RECURRING (rent & fixed monthly costs) ==================== */
router.get('/recurring', async (req, res, next) => {
  try {
    const params = [];
    const branch = andBranch(req, params, 'r');
    const { rows } = await db.query(`
      SELECT r.*, b.name AS branch_name,
             (SELECT COUNT(*)::int FROM recurring_postings rp
               WHERE rp.source = 'recurring' AND rp.source_id = r.id) AS months_posted
      FROM recurring_expenses r
      LEFT JOIN branches b ON b.id = r.branch_id
      WHERE TRUE ${branch}
      ORDER BY r.active DESC, r.created_at DESC`, params);
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/recurring', async (req, res, next) => {
  try {
    const { category, description, amount } = req.body;
    if (!['rent', 'utilities', 'tax', 'other'].includes(category)) {
      return res.status(400).json({ error: 'Invalid category' });
    }
    if (!Number(amount) || Number(amount) <= 0) return res.status(400).json({ error: 'Amount must be greater than zero' });
    const branchId = writeBranch(req);
    if (!branchId) return res.status(400).json({ error: 'Choose which branch this recurring cost belongs to' });
    const { rows } = await db.query(
      `INSERT INTO recurring_expenses (category, description, amount, branch_id)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [category, description || null, amount, branchId]);
    // Post this month's entry right away
    const { postMonthlyRecurring: post } = require('../recurring');
    setTimeout(() => post().catch(() => {}), 100);
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// Update amount / description / active (e.g. rent increased next year)
router.put('/recurring/:id', async (req, res, next) => {
  try {
    const { amount, description, active } = req.body;
    const fields = []; const values = []; let i = 1;
    if (amount !== undefined) {
      if (!Number(amount) || Number(amount) <= 0) return res.status(400).json({ error: 'Amount must be greater than zero' });
      fields.push(`amount = $${i++}`); values.push(amount);
    }
    if (description !== undefined) { fields.push(`description = $${i++}`); values.push(description || null); }
    if (typeof active === 'boolean') { fields.push(`active = $${i++}`); values.push(active); }
    if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
    values.push(req.params.id);
    const idPos = values.length;
    const guard = branchGuardFor(req, values);
    const { rows } = await db.query(
      `UPDATE recurring_expenses SET ${fields.join(', ')} WHERE id = $${idPos} ${guard} RETURNING *`, values);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.delete('/recurring/:id', async (req, res, next) => {
  try {
    // Confirm ownership before clearing the posting ledger, so a branch admin
    // cannot wipe another branch's posting history via a guessed id.
    const own = [req.params.id];
    const ownGuard = branchGuardFor(req, own);
    const mine = await db.query(
      `SELECT id FROM recurring_expenses WHERE id = $1 ${ownGuard}`, own);
    if (!mine.rows[0]) return res.status(404).json({ error: 'Not found' });

    await db.query(`DELETE FROM recurring_postings WHERE source = 'recurring' AND source_id = $1`, [req.params.id]);
    const { rows } = await db.query('DELETE FROM recurring_expenses WHERE id = $1 RETURNING id', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

/* ==================== CAPITAL ==================== */
router.get('/capital', async (req, res, next) => {
  try {
    const params = [];
    const branch = andBranch(req, params, 'c');
    const { rows } = await db.query(
      `SELECT c.*, u.name AS created_by_name, b.name AS branch_name
       FROM capital_entries c
       LEFT JOIN users u ON u.id = c.created_by
       LEFT JOIN branches b ON b.id = c.branch_id
       WHERE TRUE ${branch}
       ORDER BY c.entry_date DESC, c.id DESC LIMIT 500`, params);
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/capital', async (req, res, next) => {
  try {
    const { type, description, amount, entry_date } = req.body;
    if (!['investment', 'withdrawal'].includes(type)) return res.status(400).json({ error: 'Invalid type' });
    if (!Number(amount) || Number(amount) <= 0) return res.status(400).json({ error: 'Amount must be greater than zero' });
    const branchId = writeBranch(req);
    if (!branchId) return res.status(400).json({ error: 'Choose which branch this capital entry belongs to' });
    const { rows } = await db.query(
      `INSERT INTO capital_entries (type, description, amount, entry_date, created_by, branch_id)
       VALUES ($1,$2,$3,COALESCE($4, CURRENT_DATE),$5,$6) RETURNING *`,
      [type, description || null, amount, entry_date || null, req.user.id, branchId]);
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

router.delete('/capital/:id', async (req, res, next) => {
  try {
    const params = [req.params.id];
    const guard = branchGuardFor(req, params);
    const { rows } = await db.query(
      `DELETE FROM capital_entries WHERE id = $1 ${guard} RETURNING id`, params);
    if (!rows[0]) return res.status(404).json({ error: 'Entry not found' });
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

/* ==================== FIXED ASSETS ==================== */
router.get('/assets', async (req, res, next) => {
  try {
    const params = [];
    const branch = andBranch(req, params, 'a');
    const { rows } = await db.query(
      `SELECT a.*, b.name AS branch_name
       FROM assets a LEFT JOIN branches b ON b.id = a.branch_id
       WHERE TRUE ${branch}
       ORDER BY a.active DESC, a.created_at DESC LIMIT 500`, params);
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/assets', async (req, res, next) => {
  try {
    const { name, category = 'equipment', cost, purchase_date, notes } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Asset name is required' });
    if (Number(cost) < 0 || isNaN(Number(cost))) return res.status(400).json({ error: 'Enter a valid cost' });
    const branchId = writeBranch(req);
    if (!branchId) return res.status(400).json({ error: 'Choose which branch this asset belongs to' });
    const { rows } = await db.query(
      `INSERT INTO assets (name, category, cost, purchase_date, notes, branch_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [name.trim(), category, cost || 0, purchase_date || null, notes || null, branchId]);
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

router.put('/assets/:id', async (req, res, next) => {
  try {
    const { active } = req.body;
    const params = [!!active, req.params.id];
    const guard = branchGuardFor(req, params);
    const { rows } = await db.query(
      `UPDATE assets SET active = $1 WHERE id = $2 ${guard} RETURNING *`, params);
    if (!rows[0]) return res.status(404).json({ error: 'Asset not found' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.delete('/assets/:id', async (req, res, next) => {
  try {
    const params = [req.params.id];
    const guard = branchGuardFor(req, params);
    const { rows } = await db.query(
      `DELETE FROM assets WHERE id = $1 ${guard} RETURNING id`, params);
    if (!rows[0]) return res.status(404).json({ error: 'Asset not found' });
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

module.exports = router;
