-- Migration: extend servicios states and optional monetary breakdown fields
-- Safe to run multiple times.

BEGIN;

ALTER TABLE IF EXISTS servicios
  ADD COLUMN IF NOT EXISTS subtotal NUMERIC(12,2);

ALTER TABLE IF EXISTS servicios
  ADD COLUMN IF NOT EXISTS impuestos NUMERIC(12,2);

ALTER TABLE IF EXISTS servicios
  ADD COLUMN IF NOT EXISTS total NUMERIC(12,2);

DO $$
DECLARE
  current_check_name TEXT;
BEGIN
  SELECT con.conname INTO current_check_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'servicios'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%estado_servicio%'
  LIMIT 1;

  IF current_check_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE servicios DROP CONSTRAINT %I', current_check_name);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_servicios_estado_servicio'
  ) THEN
    ALTER TABLE servicios
      ADD CONSTRAINT chk_servicios_estado_servicio
      CHECK (estado_servicio IS NULL OR estado_servicio IN ('COMPLETADO', 'PENDIENTE', 'REALIZADO'));
  END IF;
END$$;

COMMIT;
