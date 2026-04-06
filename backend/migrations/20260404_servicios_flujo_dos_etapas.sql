-- Migration: servicios flow in two stages (basic request -> data completion)
-- Safe to run multiple times.

BEGIN;

ALTER TABLE IF EXISTS servicios
  ALTER COLUMN proveedor_id DROP NOT NULL;

ALTER TABLE IF EXISTS servicios
  ALTER COLUMN costo DROP NOT NULL;

ALTER TABLE IF EXISTS servicios
  ALTER COLUMN moneda_id DROP NOT NULL;

ALTER TABLE IF EXISTS servicios
  ADD COLUMN IF NOT EXISTS nombre_servicio VARCHAR(255);

ALTER TABLE IF EXISTS servicios
  ADD COLUMN IF NOT EXISTS prioridad VARCHAR(10);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_prioridad'
  ) THEN
    ALTER TABLE servicios
      ADD CONSTRAINT chk_prioridad
      CHECK (prioridad IN ('ALTA', 'MEDIA', 'BAJA'));
  END IF;
END$$;

COMMIT;
