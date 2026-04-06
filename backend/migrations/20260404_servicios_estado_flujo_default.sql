-- Migration: align estado_flujo defaults with chk_servicios_estado_flujo.

BEGIN;

UPDATE servicios
SET estado_flujo = CASE UPPER(TRIM(COALESCE(estado_flujo, '')))
  WHEN 'DATOS_COMPLETADOS' THEN 'DATOS_COMPLETADOS'
  WHEN 'PENDIENTE' THEN 'PENDIENTE'
  WHEN 'REALIZADO' THEN 'REALIZADO'
  WHEN 'COMPLETADO' THEN 'DATOS_COMPLETADOS'
  ELSE NULL
END
WHERE estado_flujo IS NOT NULL;

ALTER TABLE servicios
  ALTER COLUMN estado_flujo DROP DEFAULT;

COMMIT;
