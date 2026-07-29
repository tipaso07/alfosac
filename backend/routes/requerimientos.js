const { getRequerimientoDescripcionExpr, getRequerimientoDescripcionColumn, insertMovimiento, discountMaterialStockDistributed, getMaterialStockTotal } = require('../db/pool');
const { parseEmbeddedCommentsFromText, fetchCommentsForEntities } = require('../services/comments');
const { fetchActionableApprovalReferenceIds, isPendingApprovalState, tienePermiso, aprobarEntidad, fetchApprovedApproversByEntity, fetchApprovalHistoryByEntity, mapApprovalDecisionErrorToHttp } = require('../services/approval');
const { getPermissionsByRoleId, isWarehouseAreaName, DEFAULT_USER_AVATAR } = require('../config/constants');
const { normalizePermissionName, normalize } = require('../utils/normalize');
const { PET_SQL_NOW } = require('../utils/datetime');

const hasPermission = async (pool, userId, permission) => {
  const id = Number(userId || 0);
  if (!id) return false;
  const result = await pool.query(`SELECT id_role FROM usuarios WHERE id = $1`, [id]);
  const roleId = Number(result.rows[0]?.id_role || 0);
  const perms = getPermissionsByRoleId(roleId);
  return perms.some((p) => normalizePermissionName(p) === normalizePermissionName(permission));
};

module.exports = function(app, deps) {
  const { pool, authMiddleware } = deps;

  app.post('/api/requerimientos', authMiddleware, async (req, res) => {
    const client = await pool.connect();
    try {
      const { prioridad, descripcion, items = [] } = req.body;

      if (!['ALTA', 'MEDIA', 'BAJA'].includes(prioridad)) {
        return res.status(400).json({ error: 'La prioridad debe ser ALTA, MEDIA o BAJA' });
      }

      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Debe incluir al menos un item' });
      }

      for (const item of items) {
        const idMaterial = Number(item.id_material || 0);
        const cantidad = Number(item.cantidad || 0);
        if (!idMaterial || cantidad <= 0) {
          return res.status(400).json({ error: 'Cada item debe tener id_material valido y cantidad mayor a 0' });
        }
      }

      const descCol = getRequerimientoDescripcionColumn();

      await client.query('BEGIN');

      const headerResult = await client.query(`
        INSERT INTO requerimientos (estado, prioridad, ${descCol}, id_usuario)
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `, ['PENDIENTE', prioridad, descripcion || null, req.user.id]);

      const idRequerimiento = headerResult.rows[0].id;

      for (const item of items) {
        await client.query(`
          INSERT INTO detalle_requerimiento (id_requerimiento, id_material, cantidad)
          VALUES ($1, $2, $3)
        `, [idRequerimiento, Number(item.id_material), Number(item.cantidad)]);
      }

      const { createApprovalRowsForEntity } = require('../services/approval');

      const approvalSetup = await createApprovalRowsForEntity(client, {
        tipo: 'REQUERIMIENTO',
        referenciaId: idRequerimiento,
        creatorRoleId: Number(req.user?.id_role || req.user?.rol_id || 0),
        creatorUserId: Number(req.user?.id || 0),
        creatorAreaId: Number(req.user?.id_area || 0),
      });

      if (approvalSetup.autoApproved) {
        await client.query(`
          UPDATE requerimientos
          SET estado = 'APROBADO'
          WHERE id = $1
        `, [idRequerimiento]);
      }

      await client.query('COMMIT');

      const created = await pool.query(`
        SELECT r.*, u.nombre AS usuario, COALESCE(a.nombre, 'Sin area') AS area
        FROM requerimientos r
        JOIN usuarios u ON u.id = r.id_usuario
        LEFT JOIN areas a ON a.id = u.id_area
        WHERE r.id = $1
        LIMIT 1
      `, [idRequerimiento]);

      res.status(201).json(created.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: error.message });
    } finally {
      client.release();
    }
  });

  app.patch('/api/requerimientos/:id/estado', authMiddleware, async (req, res) => {
    const client = await pool.connect();
    try {
      const { id } = req.params;
      const estado = normalize(req.body.estado);

      if (!['APROBADO', 'RECHAZADO'].includes(estado)) {
        return res.status(400).json({ error: 'Estado invalido. Usa APROBADO o RECHAZADO' });
      }

      await client.query('BEGIN');

      const reqRow = await client.query(
        'SELECT id, estado FROM requerimientos WHERE id = $1 FOR UPDATE',
        [id]
      );

      if (reqRow.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Requerimiento no encontrado' });
      }

      const approvalRows = await client.query(
        `SELECT id FROM aprobaciones WHERE upper(trim(tipo)) = 'REQUERIMIENTO' AND referencia_id = $1 LIMIT 1`,
        [id]
      ).catch(() => ({ rows: [] }));

      const useApprovalTable = approvalRows.rows.length > 0;

      if (useApprovalTable) {
        await client.query('ROLLBACK');

        const approvalResult = await aprobarEntidad(req.user, 'requerimiento', id, estado);
        if (!approvalResult?.ok) {
          return res.status(500).json({ error: 'No se pudo actualizar el estado del requerimiento' });
        }

        const refreshed = await pool.query(`
          SELECT r.*, u.nombre AS usuario, COALESCE(a.nombre, 'Sin area') AS area
          FROM requerimientos r
          JOIN usuarios u ON u.id = r.id_usuario
          LEFT JOIN areas a ON a.id = u.id_area
          WHERE r.id = $1
          LIMIT 1
        `, [id]);

        if (refreshed.rows[0]) {
          refreshed.rows[0].aprobadores = await fetchApprovedApproversByEntity(pool, {
            tipo: 'REQUERIMIENTO',
            referenciaId: Number(id),
          });
          refreshed.rows[0].historial_aprobaciones = await fetchApprovalHistoryByEntity(pool, {
            tipo: 'REQUERIMIENTO',
            referenciaId: Number(id),
          });
        }

        return res.json(refreshed.rows[0]);
      } else {
        const hasApprovalPermission = await hasPermission(pool, req.user.id, 'APROBAR_REQUERIMIENTO');
        if (!hasApprovalPermission) {
          await client.query('ROLLBACK');
          return res.status(403).json({ error: 'Sin permiso para gestionar requerimientos' });
        }

        const isRejected = estado === 'RECHAZADO';
        await client.query(`
          UPDATE requerimientos
          SET estado = $1
          WHERE id = $2
        `, [isRejected ? 'RECHAZADO' : estado, id]);
      }

      await client.query('COMMIT');

      const result = await pool.query(`
        SELECT r.*, u.nombre AS usuario, COALESCE(a.nombre, 'Sin area') AS area
        FROM requerimientos r
        JOIN usuarios u ON u.id = r.id_usuario
        LEFT JOIN areas a ON a.id = u.id_area
        WHERE r.id = $1
        LIMIT 1
      `, [id]);

      res.json(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      const mapped = mapApprovalDecisionErrorToHttp(error);
      if (mapped.expose) {
        return res.status(mapped.status).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    } finally {
      client.release();
    }
  });

  app.get('/api/requerimientos', authMiddleware, async (req, res) => {
    try {
      const userRole = String(req.user?.rol || '');
      const roleId = Number(req.user?.id_role || req.user?.rol_id || 0);
      const userId = Number(req.user?.id || 0);
      const isGerente = roleId === 1;
      const isSolicitante = roleId === 4 || roleId === 2;
      const descripcionExpr = getRequerimientoDescripcionExpr('r');

      let areaFilter = '';
      let userFilter = '';
      const queryParams = [];
      let paramIndex = 1;

      if (isGerente) {
        const userAreaId = Number(req.user?.id_area || 0);
        if (userAreaId > 0) {
          areaFilter = `AND u.id_area = $${paramIndex}`;
          queryParams.push(userAreaId);
          paramIndex += 1;
        }
      } else if (isSolicitante) {
        userFilter = `AND r.id_usuario = $${paramIndex}`;
        queryParams.push(userId);
        paramIndex += 1;
      }

      const result = await pool.query(
        `
          SELECT
            r.id,
            r.estado,
            r.estado_entrega,
            r.nombre_receptor,
            r.dni_receptor,
            r.prioridad,
            ${descripcionExpr} AS descripcion,
            r.id_usuario,
            u.id_area,
            u.nombre AS usuario,
            COALESCE(a.nombre, 'Sin area') AS area,
            r.fecha_creacion,
            dr.id_material,
            m.nombre AS material,
            dr.cantidad,
            r.calificacion,
            COALESCE(r.calificacion_comentario, '') AS calificacion_comentario,
            r.calificacion_usuario,
            r.calificacion_fecha
          FROM requerimientos r
          JOIN usuarios u ON u.id = r.id_usuario
          LEFT JOIN areas a ON a.id = u.id_area
          LEFT JOIN detalle_requerimiento dr ON dr.id_requerimiento = r.id
          LEFT JOIN materiales m ON m.id = dr.id_material
          WHERE TRUE ${areaFilter} ${userFilter}
          ORDER BY r.fecha_creacion DESC, r.id DESC
        `,
        queryParams
      );

      const grouped = result.rows.reduce((acc, row) => {
        const key = row.id;
        if (!acc[key]) {
          const parsedDescription = parseEmbeddedCommentsFromText(row.descripcion || '');
          acc[key] = {
            id: row.id,
            estado: row.estado,
            estado_entrega: row.estado_entrega,
            nombre_receptor: row.nombre_receptor,
            dni_receptor: row.dni_receptor,
            prioridad: row.prioridad,
            descripcion: parsedDescription.text,
            comentarios_historial: [],
            id_usuario: row.id_usuario,
            id_area: row.id_area,
            usuario: row.usuario,
            area: row.area,
            fecha_creacion: row.fecha_creacion,
            calificacion: row.calificacion ?? null,
            calificacion_comentario: row.calificacion_comentario || '',
            items: [],
          };
        }

        if (row.id_material) {
          acc[key].items.push({
            id_material: row.id_material,
            material: row.material,
            cantidad: Number(row.cantidad),
          });
        }

        return acc;
      }, {});

      const list = Object.values(grouped);

      const commentsByReq = await fetchCommentsForEntities(pool, {
        tipoEntidad: 'requerimiento',
        entityIds: list.map((row) => Number(row.id || 0)),
      });

      list.forEach((row) => {
        row.comentarios_historial = commentsByReq.get(Number(row.id || 0)) || [];
      });

      const actionableIds = await fetchActionableApprovalReferenceIds(pool, {
        tipo: 'REQUERIMIENTO',
        roleId,
        userId,
        referenceIds: list.map((row) => Number(row.id || 0)),
      });

      const hasApprovalPermission = await hasPermission(pool, userId, 'APROBAR_REQUERIMIENTO');

      list.forEach((row) => {
        const refId = Number(row.id || 0);
        const isPending = isPendingApprovalState(row.estado);
        const canApprove = hasApprovalPermission && actionableIds.has(refId) && isPending;
        row.puede_aprobar = canApprove;
        row.puede_rechazar = canApprove;
      });

      res.json(list);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/mis-requerimientos', authMiddleware, async (req, res) => {
    try {
      const descripcionExpr = getRequerimientoDescripcionExpr('r');
      const result = await pool.query(
        `
          SELECT
            r.id,
            ${descripcionExpr} AS descripcion,
            r.estado,
            r.estado_entrega,
            r.fecha_creacion,
            r.id_usuario,
            u.nombre AS usuario,
            COALESCE(a.nombre, 'Sin area') AS area
          FROM requerimientos r
          JOIN usuarios u ON u.id = r.id_usuario
          LEFT JOIN areas a ON a.id = u.id_area
          WHERE r.id_usuario = $1
          ORDER BY r.fecha_creacion DESC, r.id DESC
        `,
        [req.user.id]
      );

      const mapped = result.rows.map((row) => {
        const parsedDescription = parseEmbeddedCommentsFromText(row.descripcion || '');
        return {
          ...row,
          descripcion: parsedDescription.text,
          comentarios_historial: [],
        };
      });

      const commentsByReq = await fetchCommentsForEntities(pool, {
        tipoEntidad: 'requerimiento',
        entityIds: mapped.map((row) => Number(row.id || 0)),
      });

      mapped.forEach((row) => {
        row.comentarios_historial = commentsByReq.get(Number(row.id || 0)) || [];
      });

      res.json(mapped);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch('/api/requerimientos/:id/estado-entrega', authMiddleware, async (req, res) => {
    const client = await pool.connect();
    try {
      const { id } = req.params;
      const estadoEntrega = normalize(req.body.estado_entrega);
      const receptorUserId = Number(req.body.receptor_user_id || 0);

      if (estadoEntrega !== 'ENTREGADO') {
        return res.status(400).json({ error: 'Estado de entrega invalido' });
      }

      if (!receptorUserId) {
        return res.status(400).json({ error: 'Debes seleccionar un receptor valido' });
      }

      await client.query('BEGIN');

      const reqRow = await client.query(
        `SELECT r.id, r.id_usuario, r.estado, r.estado_entrega, u.id_area
         FROM requerimientos r
         JOIN usuarios u ON u.id = r.id_usuario
         WHERE r.id = $1
         LIMIT 1
         FOR UPDATE`,
        [id]
      );

      if (reqRow.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Requerimiento no encontrado' });
      }

      const reqData = reqRow.rows[0];
      const entregaActual = normalize(reqData.estado_entrega || '');

      if (entregaActual === 'ENTREGADO') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'El requerimiento ya fue entregado' });
      }

      if (entregaActual !== 'POR_RECOGER' && normalize(reqData.estado) !== 'APROBADO') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'El requerimiento debe estar aprobado y listo para recoger' });
      }

      const areaId = Number(reqData.id_area || 0);
      const receptorRow = await client.query(
        `SELECT id, nombre, COALESCE(NULLIF(trim(COALESCE(to_jsonb(u)->>'dni', '')), ''), '') AS dni
         FROM usuarios u
         WHERE u.id = $1 AND u.id_area = $2
         LIMIT 1`,
        [receptorUserId, areaId]
      );

      if (receptorRow.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'El receptor seleccionado no es valido para el area del requerimiento' });
      }

      const receptor = receptorRow.rows[0];
      const receptorDni = String(receptor.dni || '').trim();
      if (!receptorDni) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'El receptor seleccionado no tiene DNI registrado' });
      }

      const detailRows = await client.query(`
        SELECT id_material, SUM(cantidad)::numeric AS cantidad_total
        FROM detalle_requerimiento
        WHERE id_requerimiento = $1 AND id_material IS NOT NULL
        GROUP BY id_material
      `, [id]);

      if (detailRows.rows.length > 0) {
        const idMovimientoSalida = await insertMovimiento(client, {
          tipo: 'SALIDA',
          usuarioRegistro: reqData.id_usuario,
          idRequerimiento: Number(id),
        });

        for (const detail of detailRows.rows) {
          const idMaterial = Number(detail.id_material || 0);
          const qty = Number(detail.cantidad_total || 0);
          if (!idMaterial || qty <= 0) continue;

          const stockTotal = await getMaterialStockTotal(client, idMaterial);
          if (stockTotal > 0) {
            await discountMaterialStockDistributed(client, idMaterial, Math.min(stockTotal, qty));
          }

          await client.query(`
            INSERT INTO movimiento_detalles (id_movimiento, id_material, cantidad)
            VALUES ($1, $2, $3)
          `, [idMovimientoSalida, idMaterial, qty]);
        }
      }

      await client.query(
        `UPDATE requerimientos
         SET estado_entrega = 'ENTREGADO',
             nombre_receptor = $1,
             dni_receptor = $2
         WHERE id = $3`,
        [receptor.nombre, receptorDni, id]
      );

      await client.query('COMMIT');

      const result = await pool.query(`
        SELECT r.*, u.nombre AS usuario, COALESCE(a.nombre, 'Sin area') AS area
        FROM requerimientos r
        JOIN usuarios u ON u.id = r.id_usuario
        LEFT JOIN areas a ON a.id = u.id_area
        WHERE r.id = $1
        LIMIT 1
      `, [id]);

      res.json(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: error.message });
    } finally {
      client.release();
    }
  });

  app.get('/api/requerimientos/:id/receptores', authMiddleware, async (req, res) => {
    try {
      const { id } = req.params;
      const term = String(req.query.query || '').trim();

      const reqArea = await pool.query(
        `
          SELECT u.id_area, COALESCE(a.nombre, '') AS area_nombre
          FROM requerimientos r
          JOIN usuarios u ON u.id = r.id_usuario
          LEFT JOIN areas a ON a.id = u.id_area
          WHERE r.id = $1
          LIMIT 1
        `,
        [id]
      );

      if (reqArea.rows.length === 0) {
        return res.status(404).json({ error: 'Requerimiento no encontrado' });
      }

      const areaNameNorm = normalize(reqArea.rows[0].area_nombre || '');
      if (!areaNameNorm || isWarehouseAreaName(areaNameNorm)) {
        return res.json([]);
      }

      const areaId = Number(reqArea.rows[0].id_area || 0);
      if (!areaId) {
        return res.json([]);
      }

      const conditions = ['u.id_area = $1'];
      const params = [areaId];

      if (term) {
        params.push(`%${term}%`);
        const likePos = params.length;
        params.push(`%${term}%`);
        const likeDniPos = params.length;
        conditions.push(`(u.nombre ILIKE $${likePos} OR COALESCE(to_jsonb(u)->>'dni', '') ILIKE $${likeDniPos})`);
      }

      const result = await pool.query(
        `
          SELECT
            u.id,
            u.nombre,
            COALESCE(NULLIF(trim(COALESCE(to_jsonb(u)->>'dni', '')), ''), '') AS dni,
            COALESCE(ar.nombre, '') AS area,
            COALESCE(NULLIF(trim(COALESCE(to_jsonb(u)->>'imagen', to_jsonb(u)->>'foto', '')), ''), '') AS imagen
          FROM usuarios u
          LEFT JOIN areas ar ON ar.id = u.id_area
          WHERE ${conditions.join(' AND ')}
          ORDER BY u.nombre ASC
          LIMIT 20
        `,
        params
      );

      return res.json(result.rows.map((row) => ({
        id: row.id,
        nombre: row.nombre,
        dni: row.dni || '',
        area: row.area || '',
        imagen: row.imagen || DEFAULT_USER_AVATAR,
      })));
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });
};
