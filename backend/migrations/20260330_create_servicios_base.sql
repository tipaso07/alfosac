-- Migration (preexisting date): ensure servicios and calificaciones_proveedor exist
-- Fecha: 2026-05-04 (archivo creado para colocarse antes de migraciones de 2026-04)

BEGIN;

CREATE TABLE IF NOT EXISTS servicios (
  id SERIAL PRIMARY KEY,
  proveedor_id INTEGER,
  id_usuario INTEGER,
  moneda_id INTEGER,
  nombre_servicio VARCHAR(255),
  descripcion_servicio TEXT,
  costo NUMERIC(12,2),
  subtotal NUMERIC(12,2),
  igv NUMERIC(12,2),
  costo_envio NUMERIC(12,2),
  otros_costos NUMERIC(12,2),
  total NUMERIC(12,2),
  aplica_retencion BOOLEAN DEFAULT FALSE,
  retencion NUMERIC(8,2),
  tipo_retencion VARCHAR(20),
  prioridad VARCHAR(10),
  dentro_plan BOOLEAN DEFAULT FALSE,
  estado_aprobacion VARCHAR(30) DEFAULT 'PENDIENTE',
  estado_flujo VARCHAR(30),
  estado_servicio VARCHAR(30),
  fecha TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_servicios_proveedor_id ON servicios(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_servicios_id_usuario ON servicios(id_usuario);

CREATE TABLE IF NOT EXISTS calificaciones_proveedor (
  id SERIAL PRIMARY KEY,
  id_proveedor INTEGER,
  tipo VARCHAR(50),
  id_referencia INTEGER,
  puntuacion INTEGER,
  comentario TEXT,
  fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_calif_proveedor_ref ON calificaciones_proveedor(id_proveedor, id_referencia);

COMMIT;
