const router = require('express').Router();
const db = require('../db');
const { requireAuth, requireAdmin, readBranch, writeBranch } = require('../middleware/auth');
const { logSync, origin, newRef } = require('../sync/outbox');

router.use(requireAuth);

const GARMENTS = ['suit', 'shirt', 'khamiis', 'safari_suit', 'jacket', 'trouser', 'other'];
const PAYMENT_METHODS = [
  'premier_bank', 'ibs_bank', 'salaam_bank', 'my_bank', 'dahabshiil_bank',
  'edahab', 'merchant', 'evc_plus', 'my_cash', 'cash',
];

// 5% VAT on every non-cash payment method — cash is never taxed.
//
// The VAT is worked out ONCE, from the PRICE, at the moment the order is
// created, and it is part of what the customer owes from that point on:
//     Price 50 by bank  ->  VAT 2.50  ->  Total 52.50
// Pay 52.50 and the order is PAID. Cash orders have no VAT, so Total = Price.
//
// It used to be charged per payment instead, which meant every payment
// created fresh tax and the balance could never reach zero. Do not move it
// back onto payments.
const VAT_RATE = 0.05;
function vatFor(method, amount) {
  return method === 'cash' ? 0 : Math.round((Number(amount) || 0) * VAT_RATE * 100) / 100;
}

const LINE_TYPES = ['tailoring', 'fabric', 'product'];

// The ceiling a salesman may discount on one order, in money. Stored as a
// setting so the owner can change it without a release; missing or unreadable
// falls back to 0, which means "no discounts without an admin" — the safe
// direction to fail.
async function discountLimit(client) {
  const r = await client.query(`SELECT value FROM app_settings WHERE key = 'salesman_discount_limit'`);
  const n = Number(r.rows[0]?.value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * Validates every line on an order and works out what it costs.
 *
 * The money is computed on the SERVER from the fabric's price per yard and
 * the variant's selling price. Only the sewing charge is typed by staff.
 * A total posted by the browser is a total anyone could edit.
 *
 * The three line types price differently:
 *   tailoring — cloth (yards × price/yard, automatic) + sewing × qty (typed)
 *   fabric    — cloth only, no sewing
 *   product   — variant selling price × qty
 *
 * Returns { lines, subtotal } or { error }.
 */
async function priceItems(client, items, branchId) {
  const lines = [];
  let subtotal = 0;

  for (const [idx, it] of items.entries()) {
    const n = idx + 1;
    // Lines from an older client carry no type; they can only be tailoring,
    // because that is all the system could create before products existed.
    const lineType = it.line_type || 'tailoring';
    if (!LINE_TYPES.includes(lineType)) {
      return { error: `Item ${n}: unknown line type "${lineType}"` };
    }
    const qty = Number(it.qty) || 1;
    if (!Number.isInteger(qty) || qty < 1) return { error: `Item ${n}: quantity must be at least 1` };

    // ---------- Ready-made product ----------
    if (lineType === 'product') {
      if (!it.variant_id) return { error: `Item ${n}: choose which size/colour is being sold` };
      // Scoped to this branch: a variant belonging to another branch is
      // treated as not existing, so a sale can never draw down another
      // shop's shelf.
      const v = await client.query(
        `SELECT v.id, v.size, v.color, v.sell_price, v.quantity, p.name AS product_name
         FROM product_variants v JOIN products p ON p.id = v.product_id
         WHERE v.id = $1 AND p.branch_id = $2 AND v.active AND p.active`,
        [it.variant_id, branchId]);
      if (!v.rows[0]) return { error: `Item ${n}: that item is not stocked at this branch` };
      const variant = v.rows[0];

      // Price comes from the variant. An override is allowed (haggling
      // happens) but never below zero.
      const unit = it.unit_price !== undefined && it.unit_price !== null && it.unit_price !== ''
        ? Number(it.unit_price) : Number(variant.sell_price);
      if (!Number.isFinite(unit) || unit < 0) return { error: `Item ${n}: invalid price` };

      const amount = Math.round(unit * qty * 100) / 100;
      subtotal += amount;
      lines.push({
        line_type: 'product', garment_type: null, fabric_id: null, variant_id: variant.id,
        meters: 0, qty, unit_price: unit, fabric_amount: 0, amount,
        label: `${variant.product_name}${variant.size ? ` · ${variant.size}` : ''}${variant.color ? ` · ${variant.color}` : ''}`,
        stock_left: Number(variant.quantity),
      });
      continue;
    }

    // ---------- Both cloth lines need a fabric (except own-cloth tailoring) ----------
    const yards = Number(it.meters) || 0;
    let fabric = null;
    if (it.fabric_id) {
      const f = await client.query(
        `SELECT id, code, name, price_per_meter, quantity_meters
         FROM fabrics WHERE id = $1 AND branch_id = $2 AND active`,
        [it.fabric_id, branchId]);
      if (!f.rows[0]) return { error: `Item ${n}: that fabric is not stocked at this branch` };
      fabric = f.rows[0];
    }

    // Cloth is priced automatically from the fabric's price per yard.
    const fabricAmount = fabric && yards > 0
      ? Math.round(yards * Number(fabric.price_per_meter) * 100) / 100
      : 0;

    // ---------- Cut cloth to take away ----------
    if (lineType === 'fabric') {
      if (!fabric) return { error: `Item ${n}: choose which fabric is being sold` };
      if (yards <= 0) return { error: `Item ${n}: enter how many yards of ${fabric.code} are being sold` };
      subtotal += fabricAmount;
      lines.push({
        line_type: 'fabric', garment_type: null, fabric_id: fabric.id, variant_id: null,
        meters: yards, qty: 1, unit_price: Number(fabric.price_per_meter),
        fabric_amount: fabricAmount, amount: fabricAmount,
        label: `${fabric.code} ${fabric.name} — ${yards} yd`,
      });
      continue;
    }

    // ---------- Fabric + sewing ----------
    if (!GARMENTS.includes(it.garment_type)) {
      return { error: `Item ${n}: invalid garment type "${it.garment_type}"` };
    }
    if (fabric && yards <= 0) {
      return { error: `Item ${n}: enter how many yards of ${fabric.code} are needed` };
    }
    // Staff type only the sewing charge; the cloth prices itself.
    const sewing = Number(it.unit_price) || 0;
    if (sewing < 0) return { error: `Item ${n}: sewing charge cannot be negative` };
    if (!fabric && sewing <= 0) {
      return { error: `Item ${n}: with the customer's own cloth, the sewing charge is the whole price — enter it` };
    }
    const amount = Math.round((fabricAmount + sewing * qty) * 100) / 100;
    subtotal += amount;
    lines.push({
      line_type: 'tailoring', garment_type: it.garment_type,
      fabric_id: fabric ? fabric.id : null, variant_id: null,
      meters: yards, qty, unit_price: sewing, fabric_amount: fabricAmount, amount,
      label: `${qty} × ${it.garment_type}`,
    });
  }

  return { lines, subtotal: Math.round(subtotal * 100) / 100 };
}

// Next order number for whichever side of the system this is, and whichever
// branch the order is being taken at.
//
// Format:  [C]<BRANCH CODE>-<n>     e.g.  HDN-1, HDN-2, CHDN-1
//
// Three things have to stay true at once:
//   * Each BRANCH counts from 1 independently, so a branch's own paperwork
//     reads naturally and one branch's volume never inflates another's
//     numbers.
//   * The POS and the cloud must never mint the same string while out of
//     contact with each other, hence the leading C on cloud-taken orders.
//   * order_no stays globally unique, because it is the key the two
//     databases use to recognise the same order (see sync/apply.js).
// Branch codes are unique, so those three together can never collide.
//
// The count is read from the highest existing number for that branch rather
// than from a counter, because a counter drifts the moment someone types
// their own order number by hand. Pre-branch numbers (plain 1, 2, 3 and
// C1, C2...) match none of these patterns, so legacy orders neither break
// the sequence nor get overwritten — the dash keeps the two eras apart.
async function nextOrderNo(client, branchId) {
  const b = await client.query('SELECT code FROM branches WHERE id = $1', [branchId]);
  if (!b.rows[0]) throw new Error('Branch not found for order numbering');
  const prefix = `${origin() === 'cloud' ? 'C' : ''}${b.rows[0].code}-`;

  const last = await client.query(
    `SELECT COALESCE(MAX(SUBSTRING(order_no FROM ${prefix.length + 1})::int), 0) AS n
     FROM orders
     WHERE order_no ~ ('^' || $1 || '[0-9]+$')`,
    [prefix]
  );
  return `${prefix}${Number(last.rows[0].n) + 1}`;
}

// Salesmen must NOT see orders that are both delivered AND fully paid
const salesmanFilter = `NOT (o.status = 'delivered' AND f.payment_status = 'paid')`;

// PRIVACY: customers may be high-profile.
// NAME and PHONE go to every role that handles orders — counter staff have to
// be able to ring a customer about a fitting or a pickup, and having to ask an
// admin for the number every time is what pushed people to keep private
// notebooks. EMAIL and ADDRESS remain admin-only, as does the whole customers
// module (profiles, statements, order history).

// ---------------- Branch isolation for every /:id route ----------------
// Registered with router.param so it applies to EVERY route carrying an :id —
// detail, status, payments, tailor assignment, edit, delete, restore, job
// sheet — without each one having to remember. A branch admin who guesses an
// id from another branch gets the same 404 as a genuinely missing order, so
// probing ids reveals nothing about other branches.
//
// req.order is left behind for handlers that want it.
router.param('id', async (req, res, next, id) => {
  if (!/^\d+$/.test(String(id))) return res.status(400).json({ error: 'Invalid order id' });
  try {
    const { rows } = await db.query(
      `SELECT o.id, o.order_no, o.branch_id, b.code AS branch_code, b.name AS branch_name
       FROM orders o JOIN branches b ON b.id = o.branch_id WHERE o.id = $1`,
      [id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Order not found' });
    const scope = readBranch(req);
    if (scope != null && rows[0].branch_id !== scope) {
      return res.status(404).json({ error: 'Order not found' });
    }
    req.order = rows[0];
    next();
  } catch (err) { next(err); }
});

// ---------------- Create order (the 5-part flow) ----------------
router.post('/', async (req, res, next) => {
  // Orders can be taken at the shop POS *and* from the cloud admin site.
  // The two databases run independently and each picks the next order number
  // from its own highest one, so if both were left to count 1, 2, 3… they
  // would hand out the same number while out of contact and clash on sync.
  // Cloud orders are therefore prefixed — C1, C2, C3… — which can never
  // collide with the POS's plain numbers, and tells you at a glance where an
  // order was taken. See nextOrderNo() below.
  //
  // Only admin/salesman take orders. Tailors, the master tailor, and the
  // cashier all work with orders that already exist.
  if (!['admin', 'salesman'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Only an admin or salesman can create a new order' });
  }
  // A superadmin deliberately cannot take orders: they have no branch, so
  // there would be no correct answer to "which branch is this sale?". They
  // oversee branches rather than trading in them.
  const branchId = writeBranch(req);
  if (!branchId) {
    return res.status(400).json({ error: 'Orders are taken at a branch. Log in as that branch to create one.' });
  }
  const client = await db.getClient();
  try {
    const { customer, measurements = {}, items = [], advance_amount = 0, advance_method = 'cash',
            advance_date, delivery_date, notes, tailor_id, order_no, order_date, vat_method,
            discount_amount = 0, discount_reason } = req.body;

    if (!customer || (!customer.id && !customer.name)) return res.status(400).json({ error: 'Customer information is required' });
    if (!items.length) return res.status(400).json({ error: 'At least one order item is required' });

    // ---- Validate every line and work out what it costs ----
    // The price is computed HERE, from the fabric's price per yard and the
    // variant's selling price, rather than trusted from the browser. A total
    // sent by the client is a total anyone can edit.
    const priced = await priceItems(client, items, branchId);
    if (priced.error) return res.status(400).json({ error: priced.error });
    const { lines, subtotal } = priced;

    if (!subtotal || subtotal <= 0) return res.status(400).json({ error: 'Order total must be greater than zero' });

    // ---- Discount: one figure for the whole order, in money ----
    const discount = Math.round((Number(discount_amount) || 0) * 100) / 100;
    if (discount < 0) return res.status(400).json({ error: 'Discount cannot be negative' });
    if (discount > subtotal) {
      return res.status(400).json({ error: `Discount cannot be more than the order total ($${subtotal.toFixed(2)})` });
    }
    // A salesman may discount up to the shop's ceiling; beyond that it is an
    // admin's decision. The limit is a setting, not a constant, so the owner
    // can change it without a release.
    if (discount > 0 && req.user.role === 'salesman') {
      const limit = await discountLimit(client);
      if (discount > limit) {
        return res.status(403).json({
          error: `A salesman can discount up to $${limit.toFixed(2)}. Ask an admin to approve $${discount.toFixed(2)}.`,
        });
      }
    }

    const total = Math.round((subtotal - discount) * 100) / 100;
    const advance = Number(advance_amount) || 0;
    if (advance < 0) return res.status(400).json({ error: 'Advance cannot be negative' });
    if (advance > 0 && !PAYMENT_METHODS.includes(advance_method)) {
      return res.status(400).json({ error: `Invalid payment method: ${advance_method}` });
    }

    // Which method is this order billed under? That decides the VAT. The form
    // sends it explicitly; if it doesn't, fall back to the advance's method,
    // and finally to cash (no VAT) so nothing is ever taxed by accident.
    const vatMethod = vat_method || (advance > 0 ? advance_method : 'cash');
    if (!PAYMENT_METHODS.includes(vatMethod)) {
      return res.status(400).json({ error: `Invalid payment method: ${vatMethod}` });
    }
    // VAT is charged on the NET — what the customer actually pays after the
    // discount. Taxing the pre-discount figure over-collects on every
    // discounted sale.
    const orderVat = vatFor(vatMethod, total);
    // The advance can cover the VAT too, so it may legitimately exceed the
    // bare price — it just can't exceed the full total.
    if (advance > total + orderVat) {
      return res.status(400).json({ error: `Advance cannot be more than the total ($${(total + orderVat).toFixed(2)})` });
    }

    // Order date is optional — if given, it can't be in the future (backdating
    // a forgotten entry is fine, "creating" an order ahead of time is not).
    if (order_date) {
      const od = new Date(order_date);
      const endOfToday = new Date(); endOfToday.setHours(23, 59, 59, 999);
      if (isNaN(od.getTime())) return res.status(400).json({ error: 'Invalid order date' });
      if (od > endOfToday) return res.status(400).json({ error: 'Order date cannot be in the future' });
    }
    // Same deal for the advance payment date — skip it and "now" is used.
    if (advance_date) {
      const ad = new Date(advance_date);
      const endOfToday = new Date(); endOfToday.setHours(23, 59, 59, 999);
      if (isNaN(ad.getTime())) return res.status(400).json({ error: 'Invalid payment date' });
      if (ad > endOfToday) return res.status(400).json({ error: 'Payment date cannot be in the future' });
    }

    await client.query('BEGIN');

    // 1. Customer: reuse existing (by id or phone) or create
    let customerId = customer.id;
    if (!customerId && customer.phone) {
      const found = await client.query('SELECT id FROM customers WHERE phone = $1 LIMIT 1', [customer.phone.trim()]);
      customerId = found.rows[0]?.id;
    }
    if (!customerId) {
      const c = await client.query(
        `INSERT INTO customers (name, phone) VALUES ($1,$2) RETURNING id`,
        [customer.name.trim(), customer.phone ? customer.phone.trim() : null]
      );
      customerId = c.rows[0].id;
    }

    // 2. Order number — write your own, or leave blank to auto-generate
    let orderNo;
    if (order_no && order_no.trim()) {
      orderNo = order_no.trim();
      const dupe = await client.query('SELECT id FROM orders WHERE order_no = $1', [orderNo]);
      if (dupe.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Order number "${orderNo}" is already used by another order. Choose a different number, or leave it blank to auto-generate one.` });
      }
    } else {
      orderNo = await nextOrderNo(client, branchId);
    }

    // 3. (optional) Tailor assignment at creation — must be an active tailor
    let assignedTailor = null;
    let assignedTailorUsername = null;
    if (tailor_id) {
      // The tailor must work at THIS branch — you cannot hand a job to
      // another branch's staff.
      const t = await client.query(
        `SELECT id, username FROM users
         WHERE id = $1 AND role = 'tailor' AND active = TRUE AND branch_id = $2`,
        [tailor_id, branchId]);
      if (!t.rows[0]) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Selected tailor not found, inactive, or not at this branch' }); }
      assignedTailor = t.rows[0].id;
      assignedTailorUsername = t.rows[0].username;
    }

    // 4. Order — order date is optional too: given a date, keep today's actual
    // time-of-day so same-day entries still sort naturally; blank = right now.
    //
    // STATUS: an order with nothing to sew is finished the moment it is rung
    // up — the customer already walked out with the goods. Leaving such a
    // sale 'pending' would park it in the workshop queue forever and set off
    // the delayed-orders alert once its date passed. Payment status is
    // separate, so an unpaid shoe sale still shows a balance owed.
    const hasTailoring = lines.some((l) => l.line_type === 'tailoring');
    const initialStatus = hasTailoring ? 'pending' : 'delivered';

    const o = await client.query(
      `INSERT INTO orders (order_no, customer_id, measurements, notes, price, discount_amount, discount_reason,
                           status, delivery_date, created_by, tailor_id, claimed_at, created_at,
                           vat_method, vat_amount, branch_id, completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
               CASE WHEN $11::int IS NULL THEN NULL ELSE now() END,
               COALESCE(($12::date + CURRENT_TIME)::timestamptz, now()), $13, $14, $15,
               CASE WHEN $8 = 'delivered' THEN now() ELSE NULL END) RETURNING *`,
      [orderNo, customerId, JSON.stringify(measurements), notes || null, subtotal,
       discount, discount_reason?.trim() || null, initialStatus, delivery_date || null,
       req.user.id, assignedTailor, order_date || null, vatMethod, orderVat, branchId]
    );
    const order = o.rows[0];

    // 5. Lines + stock. Every line was already validated and priced by
    // priceItems() above, so this loop only writes and deducts.
    const syncItems = [];
    for (const l of lines) {
      await client.query(
        `INSERT INTO order_items (order_id, line_type, garment_type, fabric_id, variant_id,
                                  meters, qty, unit_price, fabric_amount, amount)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [order.id, l.line_type, l.garment_type, l.fabric_id, l.variant_id,
         l.meters, l.qty, l.unit_price, l.fabric_amount, l.amount]
      );

      // ---- Cloth off the roll (tailoring with shop fabric, or cut-and-go) ----
      let fabricCode = null;
      if (l.fabric_id && l.meters > 0) {
        // The branch and the sufficiency check live in the UPDATE itself, so
        // there is no window between checking and deducting.
        const upd = await client.query(
          `UPDATE fabrics SET quantity_meters = quantity_meters - $1
           WHERE id = $2 AND branch_id = $3 AND quantity_meters >= $1
           RETURNING code, quantity_meters`,
          [l.meters, l.fabric_id, branchId]
        );
        if (!upd.rows[0]) {
          const f = await client.query(
            'SELECT code, quantity_meters FROM fabrics WHERE id = $1 AND branch_id = $2',
            [l.fabric_id, branchId]);
          await client.query('ROLLBACK');
          return res.status(400).json({
            error: `Not enough fabric ${f.rows[0]?.code || ''}: only ${f.rows[0]?.quantity_meters ?? 0} yards available, ${l.meters} requested`,
          });
        }
        fabricCode = upd.rows[0].code;
        await client.query(
          `INSERT INTO fabric_movements (fabric_id, type, meters, note, order_id, created_by)
           VALUES ($1,'out',$2,$3,$4,$5)`,
          [l.fabric_id, l.meters,
           l.line_type === 'fabric' ? `Sold as cloth — order ${orderNo}` : `Used for order ${orderNo}`,
           order.id, req.user.id]
        );
      } else if (l.fabric_id) {
        const fc = await client.query('SELECT code FROM fabrics WHERE id = $1', [l.fabric_id]);
        fabricCode = fc.rows[0]?.code || null;
      }

      // ---- Units off the shelf (ready-made) ----
      let variantKey = null;
      if (l.variant_id) {
        const upd = await client.query(
          `UPDATE product_variants v SET quantity = v.quantity - $1
           FROM products p
           WHERE v.id = $2 AND p.id = v.product_id AND p.branch_id = $3 AND v.quantity >= $1
           RETURNING v.quantity`,
          [l.qty, l.variant_id, branchId]
        );
        if (!upd.rows[0]) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            error: `Not enough stock of ${l.label}: only ${l.stock_left} left, ${l.qty} requested`,
          });
        }
        await client.query(
          `INSERT INTO product_movements (variant_id, type, qty, note, order_id, created_by)
           VALUES ($1,'out',$2,$3,$4,$5)`,
          [l.variant_id, l.qty, `Sold — order ${orderNo}`, order.id, req.user.id]
        );
        // Products are matched across databases by name+size+colour, not by
        // id, for the same reason branches are matched by code: the two sides
        // number their rows independently.
        const vk = await client.query(
          `SELECT p.name, v.size, v.color FROM product_variants v
           JOIN products p ON p.id = v.product_id WHERE v.id = $1`, [l.variant_id]);
        variantKey = vk.rows[0] || null;
      }

      syncItems.push({
        line_type: l.line_type, garment_type: l.garment_type, fabric_code: fabricCode,
        product: variantKey, meters: l.meters, qty: l.qty,
        unit_price: l.unit_price, fabric_amount: l.fabric_amount, amount: l.amount,
      });
    }

    // 5. Advance payment — date is optional too: given a date, keep the
    // current time-of-day so it still sorts naturally; blank = right now.
    // The VAT lives on the order now, so payments carry none of their own.
    let advanceRef = null;
    if (advance > 0) {
      advanceRef = newRef();
      await client.query(
        `INSERT INTO payments (order_id, amount, method, note, received_by, client_ref, created_at, vat_amount)
         VALUES ($1,$2,$3,'Advance payment',$4,$5, COALESCE(($6::date + CURRENT_TIME)::timestamptz, now()), 0)`,
        [order.id, advance, advance_method, req.user.id, advanceRef, advance_date || null]
      );
    }

    // 6. Log for sync — this whole order (customer, items, advance) ships to
    // the cloud as one unit the next time the POS syncs.
    // Branch travels as a CODE, never an id — the two databases assign their
    // own ids independently, so an id would point at the wrong branch (or
    // nothing) on the other side. See sync/apply.js resolveBranch().
    const branchCode = (await client.query('SELECT code FROM branches WHERE id = $1', [branchId])).rows[0]?.code || null;
    await logSync(client, {
      entity: 'order_created',
      order_no: order.order_no,
      branch_code: branchCode,
      payload: {
        order_no: order.order_no,
        branch_code: branchCode,
        customer: { name: customer.name || null, phone: customer.phone || null },
        measurements, notes: notes || null, price: subtotal,
        discount_amount: discount, discount_reason: discount_reason?.trim() || null,
        vat_method: vatMethod, vat_amount: orderVat,
        status: order.status, delivery_date: delivery_date || null,
        tailor_username: assignedTailorUsername, claimed_at: order.claimed_at,
        created_by_username: req.user.username, created_at: order.created_at,
        items: syncItems,
        advance: advance > 0 ? { amount: advance, method: advance_method, vat_amount: 0, received_by_username: req.user.username, client_ref: advanceRef } : null,
      },
    });

    await client.query('COMMIT');
    res.status(201).json({
      ...order,
      subtotal, discount_amount: discount,
      advance_paid: advance, vat_amount: orderVat,
      total: total + orderVat,
      balance: Math.round((total + orderVat - advance) * 100) / 100,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505' && err.constraint === 'orders_order_no_key') {
      return res.status(400).json({ error: 'That order number was just taken by another order. Choose a different number, or leave it blank to auto-generate one.' });
    }
    next(err);
  } finally { client.release(); }
});

// ---------------- List orders ----------------
// Master tailor never sees money — they use GET /orders/tailoring instead.
router.get('/', async (req, res, next) => {
  try {
    if (req.user.role === 'master_tailor') {
      return res.status(403).json({ error: 'Use the Tailoring page instead' });
    }
    const isAdmin = ['admin', 'superadmin'].includes(req.user.role);
    const isCashier = req.user.role === 'cashier';
    const { status, payment_status, search, from, to, deleted } = req.query;
    const params = [];
    // Deleted orders are hidden from every list. The admin can ask to see
    // them (?deleted=1) so a hidden order can be found and restored; no
    // other role is ever shown one.
    const showDeleted = isAdmin && (deleted === '1' || deleted === 'true');
    const where = [showDeleted ? 'TRUE' : 'o.deleted_at IS NULL'];

    // Branch isolation comes first: a branch admin's list is their own
    // branch, full stop. Only a superadmin sees across branches.
    const branch = readBranch(req);
    if (branch != null) { params.push(branch); where.push(`o.branch_id = $${params.length}`); }

    if (!isAdmin) where.push(salesmanFilter);
    // Cashiers only ever see orders that still have money owed on them.
    if (isCashier) where.push(`f.balance > 0 AND o.status <> 'cancelled'`);
    if (status) { params.push(status); where.push(`o.status = $${params.length}`); }
    if (payment_status) { params.push(payment_status); where.push(`f.payment_status = $${params.length}`); }
    // Narrows which ORDERS appear, never what an order is made of — a suit
    // filter shows every order containing a suit, still listing its other
    // garments alongside.
    if (req.query.garment) {
      params.push(req.query.garment);
      where.push(`EXISTS (SELECT 1 FROM order_items g WHERE g.order_id = o.id AND g.garment_type = $${params.length})`);
    }
    if (search) {
      params.push(`%${search}%`);
      where.push(`(o.order_no ILIKE $${params.length} OR c.name ILIKE $${params.length} OR c.phone ILIKE $${params.length})`);
    }
    if (from) { params.push(from); where.push(`o.created_at >= $${params.length}`); }
    if (to) { params.push(to); where.push(`o.created_at < ($${params.length}::date + 1)`); }

    const { rows } = await db.query(
      `SELECT o.id, o.order_no, o.status, o.price, o.delivery_date, o.created_at, o.deleted_at,
              o.tailor_id, tl.name AS tailor_name, tl.staff_no AS tailor_staff_no,
              c.name AS customer_name, c.phone AS customer_phone,
              o.branch_id, b.name AS branch_name, b.code AS branch_code,
              f.paid, f.balance, f.payment_status, f.vat_collected,
              f.discount_amount, f.net_price, f.total,
              (SELECT STRING_AGG(DISTINCT oi.line_type, ',') FROM order_items oi WHERE oi.order_id = o.id) AS line_types,
              -- What is ON this order, with real quantities and grouped by
              -- what a human would call one thing. Three suits cut from three
              -- different bolts are three rows in the database but one line to
              -- read: Suit ×3. Summed in SQL, so the number shown is always
              -- the true quantity and never a count of rows.
              COALESCE((
                SELECT json_agg(x ORDER BY x.line_type, x.label)
                FROM (
                  SELECT oi.line_type,
                         CASE oi.line_type
                           WHEN 'tailoring' THEN oi.garment_type
                           WHEN 'product'   THEN pp.name
                           ELSE fb2.code
                         END AS label,
                         SUM(oi.qty)::int AS qty,
                         SUM(oi.meters)::numeric AS yards
                  FROM order_items oi
                  LEFT JOIN product_variants pv2 ON pv2.id = oi.variant_id
                  LEFT JOIN products pp ON pp.id = pv2.product_id
                  LEFT JOIN fabrics fb2 ON fb2.id = oi.fabric_id
                  WHERE oi.order_id = o.id
                  GROUP BY oi.line_type, 2
                ) x
              ), '[]'::json) AS item_summary
       FROM orders o
       JOIN customers c ON c.id = o.customer_id
       JOIN branches b ON b.id = o.branch_id
       JOIN order_finance f ON f.order_id = o.id
       LEFT JOIN users tl ON tl.id = o.tailor_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY o.created_at DESC
       LIMIT 2000`,
      params
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ---------------- Tailoring overview (master tailor + admin) ----------------
// Every order still IN the workshop — no money, ever. Delivered and
// cancelled orders are done-and-gone, so the master tailor never sees them
// here; they'd just be clutter on a list meant for active work.
router.get('/tailoring', async (req, res, next) => {
  try {
    if (!['admin', 'superadmin', 'master_tailor'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Not allowed' });
    }
    const { status, unassigned, tailor_id, search } = req.query;
    const params = [];
    const where = [
      'o.deleted_at IS NULL',
      `o.status NOT IN ('cancelled', 'delivered')`,
      // Only orders with something to SEW. A sale of ready-made goods, or of
      // cut cloth taken away, has no work in it — without this the master
      // tailor's queue fills with jobs that can never be completed.
      `EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.line_type = 'tailoring')`,
    ];

    const branch = readBranch(req);
    if (branch != null) { params.push(branch); where.push(`o.branch_id = $${params.length}`); }

    if (status) { params.push(status); where.push(`o.status = $${params.length}`); }
    if (unassigned === '1') where.push(`o.tailor_id IS NULL`);
    if (tailor_id) { params.push(tailor_id); where.push(`o.tailor_id = $${params.length}`); }
    if (search) { params.push(`%${search}%`); where.push(`o.order_no ILIKE $${params.length}`); }

    const { rows } = await db.query(
      `SELECT o.id, o.order_no, o.status, o.delivery_date, o.claimed_at, o.created_at,
              c.name AS customer_name, c.phone AS customer_phone,
              o.branch_id, b.name AS branch_name, b.code AS branch_code,
              o.tailor_id, tl.name AS tailor_name, tl.staff_no AS tailor_staff_no,
              (SELECT STRING_AGG(oi.qty || ' × ' || REPLACE(oi.garment_type, '_', ' '), ', ')
                 FROM order_items oi WHERE oi.order_id = o.id) AS garments
       FROM orders o
       JOIN customers c ON c.id = o.customer_id
       JOIN branches b ON b.id = o.branch_id
       LEFT JOIN users tl ON tl.id = o.tailor_id
       WHERE ${where.join(' AND ')}
       ORDER BY (o.status = 'in_progress') DESC, o.tailor_id IS NULL DESC, o.delivery_date ASC NULLS LAST
       LIMIT 500`,
      params
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ---------------- Printable job sheet (admin, salesman, master tailor) ----------------
// Everything a tailor needs to physically make the garment — customer name,
// dates, measurements, items — and NOTHING about money, ever.
router.get('/:id/job-sheet', async (req, res, next) => {
  try {
    if (!['admin', 'salesman', 'master_tailor'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Not allowed' });
    }
    const { rows } = await db.query(
      `SELECT o.id, o.order_no, o.status, o.delivery_date, o.claimed_at, o.created_at,
              o.measurements, o.notes, c.name AS customer_name,
              tl.name AS tailor_name, tl.staff_no AS tailor_staff_no
       FROM orders o
       JOIN customers c ON c.id = o.customer_id
       LEFT JOIN users tl ON tl.id = o.tailor_id
       WHERE o.id = $1 AND o.deleted_at IS NULL`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Order not found' });

    const items = await db.query(
      `SELECT oi.garment_type, oi.qty, oi.meters,
              fb.code AS fabric_code, fb.name AS fabric_name, fb.color AS fabric_color
       FROM order_items oi LEFT JOIN fabrics fb ON fb.id = oi.fabric_id
       WHERE oi.order_id = $1 ORDER BY oi.id`,
      [req.params.id]
    );
    res.json({ ...rows[0], items: items.rows });
  } catch (err) { next(err); }
});

// ---------------- Tailor performance (master tailor + admin) ----------------
// Jobs finished per tailor over a period — daily / weekly / monthly / all
// time. Based on completed_at, which is stamped once when a job first
// reaches 'completed', so it can't be skewed by unrelated later edits.
router.get('/tailor-performance', async (req, res, next) => {
  try {
    if (!['admin', 'superadmin', 'master_tailor'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Not allowed' });
    }
    const period = ['daily', 'weekly', 'monthly', 'all'].includes(req.query.period) ? req.query.period : 'all';
    const since = {
      daily: `date_trunc('day', now())`,
      weekly: `date_trunc('week', now())`,
      monthly: `date_trunc('month', now())`,
      all: null,
    }[period];
    const completedGuard = since ? `AND o.completed_at >= ${since}` : '';

    // Two separate branch conditions on purpose: one picks which TAILORS are
    // listed, the other which of their ORDERS count. Filtering only the
    // tailors would still let another branch's job totals bleed in.
    const params = [];
    const userWhere = [`u.role = 'tailor'`];
    let orderBranch = '';
    const branch = readBranch(req);
    if (branch != null) {
      params.push(branch);
      userWhere.push(`u.branch_id = $${params.length}`);
      orderBranch = `AND o.branch_id = $${params.length}`;
    }

    const { rows } = await db.query(
      `SELECT u.id, u.staff_no, u.name, u.branch_id, b.name AS branch_name,
              COUNT(DISTINCT o.id) FILTER (WHERE o.status IN ('completed','delivered') ${completedGuard})::int AS completed_jobs,
              COALESCE(SUM(oi.qty) FILTER (WHERE o.status IN ('completed','delivered') ${completedGuard}), 0)::int AS garments_made,
              COUNT(DISTINCT o.id) FILTER (WHERE o.status = 'in_progress')::int AS in_progress_now
       FROM users u
       LEFT JOIN branches b ON b.id = u.branch_id
       LEFT JOIN orders o ON o.tailor_id = u.id AND o.status <> 'cancelled' ${orderBranch}
       LEFT JOIN order_items oi ON oi.order_id = o.id
       WHERE ${userWhere.join(' AND ')}
       GROUP BY u.id, u.staff_no, u.name, u.branch_id, b.name
       ORDER BY completed_jobs DESC, u.name ASC`,
      params
    );
    res.json({ period, tailors: rows });
  } catch (err) { next(err); }
});

// ---------------- Order detail ----------------
router.get('/:id', async (req, res, next) => {
  try {
    if (req.user.role === 'master_tailor') {
      return res.status(403).json({ error: 'Use the Tailoring page instead' });
    }
    const isAdmin = ['admin', 'superadmin'].includes(req.user.role);
    const isCashier = req.user.role === 'cashier';
    // Staff never see a deleted order. The admin still can, so that a hidden
    // order can be opened and checked before deciding to restore it — the
    // response carries deleted_at so the page can flag it clearly.
    const guard = (!isAdmin ? `AND o.deleted_at IS NULL AND ${salesmanFilter}` : '')
      + (isCashier ? ` AND f.balance > 0 AND o.status <> 'cancelled'` : '');
    // Phone now goes to every role that can open an order — staff need to be
    // able to call the customer. Email and address stay admin-only.
    const contactCols = isAdmin
      ? `c.email AS customer_email, c.address AS customer_address,`
      : '';
    const { rows } = await db.query(
      `SELECT o.*, c.name AS customer_name, c.phone AS customer_phone, ${contactCols}
              b.name AS branch_name, b.code AS branch_code,
              f.paid, f.balance, f.payment_status, f.vat_collected,
              f.discount_amount, f.net_price, f.total,
              u.name AS created_by_name, tl.name AS tailor_name
       FROM orders o
       JOIN customers c ON c.id = o.customer_id
       JOIN branches b ON b.id = o.branch_id
       JOIN order_finance f ON f.order_id = o.id
       LEFT JOIN users u ON u.id = o.created_by
       LEFT JOIN users tl ON tl.id = o.tailor_id
       WHERE o.id = $1 ${guard}`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Order not found' });

    const [items, pays] = await Promise.all([
      db.query(
        `SELECT oi.*, fb.code AS fabric_code, fb.name AS fabric_name, fb.color AS fabric_color,
                p.name AS product_name, p.brand AS product_brand,
                v.size AS variant_size, v.color AS variant_color
         FROM order_items oi
         LEFT JOIN fabrics fb ON fb.id = oi.fabric_id
         LEFT JOIN product_variants v ON v.id = oi.variant_id
         LEFT JOIN products p ON p.id = v.product_id
         WHERE oi.order_id = $1 ORDER BY oi.id`,
        [req.params.id]
      ),
      db.query(
        `SELECT p.*, u.name AS received_by_name
         FROM payments p LEFT JOIN users u ON u.id = p.received_by
         WHERE p.order_id = $1 ORDER BY p.created_at`,
        [req.params.id]
      ),
    ]);
    res.json({ ...rows[0], items: items.rows, payments: pays.rows });
  } catch (err) { next(err); }
});

// ---------------- Update status ----------------
// Salesman: may move status forward but can NEVER cancel. Admin: everything.
// Master tailor: In Progress / Completed only, on any order (they oversee
// every tailor's jobs) — and never sees money in the response.
router.patch('/:id/status', async (req, res, next) => {
  const client = await db.getClient();
  try {
    const { status } = req.body;
    const role = req.user.role;
    if (role === 'cashier') return res.status(403).json({ error: 'Cashiers cannot change order status' });
    const valid = ['pending', 'in_progress', 'completed', 'delivered', 'cancelled'];
    if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    // Master tailor starts the work; only the salesman (or admin) marks it
    // complete and hands the garment back.
    if (role === 'master_tailor' && status !== 'in_progress') {
      return res.status(403).json({ error: 'Master tailor can only start work (mark In Progress) — the salesman completes the order' });
    }
    if (status === 'cancelled' && role !== 'admin') {
      return res.status(403).json({ error: 'Only an admin can cancel an order' });
    }

    await client.query('BEGIN');
    // completed_at is stamped once, the first time a job reaches 'completed'
    // — later edits (price, notes, even bouncing status) never touch it, so
    // it stays a true record of when the tailor actually finished the work.
    const { rows } = await client.query(
      `UPDATE orders SET status = $1,
              completed_at = CASE WHEN $1 = 'completed' AND completed_at IS NULL THEN now() ELSE completed_at END
       WHERE id = $2 AND status <> 'cancelled' AND deleted_at IS NULL RETURNING *`,
      [status, req.params.id]
    );
    if (!rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Order not found or already cancelled' }); }

    // Cancelling returns EVERYTHING to stock — cloth to the roll and
    // ready-made units to the shelf. Missing the second half would quietly
    // lose a pair of shoes from inventory every time a sale was cancelled.
    let restock = [];
    if (status === 'cancelled') {
      const items = await client.query(
        `SELECT oi.fabric_id, oi.meters, fb.code AS fabric_code
         FROM order_items oi LEFT JOIN fabrics fb ON fb.id = oi.fabric_id
         WHERE oi.order_id = $1 AND oi.fabric_id IS NOT NULL AND oi.meters > 0`,
        [req.params.id]
      );
      for (const it of items.rows) {
        await client.query('UPDATE fabrics SET quantity_meters = quantity_meters + $1 WHERE id = $2', [it.meters, it.fabric_id]);
        await client.query(
          `INSERT INTO fabric_movements (fabric_id, type, meters, note, order_id, created_by)
           VALUES ($1,'in',$2,'Restocked from cancelled order',$3,$4)`,
          [it.fabric_id, it.meters, req.params.id, req.user.id]
        );
        restock.push({ fabric_code: it.fabric_code, meters: it.meters });
      }

      const prods = await client.query(
        `SELECT oi.variant_id, oi.qty, p.name AS product_name, v.size, v.color
         FROM order_items oi
         JOIN product_variants v ON v.id = oi.variant_id
         JOIN products p ON p.id = v.product_id
         WHERE oi.order_id = $1 AND oi.variant_id IS NOT NULL AND oi.qty > 0`,
        [req.params.id]
      );
      for (const it of prods.rows) {
        await client.query('UPDATE product_variants SET quantity = quantity + $1 WHERE id = $2',
          [it.qty, it.variant_id]);
        await client.query(
          `INSERT INTO product_movements (variant_id, type, qty, note, order_id, created_by)
           VALUES ($1,'in',$2,'Restocked from cancelled order',$3,$4)`,
          [it.variant_id, it.qty, req.params.id, req.user.id]
        );
        restock.push({
          product: `${it.product_name}${it.size ? ` · ${it.size}` : ''}${it.color ? ` · ${it.color}` : ''}`,
          qty: it.qty,
        });
      }
    }

    await logSync(client, {
      entity: status === 'cancelled' ? 'order_cancelled' : 'order_status',
      order_no: rows[0].order_no,
      payload: { order_no: rows[0].order_no, status, event_at: rows[0].updated_at, restock },
    });

    await client.query('COMMIT');
    // Master tailor never sees prices — even in this response.
    res.json(role === 'master_tailor' ? { id: rows[0].id, order_no: rows[0].order_no, status: rows[0].status } : rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally { client.release(); }
});

// ---------------- Record a payment (admin, salesman, cashier) ----------------
router.post('/:id/payments', async (req, res, next) => {
  if (!['admin', 'salesman', 'cashier'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Not allowed to record payments' });
  }
  const client = await db.getClient();
  try {
    const { amount, method = 'cash', note, payment_date } = req.body;
    const amt = Number(amount);
    if (!amt || amt <= 0) return res.status(400).json({ error: 'Payment amount must be greater than zero' });
    if (!PAYMENT_METHODS.includes(method)) return res.status(400).json({ error: `Invalid payment method: ${method}` });

    // Payment date is optional — skip it and "now" is used. Given a date, it
    // can't be in the future (backdating a forgotten entry is fine).
    if (payment_date) {
      const pd = new Date(payment_date);
      const endOfToday = new Date(); endOfToday.setHours(23, 59, 59, 999);
      if (isNaN(pd.getTime())) return res.status(400).json({ error: 'Invalid payment date' });
      if (pd > endOfToday) return res.status(400).json({ error: 'Payment date cannot be in the future' });
    }

    await client.query('BEGIN');
    const ord = await client.query('SELECT order_no FROM orders WHERE id = $1 AND deleted_at IS NULL', [req.params.id]);
    if (!ord.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Order not found' }); }

    const fin = await client.query('SELECT balance FROM order_finance WHERE order_id = $1', [req.params.id]);
    if (amt > Number(fin.rows[0].balance)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Payment exceeds remaining balance ($${fin.rows[0].balance})` });
    }

    // No VAT here: the order already carries its own, decided when the price
    // was charged. Taxing each payment as well is what made the balance
    // impossible to clear.
    const ref = newRef();
    const { rows } = await client.query(
      `INSERT INTO payments (order_id, amount, method, note, received_by, client_ref, created_at, vat_amount)
       VALUES ($1,$2,$3,$4,$5,$6, COALESCE(($7::date + CURRENT_TIME)::timestamptz, now()), 0) RETURNING *`,
      [req.params.id, amt, method, note || null, req.user.id, ref, payment_date || null]
    );

    await logSync(client, {
      entity: 'order_payment',
      order_no: ord.rows[0].order_no,
      client_ref: ref,
      payload: {
        order_no: ord.rows[0].order_no, amount: amt, method, note: note || null, vat_amount: 0,
        received_by_username: req.user.username, client_ref: ref, created_at: rows[0].created_at,
      },
    });

    const updated = await client.query('SELECT * FROM order_finance WHERE order_id = $1', [req.params.id]);
    await client.query('COMMIT');
    res.status(201).json({ payment: rows[0], finance: updated.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally { client.release(); }
});

// ---------------- Assign / change the tailor ----------------
// Salesman: may ASSIGN only while no tailor is set. Admin and master tailor:
// may assign or CHANGE anytime — the master tailor controls every tailor's
// workload, so they get the same reach as admin for this one action.
router.patch('/:id/tailor', async (req, res, next) => {
  if (!['admin', 'salesman', 'master_tailor'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Not allowed to assign tailors' });
  }
  const client = await db.getClient();
  try {
    const { tailor_id } = req.body;
    if (!tailor_id) return res.status(400).json({ error: 'tailor_id is required' });

    await client.query('BEGIN');
    // The tailor must belong to the same branch as the order. req.order was
    // established (and branch-checked) by router.param above.
    const t = await client.query(
      `SELECT id, name, username FROM users
       WHERE id = $1 AND role = 'tailor' AND active = TRUE AND branch_id = $2`,
      [tailor_id, req.order.branch_id]);
    if (!t.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Selected tailor not found, inactive, or not at this order\'s branch' });
    }

    const canReassignAnytime = ['admin', 'master_tailor'].includes(req.user.role);
    const guard = canReassignAnytime ? '' : 'AND tailor_id IS NULL';
    const { rows } = await client.query(
      `UPDATE orders SET tailor_id = $1, claimed_at = now()
       WHERE id = $2 AND status NOT IN ('delivered','cancelled') ${guard}
       RETURNING id, order_no, tailor_id, claimed_at`,
      [tailor_id, req.params.id]
    );
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return res.status(canReassignAnytime ? 404 : 403).json({
        error: canReassignAnytime
          ? 'Order not found or already delivered/cancelled'
          : 'This order already has a tailor — only an admin or the master tailor can change the assignment',
      });
    }

    await logSync(client, {
      entity: 'order_tailor',
      order_no: rows[0].order_no,
      payload: { order_no: rows[0].order_no, tailor_username: t.rows[0].username, claimed_at: rows[0].claimed_at },
    });

    await client.query('COMMIT');
    res.json({ ...rows[0], tailor_name: t.rows[0].name });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally { client.release(); }
});

// ---------------- Delete a wrong payment entry (ADMIN ONLY) ----------------
router.delete('/:id/payments/:paymentId', requireAdmin, async (req, res, next) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const del = await client.query(
      'DELETE FROM payments WHERE id = $1 AND order_id = $2 RETURNING id, client_ref, order_id',
      [req.params.paymentId, req.params.id]
    );
    if (!del.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Payment not found' }); }

    // Only log for sync if this payment had a client_ref (i.e. was created
    // after sync was set up — older payments were never mirrored either way).
    if (del.rows[0].client_ref) {
      const ord = await client.query('SELECT order_no FROM orders WHERE id = $1', [del.rows[0].order_id]);
      await logSync(client, {
        entity: 'order_payment_deleted',
        order_no: ord.rows[0]?.order_no || '',
        client_ref: del.rows[0].client_ref,
        payload: { client_ref: del.rows[0].client_ref },
      });
    }

    const fin = await client.query('SELECT * FROM order_finance WHERE order_id = $1', [req.params.id]);
    await client.query('COMMIT');
    res.json({ deleted: true, finance: fin.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally { client.release(); }
});

// ---------------- Delete an order (ADMIN ONLY) ----------------
// Nothing is actually removed. The order is HIDDEN: deleted_at is stamped,
// and from that moment it disappears from every list, report, dashboard
// figure and finance total. The row, its items, its payments and its whole
// history stay in the database untouched, so an accidental delete costs
// nothing — POST /api/orders/:id/restore puts it straight back.
//
// Fabric is deliberately NOT restocked here. Hiding an order is a
// bookkeeping action, not a real-world one; the cloth genuinely left the
// shelf. Cancel the order first if the fabric really did come back.
router.delete('/:id', requireAdmin, async (req, res, next) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE orders SET deleted_at = now()
       WHERE id = $1 AND deleted_at IS NULL RETURNING order_no`,
      [req.params.id]
    );
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Order not found, or it has already been deleted' });
    }

    await logSync(client, {
      entity: 'order_deleted',
      order_no: rows[0].order_no,
      payload: { order_no: rows[0].order_no, event_at: new Date().toISOString() },
    });

    await client.query('COMMIT');
    res.json({ deleted: true, hidden: true, order_no: rows[0].order_no });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally { client.release(); }
});

// ---------------- Bring a hidden order back (ADMIN ONLY) ----------------
router.post('/:id/restore', requireAdmin, async (req, res, next) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE orders SET deleted_at = NULL
       WHERE id = $1 AND deleted_at IS NOT NULL RETURNING order_no`,
      [req.params.id]
    );
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Order not found, or it was never deleted' });
    }

    await logSync(client, {
      entity: 'order_restored',
      order_no: rows[0].order_no,
      payload: { order_no: rows[0].order_no, event_at: new Date().toISOString() },
    });

    await client.query('COMMIT');
    res.json({ restored: true, order_no: rows[0].order_no });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally { client.release(); }
});

// ---------------- Edit order (ADMIN ONLY) ----------------
// price, delivery_date, notes, measurements, vat_method
// Changing the price or the billing method re-derives the VAT, so the total
// the customer owes always matches the price actually on the order.
router.put('/:id', requireAdmin, async (req, res, next) => {
  const client = await db.getClient();
  try {
    const allowed = ['price', 'delivery_date', 'notes', 'measurements'];
    const fields = [];
    const values = [];
    let i = 1;
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        fields.push(`${key} = $${i++}`);
        values.push(key === 'measurements' ? JSON.stringify(req.body[key]) : req.body[key]);
      }
    }
    if (req.body.vat_method !== undefined) {
      if (!PAYMENT_METHODS.includes(req.body.vat_method)) {
        return res.status(400).json({ error: `Invalid payment method: ${req.body.vat_method}` });
      }
      fields.push(`vat_method = $${i++}`);
      values.push(req.body.vat_method);
    }
    if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
    if (req.body.price !== undefined && (!Number(req.body.price) || Number(req.body.price) <= 0)) {
      return res.status(400).json({ error: 'Price must be greater than zero' });
    }

    await client.query('BEGIN');

    // Work out the VAT from whatever the price and method end up being after
    // this edit — the current row supplies whichever of the two wasn't sent.
    const cur = await client.query('SELECT price, vat_method FROM orders WHERE id = $1', [req.params.id]);
    if (!cur.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Order not found' }); }
    const newPrice = req.body.price !== undefined ? Number(req.body.price) : Number(cur.rows[0].price);
    const newMethod = req.body.vat_method !== undefined ? req.body.vat_method : cur.rows[0].vat_method;
    fields.push(`vat_amount = $${i++}`);
    values.push(vatFor(newMethod, newPrice));

    values.push(req.params.id);
    const { rows } = await client.query(`UPDATE orders SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, values);
    if (!rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Order not found' }); }

    await logSync(client, {
      entity: 'order_edited',
      order_no: rows[0].order_no,
      payload: {
        order_no: rows[0].order_no, price: rows[0].price, delivery_date: rows[0].delivery_date,
        notes: rows[0].notes, measurements: rows[0].measurements,
        vat_method: rows[0].vat_method, vat_amount: rows[0].vat_amount,
        event_at: rows[0].updated_at,
      },
    });

    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally { client.release(); }
});

module.exports = router;
