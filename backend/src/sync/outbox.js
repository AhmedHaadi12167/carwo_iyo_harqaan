const crypto = require('crypto');

// Which side is this server? Set in .env:
//   SYNC_ORIGIN=pos    (the POS machine's local backend)
//   SYNC_ORIGIN=cloud  (the hosted backend on the server)
function origin() {
  return process.env.SYNC_ORIGIN === 'cloud' ? 'cloud' : 'pos';
}

// Call this INSIDE the same transaction as the write it describes, so the
// outbox entry can never exist without the change it records actually
// having committed (and vice versa).
async function logSync(client, { entity, order_no, payload, client_ref = null, branch_code = null }) {
  await client.query(
    `INSERT INTO sync_outbox (entity, order_no, payload, origin, client_ref, branch_code)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [entity, order_no, JSON.stringify(payload), origin(), client_ref, branch_code]
  );
}

const newRef = () => crypto.randomUUID();

module.exports = { logSync, origin, newRef };
