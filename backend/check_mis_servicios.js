const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });
const { Pool } = require('pg');

(async () => {
  const configuredDbHost = process.env.DB_HOST || 'localhost';
  const effectiveDbHost = configuredDbHost === 'postgres' && process.platform === 'win32' ? 'localhost' : configuredDbHost;
  const pool = new Pool({
    host: effectiveDbHost,
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'postgres',
  });

  try {
    const q = `
      SELECT
        s.id,
        COALESCE(NULLIF(to_jsonb(s)->>'id_usuario', ''), NULLIF(to_jsonb(s)->>'usuario_id','')) AS id_usuario,
        upper(trim(COALESCE(to_jsonb(s)->>'estado_aprobacion', to_jsonb(s)->>'estado', ''))) AS estado_aprobacion,
        NULLIF(COALESCE(to_jsonb(s)->>'estado_flujo', to_jsonb(s)->>'estado_servicio', to_jsonb(s)->>'estado_flujo'), '') AS estado_flujo,
        NULLIF(COALESCE(to_jsonb(s)->>'proveedor_id', to_jsonb(s)->>'id_proveedor', ''), '')::int AS proveedor_id,
        NULLIF(COALESCE(to_jsonb(s)->>'subtotal', ''), '')::numeric AS subtotal,
        NULLIF(COALESCE(to_jsonb(s)->>'total', ''), '')::numeric AS total,
        to_jsonb(s) AS raw
      FROM servicios s
      ORDER BY s.id DESC
      LIMIT 20
    `;

    const res = await pool.query(q);
    const simplified = res.rows.map(r => ({
      id: r.id,
      id_usuario: r.id_usuario,
      estado_aprobacion: r.estado_aprobacion,
      estado_flujo: r.estado_flujo,
      proveedor_id: r.proveedor_id,
      subtotal: r.subtotal != null ? Number(r.subtotal) : null,
      total: r.total != null ? Number(r.total) : null,
    }));

    console.log(JSON.stringify({ ok: true, rows: simplified }, null, 2));
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: String(err.message || err) }, null, 2));
    process.exit(1);
  } finally {
    try { await pool.end(); } catch (_) {}
  }
})();
