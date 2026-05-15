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

async function checkConstraints() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT constraint_name, constraint_type
      FROM information_schema.table_constraints
      WHERE table_name = 'roles'
    `);
    console.log('Constraints on roles table:');
    console.log(result.rows);

    const uniqueIndexes = await client.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'roles'
    `);
    console.log('\nIndexes on roles table:');
    console.log(uniqueIndexes.rows);

    const columnsInfo = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'roles'
      ORDER BY ordinal_position
    `);
    console.log('\nColumns in roles table:');
    console.log(columnsInfo.rows);
  } finally {
    client.release();
    pool.end();
  }
}

checkConstraints().catch(console.error);
