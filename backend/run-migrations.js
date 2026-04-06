const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '.env') });

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

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      executed_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
}

async function getExecutedMigrations(client) {
  const result = await client.query('SELECT filename FROM schema_migrations');
  return new Set(result.rows.map((row) => String(row.filename || '').trim()).filter(Boolean));
}

function getMigrationFiles() {
  const migrationsDir = path.join(__dirname, 'migrations');
  if (!fs.existsSync(migrationsDir)) return [];

  return fs.readdirSync(migrationsDir)
    .filter((name) => name.toLowerCase().endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));
}

async function applyMigration(client, filename) {
  const filePath = path.join(__dirname, 'migrations', filename);
  const sql = fs.readFileSync(filePath, 'utf8');

  console.log(`Applying migration: ${filename}`);
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
    await client.query('COMMIT');
    console.log(`Applied migration: ${filename}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function runMigrations() {
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);

    const executed = await getExecutedMigrations(client);
    const files = getMigrationFiles();

    const pending = files.filter((file) => !executed.has(file));

    if (pending.length === 0) {
      console.log('No pending migrations.');
      return;
    }

    for (const file of pending) {
      await applyMigration(client, file);
    }

    console.log(`Migrations completed. Applied: ${pending.length}`);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations().catch((error) => {
  console.error('Migration error:', error.message);
  process.exit(1);
});
