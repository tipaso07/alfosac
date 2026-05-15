/**
 * Debug script para investigar:
 * 1. Por qué total_servicios está en 0
 * 2. Por qué no hay datos de proveedores top-rated
 */

const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'alfosac_db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

async function debug() {
  try {
    console.log('🔍 DEBUGGING DASHBOARD DATA...\n');

    // 1. Check servicios table
    console.log('📊 1. Counting servicios records...');
    const serviciosResult = await pool.query('SELECT COUNT(*) as total FROM servicios');
    console.log(`   Total servicios: ${serviciosResult.rows[0].total}\n`);

    // 2. Check servicios_por_area with dates
    console.log('📊 2. Servicios por area (últimos 30 días)...');
    const servAreaResult = await pool.query(`
      SELECT 
        COALESCE(a.nombre, 'Sin area') AS area,
        COUNT(*)::int AS total
      FROM servicios s
      LEFT JOIN areas a ON a.id = NULLIF(COALESCE(to_jsonb(s)->>'id_area', to_jsonb(s)->>'area_id', ''), '')::int
      WHERE s.created_at >= NOW() - INTERVAL '30 days'
      GROUP BY COALESCE(a.nombre, 'Sin area')
      ORDER BY COUNT(*) DESC
      LIMIT 10
    `);
    console.log('   Results:');
    if (servAreaResult.rows.length === 0) {
      console.log('   ⚠️ NO RESULTS - Table might be empty or dates are wrong');
    } else {
      servAreaResult.rows.forEach(row => console.log(`     ${row.area}: ${row.total}`));
    }
    console.log();

    // 3. Check proveedores table
    console.log('📊 3. Total proveedores in database...');
    const provResult = await pool.query('SELECT COUNT(*) as total FROM proveedores');
    console.log(`   Total proveedores: ${provResult.rows[0].total}\n`);

    // 4. Check calificaciones_proveedor table
    console.log('📊 4. Total calificaciones_proveedor...');
    const calResult = await pool.query('SELECT COUNT(*) as total FROM calificaciones_proveedor');
    console.log(`   Total calificaciones: ${calResult.rows[0].total}\n`);

    // 5. Top rated proveedores
    console.log('📊 5. Top rated proveedores...');
    const topProvResult = await pool.query(`
      SELECT
        p.id as id_proveedor,
        p.nombre as proveedor,
        COUNT(cp.id)::int as total_calificaciones,
        ROUND(AVG(COALESCE(NULLIF(to_jsonb(cp)->>'puntuacion', '')::numeric, 0)), 2) as promedio_puntuacion
      FROM proveedores p
      LEFT JOIN calificaciones_proveedor cp ON cp.id_proveedor = p.id
      GROUP BY p.id, p.nombre
      HAVING COUNT(cp.id) > 0
      ORDER BY AVG(COALESCE(NULLIF(to_jsonb(cp)->>'puntuacion', '')::numeric, 0)) DESC
      LIMIT 5
    `);
    console.log('   Top 5 Proveedores:');
    if (topProvResult.rows.length === 0) {
      console.log('   ⚠️ NO TOP RATED PROVEEDORES - No calificaciones data');
    } else {
      topProvResult.rows.forEach(row => {
        console.log(`     ${row.proveedor}: ${row.promedio_puntuacion} (${row.total_calificaciones} calificaciones)`);
      });
    }
    console.log();

    // 6. Worst rated proveedores
    console.log('📊 6. Worst rated proveedores...');
    const worstProvResult = await pool.query(`
      SELECT
        p.id as id_proveedor,
        p.nombre as proveedor,
        COUNT(cp.id)::int as total_calificaciones,
        ROUND(AVG(COALESCE(NULLIF(to_jsonb(cp)->>'puntuacion', '')::numeric, 0)), 2) as promedio_puntuacion
      FROM proveedores p
      LEFT JOIN calificaciones_proveedor cp ON cp.id_proveedor = p.id
      GROUP BY p.id, p.nombre
      HAVING COUNT(cp.id) > 0
      ORDER BY AVG(COALESCE(NULLIF(to_jsonb(cp)->>'puntuacion', '')::numeric, 0)) ASC
      LIMIT 5
    `);
    console.log('   Bottom 5 Proveedores:');
    if (worstProvResult.rows.length === 0) {
      console.log('   ⚠️ NO WORST RATED PROVEEDORES');
    } else {
      worstProvResult.rows.forEach(row => {
        console.log(`     ${row.proveedor}: ${row.promedio_puntuacion} (${row.total_calificaciones} calificaciones)`);
      });
    }
    console.log();

    // 7. Check compras table (for reference)
    console.log('📊 7. Total compras (for reference)...');
    const comprasResult = await pool.query('SELECT COUNT(*) as total FROM compras');
    console.log(`   Total compras: ${comprasResult.rows[0].total}\n`);

    // 8. Check requerimientos table
    console.log('📊 8. Total requerimientos (for reference)...');
    const reqResult = await pool.query('SELECT COUNT(*) as total FROM requerimientos');
    console.log(`   Total requerimientos: ${reqResult.rows[0].total}\n`);

    console.log('✅ Debug complete');
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    pool.end();
  }
}

debug();
