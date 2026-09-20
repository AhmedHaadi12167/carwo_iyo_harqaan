-- ============================================================
-- Migration: OFFLINE-POS <-> CLOUD sync (outbox pattern)
-- Run this SAME file on BOTH databases — the POS's local Postgres
-- AND the cloud Postgres — since both sides need identical tables.
-- Run: psql -U postgres -d tailors_db -f database/add-sync.sql
-- ============================================================

BEGIN;

-- Every meaningful write to an order/payment gets logged here, on the
-- database it was written to. The sync client reads new rows out of this
-- table and ships them to the other side. Nothing is ever deleted from here
-- automatically — it's a permanent audit trail as a side benefit.
CREATE TABLE IF NOT EXISTS sync_outbox (
  id         BIGSERIAL PRIMARY KEY,
  entity     TEXT NOT NULL CHECK (entity IN (
               'order_created', 'order_status', 'order_cancelled',
               'order_edited', 'order_tailor',
               'order_payment', 'order_payment_deleted'
             )),
  order_no   TEXT NOT NULL,           -- stable key shared by both databases
  payload    JSONB NOT NULL,
  origin     TEXT NOT NULL CHECK (origin IN ('pos','cloud')),
  client_ref TEXT,                    -- idempotency key (payments/deletes)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sync_outbox_origin_id ON sync_outbox (origin, id);
CREATE INDEX IF NOT EXISTS idx_sync_outbox_order_no ON sync_outbox (order_no);

-- Remembers how far the sync client has pushed/pulled, so a restart doesn't
-- resend or reprocess everything from the beginning.
CREATE TABLE IF NOT EXISTS sync_cursor (
  peer       TEXT PRIMARY KEY,        -- e.g. 'cloud_pushed', 'cloud_pulled'
  last_id    BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Guards against double-applying an incoming entry if a push/pull is retried
-- after a dropped connection (network hiccups are expected, not exceptional).
CREATE TABLE IF NOT EXISTS sync_applied (
  client_ref TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotency key for payments — generated once at creation time and carried
-- through the sync payload, so a replayed sync never creates a duplicate
-- payment row.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS client_ref TEXT UNIQUE;

COMMIT;
