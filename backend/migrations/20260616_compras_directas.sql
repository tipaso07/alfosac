CREATE TABLE IF NOT EXISTS compras_directas (
    id SERIAL PRIMARY KEY,
    id_usuario INTEGER NOT NULL REFERENCES usuarios(id),
    id_area INTEGER NOT NULL REFERENCES areas(id),
    proveedor_texto VARCHAR(255),
    tipo_pago VARCHAR(50) NOT NULL DEFAULT 'EFECTIVO',
    numero_comprobante VARCHAR(100),
    total DECIMAL(12,2) NOT NULL DEFAULT 0,
    foto TEXT,
    observaciones TEXT,
    fecha_compra TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS detalle_compras_directas (
    id SERIAL PRIMARY KEY,
    id_compra_directa INTEGER NOT NULL REFERENCES compras_directas(id) ON DELETE CASCADE,
    descripcion TEXT NOT NULL,
    cantidad DECIMAL(12,2) NOT NULL,
    precio_unitario DECIMAL(12,2) NOT NULL,
    total DECIMAL(12,2) NOT NULL
);