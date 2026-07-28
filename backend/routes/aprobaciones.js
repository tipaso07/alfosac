const { getApprovalStageRoleIdForUser, getApprovalPendingStatesForRoleId, hasAprobacionesTable, getApprovalRoleIdFromState, getPendingStateByRoleId, isApprovalHierarchyRoleId } = require('../services/approval');

module.exports = function(app, deps) {
  const { pool, authMiddleware } = deps;

  app.get('/api/aprobaciones/pendientes', authMiddleware, async (req, res) => {
    try {
      const approvalRoleId = getApprovalStageRoleIdForUser(req.user);
      const approvalStageStates = getApprovalPendingStatesForRoleId(approvalRoleId);
      if (!approvalRoleId || approvalStageStates.length === 0) {
        return res.json([]);
      }

      const hasTable = await hasAprobacionesTable(pool);
      if (!hasTable) {
        return res.json([]);
      }

      const result = await pool.query(
        `
          SELECT
            a.id,
            upper(trim(a.tipo)) AS tipo,
            a.referencia_id,
            a.orden,
            a.rol_aprobador,
            upper(trim(COALESCE(a.estado, 'PENDIENTE'))) AS estado,
            a.fecha
          FROM aprobaciones a
          WHERE upper(trim(a.tipo)) IN ('COMPRA', 'SERVICIO', 'REQUERIMIENTO')
            AND a.rol_aprobador = $1
            AND (upper(trim(COALESCE(a.estado, 'PENDIENTE'))) = 'PENDIENTE'
                 OR upper(trim(COALESCE(a.estado, 'PENDIENTE'))) LIKE 'PENDIENTE_%')
            AND NOT EXISTS (
              SELECT 1
              FROM aprobaciones prev
              WHERE upper(trim(prev.tipo)) = upper(trim(a.tipo))
                AND prev.referencia_id = a.referencia_id
                AND prev.orden < a.orden
                AND upper(trim(COALESCE(prev.estado, 'PENDIENTE'))) <> 'APROBADO'
            )
          ORDER BY upper(trim(a.tipo)), a.referencia_id, a.orden
        `,
        [approvalRoleId]
      );

      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/aprobaciones/config', authMiddleware, async (req, res) => {
    try {
      const gerentesRoleId = Number((await pool.query("SELECT id FROM roles WHERE upper(trim(nombre)) = 'GERENTES' LIMIT 1")).rows[0]?.id || 1);

      const finanzasAreaId = await (async () => {
        const result = await pool.query("SELECT id FROM areas WHERE unaccent(upper(trim(nombre))) LIKE unaccent('%ADMINISTRACION Y FINANZAS%') LIMIT 1");
        return Number(result.rows[0]?.id || 0);
      })();

      const gerenciaAreaId = await (async () => {
        const result = await pool.query("SELECT id FROM areas WHERE unaccent(upper(trim(nombre))) LIKE unaccent('%GERENCIA GENERAL%') LIMIT 1");
        return Number(result.rows[0]?.id || 0);
      })();

      const gerenteFinanzas = finanzasAreaId ? await (async () => {
        const result = await pool.query(
          `SELECT u.id, u.nombre, u.email FROM usuarios u
           INNER JOIN roles r ON u.id_role = r.id
           WHERE u.id_area = $1 AND r.id = $2
             AND upper(trim(COALESCE(u.sub_area, ''))) = 'GERENTE'
           LIMIT 1`,
          [finanzasAreaId, gerentesRoleId]
        );
        return result.rows[0] || null;
      })() : null;

      const gerenteGerencia = gerenciaAreaId ? await (async () => {
        const result = await pool.query(
          `SELECT u.id, u.nombre, u.email FROM usuarios u
           INNER JOIN roles r ON u.id_role = r.id
           WHERE u.id_area = $1 AND r.id = $2
             AND upper(trim(COALESCE(u.sub_area, ''))) = 'GERENTE'
           LIMIT 1`,
          [gerenciaAreaId, gerentesRoleId]
        );
        return result.rows[0] || null;
      })() : null;

      const flujos = {
        COMPRA: 'Dinamico por area del solicitante',
        SERVICIO_DENTRO_PLAN: gerenteFinanzas
          ? [{ usuario_id: gerenteFinanzas.id, nombre: gerenteFinanzas.nombre, orden: 1 }]
          : [],
        SERVICIO_FUERA_PLAN: [
          ...(gerenteFinanzas
            ? [{ usuario_id: gerenteFinanzas.id, nombre: gerenteFinanzas.nombre, orden: 1 }]
            : []),
          ...(gerenteGerencia
            ? [{ usuario_id: gerenteGerencia.id, nombre: gerenteGerencia.nombre, orden: 2 }]
            : []),
        ],
      };

      res.json({ flujos, hardcoded: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put('/api/aprobaciones/config/:flujo', authMiddleware, async (req, res) => {
    return res.status(400).json({
      error: 'Los flujos de aprobacion estan hardcodeados y no se pueden modificar',
      hardcoded: true,
    });
  });
};
