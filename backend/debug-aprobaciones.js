const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  password: 'postgres',
  host: 'localhost',
  port: 5432,
  database: 'alfosac',
});

async function debugService23() {
  try {
    console.log('\n=== APROBACIONES PARA SERVICIO 23 ===');
    const aprobResult = await pool.query(
      'SELECT id, referencia_id, rol_aprobador, estado, orden, tipo FROM aprobaciones WHERE tipo = $1 AND referencia_id = $2 ORDER BY orden',
      ['SERVICIO', 23]
    );
    console.log('Aprobaciones encontradas:', aprobResult.rows.length);
    aprobResult.rows.forEach(row => {
      console.log(`  Orden ${row.orden}: rol_aprobador=${row.rol_aprobador}, estado=${row.estado}`);
    });

    console.log('\n=== SERVICIO 23 ===');
    const servicioResult = await pool.query(
      'SELECT id, estado_aprobacion, estado_flujo, dentro_plan FROM servicios WHERE id = $1',
      [23]
    );
    if (servicioResult.rows.length > 0) {
      const svc = servicioResult.rows[0];
      console.log(`  estado_aprobacion: ${svc.estado_aprobacion}`);
      console.log(`  estado_flujo: ${svc.estado_flujo}`);
      console.log(`  dentro_plan: ${svc.dentro_plan}`);
    }

    console.log('\n=== ROLES CONFIG ===');
    const rolesResult = await pool.query(
      'SELECT id, nombre FROM roles ORDER BY id'
    );
    rolesResult.rows.forEach(row => {
      console.log(`  rol_id=${row.id}: ${row.nombre}`);
    });

    console.log('\n=== APROBACIONES CONFIG ===');
    const configResult = await pool.query(
      'SELECT flujo, orden, rol_id FROM aprobaciones_config WHERE activo = TRUE ORDER BY flujo, orden'
    );
    configResult.rows.forEach(row => {
      console.log(`  ${row.flujo} (orden ${row.orden}): rol_id=${row.rol_id}`);
    });

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

debugService23();
