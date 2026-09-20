const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { sendOtpEmail } = require('../lib/mailer');

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });

    // Log in with USERNAME or PHONE NUMBER — whichever is easier
    const identifier = username.trim();
    const { rows } = await db.query(
      `SELECT u.*, b.name AS branch_name, b.code AS branch_code, b.active AS branch_active
       FROM users u
       LEFT JOIN branches b ON b.id = u.branch_id
       WHERE (LOWER(u.username) = LOWER($1) OR u.phone = $1) AND u.active = TRUE`,
      [identifier]
    );
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid username/phone or password' });
    }

    // Closing a branch has to lock its staff out, otherwise a deactivated
    // branch keeps trading. The superadmin has no branch and is unaffected.
    if (user.role !== 'superadmin' && user.branch_active === false) {
      return res.status(403).json({ error: 'This branch is closed. Contact the head office.' });
    }

    // branch_id is signed into the token, so a branch admin cannot widen
    // their own scope by tampering with a request.
    const token = jwt.sign(
      {
        id: user.id, name: user.name, username: user.username, role: user.role,
        branch_id: user.branch_id, branch_name: user.branch_name, branch_code: user.branch_code,
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES || '12h' }
    );
    res.json({
      token,
      user: {
        id: user.id, name: user.name, username: user.username, phone: user.phone, role: user.role,
        branch_id: user.branch_id, branch_name: user.branch_name, branch_code: user.branch_code,
      },
    });
  } catch (err) { next(err); }
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

// PUT /api/auth/profile — update own name and/or password
router.put('/profile', requireAuth, async (req, res, next) => {
  try {
    const { name, current_password, new_password } = req.body;
    const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    const me = rows[0];
    if (!me) return res.status(404).json({ error: 'User not found' });

    const fields = [];
    const values = [];
    let i = 1;

    if (name && name.trim()) { fields.push(`name = $${i++}`); values.push(name.trim()); }

    if (new_password) {
      if (!current_password || !(await bcrypt.compare(current_password, me.password_hash))) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }
      if (new_password.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
      fields.push(`password_hash = $${i++}`);
      values.push(await bcrypt.hash(new_password, 10));
    }

    if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
    values.push(req.user.id);
    const upd = await db.query(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${i} RETURNING id, name, username, role, branch_id`,
      values
    );
    const user = upd.rows[0];
    const br = await db.query('SELECT name, code FROM branches WHERE id = $1', [user.branch_id]);
    // Fresh token so the UI shows the new name immediately. The branch must
    // be carried over — a token without it is rejected by requireAuth, which
    // would log the user out the moment they renamed themselves.
    const token = jwt.sign(
      {
        id: user.id, name: user.name, username: user.username, role: user.role,
        branch_id: user.branch_id,
        branch_name: br.rows[0]?.name || null,
        branch_code: br.rows[0]?.code || null,
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES || '12h' }
    );
    res.json({
      token,
      user: {
        ...user,
        branch_name: br.rows[0]?.name || null,
        branch_code: br.rows[0]?.code || null,
      },
    });
  } catch (err) { next(err); }
});

// ---------------- Forgot password (email OTP) ----------------
// Three steps: request a code -> verify the code -> set a new password.
// The OTP itself is never stored in plain text, only its bcrypt hash, and
// it expires after 10 minutes and can only be used once.

// STEP 1 — POST /api/auth/forgot-password { identifier }
// identifier = username, phone, or email — whichever the admin has on hand.
router.post('/forgot-password', async (req, res, next) => {
  try {
    const identifier = (req.body.identifier || '').trim();
    if (!identifier) return res.status(400).json({ error: 'Enter your username, phone, or email' });

    const { rows } = await db.query(
      `SELECT * FROM users WHERE (LOWER(username) = LOWER($1) OR phone = $1 OR LOWER(email) = LOWER($1)) AND active = TRUE`,
      [identifier]
    );
    const user = rows[0];
    if (!user) return res.status(404).json({ error: 'No account found with that username, phone, or email' });
    if (!user.email) return res.status(400).json({ error: 'This account has no email on file — ask another admin to add one first' });

    const otp = String(crypto.randomInt(100000, 999999));
    const otpHash = await bcrypt.hash(otp, 10);
    await db.query(
      `INSERT INTO password_resets (user_id, otp_hash, expires_at) VALUES ($1, $2, now() + interval '10 minutes')`,
      [user.id, otpHash]
    );
    await sendOtpEmail(user.email, otp, user.name);
    // Mask the email back to the user so they know where to look without fully exposing it
    const masked = user.email.replace(/^(.{2}).+(@.+)$/, '$1***$2');
    res.json({ sent: true, email: masked });
  } catch (err) { next(err); }
});

// STEP 2 — POST /api/auth/verify-otp { identifier, otp }
// Returns a short-lived reset token used only for the final step.
router.post('/verify-otp', async (req, res, next) => {
  try {
    const identifier = (req.body.identifier || '').trim();
    const otp = (req.body.otp || '').trim();
    if (!identifier || !otp) return res.status(400).json({ error: 'Enter the code that was emailed to you' });

    const { rows: users } = await db.query(
      `SELECT * FROM users WHERE (LOWER(username) = LOWER($1) OR phone = $1 OR LOWER(email) = LOWER($1)) AND active = TRUE`,
      [identifier]
    );
    const user = users[0];
    if (!user) return res.status(404).json({ error: 'No account found' });

    const { rows: resets } = await db.query(
      `SELECT * FROM password_resets WHERE user_id = $1 AND used = FALSE AND expires_at > now() ORDER BY created_at DESC LIMIT 1`,
      [user.id]
    );
    const reset = resets[0];
    if (!reset || !(await bcrypt.compare(otp, reset.otp_hash))) {
      return res.status(400).json({ error: 'Invalid or expired code' });
    }

    await db.query(`UPDATE password_resets SET verified = TRUE WHERE id = $1`, [reset.id]);
    const resetToken = jwt.sign(
      { purpose: 'pwreset', user_id: user.id, reset_id: reset.id },
      process.env.JWT_SECRET,
      { expiresIn: '10m' }
    );
    res.json({ reset_token: resetToken });
  } catch (err) { next(err); }
});

// STEP 3 — POST /api/auth/reset-password { reset_token, new_password }
router.post('/reset-password', async (req, res, next) => {
  try {
    const { reset_token, new_password } = req.body;
    if (!reset_token || !new_password) return res.status(400).json({ error: 'Missing reset token or new password' });
    if (new_password.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });

    let payload;
    try {
      payload = jwt.verify(reset_token, process.env.JWT_SECRET);
    } catch {
      return res.status(400).json({ error: 'This reset link expired — start over' });
    }
    if (payload.purpose !== 'pwreset') return res.status(400).json({ error: 'Invalid reset token' });

    const { rows } = await db.query(
      `SELECT * FROM password_resets WHERE id = $1 AND user_id = $2 AND verified = TRUE AND used = FALSE AND expires_at > now()`,
      [payload.reset_id, payload.user_id]
    );
    if (!rows[0]) return res.status(400).json({ error: 'This reset code was already used or has expired — start over' });

    const hash = await bcrypt.hash(new_password, 10);
    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, payload.user_id]);
    await db.query('UPDATE password_resets SET used = TRUE WHERE id = $1', [payload.reset_id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
