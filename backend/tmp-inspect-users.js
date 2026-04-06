const { Pool } = require('pg');
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});
(async () => {
  const cols = await pool.query("select column_name,data_type from information_schema.columns where table_schema='public' and table_name='usuarios' order by ordinal_position");
  console.log(JSON.stringify(cols.rows, null, 2));
  const sample = await pool.query("select * from usuarios order by id limit 3");
  console.log(JSON.stringify(sample.rows, null, 2));
  await pool.end();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
