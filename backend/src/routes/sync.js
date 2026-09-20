const router = require('express').Router();
const db = require('../db');
const { applyEntry } = require('../sync/apply');
const { getSyncStatus } = require('../sync/client');
const { requireAuth } = require('../middleware/auth');

// Server-to-server auth — a shared secret, not a user login. Only the
// POS's own sync client and the cloud server ever call these two routes.
function requireSyncSecret(req, res, next) {
  const key = req.headers['x-sync-key'];
  if (!process.env.SYNC_SECRET || key !== process.env.SYNC_SECRET) {
    return res.status(401).json({ error: 'Invalid sync key' });
  }
  next();
}

// The POS calls this on the cloud to hand over its new local changes.
router.post('/push', requireSyncSecret, async (req, res, next) => {
  try {
    const entries = Array.isArray(req.body.entries) ? req.body.entries : [];
    let applied = 0, skipped = 0;
    for (const entry of entries) {
      const result = await applyEntry(entry);
      if (result.applied) applied++; else skipped++;
    }
    res.json({ received: entries.length, applied, skipped });
  } catch (err) { next(err); }
});

// The POS calls this on the cloud to ask for anything new the ADMIN did
// (cancellations, edits) since its last successful pull.
router.get('/pull', requireSyncSecret, async (req, res, next) => {
  try {
    const since = Number(req.query.since) || 0;
    const { rows } = await db.query(
      `SELECT id, entity, order_no, payload, origin, client_ref FROM sync_outbox
       WHERE origin = 'cloud' AND id > $1 ORDER BY id ASC LIMIT 500`,
      [since]
    );
    res.json({ entries: rows });
  } catch (err) { next(err); }
});

// Small status readout for the "last synced" UI banner (task #11).
router.get('/status', requireAuth, (req, res) => res.json(getSyncStatus()));

module.exports = router;
