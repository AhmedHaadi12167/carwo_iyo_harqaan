/**
 * Runs ONLY on the POS (SYNC_ORIGIN=pos with CLOUD_SYNC_URL set). The cloud
 * server never initiates a connection — it just answers when the POS calls,
 * because the POS is typically behind a router/NAT with no public address,
 * while the cloud server always has one. This means nothing needs to be
 * "port forwarded" at the shop; the POS only ever makes outbound requests.
 *
 * Every tick: push whatever's new locally, then pull whatever's new on the
 * cloud (admin cancellations/edits), and apply it. If there's no internet
 * right now, the tick just fails quietly and tries again next time — the
 * POS keeps working locally the entire time regardless.
 */
const db = require('./../db');
const { applyEntry } = require('./apply');

const state = {
  lastSyncedAt: null,
  lastError: null,
  pendingPush: 0,
  running: false,
};

function getSyncStatus() {
  return {
    role: process.env.SYNC_ORIGIN === 'cloud' ? 'cloud' : 'pos',
    enabled: !!process.env.CLOUD_SYNC_URL,
    ...state,
  };
}

async function pushLocalChanges() {
  const cursor = await db.query(`SELECT last_id FROM sync_cursor WHERE peer = 'cloud_pushed'`);
  const lastId = cursor.rows[0]?.last_id || 0;
  const { rows } = await db.query(
    `SELECT id, entity, order_no, payload, origin, client_ref FROM sync_outbox
     WHERE origin = 'pos' AND id > $1 ORDER BY id ASC LIMIT 200`,
    [lastId]
  );
  state.pendingPush = rows.length;
  if (!rows.length) return;

  const res = await fetch(`${process.env.CLOUD_SYNC_URL}/api/sync/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-sync-key': process.env.SYNC_SECRET },
    body: JSON.stringify({ entries: rows }),
  });
  if (!res.ok) throw new Error(`Cloud rejected push (HTTP ${res.status})`);

  const maxId = rows[rows.length - 1].id;
  await db.query(
    `INSERT INTO sync_cursor (peer, last_id) VALUES ('cloud_pushed', $1)
     ON CONFLICT (peer) DO UPDATE SET last_id = $1, updated_at = now()`,
    [maxId]
  );
}

async function pullCloudChanges() {
  const cursor = await db.query(`SELECT last_id FROM sync_cursor WHERE peer = 'cloud_pulled'`);
  const since = cursor.rows[0]?.last_id || 0;

  const res = await fetch(`${process.env.CLOUD_SYNC_URL}/api/sync/pull?since=${since}`, {
    headers: { 'x-sync-key': process.env.SYNC_SECRET },
  });
  if (!res.ok) throw new Error(`Cloud rejected pull (HTTP ${res.status})`);
  const { entries } = await res.json();

  for (const entry of entries) {
    await applyEntry(entry);
    // Advance the cursor after each entry (not just at the end) so a crash
    // mid-batch never re-applies what already succeeded.
    await db.query(
      `INSERT INTO sync_cursor (peer, last_id) VALUES ('cloud_pulled', $1)
       ON CONFLICT (peer) DO UPDATE SET last_id = $1, updated_at = now()`,
      [entry.id]
    );
  }
}

async function tick() {
  if (state.running) return; // never overlap two ticks if one is running long
  state.running = true;
  try {
    await pushLocalChanges();
    await pullCloudChanges();
    state.lastSyncedAt = new Date().toISOString();
    state.lastError = null;
  } catch (err) {
    // Expected and harmless when the shop has no internet right now.
    state.lastError = err.message;
  } finally {
    state.running = false;
  }
}

function startSyncLoop() {
  if (process.env.SYNC_ORIGIN !== 'pos' || !process.env.CLOUD_SYNC_URL) return;
  const intervalMs = Number(process.env.SYNC_INTERVAL_MS) || 20000;
  tick();
  setInterval(tick, intervalMs);
  console.log(`Sync loop active — syncing with ${process.env.CLOUD_SYNC_URL} every ${intervalMs / 1000}s`);
}

module.exports = { startSyncLoop, getSyncStatus };
