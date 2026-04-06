const { Pool } = require('pg');

// Conectar a la BD postgres (la BD por defecto)
const pool = new Pool({
  host: 'localhost',
  port: 5432,
  user: 'postgres',
  password: 'alfosac123456',
  database: 'postgres',
});

async function createDatabase() {
  try {
    console.log('Conectando a PostgreSQL...');
    const client = await pool.connect();
    
    // Verificar si existe la BD objetivo "postgres"
    const result = await client.query(
      "SELECT datname FROM pg_database WHERE datname = 'postgres'"
    );
    
    if (result.rows.length > 0) {
      console.log('✓ Base de datos "postgres" encontrada');
      client.release();
      return;
    }

    console.error('No se encontro la base de datos "postgres". Verifica tu instancia de PostgreSQL.');
    client.release();
    process.exit(1);
    
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

createDatabase();
