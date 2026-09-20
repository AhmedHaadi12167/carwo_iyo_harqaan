const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    // Tokens issued before branches existed carry no branch at all. Such a
    // session cannot be scoped safely, so it is refused rather than silently
    // treated as "all branches" — the holder just logs in again.
    if (req.user.role !== 'superadmin' && !req.user.branch_id) {
      return res.status(401).json({ error: 'Your session predates branches — please log in again' });
    }
    next();
  } catch {
    return res.status(401).json({ error: 'Session expired, please log in again' });
  }
}

// A superadmin outranks a branch admin everywhere, so anything an admin may
// do, a superadmin may also do. Every existing requireAdmin call therefore
// keeps working unchanged for superadmins.
function requireAdmin(req, res, next) {
  if (!['admin', 'superadmin'].includes(req.user?.role)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// Branch creation, cross-branch reporting and promoting staff are reserved
// for the one account that owns the whole business.
function requireSuperadmin(req, res, next) {
  if (req.user?.role !== 'superadmin') {
    return res.status(403).json({ error: 'Superadmin access required' });
  }
  next();
}

const isSuperadmin = (req) => req.user?.role === 'superadmin';

/**
 * Which branch's data may this request READ?
 *
 *   returns a number -> restrict every query to that branch
 *   returns null     -> no restriction (superadmin looking at everything)
 *
 * A branch admin can never widen this: their branch comes from the signed
 * token, and ?branch_id= in the URL is ignored for them entirely. Only a
 * superadmin may narrow the view to one branch via ?branch_id=.
 */
function readBranch(req) {
  if (!isSuperadmin(req)) return req.user.branch_id;
  const asked = req.query.branch_id;
  if (asked && asked !== 'all') {
    const n = Number(asked);
    return Number.isInteger(n) && n > 0 ? n : null;
  }
  return null;
}

/**
 * Which branch does a row this request CREATES belong to?
 *
 * For everyone except a superadmin this is their own branch, full stop.
 * A superadmin has no branch of their own, so they must name one explicitly
 * — returning null here means "the caller has to reject this request".
 */
function writeBranch(req) {
  if (!isSuperadmin(req)) return req.user.branch_id;
  const asked = req.body?.branch_id ?? req.query.branch_id;
  const n = Number(asked);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Appends a branch condition to a WHERE list you are already building.
 *
 *   const where = ['o.deleted_at IS NULL'];
 *   const params = [];
 *   branchWhere(req, where, params, 'o');
 *
 * Does nothing when the request may see all branches, so the same call is
 * safe on every query regardless of who is asking.
 */
function branchWhere(req, where, params, alias = '') {
  const b = readBranch(req);
  if (b == null) return null;
  const col = alias ? `${alias}.branch_id` : 'branch_id';
  params.push(b);
  where.push(`${col} = $${params.length}`);
  return b;
}

/**
 * A ready-made SQL condition for the caller's branch, for the many dashboard
 * and finance queries that take no bind parameters at all and would other-
 * wise need every placeholder renumbered.
 *
 *   `WHERE ${branchCond(req, 'o')} AND ...`
 *     -> "o.branch_id = 4 AND ..."   for a branch admin
 *     -> "TRUE AND ..."              for a superadmin
 *
 * The id is inlined rather than bound, so it is checked to be a genuine
 * integer first and throws otherwise. That assertion is the whole safety
 * argument: the value originates in a signed JWT, but this function must not
 * quietly interpolate a string if that ever stops being true.
 */
function branchCond(req, alias = '') {
  const b = readBranch(req);
  if (b == null) return 'TRUE';
  if (!Number.isInteger(b)) throw new Error(`Refusing to build SQL with a non-integer branch: ${JSON.stringify(b)}`);
  return `${alias ? `${alias}.` : ''}branch_id = ${b}`;
}

module.exports = {
  requireAuth,
  requireAdmin,
  requireSuperadmin,
  isSuperadmin,
  readBranch,
  writeBranch,
  branchWhere,
  branchCond,
};
