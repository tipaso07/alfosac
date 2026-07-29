const { PET_SQL_NOW } = require('../utils/datetime');

module.exports = function(app, deps) {
  const { pool, authMiddleware, requireCompras } = deps;

  app.get('/api/stats', authMiddleware, async (req, res) => {
    try {
      const [matStats, reqStats] = await Promise.all([
        pool.query(
          `
            SELECT
              COUNT(*) AS total_materiales,
              COALESCE(SUM(cantidad), 0) AS stock_total
            FROM stock
          `
        ),
        pool.query(
          `
            SELECT
              COUNT(*) AS total_requerimientos,
              COUNT(CASE WHEN upper(trim(COALESCE(estado_entrega, ''))) = 'POR_RECOGER' THEN 1 END) AS pendientes,
              0 AS aprobados,
              0 AS rechazados,
              COUNT(CASE WHEN upper(trim(COALESCE(estado_entrega, ''))) = 'ENTREGADO' THEN 1 END) AS completados
            FROM requerimientos
          `
        ),
      ]);

      res.json({
        ...matStats.rows[0],
        ...reqStats.rows[0],
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/admin-dashboard', authMiddleware, async (req, res) => {
    const roleId = Number(req.user?.id_role || 0);
    const areaId = Number(req.user?.id_area || 0);
    const isCompras = roleId === 2;
    const isGerenteAuthorized = roleId === 1 && [1, 3].includes(areaId);
    if (!isCompras && !isGerenteAuthorized) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    try {
      const fechaInicioRaw = String(req.query?.fecha_inicio || '').trim();
      const fechaFinRaw = String(req.query?.fecha_fin || '').trim();
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

      const fechaInicio = fechaInicioRaw ? (dateRegex.test(fechaInicioRaw) ? fechaInicioRaw : null) : null;
      const fechaFin = fechaFinRaw ? (dateRegex.test(fechaFinRaw) ? fechaFinRaw : null) : null;

      if (fechaInicioRaw && !fechaInicio) {
        return res.status(400).json({ error: 'fecha_inicio invalida. Usa formato YYYY-MM-DD' });
      }
      if (fechaFinRaw && !fechaFin) {
        return res.status(400).json({ error: 'fecha_fin invalida. Usa formato YYYY-MM-DD' });
      }
      if (fechaInicio && fechaFin && fechaInicio > fechaFin) {
        return res.status(400).json({ error: 'fecha_inicio no puede ser mayor que fecha_fin' });
      }

      const hasRangeFilter = Boolean(fechaInicio || fechaFin);
      let areaIds = null;

      if (hasRangeFilter) {
        const areasResult = await pool.query(
          `
            WITH movimientos_filtrados AS (
              SELECT
                NULLIF(
                  COALESCE(
                    NULLIF(to_jsonb(m)->>'id_requerimiento', ''),
                    NULLIF(to_jsonb(m)->>'requerimiento_id', ''),
                    ''
                  ),
                  ''
                )::int AS id_requerimiento,
                CASE
                  WHEN COALESCE(
                    NULLIF(to_jsonb(m)->>'usuario_registro', ''),
                    NULLIF(to_jsonb(m)->>'id_usuario', ''),
                    NULLIF(to_jsonb(m)->>'usuario_id', '')
                  ) ~ '^\\d+$'
                    THEN COALESCE(
                      NULLIF(to_jsonb(m)->>'usuario_registro', ''),
                      NULLIF(to_jsonb(m)->>'id_usuario', ''),
                      NULLIF(to_jsonb(m)->>'usuario_id', '')
                    )::int
                  ELSE NULL
                END AS usuario_id,
                COALESCE(
                  NULLIF(to_jsonb(m)->>'fecha_movimiento', '')::timestamp,
                  NULLIF(to_jsonb(m)->>'fecha', '')::timestamp,
                  ${PET_SQL_NOW}
                )::date AS fecha_mov
              FROM movimientos m
            ),
            areas_activas AS (
              SELECT DISTINCT
                COALESCE(
                  NULLIF(to_jsonb(r)->>'id_area', '')::int,
                  ur.id_area,
                  um.id_area
                ) AS area_id
              FROM movimientos_filtrados mf
              LEFT JOIN requerimientos r ON r.id = mf.id_requerimiento
              LEFT JOIN usuarios ur ON ur.id = NULLIF(to_jsonb(r)->>'id_usuario', '')::int
              LEFT JOIN usuarios um ON um.id = mf.usuario_id
              WHERE ($1::date IS NULL OR mf.fecha_mov >= $1::date)
                AND ($2::date IS NULL OR mf.fecha_mov <= $2::date)
              
              UNION
              
              SELECT DISTINCT
                COALESCE(NULLIF(to_jsonb(c)->>'id_area_final', '')::int, NULLIF(to_jsonb(c)->>'id_area_solicitante', '')::int) AS area_id
              FROM compras c
              WHERE ($1::date IS NULL OR COALESCE(NULLIF(to_jsonb(c)->>'fecha_creacion', '')::date, NULLIF(to_jsonb(c)->>'created_at', '')::date) >= $1::date)
                AND ($2::date IS NULL OR COALESCE(NULLIF(to_jsonb(c)->>'fecha_creacion', '')::date, NULLIF(to_jsonb(c)->>'created_at', '')::date) <= $2::date)
              
              UNION
              
              SELECT DISTINCT
                NULLIF(COALESCE(to_jsonb(s)->>'id_area', to_jsonb(s)->>'area_id', ''), '')::int AS area_id
              FROM servicios s
              
              UNION
              
              SELECT DISTINCT
                NULLIF(to_jsonb(cd)->>'id_area', '')::int AS area_id
              FROM compras_directas cd
              WHERE ($1::date IS NULL OR COALESCE(NULLIF(to_jsonb(cd)->>'fecha_creacion', '')::date, NULLIF(to_jsonb(cd)->>'created_at', '')::date) >= $1::date)
                AND ($2::date IS NULL OR COALESCE(NULLIF(to_jsonb(cd)->>'fecha_creacion', '')::date, NULLIF(to_jsonb(cd)->>'created_at', '')::date) <= $2::date)
            )
            SELECT area_id
            FROM areas_activas
            WHERE area_id IS NOT NULL
          `,
          [fechaInicio, fechaFin]
        );

        areaIds = [...new Set(areasResult.rows.map((row) => Number(row.area_id || 0)).filter((id) => id > 0))];

        if (areaIds.length === 0) {
          return res.json({
            filtro_fechas: {
              fecha_inicio: fechaInicio || '',
              fecha_fin: fechaFin || '',
            },
            resumen: {
              total_compras: 0,
              total_requerimientos: 0,
              total_servicios: 0,
              monto_total_compras: 0,
              monto_total_restock: 0,
        monto_total_requerimientos: Number(reqRes.rows.reduce((s, r) => s + Number(r.monto_total || 0), 0).toFixed(2)),
              monto_total_servicios: 0,
              monto_total_consumo: 0,
              total_entradas_movimientos: 0,
              total_salidas_movimientos: 0,
              total_compras_pendientes: 0,
              total_compras_aprobadas: 0,
              total_compras_por_recibir: 0,
              total_compras_por_entregar: 0,
              total_compras_entregadas: 0,
              total_servicios_pendientes: 0,
              total_servicios_realizados: 0,
            },
            compras_por_area: [],
            requerimientos_por_area: [],
            servicios_por_area: [],
            materiales_mas_utilizados: [],
            distribucion_salida_por_area: [],
            gasto_salida_por_area: [],
            cantidad_materiales_recibidos_por_area: [],
            total_compras_directas: 0,
            monto_total_compras_directas: 0,
            compras_directas_por_area: [],
          });
        }
      }

      const dateCond = (col) => {
        if (!fechaInicio && !fechaFin) return 'TRUE';
        const parts = [];
        if (fechaInicio) parts.push(`${col} >= '${fechaInicio}'::date`);
        if (fechaFin) parts.push(`${col} <= '${fechaFin}'::date`);
        return parts.join(' AND ');
      };

      const areaFilter = areaIds && areaIds.length > 0;
      const comprasAreaFilter = areaFilter ? `AND COALESCE(c.id_area_final, c.id_area_solicitante) = ANY($1::int[])` : '';
      const servAreaFilter = areaFilter ? `AND s.area_id = ANY($1::int[])` : '';
      const cdAreaFilter = areaFilter ? `AND cd.id_area = ANY($1::int[])` : '';
      const reqAreaFilter = areaFilter ? `AND u.id_area = ANY($1::int[])` : '';
      const mvAreaFilter = areaFilter ? `AND u2.id_area = ANY($1::int[])` : '';

      const [comprasRes, servRes, reqRes, cdRes, mvRes, matRes, califRes] = await Promise.all([
        pool.query(`
          SELECT
            COALESCE(a.nombre, 'Sin area') AS area,
            COUNT(*)::int AS total,
            COALESCE(c.id_area_final, c.id_area_solicitante) = 6 AS es_restock,
            COALESCE(SUM(
              CASE
                WHEN upper(trim(COALESCE(c.moneda, ''))) IN ('DOLARES','DOLAR','USD','US$') OR c.id_moneda = 2
                  THEN COALESCE(c.importe_final, c.total,
                    (COALESCE(c.subtotal,0)+COALESCE(c.igv,0)+COALESCE(c.costo_envio,0)+COALESCE(c.otros_costos,0))
                  ) * COALESCE(NULLIF(c.tipo_cambio, 0), 3.4)
                ELSE COALESCE(c.importe_final, c.total,
                  (COALESCE(c.subtotal,0)+COALESCE(c.igv,0)+COALESCE(c.costo_envio,0)+COALESCE(c.otros_costos,0))
                )
              END
            )::numeric, 0)::numeric AS monto_total,
            COUNT(*) FILTER (WHERE upper(trim(c.estado_pedido)) = 'PENDIENTE')::int AS pendientes,
            COUNT(*) FILTER (WHERE upper(trim(c.estado)) = 'APROBADA' OR upper(trim(c.estado_pedido)) = 'APROBADO')::int AS aprobadas,
            COUNT(*) FILTER (WHERE upper(trim(c.estado_pedido)) = 'POR_RECIBIR')::int AS por_recibir,
            COUNT(*) FILTER (WHERE upper(trim(c.estado_pedido)) = 'POR_ENTREGAR')::int AS por_entregar,
            COUNT(*) FILTER (WHERE upper(trim(c.estado_pedido)) = 'ENTREGADO' OR upper(trim(c.estado)) = 'ENTREGADO')::int AS entregadas
          FROM compras c
          LEFT JOIN areas a ON a.id = COALESCE(c.id_area_final, c.id_area_solicitante)
          WHERE ${dateCond('COALESCE(c.fecha_creacion::date, c.created_at::date)', 'c')}
          ${comprasAreaFilter}
          AND (upper(trim(c.estado_pedido)) IN ('POR_RECIBIR', 'POR_ENTREGAR', 'ENTREGADO') OR upper(trim(c.estado)) = 'ENTREGADO')
          GROUP BY a.nombre, COALESCE(c.id_area_final, c.id_area_solicitante)
          ORDER BY monto_total DESC
        `, areaFilter ? [areaIds] : []),

        pool.query(`
          SELECT
            COALESCE(a.nombre, 'Sin area') AS area,
            COUNT(*)::int AS total,
            COALESCE(SUM(
              CASE
                WHEN s.moneda_id = 2 THEN COALESCE(s.total, 0) * COALESCE(NULLIF(s.tipo_cambio, 0), 3.4)
                ELSE COALESCE(s.total, 0)
              END
            )::numeric, 0)::numeric AS monto_total,
            COUNT(*) FILTER (WHERE upper(trim(COALESCE(s.estado_flujo, s.estado_servicio, ''))) = 'PENDIENTE')::int AS pendientes,
            COUNT(*) FILTER (WHERE upper(trim(COALESCE(s.estado_flujo, s.estado_servicio, ''))) IN ('REALIZADO', 'COMPLETADO', 'APROBADO'))::int AS realizados
          FROM servicios s
          LEFT JOIN areas a ON a.id = s.area_id
          WHERE ${dateCond('COALESCE(s.fecha::date, s.created_at::date)', 's')}
          ${servAreaFilter}
          AND upper(trim(COALESCE(s.estado_flujo, s.estado_servicio, ''))) IN ('PENDIENTE', 'REALIZADO', 'COMPLETADO', 'APROBADO')
          GROUP BY a.nombre
          ORDER BY monto_total DESC
        `, areaFilter ? [areaIds] : []),

        pool.query(`
          SELECT
            COALESCE(a.nombre, 'Sin area') AS area,
            COUNT(DISTINCT r.id)::int AS total,
            COALESCE(SUM(
              CASE
                WHEN mo.id = 2 THEN COALESCE(dr.cantidad, 0) * COALESCE(m.costo_unitario, 0) * 1.18 * 3.4
                ELSE COALESCE(dr.cantidad, 0) * COALESCE(m.costo_unitario, 0) * 1.18
              END
            ), 0)::numeric AS monto_total,
            COUNT(DISTINCT r.id) FILTER (WHERE upper(trim(r.estado_entrega)) = 'POR_RECOGER')::int AS pendientes,
            COUNT(DISTINCT r.id) FILTER (WHERE upper(trim(r.estado_entrega)) = 'ENTREGADO')::int AS completados
          FROM requerimientos r
          LEFT JOIN usuarios u ON u.id = r.id_usuario
          LEFT JOIN areas a ON a.id = u.id_area
          LEFT JOIN detalle_requerimiento dr ON dr.id_requerimiento = r.id
          LEFT JOIN materiales m ON m.id = dr.id_material
          LEFT JOIN monedas mo ON mo.id = m.id_moneda
          WHERE ${dateCond('r.fecha_creacion::date', 'r')}
          ${reqAreaFilter}
          GROUP BY a.nombre
          ORDER BY total DESC
        `, areaFilter ? [areaIds] : []),

        pool.query(`
          SELECT
            COALESCE(a.nombre, 'Sin area') AS area,
            COUNT(*)::int AS total,
            COALESCE(SUM(
              CASE
                WHEN cd.id_moneda = 2 THEN COALESCE(cd.total, 0) * 3.4
                ELSE COALESCE(cd.total, 0)
              END
            )::numeric, 0)::numeric AS monto_total
          FROM compras_directas cd
          LEFT JOIN areas a ON a.id = cd.id_area
          WHERE ${dateCond('COALESCE(cd.fecha_compra::date, cd.created_at::date)', 'cd')}
          ${cdAreaFilter}
          GROUP BY a.nombre
          ORDER BY monto_total DESC
        `, areaFilter ? [areaIds] : []),

        pool.query(`
          SELECT
            COALESCE(a.nombre, 'Sin area') AS area,
            m.tipo,
            COUNT(*)::int AS total
          FROM movimientos m
          LEFT JOIN usuarios u2 ON u2.id = m.id_usuario
          LEFT JOIN areas a ON a.id = u2.id_area
          WHERE ${dateCond('m.fecha::date', 'm')}
          ${mvAreaFilter}
          GROUP BY a.nombre, m.tipo
        `, areaFilter ? [areaIds] : []),

        pool.query(`
          SELECT
            COALESCE(mt.nombre, 'Sin material') AS material,
            COALESCE(SUM(dm.cantidad), 0)::int AS cantidad_total_salida
          FROM detalle_movimientos dm
          INNER JOIN movimientos m ON m.id = dm.id_movimiento
          LEFT JOIN materiales mt ON mt.id = dm.id_material
          LEFT JOIN usuarios u2 ON u2.id = m.id_usuario
          WHERE upper(trim(m.tipo)) = 'SALIDA'
            AND ${dateCond('m.fecha::date', 'm')}
            ${mvAreaFilter}
          GROUP BY mt.nombre
          ORDER BY cantidad_total_salida DESC
          LIMIT 10
        `, areaFilter ? [areaIds] : []),

        pool.query(`
          SELECT
            cp.id_proveedor,
            COALESCE(p.razon_social, p.nombre, 'Proveedor') AS proveedor,
            COUNT(*)::int AS total_calificaciones,
            ROUND(AVG(cp.puntuacion)::numeric, 1) AS promedio_puntuacion
          FROM calificaciones_proveedor cp
          LEFT JOIN proveedores p ON p.id = cp.id_proveedor
          GROUP BY cp.id_proveedor, p.razon_social, p.nombre
          HAVING COUNT(*) > 0
          ORDER BY promedio_puntuacion DESC
          LIMIT 5
        `),
      ]);

      const resumen = {
        total_compras: comprasRes.rows.reduce((s, r) => s + r.total, 0),
        total_requerimientos: reqRes.rows.reduce((s, r) => s + r.total, 0),
        total_servicios: servRes.rows.reduce((s, r) => s + r.total, 0),
        monto_total_compras: Number(comprasRes.rows.filter(r => !r.es_restock).reduce((s, r) => s + Number(r.monto_total || 0), 0).toFixed(2)),
        total_restock_count: comprasRes.rows.filter(r => r.es_restock).reduce((s, r) => s + r.total, 0),
        monto_total_restock: Number(comprasRes.rows.filter(r => r.es_restock).reduce((s, r) => s + Number(r.monto_total || 0), 0).toFixed(2)),
        monto_total_requerimientos: Number(reqRes.rows.reduce((s, r) => s + Number(r.monto_total || 0), 0).toFixed(2)),
        monto_total_servicios: Number(servRes.rows.reduce((s, r) => s + Number(r.monto_total || 0), 0).toFixed(2)),
        monto_total_consumo: 0,
        total_entradas_movimientos: mvRes.rows.filter(r => r.tipo === 'ENTRADA').reduce((s, r) => s + r.total, 0),
        total_salidas_movimientos: mvRes.rows.filter(r => r.tipo === 'SALIDA').reduce((s, r) => s + r.total, 0),
        total_compras_pendientes: comprasRes.rows.reduce((s, r) => s + r.pendientes, 0),
        total_compras_aprobadas: comprasRes.rows.reduce((s, r) => s + r.aprobadas, 0),
        total_compras_por_recibir: comprasRes.rows.reduce((s, r) => s + r.por_recibir, 0),
        total_compras_por_entregar: comprasRes.rows.reduce((s, r) => s + r.por_entregar, 0),
        total_compras_entregadas: comprasRes.rows.reduce((s, r) => s + r.entregadas, 0),
        total_servicios_pendientes: servRes.rows.reduce((s, r) => s + r.pendientes, 0),
        total_servicios_realizados: servRes.rows.reduce((s, r) => s + r.realizados, 0),
        total_compras_directas: cdRes.rows.reduce((s, r) => s + r.total, 0),
        monto_total_compras_directas: Number(cdRes.rows.reduce((s, r) => s + Number(r.monto_total || 0), 0).toFixed(2)),
      };
      resumen.monto_total_consumo = Number((resumen.monto_total_compras + resumen.monto_total_requerimientos + resumen.monto_total_servicios + resumen.monto_total_compras_directas).toFixed(2));

      const gastoSalidaPorArea = mvRes.rows
        .filter(r => r.tipo === 'SALIDA')
        .map(r => ({ area: r.area, total_gastado: r.total }));

      const distribucionSalidaPorArea = mvRes.rows
        .filter(r => r.tipo === 'SALIDA')
        .map(r => ({ area: r.area, total: r.total }));

      res.json({
        filtro_fechas: {
          fecha_inicio: fechaInicio || '',
          fecha_fin: fechaFin || '',
        },
        resumen,
        compras_por_area: comprasRes.rows.map(r => ({ area: r.area, total: r.total, monto_total: Number(r.monto_total || 0) })),
        requerimientos_por_area: reqRes.rows.map(r => ({ area: r.area, total: r.total, monto_total: Number(r.monto_total || 0) })),
        servicios_por_area: servRes.rows.map(r => ({ area: r.area, total: r.total, monto_total: Number(r.monto_total || 0) })),
        materiales_mas_utilizados: matRes.rows.map(r => ({ material: r.material, cantidad_total_salida: r.cantidad_total_salida })),
        distribucion_salida_por_area: distribucionSalidaPorArea,
        gasto_salida_por_area: gastoSalidaPorArea,
        cantidad_materiales_recibidos_por_area: [],
        total_compras_directas: resumen.total_compras_directas,
        monto_total_compras_directas: resumen.monto_total_compras_directas,
        compras_directas_por_area: cdRes.rows.map(r => ({ area: r.area, total: r.total, monto_total: Number(r.monto_total || 0) })),
        proveedores_top_rated: califRes.rows.map(r => ({
          id_proveedor: r.id_proveedor,
          proveedor: r.proveedor,
          total_calificaciones: r.total_calificaciones,
          promedio_puntuacion: Number(r.promedio_puntuacion || 0),
        })),
        proveedores_worst_rated: [],
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
};
