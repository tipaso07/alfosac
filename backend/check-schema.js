const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'alfosac',
});

async function checkSchema() {
  try {
    // Get usuarios table columns
    const columnResult = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'usuarios'
      ORDER BY ordinal_position
    `);
    
    console.log('\n=== USUARIOS TABLE COLUMNS ===');
    columnResult.rows.forEach(col => {
      console.log(`  ${col.column_name}: ${col.data_type}`);
    });
    
    // Get first user
    const userResult = await pool.query(`
      SELECT *
      FROM usuarios
      WHERE email = 'admin@alfosac.pe'
      LIMIT 1
    `);
    
    console.log('\n=== ADMIN USER DATA ===');
    if (userResult.rows.length > 0) {
      const user = userResult.rows[0];
      console.log(JSON.stringify(user, null, 2));
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

checkSchema();
