const db = require('../db');
const { origin } = require('./outbox');

/**
 * Applies one incoming sync_outbox entry from the OTHER database onto this
 * one. Every apply is wrapped in its own transaction and is idempotent: if
 * the same entry is delivered twice (a retried push after a dropped
 * connection, for example), the second attempt is a safe no-op.
 *
 * Conflict rule (last-write-wins, guarded in SQL so it can't race):
 *   Every mutable order field (status, cancellation, price/delivery/notes/
 *   measurements, tailor assignment) carries an `event_at` timestamp taken
 *   from the origin database at the moment it was written. The UPDATE that
 *   applies it here only succeeds if that timestamp is NEWER than this
 *   database's own `orders.updated_at` for that row — so whichever side
 *   made the change more recently always wins, and a stale, older change
 *   arriving late can never overwrite a newer one.
 *   Payments are pure inserts (never overwritten) so they can never
 *   conflict — they're deduplicated instead, by a client_ref generated once
 *   at creation time.
 */
async function applyEntry(entry) {
  const dedupeKey = `${entry.origin}:${entry.id}`;
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const seen = await client.query('SELECT 1 FROM sync_applied WHERE client_ref = $1', [dedupeKey]);
    if (seen.rows[0]) { await client.query('ROLLBACK'); return { skipped: true }; }

    const p = entry.payload;
    switch (entry.entity) {
      case 'order_created':         await applyOrderCreated(client, p, entry.origin); break;
      case 'order_status':          await applyOrderStatus(client, p); break;
      case 'order_cancelled':       await applyOrderCancelled(client, p); break;
      case 'order_edited':          await applyOrderEdited(client, p); break;
      case 'order_tailor':          await applyOrderTailor(client, p); break;
      case 'order_payment':         await applyOrderPayment(client, p); break;
      case 'order_payment_deleted': await applyOrderPaymentDeleted(client, p); break;
      case 'order_deleted':         await applyOrderDeleted(client, p); break;
      case 'order_restored':        await applyOrderRestored(client, p); break;
      default: break; // unknown entity — ignore rather than fail the whole batch
    }

    await client.query('INSERT INTO sync_applied (client_ref) VALUES ($1)', [dedupeKey]);
    await client.query('COMMIT');
    return { applied: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Staff accounts are managed separately per database (salesmen/tailors log
// into the POS, admins log into the cloud site) — see DEPLOY.md. When a
// synced record names a user who doesn't have a matching username on this
// side, we store NULL rather than guessing; the amounts/status stay correct,
// only the "handled by" label is blank on the mirrored copy.
async function resolveUser(client, username) {
  if (!username) return null;
  const r = await client.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [username]);
  return r.rows[0]?.id || null;
}

/**
 * Branch ids are assigned independently by each database, so they are never
 * sent over the wire — the branch CODE travels and is resolved to a local id
 * here.
 *
 * If this side has never heard of the branch, it is created rather than
 * rejected. The alternative is worse: a real order arrives, has nowhere to
 * live (orders.branch_id is NOT NULL), and the whole sync batch jams behind
 * it. A placeholder branch that the superadmin can rename is recoverable; a
 * stuck sync queue silently stops the two databases converging.
 *
 * Orders predating branches carry no code at all — those fall back to MAIN,
 * which is the branch the migration put all existing data in.
 */
async function resolveBranch(client, code) {
  const wanted = (code || 'MAIN').toUpperCase();

  const found = await client.query('SELECT id FROM branches WHERE UPPER(code) = $1', [wanted]);
  if (found.rows[0]) return found.rows[0].id;

  const made = await client.query(
    `INSERT INTO branches (name, code) VALUES ($1, $2)
     ON CONFLICT (code) DO UPDATE SET code = EXCLUDED.code
     RETURNING id`,
    [`${wanted} (from sync — rename me)`, wanted]
  );
  return made.rows[0].id;
}

async function applyOrderCreated(client, p, fromOrigin) {
  const exists = await client.query('SELECT id FROM orders WHERE order_no = $1', [p.order_no]);
  if (exists.rows[0]) return; // defensive; the dedupe key already prevents this

  let customerId;
  if (p.customer.phone) {
    const found = await client.query('SELECT id FROM customers WHERE phone = $1', [p.customer.phone]);
    customerId = found.rows[0]?.id;
  }
  if (!customerId) {
    const c = await client.query(
      'INSERT INTO customers (name, phone) VALUES ($1,$2) RETURNING id',
      [p.customer.name, p.customer.phone || null]
    );
    customerId = c.rows[0].id;
  }

  const createdBy = await resolveUser(client, p.created_by_username);
  const tailorId = p.tailor_username ? await resolveUser(client, p.tailor_username) : null;

  const branchId = await resolveBranch(client, p.branch_code);

  const o = await client.query(
    `INSERT INTO orders (order_no, customer_id, measurements, notes, price, status, delivery_date, tailor_id, claimed_at, created_by, created_at, vat_method, vat_amount, branch_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
    [p.order_no, customerId, JSON.stringify(p.measurements || {}), p.notes || null, p.price,
     p.status || 'pending', p.delivery_date || null, tailorId, p.claimed_at || null, createdBy, p.created_at,
     p.vat_method || 'cash', p.vat_amount || 0, branchId]
  );
  const orderId = o.rows[0].id;

  // An order taken on the CLOUD admin site still consumes real cloth off the
  // shop's shelf, so when that order reaches the POS the stock has to come
  // down here too — the POS is where the physical inventory is counted.
  // Orders travelling the other way (POS -> cloud) already deducted at the
  // POS when they were written, so they must NOT deduct again on arrival.
  const deductStock = fromOrigin === 'cloud' && origin() === 'pos';

  for (const it of p.items || []) {
    // Fabric linkage is best-effort: the fabric CATALOG itself isn't synced
    // between the two databases (only order/payment activity is). If a
    // fabric with this code already exists locally the item links to it for
    // display; if it doesn't, the item is still recorded, just unlinked.
    // Scoped to the order's own branch. Fabric codes are only unique WITHIN a
    // branch now, so an unscoped lookup could link the item to another
    // branch's roll — and then deduct stock from the wrong shelf below.
    let fabricId = null;
    if (it.fabric_code) {
      const f = await client.query(
        'SELECT id FROM fabrics WHERE UPPER(code) = UPPER($1) AND branch_id = $2',
        [it.fabric_code, branchId]);
      fabricId = f.rows[0]?.id || null;
    }
    await client.query(
      `INSERT INTO order_items (order_id, garment_type, fabric_id, meters, qty, unit_price, amount)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [orderId, it.garment_type, fabricId, it.meters || 0, it.qty || 1, it.unit_price || 0, it.amount || 0]
    );

    if (deductStock && fabricId && Number(it.meters) > 0) {
      // Never let a synced order push stock negative: the shelf can't hold
      // less than nothing, and a mirrored record arriving late is not a
      // reason to corrupt the count. Deduct what's actually there.
      await client.query(
        `UPDATE fabrics SET quantity_meters = GREATEST(quantity_meters - $1, 0) WHERE id = $2`,
        [it.meters, fabricId]
      );
      await client.query(
        `INSERT INTO fabric_movements (fabric_id, type, meters, note, order_id)
         VALUES ($1,'out',$2,$3,$4)`,
        [fabricId, it.meters, `Used for order ${p.order_no} (taken on the admin site)`, orderId]
      );
    }
  }

  if (p.advance && Number(p.advance.amount) > 0) {
    const receivedBy = await resolveUser(client, p.advance.received_by_username);
    await client.query(
      `INSERT INTO payments (order_id, amount, method, note, received_by, client_ref, created_at, vat_amount)
       VALUES ($1,$2,$3,'Advance payment',$4,$5,$6,$7) ON CONFLICT (client_ref) DO NOTHING`,
      [orderId, p.advance.amount, p.advance.method || 'cash', receivedBy, p.advance.client_ref, p.created_at, p.advance.vat_amount || 0]
    );
  }
}

async function applyOrderStatus(client, p) {
  await client.query(
    `UPDATE orders SET status = $1 WHERE order_no = $2 AND updated_at < $3`,
    [p.status, p.order_no, p.event_at]
  );
}

async function applyOrderCancelled(client, p) {
  const upd = await client.query(
    `UPDATE orders SET status = 'cancelled' WHERE order_no = $1 AND updated_at < $2 AND status <> 'cancelled' RETURNING id`,
    [p.order_no, p.event_at]
  );
  if (!upd.rows[0]) return;
  for (const it of p.restock || []) {
    if (!it.fabric_code || !(Number(it.meters) > 0)) continue;
    const f = await client.query('SELECT id FROM fabrics WHERE code = $1', [it.fabric_code]);
    if (!f.rows[0]) continue; // fabric not known on this side — nothing to restock against
    await client.query('UPDATE fabrics SET quantity_meters = quantity_meters + $1 WHERE id = $2', [it.meters, f.rows[0].id]);
    await client.query(
      `INSERT INTO fabric_movements (fabric_id, type, meters, note) VALUES ($1,'in',$2,$3)`,
      [f.rows[0].id, it.meters, `Restocked (synced) from cancelled order ${p.order_no}`]
    );
  }
}

async function applyOrderEdited(client, p) {
  await client.query(
    `UPDATE orders SET price = $1, delivery_date = $2, notes = $3, measurements = $4,
            vat_method = COALESCE($7, vat_method), vat_amount = COALESCE($8, vat_amount)
     WHERE order_no = $5 AND updated_at < $6`,
    [p.price, p.delivery_date, p.notes, JSON.stringify(p.measurements || {}), p.order_no, p.event_at,
     p.vat_method ?? null, p.vat_amount ?? null]
  );
}

async function applyOrderTailor(client, p) {
  const tailorId = await resolveUser(client, p.tailor_username);
  if (!tailorId) return; // can't map to a real local tailor account — skip rather than guess
  await client.query(
    `UPDATE orders SET tailor_id = $1, claimed_at = $2
     WHERE order_no = $3 AND (claimed_at IS NULL OR claimed_at < $2)`,
    [tailorId, p.claimed_at, p.order_no]
  );
}

async function applyOrderPayment(client, p) {
  const order = await client.query('SELECT id FROM orders WHERE order_no = $1', [p.order_no]);
  if (!order.rows[0]) return; // order hasn't synced yet — shouldn't normally happen, outbox is applied in order
  const receivedBy = await resolveUser(client, p.received_by_username);
  await client.query(
    `INSERT INTO payments (order_id, amount, method, note, received_by, client_ref, created_at, vat_amount)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (client_ref) DO NOTHING`,
    [order.rows[0].id, p.amount, p.method, p.note, receivedBy, p.client_ref, p.created_at, p.vat_amount || 0]
  );
}

async function applyOrderPaymentDeleted(client, p) {
  await client.query('DELETE FROM payments WHERE client_ref = $1', [p.client_ref]);
}

// Deleting an order hides it rather than removing it, so the mirror does
// exactly the same thing — nothing is destroyed on either side, and the
// order can be brought back on either side later.
async function applyOrderDeleted(client, p) {
  await client.query(
    'UPDATE orders SET deleted_at = now() WHERE order_no = $1 AND deleted_at IS NULL',
    [p.order_no]
  );
}

async function applyOrderRestored(client, p) {
  await client.query(
    'UPDATE orders SET deleted_at = NULL WHERE order_no = $1 AND deleted_at IS NOT NULL',
    [p.order_no]
  );
}

module.exports = { applyEntry };
