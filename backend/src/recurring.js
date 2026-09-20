/**
 * Automatic monthly posting of recurring expenses (rent…) and staff salaries.
 *
 * How it works:
 *  - Runs at server start, every 6 hours, and before finance reports.
 *  - For the CURRENT month, each active recurring expense and each active
 *    staff member with a salary > 0 gets ONE expense entry, dated the 1st.
 *  - recurring_postings remembers what was posted, so nothing posts twice.
 *  - If the admin deletes an auto expense, that month stays skipped
 *    (the posting record remains) — it will not be recreated.
 *
 * BRANCHES: each posted expense inherits the branch of whatever generated it
 * — the recurring cost's own branch, or the staff member's branch for a
 * salary. Without that, every auto-posted rent and wage would land with no
 * branch and be rejected outright, or (worse) skew one branch's P&L with
 * another branch's costs.
 */
const db = require('./db');

let lastRun = 0;

async function postMonthlyRecurring() {
  // Throttle: at most once per hour
  if (Date.now() - lastRun < 60 * 60 * 1000) return;
  lastRun = Date.now();

  const period = new Date().toISOString().slice(0, 7); // YYYY-MM
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // ---- Fixed monthly costs (rent, utilities, tax…) ----
    const rec = await client.query('SELECT * FROM recurring_expenses WHERE active = TRUE');
    for (const r of rec.rows) {
      const claim = await client.query(
        `INSERT INTO recurring_postings (source, source_id, period)
         VALUES ('recurring', $1, $2) ON CONFLICT DO NOTHING RETURNING id`,
        [r.id, period]
      );
      if (claim.rows[0]) {
        const e = await client.query(
          `INSERT INTO expenses (category, description, amount, expense_date, branch_id)
           VALUES ($1, $2, $3, date_trunc('month', now())::date, $4) RETURNING id`,
          [r.category, `${r.description || r.category} — ${period} (auto)`, r.amount, r.branch_id]
        );
        await client.query('UPDATE recurring_postings SET expense_id = $1 WHERE id = $2',
          [e.rows[0].id, claim.rows[0].id]);
      }
    }

    // ---- Staff salaries ----
    // A superadmin has no branch, so their salary has no branch to be charged
    // to and is skipped here rather than posted against an arbitrary one.
    const staff = await client.query(
      `SELECT id, name, salary, branch_id FROM users
       WHERE active = TRUE AND salary > 0 AND branch_id IS NOT NULL`
    );
    for (const s of staff.rows) {
      const claim = await client.query(
        `INSERT INTO recurring_postings (source, source_id, period)
         VALUES ('salary', $1, $2) ON CONFLICT DO NOTHING RETURNING id`,
        [s.id, period]
      );
      if (claim.rows[0]) {
        const e = await client.query(
          `INSERT INTO expenses (category, description, amount, expense_date, branch_id)
           VALUES ('salary', $1, $2, date_trunc('month', now())::date, $3) RETURNING id`,
          [`Salary — ${s.name} — ${period} (auto)`, s.salary, s.branch_id]
        );
        await client.query('UPDATE recurring_postings SET expense_id = $1 WHERE id = $2',
          [e.rows[0].id, claim.rows[0].id]);
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    lastRun = 0; // failed — allow a retry soon
    console.error('Recurring posting failed:', err.message);
  } finally {
    client.release();
  }
}

module.exports = { postMonthlyRecurring };
