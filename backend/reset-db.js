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

async function resetDatabase() {
  const client = await pool.connect();
  try {
    // Drop all tables to start fresh
    const tables = [
      'schema_migrations',
      'item_aprobaciones',
      'aprobaciones',
      'compra_items',
      'compras',
      'servicio_items',
      'servicios',
      'usuarios',
      'proveedor_calificaciones',
      'proveedores',
      'productos_inventario',
      'productos',
      'almacenes',
      'rol_permiso',
      'permisos',
      'roles',
      'categorias',
      'unidades',
      'monedas',
      'areas'
    ];

    for (const table of tables) {
      try {
        await client.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
        console.log(`✓ Dropped ${table}`);
      } catch (err) {
        console.log(`- Skipped ${table}:`, err.message);
      }
    }

    console.log('\n✓✓✓ Database reset successfully ✓✓✓');
    pool.end();
  } catch (err) {
    console.error('Error:', err.message);
    pool.end();
    process.exit(1);
  }
}

resetDatabase();
