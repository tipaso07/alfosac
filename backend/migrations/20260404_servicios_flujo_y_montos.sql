-- Migration: add servicio workflow flow and detailed monetary fields.
-- Safe to run multiple times.

BEGIN;

ALTER TABLE IF EXISTS servicios
  ADD COLUMN IF NOT EXISTS estado_flujo VARCHAR(30);

ALTER TABLE IF EXISTS servicios
  ADD COLUMN IF NOT EXISTS igv NUMERIC(12,2);

ALTER TABLE IF EXISTS servicios
  ADD COLUMN IF NOT EXISTS costo_envio NUMERIC(12,2);

ALTER TABLE IF EXISTS servicios
  ADD COLUMN IF NOT EXISTS otros_costos NUMERIC(12,2);

UPDATE servicios s
SET
  estado_flujo = CASE UPPER(TRIM(COALESCE((to_jsonb(s)->>'estado_flujo'), (to_jsonb(s)->>'estado_servicio'), '')))
    WHEN 'COMPLETADO' THEN 'DATOS_COMPLETADOS'
    WHEN 'DATOS_COMPLETADOS' THEN 'DATOS_COMPLETADOS'
    WHEN 'PENDIENTE' THEN 'PENDIENTE'
    WHEN 'REALIZADO' THEN 'REALIZADO'
    ELSE NULL
  END,
  igv = COALESCE(NULLIF(COALESCE(to_jsonb(s)->>'igv', to_jsonb(s)->>'impuestos', ''), '')::numeric, 0),
  costo_envio = COALESCE(NULLIF(COALESCE(to_jsonb(s)->>'costo_envio', ''), '')::numeric, 0),
  otros_costos = COALESCE(NULLIF(COALESCE(to_jsonb(s)->>'otros_costos', ''), '')::numeric, 0),
  subtotal = COALESCE(NULLIF(COALESCE(to_jsonb(s)->>'subtotal', ''), '')::numeric, 0),
  total = COALESCE(
    NULLIF(COALESCE(to_jsonb(s)->>'total', ''), '')::numeric,
    COALESCE(NULLIF(COALESCE(to_jsonb(s)->>'subtotal', ''), '')::numeric, 0)
      + COALESCE(NULLIF(COALESCE(to_jsonb(s)->>'igv', to_jsonb(s)->>'impuestos', ''), '')::numeric, 0)
      + COALESCE(NULLIF(COALESCE(to_jsonb(s)->>'costo_envio', ''), '')::numeric, 0)
      + COALESCE(NULLIF(COALESCE(to_jsonb(s)->>'otros_costos', ''), '')::numeric, 0)
  );

DO $$
DECLARE
  current_check_name TEXT;
BEGIN
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

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_servicios_estado_flujo'
  ) THEN
    ALTER TABLE servicios
      ADD CONSTRAINT chk_servicios_estado_flujo
      CHECK (estado_flujo IS NULL OR estado_flujo IN ('DATOS_COMPLETADOS', 'PENDIENTE', 'REALIZADO'));
  END IF;
END$$;

COMMIT;
