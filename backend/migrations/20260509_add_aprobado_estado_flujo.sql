-- Migration: Add APROBADO state to estado_flujo CHECK constraint
-- Allows estado_flujo to be APROBADO when final approval is reached

BEGIN;

DO $$
DECLARE
  current_check_name TEXT;
BEGIN
  -- Find and drop existing estado_flujo constraint
  SELECT con.conname INTO current_check_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'servicios'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%estado_flujo%'
  LIMIT 1;

  IF current_check_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE servicios DROP CONSTRAINT %I', current_check_name);
  END IF;

  -- Add new constraint with APROBADO included
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_servicios_estado_flujo'
  ) THEN
    ALTER TABLE servicios
      ADD CONSTRAINT chk_servicios_estado_flujo
      CHECK (estado_flujo IS NULL OR estado_flujo IN ('APROBADO', 'DATOS_COMPLETADOS', 'PENDIENTE', 'REALIZADO'));
  END IF;
END$$;

COMMIT;
