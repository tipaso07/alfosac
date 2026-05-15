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

async function checkDatabase() {
  const client = await pool.connect();
  try {
    // Check roles
    const rolesResult = await client.query('SELECT id, nombre FROM roles ORDER BY id');
    console.log('Roles:');
    console.log(rolesResult.rows);

    // Check permisos
    const permisosResult = await client.query('SELECT id, nombre FROM permisos ORDER BY id');
    console.log('\nPermissions (Total:', permisosResult.rows.length, '):');
    permisosResult.rows.forEach(p => console.log(`  - ${p.id}: ${p.nombre}`));

    // Check rol_permiso
    const rolPermisoResult = await client.query(`
      SELECT r.nombre as rol_name, p.nombre as permiso_name
      FROM rol_permiso rp
      JOIN roles r ON rp.id_rol = r.id
      JOIN permisos p ON rp.id_permiso = p.id
      ORDER BY r.id, p.id
    `);
    console.log('\nRole-Permission Mappings:');
    const roleMap = {};
    rolPermisoResult.rows.forEach(row => {
      if (!roleMap[row.rol_name]) roleMap[row.rol_name] = [];
      roleMap[row.rol_name].push(row.permiso_name);
    });
    Object.entries(roleMap).forEach(([role, perms]) => {
      console.log(`  ${role}: ${perms.length} permisos`);
      perms.forEach(p => console.log(`    - ${p}`));
    });

    // Check usuarios
    const usuariosResult = await client.query('SELECT id, email, nombre, id_role FROM usuarios');
    console.log('\nUsuarios:');
    usuariosResult.rows.forEach(u => console.log(`  - ${u.email} (role_id: ${u.id_role})`));

    client.release();
    pool.end();
  } catch (err) {
    console.error('Error:', err.message);
    client.release();
    pool.end();
    process.exit(1);
  }
}

checkDatabase();
