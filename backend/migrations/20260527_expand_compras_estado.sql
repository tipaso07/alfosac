-- Migration: expand purchase state columns to accept longer workflow states

BEGIN;

ALTER TABLE compras
  ALTER COLUMN estado TYPE VARCHAR(50) USING estado::VARCHAR(50),
  ALTER COLUMN estado SET DEFAULT 'PENDIENTE',
  ALTER COLUMN estado_pedido TYPE VARCHAR(50) USING estado_pedido::VARCHAR(50),
  ALTER COLUMN estado_pedido SET DEFAULT 'PENDIENTE';

COMMIT;