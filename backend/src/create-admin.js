/**
 * Create (or reset) a top-level login.
 *
 *   npm run create-admin                                -> admin / Haadi$2026#Admin (main branch)
 *   npm run create-admin -- owner mypass "Owner" super  -> a SUPERADMIN (all branches)
 *   npm run create-admin -- myname mypassword           -> custom username + password
 *
 * Safe to run more than once — an existing user with the same username has
 * its password reset and is re-activated rather than causing an error.
 *
 * A superadmin belongs to no branch; every other role must belong to one, so
 * a plain admin is attached to the main branch. The database enforces that
 * pairing (users_branch_role_check), which is why it is decided here rather
 * than left to chance.
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./db');

const username = (process.argv[2] || 'admin').trim();
const password = process.argv[3] || 'Haadi$2026#Admin';
const fullName = process.argv[4] || 'Ahmed Haadi';
const wantsSuper = /^(super|superadmin)$/i.test(process.argv[5] || '');
const role = wantsSuper ? 'superadmin' : 'admin';

async function main() {
  if (password.length < 6) {
    console.error('Password must be at least 6 characters.');
    process.exit(1);
  }

  let branchId = null;
  if (role !== 'superadmin') {
    const b = await db.query(`SELECT id, name FROM branches ORDER BY (code = 'MAIN') DESC, id LIMIT 1`);
    if (!b.rows[0]) {
      console.error('\nNo branches exist yet. Run the branch migration first:\n  psql -U postgres -d tailors_db -f database/add-branches.sql\n');
      process.exit(1);
    }
    branchId = b.rows[0].id;
  }

  const hash = await bcrypt.hash(password, 10);

  const { rows } = await db.query(
    `INSERT INTO users (name, username, password_hash, role, active, branch_id)
     VALUES ($1, $2, $3, $4, TRUE, $5)
     ON CONFLICT (username) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           role          = EXCLUDED.role,
           branch_id     = EXCLUDED.branch_id,
           active        = TRUE
     RETURNING id, name, username, role, active, branch_id`,
    [fullName, username, hash, role, branchId]
  );

  const user = rows[0];

  // Only set the email if add-password-reset.sql has been applied.
  const col = await db.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_name = 'users' AND column_name = 'email'`
  );
  if (col.rowCount && process.env.SMTP_USER) {
    await db.query('UPDATE users SET email = $1 WHERE id = $2', [process.env.SMTP_USER, user.id]);
  }

  // Prove the stored hash actually matches, so a bad write can't look like success.
  const check = await db.query('SELECT password_hash FROM users WHERE id = $1', [user.id]);
  const ok = await bcrypt.compare(password, check.rows[0].password_hash);

  let branchLabel = '— all branches —';
  if (user.branch_id) {
    const b = await db.query('SELECT name FROM branches WHERE id = $1', [user.branch_id]);
    branchLabel = b.rows[0]?.name || String(user.branch_id);
  }

  console.log('');
  console.log(ok ? 'Account ready.' : 'WARNING: user written but password did not verify.');
  console.log('  Username: ' + user.username);
  console.log('  Password: ' + password);
  console.log('  Role:     ' + user.role);
  console.log('  Branch:   ' + branchLabel);
  console.log('');
  console.log('Change this password from your profile after logging in.');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  if (e.code === '3D000') {
    console.error('\nDatabase does not exist yet. Create it first:\n  CREATE DATABASE tailors_db;\n');
  } else if (e.code === '42P01') {
    console.error('\nThe users table is missing. Load the schema first:\n  psql -U postgres -d tailors_db -f database/schema.sql\n');
  } else {
    console.error(e);
  }
  process.exit(1);
});
