-- ============================================================
-- Migration: fabric photos
-- Run: psql -U postgres -d tailors_db -f database/add-fabric-image.sql
-- ============================================================

ALTER TABLE fabrics ADD COLUMN IF NOT EXISTS image TEXT; -- compressed JPEG data URL
