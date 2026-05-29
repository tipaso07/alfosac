-- Migration: add temporary exchange rate field to compras

BEGIN;

ALTER TABLE compras
  ADD COLUMN IF NOT EXISTS tipo_cambio NUMERIC(12,4);

COMMIT;