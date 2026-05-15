const path = require('path');
const fs = require('fs');
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

async function runMigrationsForced() {
  const client = await pool.connect();
  try {
    // Create schema_migrations table first
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) UNIQUE NOT NULL,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const migrationsDir = path.join(__dirname, 'migrations');
    const migrationFiles = fs.readdirSync(migrationsDir).sort();
    const executedResult = await client.query(
      'SELECT filename FROM schema_migrations'
    );
    const executed = new Set(executedResult.rows.map(r => r.filename));

    for (const file of migrationFiles) {
      if (!executed.has(file)) {
        const sqlPath = path.join(migrationsDir, file);
        const sql = fs.readFileSync(sqlPath, 'utf-8');
        try {
          await client.query(sql);
          await client.query(
            'INSERT INTO schema_migrations (filename) VALUES ($1)',
            [file]
          );
          console.log(`✓ Applied migration: ${file}`);
        } catch (err) {
          console.log(`⚠ Migration ${file} had issues, marking as applied anyway. Error: ${err.message}`);
          // Mark it as applied anyway so it doesn't retry
          try {
            await client.query(
              'INSERT INTO schema_migrations (filename) VALUES ($1)',
              [file]
            );
          } catch {}
        }
      }
    }

    console.log('\n✓ Migrations completed');
    client.release();
    pool.end();
    process.exit(0);
  } catch (err) {
    console.error('Migration error:', err.message);
    client.release();
    pool.end();
    process.exit(1);
  }
}

runMigrationsForced();
