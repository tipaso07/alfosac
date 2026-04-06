const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });
const { Pool } = require('pg');

const configuredDbHost = process.env.DB_HOST || 'localhost';
const effectiveDbHost = configuredDbHost === 'postgres' && process.platform === 'win32'
  ? 'localhost'
  : configuredDbHost;

const pool = new Pool({
  host: effectiveDbHost,
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'postgres',
});

const createTablesSql = `
-- Tablas base del sistema
CREATE TABLE IF NOT EXISTS roles (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL UNIQUE,
  descripcion TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS permisos (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL UNIQUE,
  descripcion TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rol_permiso (
  id SERIAL PRIMARY KEY,
  id_rol INTEGER REFERENCES roles(id),
  id_permiso INTEGER REFERENCES permisos(id),
  UNIQUE(id_rol, id_permiso)
);

CREATE TABLE IF NOT EXISTS categorias (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  descripcion TEXT
);

CREATE TABLE IF NOT EXISTS unidades (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(50) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS monedas (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(50) NOT NULL UNIQUE,
  simbolo VARCHAR(10)
);

CREATE TABLE IF NOT EXISTS almacenes (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  ubicacion VARCHAR(255),
  encargado VARCHAR(100)
);

CREATE TABLE IF NOT EXISTS areas (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL UNIQUE,
  descripcion TEXT
);

CREATE TABLE IF NOT EXISTS usuarios (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  nombre VARCHAR(100) NOT NULL,
  id_role INTEGER REFERENCES roles(id),
  id_area INTEGER REFERENCES areas(id),
  estado VARCHAR(20) DEFAULT 'ACTIVO',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS proveedores (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(200) NOT NULL,
  razon_social VARCHAR(200),
  direccion VARCHAR(255),
  distrito VARCHAR(100),
  ruc VARCHAR(11) UNIQUE,
  correo VARCHAR(100),
  persona_responsable VARCHAR(100),
  telefono VARCHAR(20),
  condiciones_pago VARCHAR(100),
  banco VARCHAR(100),
  numero_cuenta VARCHAR(50),
  cci VARCHAR(100),
  id_moneda INTEGER REFERENCES monedas(id),
  id_area_destino INTEGER REFERENCES areas(id),
  descripcion TEXT,
  retencion VARCHAR(10) DEFAULT 'NO',
  categoria VARCHAR(100),
  descuento NUMERIC(5,2) DEFAULT 0,
  tipo VARCHAR(20) DEFAULT 'BIEN',
  tipo_retencion VARCHAR(20) DEFAULT 'RETENCION',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  moneda_nombre VARCHAR(50)
);

CREATE TABLE IF NOT EXISTS materiales (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(200) NOT NULL,
  descripcion TEXT,
  id_unidad INTEGER REFERENCES unidades(id),
  id_proveedor INTEGER REFERENCES proveedores(id),
  costo_unitario NUMERIC(12,2),
  id_moneda INTEGER REFERENCES monedas(id),
  imagen VARCHAR(255),
  id_categoria INTEGER REFERENCES categorias(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  categoria VARCHAR(100)
);

CREATE TABLE IF NOT EXISTS material_categoria (
  id SERIAL PRIMARY KEY,
  id_material INTEGER REFERENCES materiales(id),
  id_categoria INTEGER REFERENCES categorias(id),
  UNIQUE(id_material, id_categoria)
);

CREATE TABLE IF NOT EXISTS materiales_proveedores (
  id SERIAL PRIMARY KEY,
  id_material INTEGER REFERENCES materiales(id),
  id_proveedor INTEGER REFERENCES proveedores(id),
  precio_unitario NUMERIC(12,2),
  UNIQUE(id_material, id_proveedor)
);

CREATE TABLE IF NOT EXISTS stock (
  id SERIAL PRIMARY KEY,
  id_material INTEGER REFERENCES materiales(id),
  id_almacen INTEGER REFERENCES almacenes(id),
  cantidad NUMERIC(12,2) DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(id_material, id_almacen)
);

CREATE TABLE IF NOT EXISTS requerimientos (
  id SERIAL PRIMARY KEY,
  numero_requerimiento VARCHAR(50),
  id_usuario INTEGER REFERENCES usuarios(id),
  id_area INTEGER REFERENCES areas(id),
  fecha_requerimiento DATE,
  fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  estado VARCHAR(30) DEFAULT 'PENDIENTE',
  prioridad VARCHAR(20) DEFAULT 'MEDIA',
  comentario TEXT,
  estado_entrega VARCHAR(30),
  nombre_receptor VARCHAR(120),
  dni_receptor VARCHAR(20),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS detalle_requerimiento (
  id SERIAL PRIMARY KEY,
  id_requerimiento INTEGER REFERENCES requerimientos(id),
  id_material INTEGER REFERENCES materiales(id),
  cantidad NUMERIC(12,2),
  observaciones TEXT
);

CREATE TABLE IF NOT EXISTS requerimiento_productos (
  id SERIAL PRIMARY KEY,
  id_requerimiento INTEGER REFERENCES requerimientos(id),
  nombre_producto VARCHAR(255),
  cantidad NUMERIC(12,2),
  comentarios TEXT
);

CREATE TABLE IF NOT EXISTS compras (
  id SERIAL PRIMARY KEY,
  numero_compra VARCHAR(50),
  id_usuario INTEGER REFERENCES usuarios(id),
  id_area_solicitante INTEGER REFERENCES areas(id),
  id_area_final INTEGER REFERENCES areas(id),
  id_usuario_solicita INTEGER REFERENCES usuarios(id),
  id_usuario_aprueba INTEGER REFERENCES usuarios(id),
  id_proveedor INTEGER REFERENCES proveedores(id),
  id_area INTEGER REFERENCES areas(id),
  fecha_solicitud DATE,
  fecha_aprobacion DATE,
  fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  estado VARCHAR(30) DEFAULT 'PENDIENTE',
  proveedor VARCHAR(200),
  ruc VARCHAR(11),
  direccion VARCHAR(255),
  distrito VARCHAR(100),
  correo VARCHAR(100),
  persona_responsable VARCHAR(100),
  telefono VARCHAR(20),
  contacto_proveedor VARCHAR(100),
  banco VARCHAR(100),
  numero_cuenta VARCHAR(50),
  cuenta VARCHAR(50),
  cci VARCHAR(100),
  retencion VARCHAR(10),
  descuento NUMERIC(12,2),
  aplica_retencion BOOLEAN DEFAULT FALSE,
  tipo VARCHAR(20),
  tipo_retencion VARCHAR(20),
  importe_final NUMERIC(12,2),
  condiciones_pago VARCHAR(100),
  monto_total NUMERIC(12,2),
  subtotal NUMERIC(12,2),
  costo_envio NUMERIC(12,2),
  otros_costos NUMERIC(12,2),
  igv NUMERIC(12,2),
  total NUMERIC(12,2),
  moneda VARCHAR(20),
  id_moneda INTEGER REFERENCES monedas(id),
  numero_orden VARCHAR(50),
  comentarios TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS detalle_compras (
  id SERIAL PRIMARY KEY,
  id_compra INTEGER REFERENCES compras(id),
  id_material INTEGER REFERENCES materiales(id),
  nombre_material VARCHAR(255),
  cantidad NUMERIC(12,2),
  precio_unitario NUMERIC(12,2),
  subtotal NUMERIC(12,2),
  id_categoria INTEGER REFERENCES categorias(id),
  comentarios TEXT
);

CREATE TABLE IF NOT EXISTS movimientos (
  id SERIAL PRIMARY KEY,
  id_material INTEGER REFERENCES materiales(id),
  tipo_movimiento VARCHAR(50),
  cantidad NUMERIC(12,2),
  documento_referencia VARCHAR(100),
  id_almacen INTEGER REFERENCES almacenes(id),
  usuario_registro VARCHAR(100),
  fecha_movimiento DATE,
  observaciones TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS movimiento_detalles (
  id SERIAL PRIMARY KEY,
  id_movimiento INTEGER REFERENCES movimientos(id),
  cantidad_entrada NUMERIC(12,2),
  cantidad_salida NUMERIC(12,2),
  saldo NUMERIC(12,2)
);

CREATE TABLE IF NOT EXISTS detalle_movimientos (
  id SERIAL PRIMARY KEY,
  id_movimiento INTEGER REFERENCES movimientos(id),
  id_material INTEGER REFERENCES materiales(id),
  cantidad NUMERIC(12,2),
  tipo VARCHAR(50)
);
`;

async function initDatabase() {
  try {
    console.log('Inicializando base de datos...');
    const client = await pool.connect();
    
    // Ejecutar CREATE TABLE statements
    const statements = createTablesSql.split(';').filter(s => s.trim());
    for (const statement of statements) {
      if (statement.trim()) {
        try {
          await client.query(statement);
        } catch (e) {
          if (!e.message.includes('already exists')) {
            console.error('Error en statement:', statement.substring(0, 50), e.message);
          }
        }
      }
    }

    console.log('✓ Tablas creadas/verificadas');

    // Insertar datos de ejemplo si no existen
    const rolesData = [
      { nombre: 'ADMIN', descripcion: 'Administrador del sistema' },
      { nombre: 'COMPRAS', descripcion: 'Rol de compras' },
      { nombre: 'ALMACENERO', descripcion: 'Rol de almacenero' },
      { nombre: 'SOLICITANTE', descripcion: 'Solicitante de materiales' },
      { nombre: 'JEFE DE AREA/SUBGERENTE', descripcion: 'Jefe de área' },
      { nombre: 'GERENCIA DEL AREA', descripcion: 'Gerencia de área' },
      { nombre: 'GERENCIA DE FINANZAS', descripcion: 'Gerencia de finanzas' },
    ];

    for (const role of rolesData) {
      await client.query(
        'INSERT INTO roles (nombre, descripcion) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [role.nombre, role.descripcion]
      );
    }
    console.log('✓ Roles verificados');

    // Insertar monedas
    const monedasData = [
      { nombre: 'SOLES', simbolo: 'S/' },
      { nombre: 'DÓLARES', simbolo: '$' },
      { nombre: 'EUROS', simbolo: '€' },
    ];

    for (const moneda of monedasData) {
      await client.query(
        'INSERT INTO monedas (nombre, simbolo) VALUES ($1, $2) ON CONFLICT (nombre) DO NOTHING',
        [moneda.nombre, moneda.simbolo]
      );
    }
    console.log('✓ Monedas verificadas');

    // Insertar unidades
    const unidadesData = ['UND', 'KG', 'LT', 'M', 'M2', 'CAJA', 'PACK'];
    for (const unidad of unidadesData) {
      await client.query(
        'INSERT INTO unidades (nombre) VALUES ($1) ON CONFLICT (nombre) DO NOTHING',
        [unidad]
      );
    }
    console.log('✓ Unidades verificadas');

    // Insertar áreas
    const areasData = [
      { nombre: 'ADMINISTRACIÓN', descripcion: 'Área administrativa' },
      { nombre: 'OPERACIONES', descripcion: 'Área de operaciones' },
      { nombre: 'VENTAS', descripcion: 'Área de ventas' },
      { nombre: 'ALMACÉN', descripcion: 'Área de almacén' },
    ];

    for (const area of areasData) {
      await client.query(
        'INSERT INTO areas (nombre, descripcion) VALUES ($1, $2) ON CONFLICT (nombre) DO NOTHING',
        [area.nombre, area.descripcion]
      );
    }
    console.log('✓ Áreas verificadas');

    // Insertar categorías
    const categoriasData = [
      { nombre: 'ELECTRÓNICA', descripcion: 'Componentes electrónicos' },
      { nombre: 'OFICINA', descripcion: 'Artículos de oficina' },
      { nombre: 'HERRAMIENTAS', descripcion: 'Herramientas' },
      { nombre: 'SEGURIDAD', descripcion: 'Equipos de seguridad' },
    ];

    for (const categoria of categoriasData) {
      await client.query(
        'INSERT INTO categorias (nombre, descripcion) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [categoria.nombre, categoria.descripcion]
      );
    }
    console.log('✓ Categorías verificadas');

    // Insertar usuario administrador si no existe
    const adminRole = await client.query('SELECT id FROM roles WHERE nombre = $1', ['ADMIN']);
    if (adminRole.rows.length > 0) {
      await client.query(
        `INSERT INTO usuarios (email, password_hash, nombre, id_role, estado) 
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (email) DO NOTHING`,
        ['admin@alfosac.pe', 'admin', 'Administrador', adminRole.rows[0].id, 'ACTIVO']
      );
      console.log('✓ Usuario administrador verificado');
    }

    // Insertar almacén por defecto
    await client.query(
      'INSERT INTO almacenes (nombre, ubicacion) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      ['ALMACÉN PRINCIPAL', 'Físico principal']
    );
    console.log('✓ Almacén verificado');

    client.release();
    console.log('\n✓✓✓ Base de datos inicializada correctamente ✓✓✓');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

initDatabase();
