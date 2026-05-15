const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'alfosac',
});

async function testApprovalLogic() {
  try {
    console.log('\n=== TEST: Service 23 Approval Logic ===\n');

    // Get service 23
    console.log('1. Getting service 23...');
    const servicioResult = await pool.query(
      'SELECT id, estado_aprobacion FROM servicios WHERE id = 23'
    );
    const service23 = servicioResult.rows[0];
    console.log(`   id: ${service23?.id}`);
    console.log(`   estado_aprobacion: ${service23?.estado_aprobacion}`);

    // Get aprobaciones for service 23
    console.log('\n2. Getting aprobaciones for service 23...');
    const aprobResult = await pool.query(
      'SELECT orden, rol_aprobador, estado FROM aprobaciones WHERE tipo = $1 AND referencia_id = $2 ORDER BY orden',
      ['SERVICIO', 23]
    );
    console.log(`   Found ${aprobResult.rows.length} aprobaciones:`);
    aprobResult.rows.forEach(row => {
      console.log(`     Orden ${row.orden}: rol_id=${row.rol_aprobador}, estado=${row.estado}`);
    });

    // Get roles
    console.log('\n3. Getting roles...');
    const rolesResult = await pool.query('SELECT id, nombre FROM roles ORDER BY id');
    const rolesMap = {};
    rolesResult.rows.forEach(row => {
      rolesMap[row.id] = row.nombre;
    });
    console.log('   Roles:');
    Object.entries(rolesMap).forEach(([id, name]) => {
      console.log(`     ${id}: ${name}`);
    });

    // Get users with their roles
    console.log('\n4. Getting users and their roles...');
    const usersResult = await pool.query(
      'SELECT id, email, id_role FROM usuarios ORDER BY id'
    );
    console.log('   Users with id_role:');
    usersResult.rows.forEach(row => {
      const roleName = rolesMap[row.id_role] || `Unknown(${row.id_role})`;
      console.log(`     ${row.email}: id_role=${row.id_role} (${roleName})`);
    });

    // Simulate the logic: what happens when finanzas user (role 7) calls /api/servicios
    console.log('\n5. Simulating /api/servicios call for finanzas user (role 7)...');
    const finanzasRoleId = 7;

    // Check if service 23 is actionable for role 7
    const actionableResult = await pool.query(
      `SELECT DISTINCT a.referencia_id FROM aprobaciones a
       WHERE upper(trim(a.tipo)) = 'SERVICIO'
         AND a.rol_aprobador = $1
         AND upper(trim(COALESCE(a.estado, 'PENDIENTE'))) = 'PENDIENTE'
         AND a.referencia_id = 23
         AND NOT EXISTS (
           SELECT 1 FROM aprobaciones prev
           WHERE upper(trim(prev.tipo)) = 'SERVICIO'
             AND prev.referencia_id = a.referencia_id
             AND prev.orden < a.orden
             AND upper(trim(COALESCE(prev.estado, 'PENDIENTE'))) <> 'APROBADO'
         )`,
      [finanzasRoleId]
    );

    if (actionableResult.rows.length > 0) {
      console.log(`   ✓ Service 23 IS actionable for finanzas user (role ${finanzasRoleId})`);
      console.log(`   → puede_aprobar SHOULD BE TRUE`);
    } else {
      console.log(`   ✗ Service 23 is NOT actionable for finanzas user (role ${finanzasRoleId})`);
      console.log(`   → puede_aprobar WILL BE FALSE`);
      
      // Debug: check what's blocking it
      console.log('\n   Debugging why it\'s not actionable:');
      const debugResult = await pool.query(
        `SELECT a.orden, a.rol_aprobador, a.estado FROM aprobaciones a
         WHERE upper(trim(a.tipo)) = 'SERVICIO' AND a.referencia_id = 23
         ORDER BY a.orden`
      );
      debugResult.rows.forEach(row => {
        console.log(`     Orden ${row.orden}: rol=${row.rol_aprobador}, estado=${row.estado}`);
        if (row.rol_aprobador === finanzasRoleId && row.estado === 'PENDIENTE') {
          console.log(`       ^ This is the finanzas stage (PENDIENTE)`);
          // Check for previous stages
          const prevStages = debugResult.rows.filter(r => r.orden < row.orden);
          if (prevStages.length === 0) {
            console.log(`       No previous stages, should be actionable!`);
          } else {
            prevStages.forEach(prev => {
              if (prev.estado !== 'APROBADO') {
                console.log(`       Previous stage (orden ${prev.orden}) not APROBADO: ${prev.estado}`);
              }
            });
          }
        }
      });
    }

    await pool.end();
  } catch (error) {
    console.error('Error:', error.message);
  }
}

testApprovalLogic();
