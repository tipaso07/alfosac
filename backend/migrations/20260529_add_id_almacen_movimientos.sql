-- Migration: add warehouse reference to movimientos

BEGIN;

ALTER TABLE movimientos
  ADD COLUMN IF NOT EXISTS id_almacen INTEGER;

COMMIT;