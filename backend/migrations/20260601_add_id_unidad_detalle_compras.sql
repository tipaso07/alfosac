-- Migration: persist purchase item unit of measure in detalle_compras

BEGIN;

ALTER TABLE detalle_compras
  ADD COLUMN IF NOT EXISTS id_unidad INTEGER REFERENCES unidades(id);

COMMIT;
