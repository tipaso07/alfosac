-- Migration: dynamic approvals base tables and default chain data
-- Fecha: 2026-05-05

BEGIN;

CREATE TABLE IF NOT EXISTS aprobaciones (
  id SERIAL PRIMARY KEY,
  tipo VARCHAR(30) NOT NULL,
  referencia_id INTEGER NOT NULL,
  orden INTEGER NOT NULL,
  rol_aprobador INTEGER NOT NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
  usuario_id INTEGER,
  fecha TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_aprobaciones_tipo_ref_orden
  ON aprobaciones (tipo, referencia_id, orden);

CREATE INDEX IF NOT EXISTS idx_aprobaciones_tipo_ref
  ON aprobaciones (tipo, referencia_id);

CREATE INDEX IF NOT EXISTS idx_aprobaciones_rol_estado
  ON aprobaciones (rol_aprobador, estado);

CREATE TABLE IF NOT EXISTS aprobaciones_config (
  id SERIAL PRIMARY KEY,
  flujo VARCHAR(40) NOT NULL,
  orden INTEGER NOT NULL,
  rol_id INTEGER NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Limpia duplicados previos para poder crear restricciones únicas de forma segura.
WITH duplicados_rol AS (
  SELECT MIN(id) AS keep_id, flujo, rol_id
  FROM aprobaciones_config
  GROUP BY flujo, rol_id
  HAVING COUNT(*) > 1
)
DELETE FROM aprobaciones_config ac
USING duplicados_rol d
WHERE ac.flujo = d.flujo
  AND ac.rol_id = d.rol_id
  AND ac.id <> d.keep_id;

WITH duplicados_orden AS (
  SELECT MIN(id) AS keep_id, flujo, orden
  FROM aprobaciones_config
  GROUP BY flujo, orden
  HAVING COUNT(*) > 1
)
DELETE FROM aprobaciones_config ac
USING duplicados_orden d
WHERE ac.flujo = d.flujo
  AND ac.orden = d.orden
  AND ac.id <> d.keep_id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_aprobaciones_config_flujo_orden
  ON aprobaciones_config (flujo, orden);

CREATE UNIQUE INDEX IF NOT EXISTS uq_aprobaciones_config_flujo_rol
  ON aprobaciones_config (flujo, rol_id);

-- Seed defaults using canonical roles when they exist.
WITH cfg AS (
  SELECT 'COMPRA'::text AS flujo, 1 AS orden, 'JEFE DE AREA/SUBGERENTE'::text AS rol_nombre
  UNION ALL SELECT 'COMPRA', 2, 'GERENCIA DEL AREA'
  UNION ALL SELECT 'COMPRA', 3, 'GERENCIA DE FINANZAS'
  UNION ALL SELECT 'COMPRA', 4, 'ADMIN'
  UNION ALL SELECT 'SERVICIO_DENTRO_PLAN', 1, 'JEFE DE AREA/SUBGERENTE'
  UNION ALL SELECT 'SERVICIO_DENTRO_PLAN', 2, 'GERENCIA DEL AREA'
  UNION ALL SELECT 'SERVICIO_DENTRO_PLAN', 3, 'GERENCIA DE FINANZAS'
  UNION ALL SELECT 'SERVICIO_FUERA_PLAN', 1, 'JEFE DE AREA/SUBGERENTE'
  UNION ALL SELECT 'SERVICIO_FUERA_PLAN', 2, 'GERENCIA DEL AREA'
  UNION ALL SELECT 'SERVICIO_FUERA_PLAN', 3, 'GERENCIA DE FINANZAS'
  UNION ALL SELECT 'SERVICIO_FUERA_PLAN', 4, 'ADMIN'
)
INSERT INTO aprobaciones_config (flujo, orden, rol_id)
SELECT cfg.flujo, cfg.orden, r.id
FROM cfg
JOIN roles r ON upper(trim(r.nombre)) = upper(trim(cfg.rol_nombre))
WHERE NOT EXISTS (
  SELECT 1
  FROM aprobaciones_config ac
  WHERE upper(trim(ac.flujo)) = upper(trim(cfg.flujo))
    AND ac.orden = cfg.orden
)
ON CONFLICT DO NOTHING;

COMMIT;
