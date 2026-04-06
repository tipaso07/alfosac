-- Migration: normalize material currency to FK materiales.id_moneda -> monedas.id
-- Safe to run multiple times.

BEGIN;

ALTER TABLE materiales
ADD COLUMN IF NOT EXISTS id_moneda INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_materiales_monedas'
  ) THEN
    ALTER TABLE materiales
    ADD CONSTRAINT fk_materiales_monedas
    FOREIGN KEY (id_moneda) REFERENCES monedas(id);
  END IF;
END$$;

-- Backfill from legacy text column when present.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'materiales'
      AND column_name = 'moneda'
  ) THEN
    UPDATE materiales m
    SET id_moneda = mo.id
    FROM monedas mo
    WHERE m.id_moneda IS NULL
      AND lower(trim(COALESCE(m.moneda, ''))) = lower(trim(COALESCE(mo.nombre, '')));
  END IF;
END$$;

-- Optional cleanup once all clients are migrated:
-- ALTER TABLE materiales DROP COLUMN moneda;

COMMIT;
