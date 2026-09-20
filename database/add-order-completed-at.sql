-- Tracks the exact moment a garment was finished, independent of updated_at
-- (which shifts on any edit — price change, note edit, etc.). Used for the
-- tailor performance report (daily / weekly / monthly / all-time).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- Best-effort backfill for orders that were already completed/delivered
-- before this column existed — updated_at is the closest approximation we
-- have for historical rows.
UPDATE orders SET completed_at = updated_at
WHERE status IN ('completed', 'delivered') AND completed_at IS NULL;
