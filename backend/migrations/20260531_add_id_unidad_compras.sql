-- Migration: persist purchase unit of measure in compras

BEGIN;

ALTER TABLE compras
  ADD COLUMN IF NOT EXISTS id_unidad INTEGER REFERENCES unidades(id);

COMMIT;