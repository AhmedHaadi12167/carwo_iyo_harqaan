-- Reverts add-fabric-name-unique.sql — real inventory has legitimate
-- fabrics that share a name (different rolls/shipments of the same
-- fabric), so names no longer need to be unique.
-- Run: psql -U postgres -d tailors_db -f database/drop-fabric-name-unique.sql
DROP INDEX IF EXISTS idx_fabrics_name_unique;
