const path = require('path');
const { execFileSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });

const configuredDbHost = process.env.DB_HOST || 'localhost';
const effectiveDbHost = configuredDbHost === 'postgres' && process.platform === 'win32'
  ? 'localhost'
  : configuredDbHost;

const dbHost = effectiveDbHost;
const dbPort = String(process.env.DB_PORT || 5432);
const dbUser = process.env.DB_USER || 'postgres';
const dbPassword = String(process.env.DB_PASSWORD || '');
const dbName = process.env.DB_NAME || 'postgres';
const backupFile = path.resolve(__dirname, '..', 'backups', 'FirstBackup.sql');

console.log(`Restoring database from backup: ${backupFile}`);
console.log(`DB host=${dbHost} port=${dbPort} user=${dbUser} database=${dbName}`);

const env = {
  ...process.env,
  PGPASSWORD: dbPassword,
  PGHOST: dbHost,
  PGPORT: dbPort,
};

const maintenanceDb = dbName === 'postgres' ? 'template1' : 'postgres';

const resetDatabase = () => {
  console.log(`Resetting database ${dbName} using maintenance DB ${maintenanceDb}`);
  execFileSync('psql', [
    '-U', dbUser,
    '-d', maintenanceDb,
    '-c', `DROP DATABASE IF EXISTS \"${dbName}\"; CREATE DATABASE \"${dbName}\";`,
  ], {
    stdio: 'inherit',
    env,
  });
};

const args = [
  '-U', dbUser,
  '--no-owner',
  '--no-privileges',
  '--clean',
  '--if-exists',
  '-d',
  dbName,
  backupFile,
];

try {
  resetDatabase();
  execFileSync('pg_restore', args, {
    stdio: 'inherit',
    env,
  });
  console.log('Database restored successfully from backup.');
} catch (error) {
  console.error('Failed to restore database from backup:', error.message);
  process.exit(1);
}
