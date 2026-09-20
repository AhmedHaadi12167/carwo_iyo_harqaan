/**
 * Seed script — creates default users and sample fabrics.
 * Run once after schema.sql:  npm run seed
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./db');

async function main() {
  // Everything seeded belongs to a branch, so find one first. Non-superadmin
  // staff and all fabrics are required by the database to have one.
  const br = await db.query(`SELECT id, name FROM branches ORDER BY (code = 'MAIN') DESC, id LIMIT 1`);
  if (!br.rows[0]) {
    console.error('\nNo branches exist yet. Run the migrations first:\n  psql -U postgres -d tailors_db -f database/migrate-all.sql\n');
    process.exit(1);
  }
  const branchId = br.rows[0].id;
  console.log(`Seeding into branch: ${br.rows[0].name}`);

  // ----- Users -----
  const users = [
    { name: 'Ahmed Haadi', username: 'admin', phone: '+252615550001', password: 'admin123', role: 'admin' },
    { name: 'Salesman', username: 'salesman', phone: '+252615550002', password: 'sales123', role: 'salesman' },
    { name: 'Master Tailor', username: 'tailor', phone: '+252615550003', password: 'tailor123', role: 'tailor' },
  ];
  for (const u of users) {
    // Checked first rather than relying on ON CONFLICT DO NOTHING: a CHECK
    // constraint is evaluated BEFORE the conflict clause, so a row that is
    // about to be skipped anyway can still fail validation.
    const exists = await db.query('SELECT 1 FROM users WHERE LOWER(username) = LOWER($1)', [u.username]);
    if (exists.rows[0]) continue;
    const hash = await bcrypt.hash(u.password, 10);
    await db.query(
      `INSERT INTO users (name, username, phone, password_hash, role, branch_id)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [u.name, u.username, u.phone, hash, u.role, branchId]
    );
  }

  // ----- Sample fabrics (from your fabric labels) -----
  const fabrics = [
    { code: 'SS0098', name: 'X125', component: 'W70P30', weight: '275G/M', color: 'Blue Pinstripe', brand: '', cost: 8, price: 15, qty: 50 },
    { code: 'SS0097', name: 'K4', component: 'W50P50', weight: '275G/M', color: 'Grey', brand: 'Ultrafine Australian', cost: 7, price: 14, qty: 45 },
    { code: 'SS0136', name: 'Safari Classic', component: 'W60P40', weight: '260G/M', color: 'Khaki', brand: '', cost: 6, price: 12, qty: 60 },
    { code: 'SS0052', name: 'Premium Navy', component: 'W80P20', weight: '280G/M', color: 'Navy', brand: '', cost: 9, price: 18, qty: 40 },
    { code: 'SS0159', name: 'Charcoal Elite', component: 'W70P30', weight: '270G/M', color: 'Charcoal', brand: '', cost: 8, price: 16, qty: 35 },
    { code: 'SS0124', name: 'Black Diamond', component: 'W50P50', weight: '265G/M', color: 'Black', brand: '', cost: 7, price: 14, qty: 30 },
  ];
  for (const f of fabrics) {
    // Fabric codes are unique PER BRANCH now, so the conflict target is the
    // (branch_id, UPPER(code)) index rather than a bare code.
    const r = await db.query(
      `INSERT INTO fabrics (code, name, component, weight, color, brand, cost_per_meter, price_per_meter, quantity_meters, branch_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (branch_id, UPPER(code)) DO NOTHING RETURNING id`,
      [f.code, f.name, f.component, f.weight, f.color, f.brand, f.cost, f.price, f.qty, branchId]
    );
    if (r.rows[0]) {
      await db.query(
        `INSERT INTO fabric_movements (fabric_id, type, meters, note) VALUES ($1,'in',$2,'Initial shipment')`,
        [r.rows[0].id, f.qty]
      );
    }
  }

  console.log('Seed complete.');
  console.log('Login  admin / admin123   (admin)');
  console.log('Login  salesman / sales123 (salesman)');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
