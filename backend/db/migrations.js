const { pool, schemaMeta, loadSchemaMeta } = require('./pool');

const ensureRequerimientosColumns = async () => {
  await pool.query(`
    ALTER TABLE requerimientos
    ADD COLUMN IF NOT EXISTS prioridad VARCHAR(20) DEFAULT 'MEDIA';
  `);

  await pool.query(`
    ALTER TABLE requerimientos
    ADD COLUMN IF NOT EXISTS fecha_creacion TIMESTAMP DEFAULT (timezone('America/Lima', now()));
  `);

  await pool.query(`
    ALTER TABLE requerimientos
    ADD COLUMN IF NOT EXISTS calificacion INTEGER;
  `);

  await pool.query(`
    ALTER TABLE requerimientos
    ADD COLUMN IF NOT EXISTS calificacion_comentario TEXT;
  `);

  await pool.query(`
    ALTER TABLE requerimientos
    ADD COLUMN IF NOT EXISTS calificacion_usuario INTEGER REFERENCES usuarios(id);
  `);

  await pool.query(`
    ALTER TABLE requerimientos
    ADD COLUMN IF NOT EXISTS calificacion_fecha TIMESTAMP;
  `);

  await pool.query(`
    UPDATE requerimientos
    SET prioridad = 'MEDIA'
    WHERE prioridad IS NULL OR trim(prioridad) = '';
  `);

  await pool.query(`
    UPDATE requerimientos
    SET prioridad = upper(trim(prioridad))
    WHERE prioridad IS NOT NULL;
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'requerimientos'
          AND column_name = 'created_at'
      ) THEN
        UPDATE requerimientos
        SET fecha_creacion = COALESCE(fecha_creacion, created_at)
        WHERE fecha_creacion IS NULL;
      END IF;
    END$$;
  `);

  schemaMeta.loaded = false;
  await loadSchemaMeta();
};

const ensureComprasColumns = async () => {
  const compraColumnStatements = [
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS id_usuario INTEGER;`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS id_area_solicitante INTEGER;`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS id_area_final INTEGER;`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS proveedor VARCHAR(200);`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS ruc VARCHAR(11);`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS direccion VARCHAR(255);`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS distrito VARCHAR(100);`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS correo VARCHAR(100);`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS persona_responsable VARCHAR(100);`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS telefono VARCHAR(20);`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS contacto_proveedor VARCHAR(100);`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS banco VARCHAR(100);`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS numero_cuenta VARCHAR(50);`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS cuenta VARCHAR(50);`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS cci VARCHAR(100);`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS retencion VARCHAR(10);`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS descuento NUMERIC(12,2);`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS tipo_cambio NUMERIC(12,4);`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS aplica_retencion BOOLEAN DEFAULT FALSE;`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS tipo VARCHAR(20);`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS tipo_retencion VARCHAR(20);`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS importe_final NUMERIC(12,2);`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS condiciones_pago VARCHAR(100);`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS detalle TEXT;`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS subtotal NUMERIC(12,2);`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS costo_envio NUMERIC(12,2);`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS otros_costos NUMERIC(12,2);`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS igv NUMERIC(12,2);`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS total NUMERIC(12,2);`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS numero_orden VARCHAR(50);`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS fecha_creacion TIMESTAMP DEFAULT (timezone('America/Lima', now()));`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS fecha_actualizacion TIMESTAMP DEFAULT (timezone('America/Lima', now()));`,
  ];

  for (const statement of compraColumnStatements) {
    await pool.query(statement);
  }

  await pool.query(`
    ALTER TABLE materiales
    ADD COLUMN IF NOT EXISTS id_moneda INTEGER;
  `);

  await pool.query(`
    ALTER TABLE materiales
    ADD COLUMN IF NOT EXISTS id_proveedor INTEGER;
  `);

  await pool.query(`
    ALTER TABLE materiales
    ADD COLUMN IF NOT EXISTS imagen TEXT;
  `);

  await pool.query(`
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
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_materiales_proveedor'
      ) THEN
        ALTER TABLE materiales
        ADD CONSTRAINT fk_materiales_proveedor
        FOREIGN KEY (id_proveedor) REFERENCES proveedores(id);
      END IF;
    END$$;
  `);

  await pool.query(`
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
          AND (
            lower(trim(COALESCE(m.moneda, ''))) = lower(trim(COALESCE(mo.nombre, '')))
          );
      END IF;
    END$$;
  `);

  schemaMeta.loaded = false;
  await loadSchemaMeta();
};

const ensureProveedoresColumns = async () => {
  const statements = [
    `ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS nombre VARCHAR(200);`,
    `ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS razon_social VARCHAR(200);`,
    `ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS ruc VARCHAR(11);`,
    `ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS direccion VARCHAR(255);`,
    `ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS distrito VARCHAR(100);`,
    `ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS correo VARCHAR(100);`,
    `ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS persona_responsable VARCHAR(100);`,
    `ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS telefono VARCHAR(50);`,
    `ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS condiciones_pago VARCHAR(100);`,
    `ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS banco VARCHAR(100);`,
    `ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS numero_cuenta VARCHAR(50);`,
    `ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS cci VARCHAR(100);`,
    `ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS id_moneda INTEGER;`,
    `ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS id_area_destino INTEGER;`,
    `ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS descripcion TEXT;`,
    `ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS retencion VARCHAR(10);`,
    `ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS categoria VARCHAR(100);`,
    `ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS descuento NUMERIC(5,2) DEFAULT 0;`,
    `ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS tipo VARCHAR(20) DEFAULT 'BIEN';`,
    `ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS tipo_retencion VARCHAR(20) DEFAULT 'RETENCION';`,
  ];
  for (const sql of statements) {
    await pool.query(sql);
  }
  schemaMeta.loaded = false;
  await loadSchemaMeta();
};

const ensureMovimientosColumns = async () => {
  await pool.query(`
    ALTER TABLE movimientos
    ADD COLUMN IF NOT EXISTS id_requerimiento INTEGER;
  `);

  await pool.query(`
    ALTER TABLE movimientos
    ADD COLUMN IF NOT EXISTS id_almacen INTEGER;
  `);
  await pool.query(`
    ALTER TABLE movimientos
    ALTER COLUMN fecha_movimiento TYPE TIMESTAMP USING fecha_movimiento::timestamp;
  `);

  await pool.query(`
    ALTER TABLE movimientos
    ALTER COLUMN fecha_movimiento SET DEFAULT timezone('America/Lima', now());
  `);

  await pool.query(`
    ALTER TABLE movimientos
    ALTER COLUMN created_at SET DEFAULT timezone('America/Lima', now());
  `);
};

module.exports = {
  ensureRequerimientosColumns,
  ensureComprasColumns,
  ensureProveedoresColumns,
  ensureMovimientosColumns,
};
