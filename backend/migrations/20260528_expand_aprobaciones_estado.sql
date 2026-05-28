-- Migration: expand approval state column to accept long pending states

BEGIN;

ALTER TABLE aprobaciones
  ALTER COLUMN estado TYPE VARCHAR(60) USING estado::VARCHAR(60),
  ALTER COLUMN estado SET DEFAULT 'PENDIENTE';

COMMIT;