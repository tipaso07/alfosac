const { schemaMeta, quoteIdentifier, getServicioUserIdColumn, getServicioAreaIdColumn, getServicioDescriptionColumn, getServicioNameColumn, getServicioPriorityColumn, getServicioDentroPlanColumn, getServicioApprovalColumn, getServicioStatusColumn, getServicioProviderIdColumn, getServicioSubtotalColumn, getServicioIgvColumn, getServicioCostoEnvioColumn, getServicioOtrosCostosColumn, getServicioTotalColumn, getServicioAplicaRetencionColumn, getServicioRetencionColumn, getServicioTipoRetencionColumn, getServicioTipoCambioColumn, getServicioCurrencyIdColumn } = require('../db/pool');
const { fetchServiciosRows } = require('../db/queries');
const { resolveApprovalRoleId, canApproveApprovalRole, canAccessManageRequestsModule, canAccessPurchaseOrdersModule, canAccessServicesHistoryModule, isComprasOperatorUser, isApprovalHierarchyRoleId, hasEffectiveFinalApprovalByRole, fetchApprovedApproversByEntity, fetchApprovalHistoryByEntity, aprobarEntidad, mapApprovalDecisionErrorToHttp, getApprovalStageRoleIdForUser, getApprovalPendingStatesForRoleId, fetchPendingApprovalReferenceIdsByRole, getApprovalRoleIdFromState, getPendingStateByRoleId, createApprovalRowsForEntity, getInitialApprovalStateForEntity, insertCommentForEntity } = require('../services/approval');
const { canManagePurchasesRole, DEFAULT_USER_AVATAR } = require('../config/constants');
const { normalize, normalizeRoleName } = require('../utils/normalize');
const { parseBooleanFlag } = require('../utils/helpers');
const { buildServicioPdfBase64 } = require('../pdf/servicioPdf');

module.exports = function(app, deps) {
  const { pool, authMiddleware } = deps;

  app.get('/api/servicios', authMiddleware, async (req, res) => {
    try {
      if (schemaMeta.serviciosColumns.size === 0) {
        return res.json([]);
      }

      const userRoleId = Number(req.user?.id_role || req.user?.rol_id || 0);
      const isSolicitante = userRoleId === 4;
      const isSsgg = userRoleId === 8;

      const canManage = await canAccessManageRequestsModule(req.user)
        || canAccessPurchaseOrdersModule(req.user)
        || isComprasOperatorUser(req.user)
        || canAccessServicesHistoryModule(req.user);
      if (!canManage && !isSolicitante && !isSsgg) {
        return res.status(403).json({ error: 'No autorizado' });
      }

      const roleId = resolveApprovalRoleId(req.user);
      const canApproveInCurrentStage = canApproveApprovalRole(req.user, roleId);

      if (isSolicitante) {
        const userIdColumn = getServicioUserIdColumn();
        const servicios = await fetchServiciosRows(
          [req.user.id],
          `WHERE NULLIF(COALESCE(to_jsonb(s)->>'${userIdColumn}', to_jsonb(s)->>'usuario_id', ''), '')::int = $1`,
          { approvalRoleId: roleId, approvalPermissionGranted: canApproveInCurrentStage, userId: Number(req.user?.id || 0) }
        );
        return res.json(servicios);
      }

      if (isSsgg) {
        const userIdColumn = getServicioUserIdColumn();
        const servicios = await fetchServiciosRows(
          [req.user.id],
          `WHERE NULLIF(COALESCE(to_jsonb(s)->>'${userIdColumn}', to_jsonb(s)->>'usuario_id', ''), '')::int = $1`,
          { approvalRoleId: roleId, approvalPermissionGranted: canApproveInCurrentStage, userId: Number(req.user?.id || 0) }
        );
        return res.json(servicios);
      }

      const servicios = await fetchServiciosRows([], '', { approvalRoleId: roleId, approvalPermissionGranted: canApproveInCurrentStage, userId: Number(req.user?.id || 0) });
      res.json(servicios);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/mis-servicios', authMiddleware, async (req, res) => {
    try {
      if (schemaMeta.serviciosColumns.size === 0) {
        return res.json([]);
      }

      const roleId = resolveApprovalRoleId(req.user);
      const canApproveInCurrentStage = canApproveApprovalRole(req.user, roleId);

      if (isApprovalHierarchyRoleId(roleId) && canApproveInCurrentStage) {
        const pendingReferenceIds = await fetchPendingApprovalReferenceIdsByRole(pool, {
          tipo: 'SERVICIO',
          roleId,
          userId: Number(req.user?.id || 0),
        });
        const referenceIds = [...new Set(pendingReferenceIds)];

        if (referenceIds.length === 0) {
          return res.json([]);
        }

        const serviciosJerarquicos = await fetchServiciosRows(
          [referenceIds],
          'WHERE s.id = ANY($1::int[])',
          {
            approvalRoleId: roleId,
            approvalPermissionGranted: canApproveInCurrentStage,
          }
        );

        serviciosJerarquicos.forEach((row) => {
          try {
            const detail = String(row.estado_aprobacion_detalle || row.estado_aprobacion || 'PENDIENTE').trim();
            const roleFromDetail = getApprovalRoleIdFromState(detail);
            if (roleFromDetail > 0) {
              row.estado_aprobacion = getPendingStateByRoleId(roleFromDetail);
            } else {
              row.estado_aprobacion = String(row.estado_aprobacion || 'PENDIENTE').trim().toUpperCase();
            }
          } catch (e) {
            row.estado_aprobacion = String(row.estado_aprobacion || 'PENDIENTE').trim().toUpperCase();
          }

          delete row.estado_aprobacion_detalle;
          delete row.gestion_estado_usuario;
        });

        return res.json(serviciosJerarquicos);
      }

      if (isComprasOperatorUser(req.user)) {
        const serviciosAprobados = await fetchServiciosRows(
          [],
          "WHERE upper(trim(COALESCE(to_jsonb(s)->>'estado_aprobacion', to_jsonb(s)->>'estado', ''))) = 'APROBADO'",
          { approvalRoleId: roleId, approvalPermissionGranted: canApproveInCurrentStage }
        );

        return res.json(serviciosAprobados);
      }

      const servicios = await fetchServiciosRows(
        [req.user.id],
        "WHERE NULLIF(COALESCE(to_jsonb(s)->>'id_usuario', to_jsonb(s)->>'usuario_id', ''), '')::int = $1",
        { approvalRoleId: roleId, approvalPermissionGranted: canApproveInCurrentStage }
      );
      res.json(servicios);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/servicios/:id/comentarios', authMiddleware, async (req, res) => {
    const client = await pool.connect();

    try {
      if (schemaMeta.serviciosColumns.size === 0) {
        return res.status(400).json({ error: 'La tabla servicios no esta disponible' });
      }

      const id = Number(req.params?.id || 0);
      const contenido = String(req.body?.contenido || '').trim();

      if (!id) {
        return res.status(400).json({ error: 'ID de servicio invalido' });
      }

      if (!contenido) {
        return res.status(400).json({ error: 'El contenido del comentario es obligatorio' });
      }

      const userIdColumn = getServicioUserIdColumn();

      await client.query('BEGIN');

      const servicioResult = await client.query(
        `
          SELECT
            id,
            ${quoteIdentifier(userIdColumn)} AS id_usuario
          FROM servicios
          WHERE id = $1
        `,
        [id]
      );

      if (servicioResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Servicio no encontrado' });
      }

      const row = servicioResult.rows[0];
      const isOwner = Number(row.id_usuario || 0) === Number(req.user?.id || 0);
      const canManage = isComprasOperatorUser(req.user)
        || canManagePurchasesRole(req.user?.rol)
        || isApprovalHierarchyRoleId(resolveApprovalRoleId(req.user))
        || canAccessServicesHistoryModule(req.user);

      if (!isOwner && !canManage) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'No autorizado para comentar este servicio' });
      }

      const newEntry = await insertCommentForEntity(client, {
        user: req.user,
        tipoEntidad: 'servicio',
        idEntidad: id,
        contenido,
      });

      await client.query('COMMIT');
      return res.json({ comentario: newEntry });
    } catch (error) {
      await client.query('ROLLBACK');
      return res.status(500).json({ error: error.message });
    } finally {
      client.release();
    }
  });

  app.get('/api/sub-areas', authMiddleware, async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT DISTINCT trim(sub_area) AS sub_area
         FROM usuarios
         WHERE sub_area IS NOT NULL AND trim(sub_area) != ''
         ORDER BY trim(sub_area)`
      );
      res.json(result.rows.map((r) => r.sub_area));
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/servicios', authMiddleware, async (req, res) => {
    const client = await pool.connect();
    let txStarted = false;

    try {
      if (schemaMeta.serviciosColumns.size === 0) {
        return res.status(400).json({ error: 'La tabla servicios no esta disponible' });
      }

      const userIdColumn = getServicioUserIdColumn();
      const areaIdColumn = getServicioAreaIdColumn();
      const descriptionColumn = getServicioDescriptionColumn();
      const nameColumn = getServicioNameColumn();
      const priorityColumn = getServicioPriorityColumn();
      const dentroPlanColumn = getServicioDentroPlanColumn();
      const approvalColumn = getServicioApprovalColumn();
      const statusColumn = getServicioStatusColumn();

      const areaId = Number(req.body?.area_id ?? req.body?.id_area ?? 0);
      const nombreServicio = String(req.body?.nombre_servicio ?? req.body?.nombre ?? '').trim();
      const prioridad = normalize(req.body?.prioridad || 'MEDIA');
      const descripcionServicio = String(req.body?.descripcion_servicio ?? req.body?.descripcion ?? '').trim();
      const dentroPlan = parseBooleanFlag(req.body?.dentro_plan ?? req.body?.dentroPlan ?? req.body?.en_plan, true);
      const subArea = String(req.body?.sub_area ?? '').trim();
      const creatorRoleId = Number(req.user?.id_role || req.user?.rol_id || 0);
      const initialApprovalState = getInitialApprovalStateForEntity({
        tipo: 'SERVICIO',
        dentroPlan,
        creatorRoleId,
      });

      if (!subArea) {
        return res.status(400).json({ error: 'sub_area es obligatoria' });
      }

      let resolvedAreaId = areaId;
      if (!Number.isInteger(resolvedAreaId) || resolvedAreaId <= 0) {
        const areaRow = await client.query(
          `SELECT id_area FROM usuarios WHERE upper(trim(sub_area)) = upper(trim($1)) AND id_area IS NOT NULL LIMIT 1`,
          [subArea]
        );
        if (areaRow.rows.length === 0) {
          return res.status(400).json({ error: 'No se encontro area para la sub-area indicada' });
        }
        resolvedAreaId = Number(areaRow.rows[0].id_area);
      }

      if (!nombreServicio) {
        return res.status(400).json({ error: 'nombre_servicio es obligatorio' });
      }

      const { PRIORIDADES } = require('../config/constants');
      if (!PRIORIDADES.includes(prioridad)) {
        return res.status(400).json({ error: 'prioridad invalida. Usa ALTA, MEDIA o BAJA' });
      }

      if (!descripcionServicio) {
        return res.status(400).json({ error: 'descripcion_servicio es obligatorio' });
      }

      const areaExists = await client.query('SELECT id FROM areas WHERE id = $1 LIMIT 1', [resolvedAreaId]);

      if (areaExists.rows.length === 0) {
        return res.status(400).json({ error: 'El area derivada de la sub-area no existe' });
      }

      await client.query('BEGIN');
      txStarted = true;

      const insertColumns = [quoteIdentifier(userIdColumn), quoteIdentifier(areaIdColumn), quoteIdentifier(descriptionColumn), quoteIdentifier(approvalColumn)];
      const insertValues = [Number(req.user.id), resolvedAreaId, descripcionServicio, initialApprovalState];

      if (nameColumn) {
        insertColumns.push(quoteIdentifier(nameColumn));
        insertValues.push(nombreServicio);
      }

      if (priorityColumn) {
        insertColumns.push(quoteIdentifier(priorityColumn));
        insertValues.push(prioridad);
      }

      if (dentroPlanColumn) {
        insertColumns.push(quoteIdentifier(dentroPlanColumn));
        insertValues.push(dentroPlan);
      }

      if (statusColumn) {
        insertColumns.push(quoteIdentifier(statusColumn));
        insertValues.push(null);
      }

      if (subArea) {
        insertColumns.push(quoteIdentifier('sub_area'));
        insertValues.push(subArea);
      }

      const placeholders = insertValues.map((_, idx) => `$${idx + 1}`);

      const created = await client.query(
        `
          INSERT INTO servicios (${insertColumns.join(', ')})
          VALUES (${placeholders.join(', ')})
          RETURNING id
        `,
        insertValues
      );

      const servicioId = Number(created.rows[0].id || 0);

      const approvalSetup = await createApprovalRowsForEntity(client, {
        tipo: 'SERVICIO',
        referenciaId: servicioId,
        dentroPlan,
        creatorRoleId,
        creatorUserId: Number(req.user?.id || 0),
        creatorAreaId: Number(req.user?.id_area || 0),
      });

      if (approvalSetup.autoApproved) {
        await client.query(
          `
            UPDATE servicios
            SET ${quoteIdentifier(approvalColumn)} = 'APROBADO',
                ${quoteIdentifier(statusColumn)} = NULL
            WHERE id = $1
          `,
          [servicioId]
        );
      }

      await client.query('COMMIT');
      txStarted = false;

      const servicio = await fetchServiciosRows([servicioId], 'WHERE s.id = $1');
      res.status(201).json(servicio[0]);
    } catch (error) {
      if (txStarted) {
        await client.query('ROLLBACK');
      }

      if (String(error?.code || '') === '23514') {
        return res.status(400).json({ error: 'Violacion de restriccion CHECK en servicios' });
      }

      res.status(500).json({ error: error.message });
    } finally {
      client.release();
    }
  });

  app.put('/api/servicios/:id/aprobar', authMiddleware, async (req, res) => {
    const client = await pool.connect();

    try {
      if (schemaMeta.serviciosColumns.size === 0) {
        return res.status(400).json({ error: 'La tabla servicios no esta disponible' });
      }

      const { id } = req.params;
      const approvalColumn = getServicioApprovalColumn();
      const statusColumn = getServicioStatusColumn();
      const estadoAprobacion = normalize(req.body?.estado_aprobacion ?? req.body?.estado);

      const { ESTADOS_SERVICIO_APROBACION } = require('../config/constants');

      if (!ESTADOS_SERVICIO_APROBACION.includes(estadoAprobacion) || estadoAprobacion === 'PENDIENTE') {
        return res.status(400).json({ error: 'estado_aprobacion invalido. Usa APROBADO o RECHAZADO' });
      }

      await client.query('BEGIN');

      const exists = await client.query('SELECT id FROM servicios WHERE id = $1 FOR UPDATE', [id]);
      if (exists.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Servicio no encontrado' });
      }

      const approvalRows = await client.query(
        `
          SELECT id
          FROM aprobaciones
          WHERE upper(trim(tipo)) = 'SERVICIO'
            AND referencia_id = $1
          LIMIT 1
        `,
        [id]
      ).catch(() => ({ rows: [] }));

      const useApprovalTable = approvalRows.rows.length > 0;

      const hasDentroPlan = Object.prototype.hasOwnProperty.call(req.body || {}, 'dentro_plan')
        || Object.prototype.hasOwnProperty.call(req.body || {}, 'dentroPlan')
        || Object.prototype.hasOwnProperty.call(req.body || {}, 'en_plan');
      const planChoice = hasDentroPlan
        ? parseBooleanFlag(req.body?.dentro_plan ?? req.body?.dentroPlan ?? req.body?.en_plan, false)
        : null;

      if (useApprovalTable) {
        await client.query('ROLLBACK');

        const approvalResult = await aprobarEntidad(req.user, 'servicio', id, estadoAprobacion, { dentro_plan: planChoice });
        if (!approvalResult?.ok) {
          return res.status(500).json({ error: 'No se pudo aprobar el servicio' });
        }

        const refreshed = await fetchServiciosRows([id], 'WHERE s.id = $1');
        if (refreshed[0]) {
          refreshed[0].aprobadores = await fetchApprovedApproversByEntity(pool, {
            tipo: 'SERVICIO',
            referenciaId: refreshed[0].id,
          });
          refreshed[0].historial_aprobaciones = await fetchApprovalHistoryByEntity(pool, {
            tipo: 'SERVICIO',
            referenciaId: refreshed[0].id,
          });
        }

        return res.json(refreshed[0]);
      } else {
        if (!canManagePurchasesRole(req.user?.rol)) {
          await client.query('ROLLBACK');
          return res.status(403).json({ error: 'Sin permiso para gestionar servicios' });
        }

        if (planChoice !== null) {
          const planColumn = getServicioDentroPlanColumn();
          if (planColumn) {
            await client.query(
              `UPDATE servicios SET ${quoteIdentifier(planColumn)} = $1 WHERE id = $2`,
              [planChoice, id]
            );
          }
        }

        await client.query(
          `
            UPDATE servicios
            SET ${quoteIdentifier(approvalColumn)} = $1,
                ${quoteIdentifier(statusColumn)} = $2
            WHERE id = $3
          `,
          [estadoAprobacion, estadoAprobacion === 'APROBADO' ? 'APROBADO' : null, id]
        );
      }

      await client.query('COMMIT');

      const servicio = await fetchServiciosRows([id], 'WHERE s.id = $1');
      if (servicio[0]) {
        servicio[0].aprobadores = await fetchApprovedApproversByEntity(pool, {
          tipo: 'SERVICIO',
          referenciaId: servicio[0].id,
        });
        servicio[0].historial_aprobaciones = await fetchApprovalHistoryByEntity(pool, {
          tipo: 'SERVICIO',
          referenciaId: servicio[0].id,
        });
      }
      res.json(servicio[0]);
    } catch (error) {
      await client.query('ROLLBACK');

      if (String(error?.code || '') === '23514') {
        return res.status(400).json({ error: 'Violacion de restriccion CHECK en servicios' });
      }

      const mapped = mapApprovalDecisionErrorToHttp(error);
      if (mapped.expose) {
        return res.status(mapped.status).json({ error: error.message });
      }

      res.status(500).json({ error: error.message });
    } finally {
      client.release();
    }
  });

  app.put('/api/servicios/:id/estado', authMiddleware, async (req, res) => {
    try {
      if (schemaMeta.serviciosColumns.size === 0) {
        return res.status(400).json({ error: 'La tabla servicios no esta disponible' });
      }

      const { id } = req.params;
      const statusColumn = getServicioStatusColumn();
      const approvalColumn = getServicioApprovalColumn();
      const userIdColumn = getServicioUserIdColumn();
      const newStatus = normalize(req.body?.estado_flujo ?? req.body?.estado_servicio ?? req.body?.estado);

      if (newStatus !== 'REALIZADO') {
        return res.status(400).json({ error: 'estado_flujo invalido. Solo se permite REALIZADO' });
      }

      const current = await pool.query(
        `
          SELECT
            id,
            ${quoteIdentifier(userIdColumn)} AS id_usuario,
            ${quoteIdentifier(approvalColumn)} AS estado_aprobacion,
            ${quoteIdentifier(statusColumn)} AS estado_flujo
          FROM servicios
          WHERE id = $1
          LIMIT 1
        `,
        [id]
      );

      if (current.rows.length === 0) {
        return res.status(404).json({ error: 'Servicio no encontrado' });
      }

      const row = current.rows[0];
      const { isGerentesRole, isComprasRole } = require('../config/constants');
      const canManage = isGerentesRole(req.user?.rol)
        || isComprasRole(req.user?.rol)
        || canManagePurchasesRole(req.user?.rol)
        || canAccessServicesHistoryModule(req.user);
      if (!canManage && Number(row.id_usuario || 0) !== Number(req.user.id || 0)) {
        return res.status(403).json({ error: 'No autorizado para actualizar este servicio' });
      }

      if (normalize(row.estado_aprobacion) !== 'APROBADO') {
        return res.status(400).json({ error: 'Solo se puede cambiar estado_flujo si estado_aprobacion = APROBADO' });
      }

      if (normalize(row.estado_flujo) !== 'PENDIENTE') {
        return res.status(400).json({ error: 'Solo se puede marcar REALIZADO cuando estado_flujo = PENDIENTE' });
      }

      const updated = await pool.query(
        `
          UPDATE servicios
          SET ${quoteIdentifier(statusColumn)} = $1
          WHERE id = $2
            AND upper(trim(COALESCE(${quoteIdentifier(approvalColumn)}::text, ''))) = 'APROBADO'
          RETURNING id
        `,
        ['REALIZADO', id]
      );

      if (updated.rows.length === 0) {
        return res.status(400).json({ error: 'No se pudo actualizar estado_flujo' });
      }

      const servicio = await fetchServiciosRows([id], 'WHERE s.id = $1');
      res.json(servicio[0]);
    } catch (error) {
      if (String(error?.code || '') === '23514') {
        return res.status(400).json({ error: 'Violacion de restriccion CHECK en servicios' });
      }

      res.status(500).json({ error: error.message });
    }
  });

  app.patch('/api/servicios/:id/completar-datos', authMiddleware, async (req, res) => {
    try {
      if (schemaMeta.serviciosColumns.size === 0) {
        return res.status(400).json({ error: 'La tabla servicios no esta disponible' });
      }

      const { id } = req.params;
      const providerId = Number(req.body?.proveedor_id ?? req.body?.id_proveedor ?? 0);
      const subtotalInput = Number(req.body?.subtotal ?? 0);
      const costoEnvioInput = Number(req.body?.costo_envio ?? 0);
      const otrosCostosInput = Number(req.body?.otros_costos ?? 0);
      const igvInput = Number((subtotalInput * 0.18).toFixed(2));
      const totalInput = Number((subtotalInput + igvInput + costoEnvioInput + otrosCostosInput).toFixed(2));

      if (!Number.isInteger(providerId) || providerId <= 0) {
        return res.status(400).json({ error: 'proveedor_id es obligatorio y debe ser valido' });
      }

      if (!Number.isFinite(subtotalInput) || subtotalInput < 0) {
        return res.status(400).json({ error: 'subtotal debe ser un numero mayor o igual a 0' });
      }

      if (!Number.isFinite(costoEnvioInput) || costoEnvioInput < 0) {
        return res.status(400).json({ error: 'costo_envio debe ser un numero mayor o igual a 0' });
      }

      if (!Number.isFinite(otrosCostosInput) || otrosCostosInput < 0) {
        return res.status(400).json({ error: 'otros_costos debe ser un numero mayor o igual a 0' });
      }

      if (!Number.isFinite(totalInput) || totalInput < 0) {
        return res.status(400).json({ error: 'total debe ser un numero mayor o igual a 0' });
      }

      const servicios = await fetchServiciosRows([id], 'WHERE s.id = $1');
      if (servicios.length === 0) {
        return res.status(404).json({ error: 'Servicio no encontrado' });
      }

      const servicio = servicios[0];
      const canOperateServicio = isComprasOperatorUser(req.user);
      const isOwner = Number(servicio.id_usuario) === Number(req.user.id);

      if (!isOwner && !canOperateServicio) {
        return res.status(403).json({ error: 'No autorizado para completar este servicio' });
      }

      if (!isOwner) {
        const hasFinalApproval = await hasEffectiveFinalApprovalByRole(pool, {
          tipo: 'SERVICIO',
          referenciaId: id,
          roleId: 7,
        });

        if (!hasFinalApproval) {
          return res.status(400).json({ error: 'El servicio aun no tiene aprobacion final de gerencia de finanzas' });
        }
      }

      if (normalize(servicio.estado_aprobacion) !== 'APROBADO') {
        return res.status(400).json({ error: 'Solo se pueden completar datos en servicios APROBADOS' });
      }

      if (normalize(servicio.estado_flujo) === 'REALIZADO') {
        return res.status(400).json({ error: 'No se pueden editar datos cuando el servicio ya fue realizado' });
      }

      const providerExists = await pool.query(
        `
          SELECT
            p.id,
            COALESCE(upper(trim(COALESCE(to_jsonb(p)->>'retencion', 'NO'))), 'NO') AS retencion,
            COALESCE(NULLIF(upper(trim(COALESCE(to_jsonb(p)->>'tipo_retencion', ''))), ''), 'RETENCION') AS tipo_retencion,
            COALESCE(NULLIF(COALESCE(to_jsonb(p)->>'descuento', ''), '')::numeric, 0) AS retencion_pct,
            NULLIF(COALESCE(to_jsonb(p)->>'id_moneda', ''), '')::int AS id_moneda,
            COALESCE(mo.nombre, '') AS moneda_nombre
          FROM proveedores p
          LEFT JOIN monedas mo ON mo.id = NULLIF(COALESCE(to_jsonb(p)->>'id_moneda', ''), '')::int
          WHERE p.id = $1
          LIMIT 1
        `,
        [providerId]
      );

      if (providerExists.rows.length === 0) {
        return res.status(400).json({ error: 'proveedor_id no existe en proveedores' });
      }

      const providerRow = providerExists.rows[0] || {};
      const providerRetencionFlag = normalize(providerRow.retencion) === 'SI';
      const tipoRetencionInput = ['RETENCION', 'DETRACCION'].includes(normalize(providerRow.tipo_retencion || ''))
        ? normalize(providerRow.tipo_retencion)
        : 'RETENCION';
      const retencionPct = Number(providerRow.retencion_pct || 0);
      const monedaNorm = normalizeRoleName(providerRow.moneda_nombre || 'PEN');
      const isUsd = monedaNorm.includes('USD') || monedaNorm.includes('DOLAR');
      const isPen = monedaNorm.includes('PEN') || monedaNorm.includes('SOL');
      const totalBase = Number((subtotalInput + igvInput + costoEnvioInput + otrosCostosInput).toFixed(2));
      const tipoCambioRaw = req.body?.tipo_cambio;
      const tipoCambioNormalized = String(tipoCambioRaw ?? '').trim().toLowerCase();
      const tipoCambioInput = tipoCambioRaw === undefined || tipoCambioRaw === null || tipoCambioNormalized === '' || tipoCambioNormalized === 'null' || tipoCambioNormalized === 'undefined'
        ? null
        : Number(tipoCambioRaw);
      if (tipoCambioInput !== null && (!Number.isFinite(tipoCambioInput) || tipoCambioInput <= 0)) {
        return res.status(400).json({ error: 'tipo_cambio debe ser numerico y mayor a 0' });
      }
      const tipoCambioUsd = Number.isFinite(tipoCambioInput) && tipoCambioInput > 0
        ? tipoCambioInput
        : 3.4;
      const totalBaseSoles = isUsd ? Number((totalBase * tipoCambioUsd).toFixed(2)) : totalBase;
      const superaUmbral = (isPen && totalBase > 700) || (isUsd && totalBaseSoles > 700);
      const aplicaRetencion = providerRetencionFlag && retencionPct > 0 && superaUmbral;
      const montoRetencion = aplicaRetencion
        ? Number((totalBase * (retencionPct / 100)).toFixed(2))
        : 0;
      const totalFinal = aplicaRetencion
        ? Number((totalBase - montoRetencion).toFixed(2))
        : totalBase;
      const retencionInput = aplicaRetencion ? retencionPct : 0;

      const providerIdColumn = getServicioProviderIdColumn();
      const statusColumn = getServicioStatusColumn();
      const nameColumn = getServicioNameColumn();
      const descriptionColumn = getServicioDescriptionColumn();
      const subtotalColumn = getServicioSubtotalColumn();
      const igvColumn = getServicioIgvColumn();
      const costoEnvioColumn = getServicioCostoEnvioColumn();
      const otrosCostosColumn = getServicioOtrosCostosColumn();
      const totalColumn = getServicioTotalColumn();
      const aplicaRetencionColumn = getServicioAplicaRetencionColumn();
      const retencionColumn = getServicioRetencionColumn();
      const tipoRetencionColumn = getServicioTipoRetencionColumn();
      const tipoCambioColumn = getServicioTipoCambioColumn();
      const monedaIdColumn = getServicioCurrencyIdColumn();

      const setClauses = [
        `${quoteIdentifier(providerIdColumn)} = $1`,
        `${quoteIdentifier(subtotalColumn || 'subtotal')} = $2`,
        `${quoteIdentifier(igvColumn || 'igv')} = $3`,
        `${quoteIdentifier(costoEnvioColumn || 'costo_envio')} = $4`,
        `${quoteIdentifier(otrosCostosColumn || 'otros_costos')} = $5`,
        `${quoteIdentifier(totalColumn || 'total')} = $6`,
        `${quoteIdentifier(statusColumn)} = $7`,
      ];

      if (monedaIdColumn && Number(providerRow.id_moneda || 0) > 0) {
        setClauses.push(`${quoteIdentifier(monedaIdColumn)} = $${setClauses.length + 1}`);
      }

      const nombreServicioInput = String(req.body?.nombre_servicio ?? req.body?.nombre ?? '').trim();
      const descripcionServicioInput = String(req.body?.descripcion_servicio ?? req.body?.descripcion ?? '').trim();
      const values = [providerId, subtotalInput, igvInput, costoEnvioInput, otrosCostosInput, totalFinal, 'DATOS_COMPLETADOS'];

      if (monedaIdColumn && Number(providerRow.id_moneda || 0) > 0) {
        values.push(Number(providerRow.id_moneda || 0));
      }

      if (nameColumn) {
        setClauses.push(`${quoteIdentifier(nameColumn)} = $${values.length + 1}`);
        values.push(nombreServicioInput);
      }

      if (descriptionColumn) {
        setClauses.push(`${quoteIdentifier(descriptionColumn)} = $${values.length + 1}`);
        values.push(descripcionServicioInput);
      }

      if (aplicaRetencionColumn) {
        setClauses.push(`${quoteIdentifier(aplicaRetencionColumn)} = $${values.length + 1}`);
        values.push(aplicaRetencion);
      }

      if (retencionColumn) {
        setClauses.push(`${quoteIdentifier(retencionColumn)} = $${values.length + 1}`);
        values.push(aplicaRetencion ? retencionInput : 0);
      }

      if (tipoRetencionColumn) {
        setClauses.push(`${quoteIdentifier(tipoRetencionColumn)} = $${values.length + 1}`);
        values.push(tipoRetencionInput);
      }

      if (tipoCambioColumn) {
        setClauses.push(`${quoteIdentifier(tipoCambioColumn)} = $${values.length + 1}`);
        values.push(Number.isFinite(tipoCambioInput) && tipoCambioInput > 0 ? tipoCambioInput : null);
      }

      values.push(id);

      await pool.query(
        `
          UPDATE servicios
          SET ${setClauses.join(', ')}
          WHERE id = $${values.length}
        `,
        values
      );

      const updated = await fetchServiciosRows([id], 'WHERE s.id = $1');
      res.json(updated[0]);
    } catch (error) {
      if (String(error?.code || '') === '23514') {
        return res.status(400).json({ error: 'Violacion de restriccion CHECK en servicios' });
      }

      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/servicios/:id/generar-orden', authMiddleware, async (req, res) => {
    try {
      if (schemaMeta.serviciosColumns.size === 0) {
        return res.status(400).json({ error: 'La tabla servicios no esta disponible' });
      }

      const { id } = req.params;
      const servicios = await fetchServiciosRows([id], 'WHERE s.id = $1');
      if (servicios.length === 0) {
        return res.status(404).json({ error: 'Servicio no encontrado' });
      }

      const servicio = servicios[0];
      const canOperateServicio = isComprasOperatorUser(req.user);
      const isOwner = Number(servicio.id_usuario) === Number(req.user.id);

      if (!isOwner && !canOperateServicio) {
        return res.status(403).json({ error: 'No autorizado para generar orden de este servicio' });
      }

      if (!isOwner) {
        const hasFinalApproval = await hasEffectiveFinalApprovalByRole(pool, {
          tipo: 'SERVICIO',
          referenciaId: id,
          roleId: 7,
        });

        if (!hasFinalApproval) {
          return res.status(400).json({ error: 'El servicio aun no tiene aprobacion final de gerencia de finanzas' });
        }
      }

      if (normalize(servicio.estado_aprobacion) !== 'APROBADO') {
        return res.status(400).json({ error: 'Solo se puede generar orden para servicios APROBADOS' });
      }

      const completionData = await pool.query(
        `
          SELECT
            NULLIF(COALESCE(to_jsonb(s)->>'proveedor_id', to_jsonb(s)->>'id_proveedor', ''), '')::int AS proveedor_id,
            NULLIF(COALESCE(to_jsonb(s)->>'subtotal', ''), '')::numeric AS subtotal,
            NULLIF(COALESCE(to_jsonb(s)->>'total', ''), '')::numeric AS total
          FROM servicios s
          WHERE s.id = $1
          LIMIT 1
        `,
        [id]
      );

      const completionRow = completionData.rows[0] || {};
      if (!Number(completionRow.proveedor_id || 0) || completionRow.subtotal == null || completionRow.total == null) {
        return res.status(400).json({ error: 'No se puede generar PDF. Completa proveedor, subtotal y total.' });
      }

      if (normalize(servicio.estado_flujo || servicio.estado_servicio) !== 'DATOS_COMPLETADOS') {
        return res.status(400).json({ error: 'Primero guarda los datos del servicio antes de generar la orden.' });
      }

      const statusColumn = getServicioStatusColumn();
      await pool.query(
        `
          UPDATE servicios
          SET ${quoteIdentifier(statusColumn)} = 'PENDIENTE'
          WHERE id = $1
        `,
        [id]
      );

      const refreshedServicios = await fetchServiciosRows([id], 'WHERE s.id = $1');
      const refreshedServicio = refreshedServicios[0] || servicio;
      refreshedServicio.aprobadores = await fetchApprovedApproversByEntity(pool, {
        tipo: 'SERVICIO',
        referenciaId: refreshedServicio.id,
      });
      refreshedServicio.historial_aprobaciones = await fetchApprovalHistoryByEntity(pool, {
        tipo: 'SERVICIO',
        referenciaId: refreshedServicio.id,
      });

      const pdfBase64 = await buildServicioPdfBase64(refreshedServicio);

      res.json({
        id: refreshedServicio.id,
        servicio: refreshedServicio,
        archivo: {
          nombre: `servicio_${refreshedServicio.id}.pdf`,
          mime: 'application/pdf',
          base64: pdfBase64,
        },
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/servicios/:id/pdf', authMiddleware, async (req, res) => {
    try {
      if (schemaMeta.serviciosColumns.size === 0) {
        return res.status(400).json({ error: 'La tabla servicios no esta disponible' });
      }

      const { id } = req.params;
      const servicios = await fetchServiciosRows([id], 'WHERE s.id = $1');
      if (servicios.length === 0) {
        return res.status(404).json({ error: 'Servicio no encontrado' });
      }

      const servicio = servicios[0];
      const canOperateServicio = isComprasOperatorUser(req.user);
      const isOwner = Number(servicio.id_usuario) === Number(req.user.id);

      if (!isOwner && !canOperateServicio) {
        return res.status(403).json({ error: 'No autorizado para descargar este PDF' });
      }

      if (!isOwner) {
        const hasFinalApproval = await hasEffectiveFinalApprovalByRole(pool, {
          tipo: 'SERVICIO',
          referenciaId: id,
          roleId: 7,
        });

        if (!hasFinalApproval) {
          return res.status(400).json({ error: 'El servicio aun no tiene aprobacion final de gerencia de finanzas' });
        }
      }

      const completionData = await pool.query(
        `
          SELECT
            NULLIF(COALESCE(to_jsonb(s)->>'proveedor_id', to_jsonb(s)->>'id_proveedor', ''), '')::int AS proveedor_id,
            NULLIF(COALESCE(to_jsonb(s)->>'subtotal', ''), '')::numeric AS subtotal,
            NULLIF(COALESCE(to_jsonb(s)->>'total', ''), '')::numeric AS total
          FROM servicios s
          WHERE s.id = $1
          LIMIT 1
        `,
        [id]
      );

      const completionRow = completionData.rows[0] || {};
      if (!Number(completionRow.proveedor_id || 0) || completionRow.subtotal == null || completionRow.total == null) {
        return res.status(400).json({ error: 'No se puede descargar PDF. Completa proveedor, subtotal y total.' });
      }

      servicio.aprobadores = await fetchApprovedApproversByEntity(pool, {
        tipo: 'SERVICIO',
        referenciaId: servicio.id,
      });
      servicio.historial_aprobaciones = await fetchApprovalHistoryByEntity(pool, {
        tipo: 'SERVICIO',
        referenciaId: servicio.id,
      });

      const pdfBase64 = await buildServicioPdfBase64(servicio);
      const pdfBuffer = Buffer.from(pdfBase64, 'base64');

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="servicio_${servicio.id}.pdf"`);
      res.send(pdfBuffer);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
};
