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

async function resetContentOnly() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename <> 'schema_migrations'
      ORDER BY tablename
    `);

    const tables = result.rows.map((row) => String(row.tablename || '').trim()).filter(Boolean);

    if (tables.length === 0) {
      console.log('No public tables found to truncate.');
      return;
    }

    await client.query('BEGIN');
    try {
      const quotedTables = tables.map((table) => `"${table.replace(/"/g, '""')}"`).join(', ');
      await client.query(`TRUNCATE TABLE ${quotedTables} RESTART IDENTITY CASCADE`);
      await client.query('COMMIT');
      console.log(`✓ Truncated ${tables.length} tables:`);
      tables.forEach((table) => console.log(`  - ${table}`));
      console.log('\n✓✓✓ Content reset completed successfully ✓✓✓');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('Error resetting database content:', error.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

resetContentOnly();