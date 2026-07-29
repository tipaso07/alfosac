const { normalize } = require('../utils/normalize');
const { insertMovimiento } = require('../db/pool');
const { formatPetDateTime } = require('../utils/datetime');

module.exports = function(app, deps) {
  const { pool, authMiddleware, requireRoles } = deps;

  app.post('/api/movimientos', authMiddleware, requireRoles('GERENTES', 'ALMACENERO'), async (req, res) => {
    let client;

    try {
      client = await pool.connect();
      const { tipo, id_almacen, items } = req.body;
      const tipoNorm = normalize(tipo);

      if (!['ENTRADA', 'SALIDA'].includes(tipoNorm)) {
        return res.status(400).json({ error: 'tipo debe ser ENTRADA o SALIDA' });
      }

      if (!id_almacen) {
        return res.status(400).json({ error: 'id_almacen es obligatorio' });
      }

      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Debe enviar items de movimiento' });
      }

      await client.query('BEGIN');

      const idMovimiento = await insertMovimiento(client, {
        tipo: tipoNorm,
        usuarioRegistro: req.user.id,
      });

      for (const item of items) {
        if (!item.id_material || !item.cantidad || Number(item.cantidad) <= 0) {
          throw new Error('Item de movimiento invalido');
        }

        await client.query(
          `
            INSERT INTO movimiento_detalles (id_movimiento, id_material, cantidad)
            VALUES ($1, $2, $3)
          `,
          [idMovimiento, item.id_material, Number(item.cantidad)]
        );

        const qty = Number(item.cantidad);
        const stockRow = await client.query(
          'SELECT id, cantidad FROM stock WHERE id_material = $1 AND id_almacen = $2 FOR UPDATE',
          [item.id_material, id_almacen]
        );

        if (tipoNorm === 'ENTRADA') {
          if (stockRow.rows.length === 0) {
            await client.query(
              'INSERT INTO stock (id_material, id_almacen, cantidad) VALUES ($1, $2, $3)',
              [item.id_material, id_almacen, qty]
            );
          } else {
            await client.query('UPDATE stock SET cantidad = cantidad + $1 WHERE id = $2', [qty, stockRow.rows[0].id]);
          }
        } else {
          if (stockRow.rows.length === 0 || Number(stockRow.rows[0].cantidad) < qty) {
            throw new Error(`Stock insuficiente para material ${item.id_material} en almacen ${id_almacen}`);
          }
          await client.query('UPDATE stock SET cantidad = cantidad - $1 WHERE id = $2', [qty, stockRow.rows[0].id]);
        }
      }
      await client.query('COMMIT');

      res.status(201).json({ id_movimiento: idMovimiento, tipo: tipoNorm });
    } catch (error) {
      if (client) await client.query('ROLLBACK');
      res.status(500).json({ error: error.message });
    } finally {
      if (client) client.release();
    }
  });

  app.get('/api/movimientos', authMiddleware, async (req, res) => {
    try {
      const userId = Number(req.user?.id || 0);
      const result = await pool.query(
        `
          WITH movimientos_base AS (
            SELECT
              m.id,
              COALESCE(
                NULLIF(to_jsonb(m)->>'tipo_movimiento', ''),
                NULLIF(to_jsonb(m)->>'tipo', ''),
                'N/D'
              ) AS tipo,
              NULLIF(COALESCE(NULLIF(to_jsonb(m)->>'id_almacen', ''), NULLIF(to_jsonb(m)->>'almacen_id', ''), ''), '')::int AS id_almacen,
              (m.fecha AT TIME ZONE 'America/Lima') AS fecha,
              COALESCE(
                NULLIF(to_jsonb(m)->>'usuario_registro', ''),
                NULLIF(to_jsonb(m)->>'id_usuario', ''),
                NULLIF(to_jsonb(m)->>'usuario_id', ''),
                ''
              ) AS usuario_ref,
              NULLIF(
                COALESCE(
                  NULLIF(to_jsonb(m)->>'id_requerimiento', ''),
                  NULLIF(to_jsonb(m)->>'requerimiento_id', ''),
                  ''
                ),
                ''
              )::int AS id_requerimiento
            FROM movimientos m
          )
          SELECT
            mb.id,
            mb.tipo,
            mb.fecha,
            mb.id_almacen,
            mb.usuario_ref AS id_usuario,
            COALESCE(usuarios.nombre, mb.usuario_ref) AS usuario,
            mb.id_requerimiento,
            COALESCE(
              CASE
                WHEN upper(trim(COALESCE(mb.tipo, ''))) = 'ENTRADA' AND mb.id_almacen IS NOT NULL THEN almacenes.nombre
                ELSE (
                  SELECT areas.nombre
                  FROM requerimientos
                  JOIN usuarios ON usuarios.id = requerimientos.id_usuario
                  LEFT JOIN areas ON areas.id = usuarios.id_area
                  WHERE requerimientos.id = mb.id_requerimiento
                  LIMIT 1
                )
              END,
              COALESCE(areas.nombre, 'Sin area')
            ) AS area_destino,
            movimiento_detalles.id AS id_movimiento_detalle,
            movimiento_detalles.id_material,
            materiales.nombre AS material,
            movimiento_detalles.cantidad,
            NULLIF(to_jsonb(materiales)->>'id_proveedor', '')::int AS id_proveedor,
            COALESCE(proveedores.razon_social, proveedores.nombre, '') AS proveedor,
            COALESCE(mi_calificacion.id, 0) AS mi_calificacion_id,
            COALESCE(mi_calificacion.puntuacion, 0) AS mi_calificacion_puntuacion,
            COALESCE(mi_calificacion.comentario, '') AS mi_calificacion_comentario,
            mi_calificacion.fecha AS mi_calificacion_fecha
          FROM movimientos_base mb
          LEFT JOIN usuarios ON usuarios.id = CASE
            WHEN mb.usuario_ref ~ '^\\d+$' THEN mb.usuario_ref::int
            ELSE NULL
          END
          LEFT JOIN areas ON areas.id = usuarios.id_area
          LEFT JOIN almacenes ON almacenes.id = mb.id_almacen
          LEFT JOIN movimiento_detalles ON movimiento_detalles.id_movimiento = mb.id
          LEFT JOIN materiales ON materiales.id = movimiento_detalles.id_material
          LEFT JOIN proveedores ON proveedores.id = NULLIF(to_jsonb(materiales)->>'id_proveedor', '')::int
          LEFT JOIN LATERAL (
            SELECT cp.id, cp.puntuacion, cp.comentario, cp.fecha
            FROM calificaciones_proveedor cp
            WHERE cp.id_proveedor = NULLIF(to_jsonb(materiales)->>'id_proveedor', '')::int
              AND lower(trim(COALESCE(cp.tipo, ''))) = 'compra'
              AND cp.id_referencia = movimiento_detalles.id
            ORDER BY cp.fecha DESC, cp.id DESC
            LIMIT 1
          ) AS mi_calificacion ON TRUE
          ORDER BY mb.id DESC
        `,
        []
      );

      const grouped = result.rows.reduce((acc, row) => {
        if (!acc[row.id]) {
          acc[row.id] = {
            id: row.id,
            tipo: row.tipo,
            fecha: formatPetDateTime(row.fecha),
            id_usuario: row.id_usuario,
            usuario: row.usuario,
            id_requerimiento: row.id_requerimiento,
            area_destino: row.area_destino,
            detalles: [],
          };
        }

        if (row.id_material) {
          acc[row.id].detalles.push({
            id_movimiento_detalle: Number(row.id_movimiento_detalle || 0) || null,
            id_material: row.id_material,
            material: row.material,
            cantidad: Number(row.cantidad),
            id_proveedor: Number(row.id_proveedor || 0) || null,
            proveedor: String(row.proveedor || '').trim(),
            mi_calificacion_id: Number(row.mi_calificacion_id || 0) || null,
            mi_calificacion_puntuacion: Number(row.mi_calificacion_puntuacion || 0) || 0,
            mi_calificacion_comentario: String(row.mi_calificacion_comentario || '').trim(),
            mi_calificacion_fecha: formatPetDateTime(row.mi_calificacion_fecha),
          });
        }

        return acc;
      }, {});

      res.json(Object.values(grouped));
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
};
