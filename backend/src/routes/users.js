const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth, requireAdmin, readBranch, writeBranch, isSuperadmin } = require('../middleware/auth');

// Roles a BRANCH admin may hand out. Deliberately excludes 'superadmin' —
// only an existing superadmin can create another one, further down.
const ROLES = ['admin', 'salesman', 'tailor', 'master_tailor', 'cashier'];
const ALL_ROLES = ['superadmin', ...ROLES];

// Phone and email are compared the way the database's unique indexes compare
// them (see add-staff-unique-contacts.sql), so a formatting difference alone
// can never look like a different person:
//   phone -> digits only, so "+252 61 234 5678" == "+252612345678"
//   email -> lower-cased and trimmed
const digitsOnly = (p) => String(p || '').replace(/[^0-9]/g, '');
const normEmail = (e) => String(e || '').trim().toLowerCase();

/**
 * Checks phone and email against every other staff account BEFORE writing,
 * so the person gets "Cumar already uses that number" instead of a bare
 * "duplicate key" from Postgres. The unique indexes are still the real
 * guarantee — this exists to make the failure legible, not to replace them.
 */
async function contactConflict(client, { phone, email, excludeId = null }) {
  const checks = [];
  if (phone) {
    checks.push(client.query(
      `SELECT name, username FROM users
       WHERE regexp_replace(phone, '[^0-9]', '', 'g') = $1
         AND phone IS NOT NULL AND ($2::int IS NULL OR id <> $2)
       LIMIT 1`,
      [digitsOnly(phone), excludeId]
    ).then((r) => (r.rows[0] ? `Phone number already belongs to ${r.rows[0].name} (${r.rows[0].username})` : null)));
  }
  if (email) {
    checks.push(client.query(
      `SELECT name, username FROM users
       WHERE LOWER(email) = $1 AND email IS NOT NULL AND ($2::int IS NULL OR id <> $2)
       LIMIT 1`,
      [normEmail(email), excludeId]
    ).then((r) => (r.rows[0] ? `Email address already belongs to ${r.rows[0].name} (${r.rows[0].username})` : null)));
  }
  return (await Promise.all(checks)).find(Boolean) || null;
}

// Turns a Postgres unique violation into something a shop manager can act on.
function duplicateMessage(err) {
  const c = err.constraint || '';
  if (c.includes('email')) return 'That email address is already used by another staff member';
  if (c.includes('phone')) return 'That phone number is already used by another staff member';
  if (c.includes('username')) return 'That username is already taken';
  if (c.includes('staff_no')) return 'Staff number clashed — try again';
  return 'Username, phone or email already exists';
}

// Every role except admin gets a staff number (ST001, ST002, ...). Reads the
// actual highest number in use and adds 1 — never a separate counter that
// could drift out of sync (same lesson learned from order numbers).
//
// Staff numbers stay unique across the WHOLE business, not per branch: the
// column has a global UNIQUE constraint, and a number that means one person
// everywhere is what makes "assign ST007" unambiguous over the phone.
async function nextStaffNo(client) {
  const r = await client.query(
    `SELECT COALESCE(MAX(SUBSTRING(staff_no FROM 3)::int), 0) AS n FROM users WHERE staff_no ~ '^ST[0-9]+$'`
  );
  return `ST${String(Number(r.rows[0].n) + 1).padStart(3, '0')}`;
}

// ---- Tailor list for assignment (admin, salesman, AND master tailor) ----
// Scoped to the caller's branch: you can only hand work to your own tailors.
router.get('/tailors', requireAuth, async (req, res, next) => {
  try {
    if (!['admin', 'superadmin', 'salesman', 'master_tailor'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Not allowed' });
    }
    const params = [];
    const where = [`role = 'tailor'`, 'active = TRUE'];
    const branch = readBranch(req);
    if (branch != null) { params.push(branch); where.push(`branch_id = $${params.length}`); }

    const { rows } = await db.query(
      `SELECT id, name, phone, staff_no, branch_id FROM users
       WHERE ${where.join(' AND ')} ORDER BY name`, params
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ---- Everything below is ADMIN ONLY ----
router.use(requireAuth, requireAdmin);

// Guard for the /:id routes: a branch admin may only touch staff at their own
// branch, and nobody except a superadmin may touch a superadmin account.
router.param('id', async (req, res, next, id) => {
  if (!/^\d+$/.test(String(id))) return res.status(400).json({ error: 'Invalid user id' });
  try {
    const { rows } = await db.query('SELECT id, role, branch_id FROM users WHERE id = $1', [id]);
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });

    const scope = readBranch(req);
    if (scope != null && rows[0].branch_id !== scope) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (rows[0].role === 'superadmin' && !isSuperadmin(req)) {
      return res.status(403).json({ error: 'Only a superadmin can manage a superadmin account' });
    }
    req.targetUser = rows[0];
    next();
  } catch (err) { next(err); }
});

// GET /api/users
// By default this lists only ACTIVE staff. "Deleting" a staff member does not
// erase them (their name is attached to orders, payments and salary expenses —
// removing the row would blank out that history), it just switches them off.
// Pass ?archived=1 to also see the switched-off ones, so they can be restored.
router.get('/', async (req, res, next) => {
  try {
    const includeArchived = req.query.archived === '1' || req.query.archived === 'true';
    const params = [];
    const where = [];
    if (!includeArchived) where.push('u.active = TRUE');

    const branch = readBranch(req);
    if (branch != null) { params.push(branch); where.push(`u.branch_id = $${params.length}`); }

    const { rows } = await db.query(
      `SELECT u.id, u.name, u.username, u.phone, u.email, u.role, u.staff_no, u.salary,
              u.active, u.created_at, u.branch_id, b.name AS branch_name, b.code AS branch_code
       FROM users u LEFT JOIN branches b ON b.id = u.branch_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY u.id`, params
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// POST /api/users
router.post('/', async (req, res, next) => {
  const client = await db.getClient();
  try {
    const { name, username, phone, email, password, role, salary = 0 } = req.body;
    if (isNaN(Number(salary)) || Number(salary) < 0) return res.status(400).json({ error: 'Salary must be zero or more' });

    const allowedRoles = isSuperadmin(req) ? ALL_ROLES : ROLES;
    if (!name || !username || !password || !allowedRoles.includes(role)) {
      return res.status(400).json({
        error: role === 'superadmin'
          ? 'Only a superadmin can create another superadmin'
          : 'name, username, password and valid role are required',
      });
    }
    if (!phone || !/^\+?[0-9\s-]{7,15}$/.test(phone.trim())) {
      return res.status(400).json({ error: 'A valid phone number is required for every staff member' });
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return res.status(400).json({ error: 'Enter a valid email address' });
    }

    // A superadmin belongs to no branch; everyone else must belong to one.
    // The database enforces this pairing too (users_branch_role_check).
    let branchId = null;
    if (role !== 'superadmin') {
      branchId = writeBranch(req);
      if (!branchId) return res.status(400).json({ error: 'Choose which branch this staff member works at' });
      const b = await db.query('SELECT id FROM branches WHERE id = $1 AND active = TRUE', [branchId]);
      if (!b.rows[0]) return res.status(400).json({ error: 'That branch does not exist or is closed' });
    }

    const hash = await bcrypt.hash(password, 10);

    await client.query('BEGIN');

    // Named check first, so a clash reads as "Cumar already uses that number"
    // rather than a database error. Inside the transaction, so it cannot race
    // against a second admin adding the same person at the same moment — the
    // unique index is still what actually guarantees it.
    const clash = await contactConflict(client, { phone, email });
    if (clash) { await client.query('ROLLBACK'); return res.status(409).json({ error: clash }); }

    const staffNo = ['admin', 'superadmin'].includes(role) ? null : await nextStaffNo(client);
    const { rows } = await client.query(
      `INSERT INTO users (name, username, phone, email, password_hash, role, salary, staff_no, branch_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, name, username, phone, email, role, staff_no, salary, active, branch_id`,
      [name.trim(), username.trim().toLowerCase(), phone.trim(),
       email ? normEmail(email) : null, hash, role, Number(salary) || 0, staffNo, branchId]
    );
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ error: duplicateMessage(err) });
    next(err);
  } finally { client.release(); }
});

// PUT /api/users/:id  (update name/phone/role/active, optionally reset password)
router.put('/:id', async (req, res, next) => {
  const client = await db.getClient();
  try {
    const { name, username, phone, email, role, active, password, salary, branch_id } = req.body;

    const allowedRoles = isSuperadmin(req) ? ALL_ROLES : ROLES;
    if (role !== undefined && !allowedRoles.includes(role)) {
      return res.status(400).json({
        error: role === 'superadmin' ? 'Only a superadmin can grant superadmin' : 'Invalid role',
      });
    }

    const fields = [];
    const values = [];
    let i = 1;
    if (name) { fields.push(`name = $${i++}`); values.push(name.trim()); }

    // The admin can rename any account, including their own. Usernames are
    // stored lowercase because logging in is case-insensitive — without
    // normalising here, "Yahya" and "yahya" would look like two free names
    // but collide on the unique index.
    if (username !== undefined) {
      const u = String(username).trim().toLowerCase();
      if (!/^[a-z0-9._-]{3,30}$/.test(u)) {
        return res.status(400).json({
          error: 'Username must be 3–30 characters, using letters, numbers, dot, dash or underscore only (no spaces).',
        });
      }
      fields.push(`username = $${i++}`); values.push(u);
    }
    if (salary !== undefined) {
      if (isNaN(Number(salary)) || Number(salary) < 0) return res.status(400).json({ error: 'Salary must be zero or more' });
      fields.push(`salary = $${i++}`); values.push(Number(salary));
    }
    if (phone !== undefined) {
      if (phone && !/^\+?[0-9\s-]{7,15}$/.test(phone.trim())) {
        return res.status(400).json({ error: 'Enter a valid phone number' });
      }
      fields.push(`phone = $${i++}`); values.push(phone ? phone.trim() : null);
    }
    if (email !== undefined) {
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        return res.status(400).json({ error: 'Enter a valid email address' });
      }
      fields.push(`email = $${i++}`); values.push(email ? normEmail(email) : null);
    }

    // Same named check as on create, excluding this account so that saving a
    // staff member without touching their contact details is not treated as
    // them clashing with themselves.
    if (phone || email) {
      const clash = await contactConflict(db, { phone, email, excludeId: Number(req.params.id) });
      if (clash) return res.status(409).json({ error: clash });
    }

    // Moving staff between branches is a superadmin decision — a branch admin
    // could otherwise transfer someone (including themselves) out of scope.
    if (branch_id !== undefined) {
      if (!isSuperadmin(req)) {
        return res.status(403).json({ error: 'Only a superadmin can move staff between branches' });
      }
      const b = await db.query('SELECT id FROM branches WHERE id = $1', [branch_id]);
      if (!b.rows[0]) return res.status(400).json({ error: 'That branch does not exist' });
      fields.push(`branch_id = $${i++}`); values.push(branch_id);
    }

    // role and branch_id are paired by a CHECK constraint, so a role change
    // to/from superadmin has to move branch_id in the same statement.
    const newRole = role || req.targetUser.role;
    if (role && role !== req.targetUser.role) {
      if (role === 'superadmin') {
        fields.push(`branch_id = NULL`);
      } else if (req.targetUser.role === 'superadmin') {
        const target = branch_id ?? writeBranch(req);
        if (!target) {
          return res.status(400).json({ error: 'Choose which branch this person moves to when removing superadmin' });
        }
        if (branch_id === undefined) { fields.push(`branch_id = $${i++}`); values.push(target); }
      }
    }

    if (role) { fields.push(`role = $${i++}`); values.push(role); }
    if (typeof active === 'boolean') { fields.push(`active = $${i++}`); values.push(active); }
    if (password) { fields.push(`password_hash = $${i++}`); values.push(await bcrypt.hash(password, 10)); }
    if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });

    await client.query('BEGIN');

    // Role changed? Keep staff_no in sync: admins and superadmins never have
    // one, everyone else must (generate on their first time leaving admin).
    if (role) {
      if (['admin', 'superadmin'].includes(newRole)) {
        fields.push(`staff_no = NULL`);
      } else {
        const cur = await client.query('SELECT staff_no FROM users WHERE id = $1', [req.params.id]);
        if (cur.rows[0] && !cur.rows[0].staff_no) {
          fields.push(`staff_no = $${i++}`); values.push(await nextStaffNo(client));
        }
      }
    }

    values.push(req.params.id);
    const { rows } = await client.query(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${i}
       RETURNING id, name, username, phone, email, role, staff_no, salary, active, branch_id`,
      values
    );
    if (!rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'User not found' }); }
    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ error: duplicateMessage(err) });
    if (err.code === '23514' && err.constraint === 'users_branch_role_check') {
      return res.status(400).json({ error: 'A superadmin belongs to no branch, and every other role must belong to one' });
    }
    next(err);
  } finally { client.release(); }
});

// DELETE /api/users/:id — archive a staff member (soft delete).
// The row is kept and only switched inactive: they immediately lose the
// ability to log in and drop off the staff list, but every order, payment and
// salary expense that carries their name stays readable. A hard DELETE would
// hit the foreign keys on orders.created_by / orders.tailor_id /
// payments.received_by and either fail outright or blank out real history.
// Restore with PUT /api/users/:id { active: true }.
router.delete('/:id', async (req, res, next) => {
  try {
    if (Number(req.params.id) === req.user.id) {
      return res.status(400).json({ error: 'You cannot remove your own account' });
    }
    const { rows } = await db.query(
      'UPDATE users SET active = FALSE WHERE id = $1 RETURNING id, name, active',
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json({ deleted: true, archived: true, name: rows[0].name });
  } catch (err) { next(err); }
});

module.exports = router;
