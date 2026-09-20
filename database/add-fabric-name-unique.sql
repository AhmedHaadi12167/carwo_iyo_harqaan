-- Fabric names must be unique (case-insensitive) — prevents the same
-- fabric being registered twice under slightly different casing.
-- Matched by the app's pre-check in backend/src/routes/fabrics.js; this
-- index is the database-level backstop for a race between two requests.
CREATE UNIQUE INDEX IF NOT EXISTS idx_fabrics_name_unique ON fabrics (LOWER(name));
