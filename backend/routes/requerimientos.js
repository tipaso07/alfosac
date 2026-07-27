const { getRequerimientoDescripcionExpr } = require('../db/pool');
const { parseEmbeddedCommentsFromText, fetchCommentsForEntities } = require('../services/comments');
const { fetchActionableApprovalReferenceIds, isPendingApprovalState, tienePermiso } = require('../services/approval');
const { getPermissionsByRoleId } = require('../config/constants');
const { normalizePermissionName } = require('../utils/normalize');

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

  app.get('/api/requerimientos', authMiddleware, async (req, res) => {
    try {
      const userRole = String(req.user?.rol || '');
      const roleId = Number(req.user?.id_role || req.user?.rol_id || 0);
      const userId = Number(req.user?.id || 0);
      const isGerente = roleId === 1;
      const isSolicitante = roleId === 4;
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
};