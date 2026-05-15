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

async function checkDuplicates() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT nombre, COUNT(*) as count
      FROM roles
      GROUP BY nombre
      HAVING COUNT(*) > 1
    `);
    console.log('Duplicate nombres in roles table:');
    console.log(result.rows);

    const allRoles = await client.query('SELECT id, nombre FROM roles ORDER BY id');
    console.log('\nAll roles:');
    console.log(allRoles.rows);
  } finally {
    client.release();
    pool.end();
  }
}

checkDuplicates().catch(console.error);
