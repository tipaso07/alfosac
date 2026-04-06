const { Pool } = require('pg');
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});
(async () => {
  for (const tableName of ['movimientos','movimiento_detalles','detalle_movimientos']) {
    const cols = await pool.query(`select column_name,data_type from information_schema.columns where table_schema='public' and table_name=$1 order by ordinal_position`, [tableName]);
    console.log('TABLE=' + tableName);
    console.log(JSON.stringify(cols.rows, null, 2));
  }
  await pool.end();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
