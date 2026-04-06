-- Migration: add retention fields for servicios completion step.

BEGIN;

ALTER TABLE IF EXISTS servicios
  ADD COLUMN IF NOT EXISTS aplica_retencion BOOLEAN DEFAULT FALSE;

ALTER TABLE IF EXISTS servicios
  ADD COLUMN IF NOT EXISTS retencion NUMERIC(8,2);

ALTER TABLE IF EXISTS servicios
  ADD COLUMN IF NOT EXISTS tipo_retencion VARCHAR(20);

UPDATE servicios s
SET
  aplica_retencion = CASE
    WHEN upper(trim(COALESCE(to_jsonb(s)->>'aplica_retencion', to_jsonb(s)->>'retencion', 'NO'))) IN ('TRUE', 'T', '1', 'SI', 'YES') THEN TRUE
    ELSE FALSE
  END,
  retencion = COALESCE(NULLIF(COALESCE(to_jsonb(s)->>'retencion', to_jsonb(s)->>'descuento', ''), '')::numeric, 0),
  tipo_retencion = CASE
    WHEN upper(trim(COALESCE(to_jsonb(s)->>'tipo_retencion', ''))) IN ('RETENCION', 'DETRACCION')
      THEN upper(trim(COALESCE(to_jsonb(s)->>'tipo_retencion', '')))
    ELSE 'RETENCION'
  END;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_servicios_tipo_retencion'
  ) THEN
    ALTER TABLE servicios
      ADD CONSTRAINT chk_servicios_tipo_retencion
      CHECK (tipo_retencion IS NULL OR tipo_retencion IN ('RETENCION', 'DETRACCION'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_servicios_retencion_positiva'
  ) THEN
    ALTER TABLE servicios
      ADD CONSTRAINT chk_servicios_retencion_positiva
      CHECK (retencion IS NULL OR retencion >= 0);
  END IF;
END$$;

COMMIT;
