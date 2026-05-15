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

async function cleanSpecificData() {
  const client = await pool.connect();
  try {
    console.log('\n🔄 Iniciando limpieza selectiva de datos...\n');
    
    await client.query('BEGIN');

    // 1. Limpiar detalles de movimientos
    console.log('  Limpiando detalle_movimientos...');
    await client.query('DELETE FROM detalle_movimientos');

    // 2. Limpiar movimiento_detalles
    console.log('  Limpiando movimiento_detalles...');
    await client.query('DELETE FROM movimiento_detalles');

    // 3. Limpiar movimientos
    console.log('  Limpiando movimientos...');
    await client.query('DELETE FROM movimientos');

    // 4. Limpiar detalle_requerimiento
    console.log('  Limpiando detalle_requerimiento...');
    await client.query('DELETE FROM detalle_requerimiento');

    // 5. Limpiar requerimiento_productos
    console.log('  Limpiando requerimiento_productos...');
    await client.query('DELETE FROM requerimiento_productos');

    // 6. Limpiar requerimientos
    console.log('  Limpiando requerimientos...');
    await client.query('DELETE FROM requerimientos');

    // 7. Limpiar detalle_compras
    console.log('  Limpiando detalle_compras...');
    await client.query('DELETE FROM detalle_compras');

    // 8. Limpiar compras (órdenes de compra)
    console.log('  Limpiando compras...');
    await client.query('DELETE FROM compras');

    // 9. Limpiar aprobaciones relacionadas con compras, servicios y requerimientos
    console.log('  Limpiando aprobaciones (compras, servicios, requerimientos)...');
    await client.query(
      "DELETE FROM aprobaciones WHERE tipo IN ('COMPRA', 'SERVICIO', 'REQUERIMIENTO')"
    );

    // 10. Limpiar servicios (órdenes de servicio)
    console.log('  Limpiando servicios...');
    await client.query('DELETE FROM servicios');

    // 11. Limpiar calificaciones de proveedores
    console.log('  Limpiando calificaciones_proveedor...');
    await client.query('DELETE FROM calificaciones_proveedor');

    // 12. Limpiar notificaciones
    console.log('  Limpiando notificaciones...');
    await client.query('DELETE FROM notificaciones');

    // 13. Limpiar materiales_proveedores (relación)
    console.log('  Limpiando materiales_proveedores...');
    await client.query('DELETE FROM materiales_proveedores');

    // 14. Limpiar stock
    console.log('  Limpiando stock...');
    await client.query('DELETE FROM stock');

    // 15. Limpiar material_categoria (relación)
    console.log('  Limpiando material_categoria...');
    await client.query('DELETE FROM material_categoria');

    // 16. Limpiar materiales
    console.log('  Limpiando materiales...');
    await client.query('DELETE FROM materiales');

    // 17. Limpiar proveedores
    console.log('  Limpiando proveedores...');
    await client.query('DELETE FROM proveedores');

    await client.query('COMMIT');

    console.log('\n✅ Limpieza completada exitosamente!\n');
    console.log('📋 Datos eliminados de:');
    console.log('   • Movimientos y detalles');
    console.log('   • Requerimientos y detalles');
    console.log('   • Compras y detalles');
    console.log('   • Servicios y aprobaciones relacionadas');
    console.log('   • Materiales, proveedores y sus relaciones');
    console.log('   • Calificaciones y notificaciones');
    console.log('\n✨ Tablas de usuarios, roles, permisos, áreas, categorías y más INTACTAS\n');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('\n❌ Error durante la limpieza:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

cleanSpecificData();
