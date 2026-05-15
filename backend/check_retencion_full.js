const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env"), override: true });
const { Pool } = require("pg");

(async () => {
  const configuredDbHost = process.env.DB_HOST || "localhost";
  const effectiveDbHost = configuredDbHost === "postgres" && process.platform === "win32" ? "localhost" : configuredDbHost;

  const pool = new Pool({
    host: effectiveDbHost,
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || "postgres",
  });

  try {
    const query = `
      WITH data AS (
        SELECT
          s.id,
          NULLIF(COALESCE(to_jsonb(s)->>'subtotal', ''), '')::numeric AS subtotal,
          NULLIF(COALESCE(to_jsonb(s)->>'igv', to_jsonb(s)->>'impuestos', ''), '')::numeric AS igv,
          NULLIF(COALESCE(to_jsonb(s)->>'costo_envio', ''), '')::numeric AS costo_envio,
          NULLIF(COALESCE(to_jsonb(s)->>'otros_costos', ''), '')::numeric AS otros_costos,
          NULLIF(COALESCE(to_jsonb(s)->>'total', ''), '')::numeric AS total,
          CASE
            WHEN upper(trim(COALESCE(to_jsonb(s)->>'aplica_retencion', ''))) IN ('TRUE', 'T', '1', 'SI', 'YES') THEN TRUE
            ELSE FALSE
          END AS aplica_retencion_guardada,
          NULLIF(COALESCE(to_jsonb(s)->>'retencion', to_jsonb(s)->>'descuento', ''), '')::numeric AS retencion_guardada_pct,
          COALESCE(upper(trim(COALESCE(to_jsonb(p)->>'retencion', 'NO'))), 'NO') AS proveedor_retencion_flag,
          COALESCE(NULLIF(COALESCE(to_jsonb(p)->>'descuento', ''), '')::numeric, 0) AS proveedor_retencion_pct,
          COALESCE(mo.nombre, '') AS moneda_proveedor,
          (COALESCE(NULLIF(COALESCE(to_jsonb(s)->>'subtotal', ''), '')::numeric, 0)
            + COALESCE(NULLIF(COALESCE(to_jsonb(s)->>'igv', to_jsonb(s)->>'impuestos', ''), '')::numeric, 0)
            + COALESCE(NULLIF(COALESCE(to_jsonb(s)->>'costo_envio', ''), '')::numeric, 0)
            + COALESCE(NULLIF(COALESCE(to_jsonb(s)->>'otros_costos', ''), '')::numeric, 0)
          )::numeric AS total_base,
          CASE
            WHEN COALESCE(upper(trim(COALESCE(to_jsonb(p)->>'retencion', 'NO'))), 'NO') = 'SI'
              AND COALESCE(NULLIF(COALESCE(to_jsonb(p)->>'descuento', ''), '')::numeric, 0) > 0
              AND (
                (
                  (COALESCE(NULLIF(COALESCE(to_jsonb(s)->>'subtotal', ''), '')::numeric, 0)
                  + COALESCE(NULLIF(COALESCE(to_jsonb(s)->>'igv', to_jsonb(s)->>'impuestos', ''), '')::numeric, 0)
                  + COALESCE(NULLIF(COALESCE(to_jsonb(s)->>'costo_envio', ''), '')::numeric, 0)
                  + COALESCE(NULLIF(COALESCE(to_jsonb(s)->>'otros_costos', ''), '')::numeric, 0)) > 700
                  AND (upper(COALESCE(mo.nombre, 'PEN')) LIKE '%PEN%' OR upper(COALESCE(mo.nombre, 'PEN')) LIKE '%SOL%')
                )
                OR (
                  (COALESCE(NULLIF(COALESCE(to_jsonb(s)->>'subtotal', ''), '')::numeric, 0)
                  + COALESCE(NULLIF(COALESCE(to_jsonb(s)->>'igv', to_jsonb(s)->>'impuestos', ''), '')::numeric, 0)
                  + COALESCE(NULLIF(COALESCE(to_jsonb(s)->>'costo_envio', ''), '')::numeric, 0)
                  + COALESCE(NULLIF(COALESCE(to_jsonb(s)->>'otros_costos', ''), '')::numeric, 0)) * 3.5 > 700
                  AND (upper(COALESCE(mo.nombre, '')) LIKE '%USD%' OR upper(COALESCE(mo.nombre, '')) LIKE '%DOLAR%')
                )
              )
            THEN TRUE
            ELSE FALSE
          END AS should_apply_by_rules
        FROM servicios s
        LEFT JOIN proveedores p ON p.id = NULLIF(COALESCE(to_jsonb(s)->>'proveedor_id', to_jsonb(s)->>'id_proveedor', ''), '')::int
        LEFT JOIN monedas mo ON mo.id = NULLIF(COALESCE(to_jsonb(p)->>'id_moneda', ''), '')::int
        ORDER BY s.id DESC
        
      )
      SELECT * FROM data;
    `;

    const res = await pool.query(query);
    const mismatches = res.rows.filter(r => r.should_apply_by_rules === true && r.aplica_retencion_guardada === false);

    console.log("--- REPORTE ÚLTIMOS 50 SERVICIOS ---");
    console.table(res.rows);
    
    console.log("\n--- MISMATCHES (should_apply=true AND aplica_retencion=false) ---");
    if (mismatches.length > 0) {
      console.table(mismatches);
    } else {
      console.log("No se encontraron mismatches.");
    }

  } catch (err) {
    console.error("Error:", err.message);
  } finally {
    await pool.end();
  }
})();
