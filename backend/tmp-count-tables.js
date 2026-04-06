const { Pool } = require('pg');
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});
(async () => {
  const tables = ['materiales','stock','proveedores','requerimientos','monedas','roles','rol_permiso','permisos','almacenes','areas','unidades','material_categoria','categorias','usuarios','detalle_requerimiento','requerimiento_productos','movimientos','movimiento_detalles','detalle_movimientos','detalle_compras','compras'];
  for (const tableName of tables) {
    const result = await pool.query(`select count(*)::int as total from ${tableName}`);
    console.log(`${tableName}=${result.rows[0].total}`);
  }
  await pool.end();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
