const { schemaMeta, pickExistingColumn, buildProveedorSelectExpressions, insertMovimiento, getMaterialStockTotal, discountMaterialStockDistributed, quoteIdentifier } = require('../db/pool');
const { fetchComprasRows, parsePurchaseComments, normalizeItemCategoryKey } = require('../db/queries');
const { resolveApprovalRoleId, canApproveApprovalRole, canAccessManageRequestsModule, canAccessPurchaseOrdersModule, isComprasOperatorUser, aprobarEntidad, hasEffectiveFinalApprovalByRole, fetchApprovedApproversByEntity, fetchApprovalHistoryByEntity, mapApprovalDecisionErrorToHttp, isPendingApprovalState, insertCommentForEntity } = require('../services/approval');
const { buildPurchaseComment, upsertProveedorRating } = require('../services/proveedores');
const { fetchCommentsForEntities } = require('../services/comments');
const { canManagePurchasesRole, canManageDeliveryRole, isWarehouseAreaName, DEFAULT_USER_AVATAR } = require('../config/constants');
const { normalize } = require('../utils/normalize');
const { PET_SQL_NOW, formatPetDateTime, currentPetDateTime } = require('../utils/datetime');
const { buildCompraPdfBase64 } = require('../pdf/compraPdf');

module.exports = function(app, deps) {
  const { pool, authMiddleware } = deps;

  app.get('/api/compras', authMiddleware, async (req, res) => {
    try {
      const userRole = String(req.user?.rol || '');
      const roleId = resolveApprovalRoleId(req.user);
      const canApproveInCurrentStage = canApproveApprovalRole(req.user, roleId);
      const canSeeAllPurchases = await canAccessManageRequestsModule(req.user)
        || canAccessPurchaseOrdersModule(req.user)
        || canManagePurchasesRole(userRole)
        || canManageDeliveryRole(userRole);

      const compras = canSeeAllPurchases
        ? await fetchComprasRows([], '', { approvalRoleId: roleId, approvalPermissionGranted: canApproveInCurrentStage, userId: Number(req.user?.id || 0) })
        : await fetchComprasRows([req.user.id], 'WHERE c.id_usuario = $1', { approvalRoleId: roleId, approvalPermissionGranted: canApproveInCurrentStage, userId: Number(req.user?.id || 0) });

      const comprasApi = compras.map((row) => {
        const safeRow = { ...row };
        delete safeRow.estado_aprobacion_detalle;
        delete safeRow.gestion_estado_usuario;
        return safeRow;
      });

      res.json(comprasApi);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/mis-compras', authMiddleware, async (req, res) => {
    try {
      const { getApprovalStageRoleIdForUser, getApprovalPendingStatesForRoleId, isApprovalHierarchyRoleId } = require('../services/approval');

      const approvalStageRoleId = getApprovalStageRoleIdForUser(req.user);
      const approvalStageStates = getApprovalPendingStatesForRoleId(approvalStageRoleId);

      if (canAccessPurchaseOrdersModule(req.user)) {
        const roleId = approvalStageRoleId;
        const canApproveInCurrentStage = canApproveApprovalRole(req.user, roleId);
        const compras = await fetchComprasRows(
          [],
          "WHERE upper(trim(COALESCE(to_jsonb(c)->>'estado_pedido', to_jsonb(c)->>'estado', ''))) IN ('APROBADA', 'APROBADO', 'POR_RECIBIR', 'RECIBIDA', 'RECIBIDO', 'ENTREGADO')",
          { approvalRoleId: roleId, approvalPermissionGranted: canApproveInCurrentStage }
        );

        return res.json(compras);
      }

      if (approvalStageStates.length > 0) {
        const approvalRoleId = approvalStageRoleId;
        const canApproveInCurrentStage = canApproveApprovalRole(req.user, approvalRoleId);
        const comprasAprobacion = await fetchComprasRows(
          [req.user.id, approvalStageStates],
          "WHERE c.id_usuario = $1 AND upper(trim(COALESCE(to_jsonb(c)->>'estado_pedido', to_jsonb(c)->>'estado', 'PENDIENTE'))) = ANY($2::text[])",
          { approvalRoleId, approvalPermissionGranted: canApproveInCurrentStage }
        );

        return res.json(comprasAprobacion);
      }

      const roleId = resolveApprovalRoleId(req.user);
      const canApproveInCurrentStage = canApproveApprovalRole(req.user, roleId);

      if (isApprovalHierarchyRoleId(roleId) && canApproveInCurrentStage) {
        const approvalStageStates = getApprovalPendingStatesForRoleId(roleId);
        if (approvalStageStates.length === 0) {
          return res.json([]);
        }

        const comprasJerarquicas = await fetchComprasRows(
          [approvalStageStates],
          "WHERE upper(trim(COALESCE(to_jsonb(c)->>'estado_pedido', to_jsonb(c)->>'estado', ''))) = ANY($1::text[])",
          {
            approvalRoleId: roleId,
            approvalPermissionGranted: canApproveInCurrentStage,
          }
        );

        return res.json(comprasJerarquicas);
      }

      if (canAccessPurchaseOrdersModule(req.user)) {
        const comprasAprobadasFinales = await fetchComprasRows(
          [],
          "WHERE upper(trim(COALESCE(to_jsonb(c)->>'estado_pedido', to_jsonb(c)->>'estado', ''))) IN ('APROBADA', 'APROBADO', 'POR_RECIBIR', 'RECIBIDA', 'RECIBIDO', 'ENTREGADO')",
          { approvalRoleId: roleId, approvalPermissionGranted: canApproveInCurrentStage }
        );

        return res.json(comprasAprobadasFinales);
      }

      const compras = await fetchComprasRows(
        [req.user.id],
        'WHERE c.id_usuario = $1',
        { approvalRoleId: roleId, approvalPermissionGranted: canApproveInCurrentStage }
      );
      res.json(compras);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/compras/:id/comentarios', authMiddleware, async (req, res) => {
    let client;

    try {
      client = await pool.connect();
      const id = Number(req.params?.id || 0);
      const contenido = String(req.body?.contenido || '').trim();

      if (!id) {
        return res.status(400).json({ error: 'ID de compra invalido' });
      }

      if (!contenido) {
        return res.status(400).json({ error: 'El contenido del comentario es obligatorio' });
      }

      await client.query('BEGIN');

      const compraResult = await client.query(
        `
          SELECT id, id_usuario
          FROM compras
          WHERE id = $1
        `,
        [id]
      );

      if (compraResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Compra no encontrada' });
      }

      const row = compraResult.rows[0];
      const isOwner = Number(row.id_usuario || 0) === Number(req.user?.id || 0);
      const canManage = isComprasOperatorUser(req.user) || canManageDeliveryRole(req.user?.rol) || canManagePurchasesRole(req.user?.rol);
      if (!isOwner && !canManage) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'No autorizado para comentar esta compra' });
      }

      const newEntry = await insertCommentForEntity(client, {
        user: req.user,
        tipoEntidad: 'compra',
        idEntidad: id,
        contenido,
      });

      await client.query('COMMIT');
      return res.json({ comentario: newEntry });
    } catch (error) {
      if (client) await client.query('ROLLBACK');
      return res.status(500).json({ error: error.message });
    } finally {
      if (client) client.release();
    }
  });

  app.post('/api/compras', authMiddleware, async (req, res) => {
    let client;

    try {
      client = await pool.connect();

      const item = req.body?.item && typeof req.body.item === 'object' ? req.body.item : null;
      const providerIdRaw = req.body?.proveedor_id ?? req.body?.id_proveedor;
      const providerId = providerIdRaw == null || providerIdRaw === ''
        ? null
        : Number(providerIdRaw);
      const idAreaFinal = req.body?.id_area_final ? Number(req.body.id_area_final) || null : null;

      const detailColumnsMeta = await client.query(
        `
          SELECT
            column_name,
            is_nullable,
            column_default,
            data_type,
            udt_name
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'detalle_compras'
        `
      );

      const detailMetaByColumn = detailColumnsMeta.rows.reduce((acc, row) => {
        acc[row.column_name] = row;
        return acc;
      }, {});

      if (!item) {
        return res.status(400).json({ error: 'Debe enviar un item para la compra' });
      }

      if (providerId !== null && (!Number.isInteger(providerId) || providerId <= 0)) {
        return res.status(400).json({ error: 'Proveedor invalido' });
      }

      let providerData = { proveedor_nombre: null, proveedor_ruc: null };
      if (providerId !== null) {
        const providerResult = await client.query(
          `
            SELECT
              p.id,
              COALESCE(
                NULLIF(trim(COALESCE(to_jsonb(p)->>'razon_social', to_jsonb(p)->>'nombre', '')), ''),
                ''
              ) AS proveedor_nombre,
              COALESCE(NULLIF(trim(COALESCE(to_jsonb(p)->>'ruc', '')), ''), '') AS proveedor_ruc
            FROM proveedores p
            WHERE p.id = $1
            LIMIT 1
          `,
          [providerId]
        );

        if (providerResult.rows.length === 0) {
          return res.status(400).json({ error: 'Proveedor seleccionado no existe' });
        }

        providerData = providerResult.rows[0];
      }

      const idUnidadCompra = (() => {
        const raw = Number(item?.id_unidad || 0);
        return Number.isInteger(raw) && raw > 0 ? raw : null;
      })();

      if (idUnidadCompra !== null) {
        const unidadExists = await client.query('SELECT id FROM unidades WHERE id = $1 LIMIT 1', [idUnidadCompra]);
        if (unidadExists.rows.length === 0) {
          return res.status(400).json({ error: 'id_unidad no existe en unidades' });
        }
      }

      await client.query('BEGIN');

      const { getInitialApprovalStateForEntity } = require('../services/approval');

      const creatorRoleId = Number(req.user?.id_role || req.user?.rol_id || 0);
      const initialApprovalState = getInitialApprovalStateForEntity({
        tipo: 'COMPRA',
        creatorRoleId,
      });

      const compraInsert = await client.query(
        `
          INSERT INTO compras (estado, id_usuario, id_area_solicitante, id_proveedor, proveedor, ruc, id_unidad, ${schemaMeta.comprasColumns.has('id_area_final') ? 'id_area_final,' : ''} fecha_creacion, fecha_actualizacion)
          VALUES ($7, $1, $2, $3, $4, $5, $6, ${schemaMeta.comprasColumns.has('id_area_final') ? '$8,' : ''} ${PET_SQL_NOW}, ${PET_SQL_NOW})
          RETURNING id
        `,
        [
          req.user.id,
          req.user.id_area || null,
          providerId || null,
          providerData.proveedor_nombre || null,
          providerData.proveedor_ruc || null,
          idUnidadCompra,
          initialApprovalState,
          ...(schemaMeta.comprasColumns.has('id_area_final') ? [idAreaFinal] : []),
        ]
      );

      const idCompra = compraInsert.rows[0].id;
      const itemCategoriesMap = {};

      let idMaterial = item.id_material ? Number(item.id_material) : null;
      const cantidad = Number(item.cantidad || 0);
      const descripcion = String(item.descripcion || item.nombre || '').trim();
      const categoria = String(item.categoria || '').trim();
      let idCategoriaDetalle = null;

      if (descripcion && categoria) {
        itemCategoriesMap[normalizeItemCategoryKey(descripcion)] = categoria;
      }

      if (cantidad <= 0) {
        throw new Error('La cantidad debe ser mayor a 0');
      }

      if (!idMaterial && !descripcion) {
        throw new Error('El item debe tener nombre');
      }

      if (!idMaterial && !categoria) {
        throw new Error('Debe ingresar la categoria del material cuando sea nuevo');
      }

      if (categoria) {
        const hasCategoriasTable = await client.query("SELECT to_regclass('public.categorias') IS NOT NULL AS exists");
        if (Boolean(hasCategoriasTable.rows[0]?.exists)) {
          const existingCategoria = await client.query(
            'SELECT id FROM categorias WHERE lower(trim(nombre)) = lower(trim($1)) LIMIT 1',
            [categoria]
          );

          if (existingCategoria.rows.length > 0) {
            idCategoriaDetalle = Number(existingCategoria.rows[0].id || 0) || null;
          } else {
            const createdCategoria = await client.query(
              'INSERT INTO categorias (nombre) VALUES ($1) RETURNING id',
              [categoria]
            );
            idCategoriaDetalle = Number(createdCategoria.rows[0].id || 0) || null;
          }
        }
      }

      if (idMaterial) {
        const materialExists = await client.query('SELECT id FROM materiales WHERE id = $1 LIMIT 1', [idMaterial]);
        if (materialExists.rows.length === 0) {
          throw new Error(`Material no existe: ${idMaterial}`);
        }
      }

      const detailNameColumn = Object.prototype.hasOwnProperty.call(detailMetaByColumn, 'nombre_material')
        ? 'nombre_material'
        : 'descripcion';
      const columns = ['id_compra', 'id_material', detailNameColumn, 'cantidad'];
      const values = [idCompra, idMaterial, descripcion || null, cantidad];

      if (Object.prototype.hasOwnProperty.call(detailMetaByColumn, 'precio_unitario')) {
        columns.push('precio_unitario');
        values.push(Number(item.precio_unitario || 0));
      }

      if (Object.prototype.hasOwnProperty.call(detailMetaByColumn, 'subtotal')) {
        columns.push('subtotal');
        values.push(Number(item.subtotal || 0));
      }

      const hasColumn = (name) => Object.prototype.hasOwnProperty.call(detailMetaByColumn, name);
      const addIfMissing = (name, value) => {
        if (hasColumn(name) && !columns.includes(name)) {
          columns.push(name);
          values.push(value);
        }
      };

      addIfMissing('total', Number(item.total || item.subtotal || 0));
      addIfMissing('categoria', categoria || null);
      addIfMissing('id_categoria', idCategoriaDetalle || null);

      if (hasColumn('id_unidad') && item && Object.prototype.hasOwnProperty.call(item, 'id_unidad') && item.id_unidad !== '') {
        const unidadId = Number(item.id_unidad || 0);
        if (!Number.isInteger(unidadId) || unidadId <= 0) {
          throw new Error('id_unidad debe ser valido');
        }
        const unidadExists = await client.query('SELECT id FROM unidades WHERE id = $1 LIMIT 1', [unidadId]);
        if (unidadExists.rows.length === 0) {
          throw new Error('id_unidad no existe en unidades');
        }
        columns.push('id_unidad');
        values.push(unidadId);
      }

      const maybeRequiredColumns = Object.keys(detailMetaByColumn)
        .filter((col) => {
          if (columns.includes(col)) return false;
          if (['id', 'id_compra', 'id_material', 'descripcion', 'cantidad'].includes(col)) return false;
          const meta = detailMetaByColumn[col];
          return meta && meta.is_nullable === 'NO' && !meta.column_default;
        });

      for (const col of maybeRequiredColumns) {
        const meta = detailMetaByColumn[col];
        const type = String(meta.data_type || meta.udt_name || '').toLowerCase();

        if (type.includes('numeric') || type.includes('integer') || type.includes('double') || type.includes('real')) {
          addIfMissing(col, 0);
        } else if (type.includes('timestamp') || type.includes('date')) {
          addIfMissing(col, new Date());
        } else if (type.includes('boolean')) {
          addIfMissing(col, false);
        } else {
          addIfMissing(col, 'N/D');
        }
      }

      const placeholders = values.map((_, idx) => `$${idx + 1}`);

      await client.query(
        `
          INSERT INTO detalle_compras (${columns.join(', ')})
          VALUES (${placeholders.join(', ')})
        `,
        values
      );

      const comentariosConCategorias = buildPurchaseComment({
        comentarios: '',
        itemCategorias: itemCategoriesMap,
      });

      if (comentariosConCategorias) {
        await client.query(
          'UPDATE compras SET comentarios = $1 WHERE id = $2',
          [comentariosConCategorias, idCompra]
        );
      }

      const { createApprovalRowsForEntity } = require('../services/approval');

      const approvalSetup = await createApprovalRowsForEntity(client, {
        tipo: 'COMPRA',
        referenciaId: idCompra,
        creatorRoleId: Number(req.user?.id_role || req.user?.rol_id || 0),
        creatorUserId: Number(req.user?.id || 0),
        creatorAreaId: Number(req.user?.id_area || 0),
      });

      if (approvalSetup.autoApproved) {
        await client.query(
          `
            UPDATE compras
            SET estado = 'APROBADA',
                estado_pedido = 'APROBADO',
                fecha_actualizacion = ${PET_SQL_NOW}
            WHERE id = $1
          `,
          [idCompra]
        );
      }

      await client.query('COMMIT');

      const created = await fetchComprasRows([idCompra], 'WHERE c.id = $1');
      res.status(201).json(created[0]);
    } catch (error) {
      if (client) await client.query('ROLLBACK');
      res.status(500).json({ error: error.message });
    } finally {
      if (client) client.release();
    }
  });

  app.patch('/api/compras/:id/estado', authMiddleware, async (req, res) => {
    let client;

    try {
      client = await pool.connect();

      const { id } = req.params;
      const estado = normalize(req.body.estado);

      if (!['APROBADA', 'RECHAZADA'].includes(estado)) {
        return res.status(400).json({ error: 'Estado invalido. Usa APROBADA o RECHAZADA' });
      }

      await client.query('BEGIN');

      const compraRow = await client.query(
        'SELECT id, estado FROM compras WHERE id = $1 FOR UPDATE',
        [id]
      );

      if (compraRow.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Compra no encontrada' });
      }

      const { hasAprobacionesTable } = require('../services/approval');

      const approvalRows = await client.query(
        `
          SELECT id
          FROM aprobaciones
          WHERE upper(trim(tipo)) = 'COMPRA'
            AND referencia_id = $1
          LIMIT 1
        `,
        [id]
      ).catch(() => ({ rows: [] }));

      const useApprovalTable = approvalRows.rows.length > 0;

      if (useApprovalTable) {
        await client.query('ROLLBACK');

        const approvalResult = await aprobarEntidad(req.user, 'compra', id, estado);
        if (!approvalResult?.ok) {
          return res.status(500).json({ error: 'No se pudo aprobar la compra' });
        }

        const refreshed = await fetchComprasRows([id], 'WHERE c.id = $1');
        if (refreshed[0]) {
          refreshed[0].aprobadores = await fetchApprovedApproversByEntity(pool, {
            tipo: 'COMPRA',
            referenciaId: refreshed[0].id,
          });
          refreshed[0].historial_aprobaciones = await fetchApprovalHistoryByEntity(pool, {
            tipo: 'COMPRA',
            referenciaId: refreshed[0].id,
          });
        }

        return res.json(refreshed[0]);
      } else {
        if (!canManagePurchasesRole(req.user?.rol)) {
          await client.query('ROLLBACK');
          return res.status(403).json({ error: 'Sin permiso para gestionar compras' });
        }

        const isRejected = estado === 'RECHAZADA';
        await client.query(
          `
            UPDATE compras
            SET estado = $1,
                estado_pedido = $2,
                fecha_actualizacion = ${PET_SQL_NOW}
            WHERE id = $3
          `,
          [isRejected ? 'RECHAZADO' : estado, isRejected ? 'RECHAZADO' : estado, id]
        );
      }

      await client.query('COMMIT');

      const result = await fetchComprasRows([id], 'WHERE c.id = $1');
      if (result[0]) {
        result[0].aprobadores = await fetchApprovedApproversByEntity(pool, {
          tipo: 'COMPRA',
          referenciaId: result[0].id,
        });
        result[0].historial_aprobaciones = await fetchApprovalHistoryByEntity(pool, {
          tipo: 'COMPRA',
          referenciaId: result[0].id,
        });
      }
      res.json(result[0]);
    } catch (error) {
      if (client) await client.query('ROLLBACK');

      const mapped = mapApprovalDecisionErrorToHttp(error);
      if (mapped.expose) {
        return res.status(mapped.status).json({ error: error.message });
      }

      res.status(500).json({ error: error.message });
    } finally {
      if (client) client.release();
    }
  });

  app.patch('/api/compras/:id/completar-datos', authMiddleware, async (req, res) => {
    try {
      const { id } = req.params;

      const compraRows = await fetchComprasRows([id], 'WHERE c.id = $1');
      if (compraRows.length === 0) {
        return res.status(404).json({ error: 'Compra no encontrada' });
      }

      const row = compraRows[0];
      const canOperateCompra = isComprasOperatorUser(req.user);
      const isOwner = Number(row.id_usuario) === Number(req.user.id);

      if (!isOwner && !canOperateCompra) {
        return res.status(403).json({ error: 'No autorizado para completar esta compra' });
      }

      if (!isOwner) {
        const hasFinalApproval = await hasEffectiveFinalApprovalByRole(pool, {
          tipo: 'COMPRA',
          referenciaId: id,
          roleId: 7,
        });

        if (!hasFinalApproval) {
          return res.status(400).json({ error: 'La compra aun no tiene aprobacion final de gerencia de finanzas' });
        }
      }

      if (!['APROBADA', 'APROBADO'].includes(normalize(row.estado))) {
        return res.status(400).json({ error: 'Solo se pueden completar datos en compras APROBADAS' });
      }

      const payload = req.body || {};
      const detallePersist = String(payload.detalle || '').trim();
      const payloadUnidadRaw = Number(payload.id_unidad || 0);
      const payloadItemsUnidades = payload.items_unidades && typeof payload.items_unidades === 'object'
        ? Object.values(payload.items_unidades)
            .map((value) => Number(value || 0))
            .filter((value) => Number.isInteger(value) && value > 0)
        : [];
      const idUnidadCompra = Number.isInteger(payloadUnidadRaw) && payloadUnidadRaw > 0
        ? payloadUnidadRaw
        : (payloadItemsUnidades.length === 1 ? payloadItemsUnidades[0] : null);

      const parsedExistingComments = parsePurchaseComments(row.comentarios);
      const shouldReplaceVisibleComments = Object.prototype.hasOwnProperty.call(payload, 'detalle')
        || Object.prototype.hasOwnProperty.call(payload, 'comentarios');
      const visibleCommentsToPersist = shouldReplaceVisibleComments
        ? String(payload.detalle || payload.comentarios || '').trim()
        : parsedExistingComments.comentarios;
      const comentariosPersist = buildPurchaseComment({
        comentarios: visibleCommentsToPersist,
        recibidoPor: parsedExistingComments.recibido_por,
        itemCategorias: parsedExistingComments.item_categorias,
        entregaArea: parsedExistingComments.entrega_area,
        comentariosHistorial: parsedExistingComments.comentarios_historial,
      });

      const comprasRetencionMeta = await pool.query(
        `
          SELECT data_type, udt_name
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'compras'
            AND column_name = 'retencion'
          LIMIT 1
        `
      );

      const providerId = payload.id_proveedor ? Number(payload.id_proveedor) : null;
      if (!providerId) {
        return res.status(400).json({ error: 'Debe seleccionar un proveedor existente de la lista' });
      }

      const providerResult = await pool.query(
        `
          SELECT ${buildProveedorSelectExpressions().join(', ')}, COALESCE(mo.nombre, '') AS moneda_nombre
          FROM proveedores p
          LEFT JOIN monedas mo ON mo.id = p.id_moneda
          WHERE p.id = $1
          LIMIT 1
        `,
        [providerId]
      );

      if (providerResult.rows.length === 0) {
        return res.status(400).json({ error: 'Proveedor seleccionado no existe' });
      }

      const providerData = providerResult.rows[0];
      const subtotal = Number(payload.subtotal || 0);
      const costoEnvio = Number(payload.costo_envio || 0);
      const otrosCostos = Number(payload.otros_costos || 0);
      const igvCalc = Number((subtotal * 0.18).toFixed(2));
      const totalCalc = Number((subtotal + igvCalc + costoEnvio + otrosCostos).toFixed(2));

      const idMoneda = Number(providerData?.id_moneda || 0);
      if (!Number.isInteger(idMoneda) || idMoneda <= 0) {
        return res.status(400).json({ error: 'El proveedor seleccionado no tiene moneda configurada' });
      }

      const monedaExists = await pool.query('SELECT id, nombre FROM monedas WHERE id = $1 LIMIT 1', [idMoneda]);
      if (monedaExists.rows.length === 0) {
        return res.status(400).json({ error: 'La moneda seleccionada no existe en la tabla monedas' });
      }

      const monedaNombre = String(monedaExists.rows[0].nombre || '').trim();
      if (!monedaNombre) {
        return res.status(400).json({ error: 'La moneda seleccionada no tiene nombre valido' });
      }

      const providerRetencionFlag = String(providerData?.retencion || '').trim().toUpperCase() === 'SI';
      const descuentoNum = Number(providerData?.descuento ?? 0);
      if (!Number.isFinite(descuentoNum) || descuentoNum < 0) {
        return res.status(400).json({ error: 'retencion (%) debe ser numerica y >= 0' });
      }

      const tipoCambioRaw = payload.tipo_cambio;
      const tipoCambioNum = tipoCambioRaw === undefined || String(tipoCambioRaw).trim() === ''
        ? (row.tipo_cambio === null || row.tipo_cambio === undefined ? null : Number(row.tipo_cambio))
        : Number(tipoCambioRaw);
      if (tipoCambioNum !== null && (!Number.isFinite(tipoCambioNum) || tipoCambioNum <= 0)) {
        return res.status(400).json({ error: 'tipo_cambio debe ser numerico y mayor a 0' });
      }

      const tipoRetencionNorm = normalize(providerData?.tipo_retencion || 'RETENCION');
      if (!['RETENCION', 'DETRACCION'].includes(tipoRetencionNorm)) {
        return res.status(400).json({ error: 'tipo_retencion solo puede ser RETENCION o DETRACCION' });
      }

      if (!providerData?.id_moneda) {
        return res.status(400).json({ error: 'El proveedor no tiene moneda configurada en BD' });
      }

      const monedaNorm = String(monedaNombre || '').toUpperCase();
      const isUsd = /USD|US\$|\$|DOL|DÓLAR|DOLAR/.test(monedaNorm);
      const isPen = /PEN|SOL/.test(monedaNorm);
      const totalBase = totalCalc;
      const tipoCambioUsd = Number.isFinite(tipoCambioNum) && tipoCambioNum > 0
        ? tipoCambioNum
        : 3.5;
      const totalEnSoles = isUsd ? Number((totalBase * tipoCambioUsd).toFixed(2)) : totalBase;
      const superaUmbral = (isPen && totalBase > 700) || (isUsd && totalEnSoles > 700);
      const aplicaRetencion = providerRetencionFlag && descuentoNum > 0 && superaUmbral;
      const montoRetencion = aplicaRetencion
        ? Number((totalBase * (descuentoNum / 100)).toFixed(2))
        : 0;
      const importeFinalCalc = aplicaRetencion
        ? Number((totalBase - montoRetencion).toFixed(2))
        : totalBase;

      if (importeFinalCalc < 0) {
        return res.status(400).json({ error: 'importe_final no puede ser negativo' });
      }

      const tipoNorm = normalize(providerData?.tipo || payload.tipo || '');
      if (tipoNorm && !['BIEN', 'SERVICIO'].includes(tipoNorm)) {
        return res.status(400).json({ error: 'tipo solo puede ser BIEN o SERVICIO' });
      }

      const retencionIndicador = providerRetencionFlag ? 'SI' : 'NO';
      const retencionType = String(comprasRetencionMeta.rows[0]?.data_type || comprasRetencionMeta.rows[0]?.udt_name || '').toLowerCase();
      const retencionPersist = retencionType.includes('boolean')
        ? (normalize(retencionIndicador) === 'SI' || normalize(retencionIndicador) === 'TRUE')
        : retencionIndicador;

      const requiredProviderValues = {
        proveedor: (providerData?.razon_social || payload.proveedor || ''),
        ruc: (providerData?.ruc || payload.ruc || ''),
        direccion: (providerData?.direccion || payload.direccion || ''),
        distrito: (providerData?.distrito || payload.distrito || ''),
        correo: (providerData?.correo || payload.correo || ''),
        persona_responsable: (providerData?.persona_responsable || payload.persona_responsable || ''),
        telefono: (providerData?.telefono || payload.telefono || ''),
        condiciones_pago: (providerData?.condiciones_pago || payload.condiciones_pago || ''),
        banco: (providerData?.banco || payload.banco || ''),
        moneda: (monedaNombre || providerData?.moneda || providerData?.moneda_nombre || ''),
        numero_cuenta: (providerData?.numero_cuenta || payload.numero_cuenta || payload.cuenta || ''),
        cci: (providerData?.cci || payload.cci || ''),
        retencion: String(retencionIndicador),
        descuento: String(descuentoNum),
        tipo: (providerData?.tipo || payload.tipo || ''),
        tipo_retencion: tipoRetencionNorm,
      };

      const missingProviderFields = Object.entries(requiredProviderValues)
        .filter(([, value]) => !String(value || '').trim())
        .map(([key]) => key);

      if (missingProviderFields.length > 0) {
        return res.status(400).json({ error: `Proveedor seleccionado con datos incompletos: ${missingProviderFields.join(', ')}` });
      }

      await pool.query(
        `
          UPDATE compras
          SET id_proveedor = $1,
              proveedor = $2,
              ruc = $3,
              direccion = $4,
              distrito = $5,
              correo = $6,
              persona_responsable = $7,
              telefono = $8,
              contacto_proveedor = $9,
              banco = $10,
              moneda = $11,
              id_moneda = $12,
              numero_cuenta = $13,
              cuenta = $14,
              cci = $15,
              retencion = $16,
              descuento = $17,
              tipo_cambio = $18,
              aplica_retencion = $19,
              tipo = $20,
              tipo_retencion = $21,
              importe_final = $22,
              condiciones_pago = $23,
              subtotal = $24,
              costo_envio = $25,
              otros_costos = $26,
              igv = $27,
              total = $28,
              detalle = $29,
              comentarios = $30,
              id_area_final = $31,
              id_unidad = COALESCE($32, id_unidad),
              fecha_actualizacion = ${PET_SQL_NOW}
            WHERE id = $33
        `,
        [
          providerId,
          (providerData?.razon_social || payload.proveedor || null),
          (providerData?.ruc || payload.ruc || null),
          (providerData?.direccion || payload.direccion || null),
          (providerData?.distrito || payload.distrito || null),
          (providerData?.correo || payload.correo || null),
          (providerData?.persona_responsable || payload.persona_responsable || null),
          (providerData?.telefono || payload.telefono || null),
          (providerData?.persona_responsable || payload.contacto_proveedor || null),
          (providerData?.banco || payload.banco || null),
          (monedaNombre || providerData?.moneda || providerData?.moneda_nombre || null),
          idMoneda,
          (providerData?.numero_cuenta || payload.numero_cuenta || payload.cuenta || null),
          (providerData?.numero_cuenta || payload.cuenta || payload.numero_cuenta || null),
          (providerData?.cci || payload.cci || null),
          retencionPersist,
          descuentoNum,
          tipoCambioNum,
          aplicaRetencion,
          (providerData?.tipo || payload.tipo || null),
          tipoRetencionNorm,
          importeFinalCalc,
          (providerData?.condiciones_pago || payload.condiciones_pago || null),
          subtotal,
          costoEnvio,
          otrosCostos,
          igvCalc,
          importeFinalCalc,
          detallePersist,
          comentariosPersist,
          payload.id_area_final ? Number(payload.id_area_final) : null,
          idUnidadCompra,
          id,
        ]
      );

      if (schemaMeta.comprasColumns.has('razon_social')) {
        await pool.query(
          'UPDATE compras SET razon_social = $1 WHERE id = $2',
          [(providerData?.razon_social || payload.proveedor || null), id]
        );
      }

      const result = await fetchComprasRows([id], 'WHERE c.id = $1');
      res.json(result[0]);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/compras/:id/generar-orden', authMiddleware, async (req, res) => {
    let client;

    try {
      client = await pool.connect();
      const { id } = req.params;
      await client.query('BEGIN');

      const compras = await fetchComprasRows([id], 'WHERE c.id = $1');
      if (compras.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Compra no encontrada' });
      }

      const compra = compras[0];

      const canOperateCompra = isComprasOperatorUser(req.user);
      const isOwner = Number(compra.id_usuario) === Number(req.user.id);

      if (!isOwner && !canOperateCompra) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'No autorizado para generar orden de esta compra' });
      }

      if (!isOwner) {
        const hasFinalApproval = await hasEffectiveFinalApprovalByRole(client, {
          tipo: 'COMPRA',
          referenciaId: id,
          roleId: 7,
        });

        if (!hasFinalApproval) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'La compra aun no tiene aprobacion final de gerencia de finanzas' });
        }
      }

      if (!['APROBADA', 'APROBADO'].includes(normalize(compra.estado))) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Solo se puede generar orden para compras APROBADAS' });
      }

      const contactoProveedor = String(compra.contacto_proveedor || compra.persona_responsable || '').trim();
      const cuentaProveedor = String(compra.cuenta || compra.numero_cuenta || '').trim();

      const missing = [];
      if (!String(compra.proveedor || '').trim()) missing.push('proveedor');
      if (!contactoProveedor) missing.push('contacto_proveedor');
      if (!String(compra.banco || '').trim()) missing.push('banco');
      if (!cuentaProveedor) missing.push('cuenta');
      if (!String(compra.cci || '').trim()) missing.push('cci');
      if (!String(compra.condiciones_pago || '').trim()) missing.push('condiciones_pago');
      if (!compra.subtotal && compra.subtotal !== 0) missing.push('subtotal');
      if (!compra.igv && compra.igv !== 0) missing.push('igv');
      if (!compra.total && compra.total !== 0) missing.push('total');
      if (!compra.id_area_final) missing.push('id_area_final');

      if (missing.length > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Faltan datos para generar OC: ${missing.join(', ')}` });
      }

      const orderCode = compra.numero_orden || `OC-${String(compra.id).padStart(6, '0')}`;

      const hasEstadoPedidoColumn = schemaMeta.comprasColumns.has('estado_pedido');
      const updateOrderQuery = `
        UPDATE compras
        SET ${hasEstadoPedidoColumn ? "estado_pedido = 'POR_RECIBIR'," : ''}
            numero_orden = $1,
            fecha_actualizacion = ${PET_SQL_NOW}
        WHERE id = $2
      `;

      await client.query(updateOrderQuery, [orderCode, id]);

      await client.query('COMMIT');

      const updated = await fetchComprasRows([id], 'WHERE c.id = $1');
      const finalCompra = updated[0];
      finalCompra.aprobadores = await fetchApprovedApproversByEntity(pool, {
        tipo: 'COMPRA',
        referenciaId: finalCompra.id,
      });
      const pdfBase64 = await buildCompraPdfBase64(finalCompra);

      res.json({
        compra: finalCompra,
        archivo: {
          nombre: `orden_compra_${finalCompra.id}.pdf`,
          mime: 'application/pdf',
          base64: pdfBase64,
        },
      });
    } catch (error) {
      if (client) await client.query('ROLLBACK');
      res.status(500).json({ error: error.message });
    } finally {
      if (client) client.release();
    }
  });

  app.patch('/api/compras/:id/marcar-recibido-almacen', authMiddleware, async (req, res) => {
    let client;

    try {
      client = await pool.connect();

      if (!canManageDeliveryRole(req.user?.rol) && !isComprasOperatorUser(req.user)) {
        return res.status(403).json({ error: 'Sin permiso para gestionar entrega' });
      }

      const { id } = req.params;
      const idCompra = Number(id || 0);

      if (!idCompra) {
        return res.status(400).json({ error: 'ID de compra invalido' });
      }

      await client.query('BEGIN');

      const compraResult = await client.query(
        `
          SELECT
            id,
            COALESCE(to_jsonb(compras)->>'estado_pedido', to_jsonb(compras)->>'estado', '') AS estado,
            NULLIF(to_jsonb(compras)->>'id_area_final', '')::int AS id_area_final,
            NULLIF(to_jsonb(compras)->>'id_area_solicitante', '')::int AS id_area_solicitante,
            NULLIF(to_jsonb(compras)->>'id_unidad', '')::int AS id_unidad
          FROM compras
          WHERE id = $1
          FOR UPDATE
        `,
        [idCompra]
      );

      if (compraResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Compra no encontrada' });
      }

      const compra = compraResult.rows[0];
      const estadoActual = normalize(compra.estado);
      const idUnidadCompra = Number(compra.id_unidad || 0);

      if (estadoActual !== 'POR_RECIBIR') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Solo se puede marcar como recibido compras en estado POR_RECIBIR' });
      }

      if (idUnidadCompra > 0) {
        await client.query(
          `
            UPDATE detalle_compras
            SET id_unidad = $1
            WHERE id_compra = $2
              AND id_material IS NOT NULL
              AND (id_unidad IS NULL OR id_unidad = 0)
          `,
          [idUnidadCompra, idCompra]
        );
      }

      const materialUnitRows = await client.query(
        `
          SELECT
            id_material,
            MAX(NULLIF(to_jsonb(dc)->>'id_unidad', '')::int) AS id_unidad
          FROM detalle_compras dc
          WHERE id_compra = $1
            AND id_material IS NOT NULL
          GROUP BY id_material
        `,
        [idCompra]
      );

      for (const materialUnitRow of materialUnitRows.rows) {
        const materialId = Number(materialUnitRow.id_material || 0);
        const detailUnitId = Number(materialUnitRow.id_unidad || 0);
        const unitIdToUse = detailUnitId || idUnidadCompra;
        if (!materialId || !unitIdToUse) continue;

        await client.query(
          'UPDATE materiales SET id_unidad = $1 WHERE id = $2',
          [unitIdToUse, materialId]
        );
      }

      const idAreaFinal = Number(compra.id_area_final || 0);
      const idAreaSolicitante = Number(compra.id_area_solicitante || 0);
      const isGeneralDestination = idAreaFinal === 0 || idAreaFinal === idAreaSolicitante;

      const areaDestinoQuery = await client.query(
        `
          SELECT COALESCE(a_fin.nombre, a_sol.nombre, '') AS area_destino_nombre
          FROM compras c
          LEFT JOIN areas a_sol ON a_sol.id = c.id_area_solicitante
          LEFT JOIN areas a_fin ON a_fin.id = c.id_area_final
          WHERE c.id = $1
        `,
        [idCompra]
      );
      const areaDestinoNorm = normalize(areaDestinoQuery.rows[0]?.area_destino_nombre || '');
      const shouldRegisterStock = isWarehouseAreaName(areaDestinoNorm);

      const detailRows = await client.query(
        `
          SELECT id_material, SUM(cantidad)::numeric AS cantidad_total
          FROM detalle_compras
          WHERE id_compra = $1
            AND id_material IS NOT NULL
          GROUP BY id_material
        `,
        [idCompra]
      );

      if (detailRows.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'La compra no tiene materiales vinculados' });
      }

      let idAlmacen = null;

      if (shouldRegisterStock) {
        const defaultWarehouse = await client.query(
          `
            SELECT id
            FROM almacenes
            ORDER BY CASE WHEN upper(trim(nombre)) = 'GENERAL' THEN 0 ELSE 1 END, id ASC
            LIMIT 1
          `
        );

        if (defaultWarehouse.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'No existe un almacen configurado para registrar recepcion' });
        }

        idAlmacen = Number(defaultWarehouse.rows[0].id);
      }

      const idMovimientoEntrada = await insertMovimiento(client, {
        tipo: 'ENTRADA',
        usuarioRegistro: req.user.id,
        idAlmacen,
      });

      if (shouldRegisterStock) {
        for (const detail of detailRows.rows) {
          const idMaterial = Number(detail.id_material || 0);
          const qty = Number(detail.cantidad_total || 0);

          if (!idMaterial || qty <= 0) continue;

          await client.query(
            `
              INSERT INTO movimiento_detalles (id_movimiento, id_material, cantidad)
              VALUES ($1, $2, $3)
            `,
            [idMovimientoEntrada, idMaterial, qty]
          );

          const stockRow = await client.query(
            'SELECT id FROM stock WHERE id_material = $1 AND id_almacen = $2 FOR UPDATE',
            [idMaterial, idAlmacen]
          );

          if (stockRow.rows.length === 0) {
            await client.query(
              'INSERT INTO stock (id_material, id_almacen, cantidad) VALUES ($1, $2, $3)',
              [idMaterial, idAlmacen, qty]
            );
          } else {
            await client.query('UPDATE stock SET cantidad = cantidad + $1 WHERE id = $2', [qty, stockRow.rows[0].id]);
          }
        }
      }

      await client.query(
        `UPDATE compras SET estado_pedido = $1, fecha_actualizacion = ${PET_SQL_NOW} WHERE id = $2`,
        [isGeneralDestination ? 'RECIBIDA' : 'RECIBIDO_EN_ALMACEN', idCompra]
      );

      await client.query('COMMIT');

      const result = await fetchComprasRows([idCompra], 'WHERE c.id = $1');
      const response = { ...result[0] };
      response.movimientos_generados = [idMovimientoEntrada];
      response.id_almacen_entrada = idAlmacen;
      res.json(response);
    } catch (error) {
      if (client) await client.query('ROLLBACK');
      res.status(500).json({ error: error.message });
    } finally {
      if (client) client.release();
    }
  });

  app.patch('/api/compras/:id/recepcionar', authMiddleware, async (req, res) => {
    let client;

    try {
      client = await pool.connect();

      if (!canManageDeliveryRole(req.user?.rol)) {
        return res.status(403).json({ error: 'Sin permiso para gestionar entrega' });
      }

      const { id } = req.params;
      const puntuacion = Number(req.body?.puntuacion || 0);
      const comentario = String(req.body?.comentario || '').trim();

      if (!Number.isInteger(puntuacion) || puntuacion < 1 || puntuacion > 5) {
        return res.status(400).json({ error: 'La calificacion del proveedor es obligatoria (1-5)' });
      }

      await client.query('BEGIN');

      const compra = await client.query(
        `
          SELECT
            id,
            COALESCE(to_jsonb(compras)->>'estado_pedido', to_jsonb(compras)->>'estado', '') AS estado,
            COALESCE(to_jsonb(compras)->>'comentarios', '') AS comentarios,
            NULLIF(to_jsonb(compras)->>'id_area_solicitante', '')::int AS id_area_solicitante,
            NULLIF(to_jsonb(compras)->>'id_area_final', '')::int AS id_area_final,
            NULLIF(to_jsonb(compras)->>'id_proveedor', '')::int AS id_proveedor,
            NULLIF(to_jsonb(compras)->>'id_moneda', '')::int AS id_moneda,
            COALESCE(to_jsonb(compras)->>'moneda', '') AS moneda,
            COALESCE(NULLIF(to_jsonb(compras)->>'subtotal', '')::numeric, 0) AS subtotal,
            COALESCE(NULLIF(to_jsonb(compras)->>'total', '')::numeric, 0) AS total,
            COALESCE(NULLIF(to_jsonb(compras)->>'igv', '')::numeric, 0) AS igv,
            COALESCE(NULLIF(to_jsonb(compras)->>'costo_envio', '')::numeric, 0) AS costo_envio,
            COALESCE(NULLIF(to_jsonb(compras)->>'otros_costos', '')::numeric, 0) AS otros_costos,
            NULLIF(to_jsonb(compras)->>'id_unidad', '')::int AS id_unidad
          FROM compras
          WHERE id = $1
          FOR UPDATE
        `,
        [id]
      );

      if (compra.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Compra no encontrada' });
      }

      const row = compra.rows[0];
      const parsedCompraComments = parsePurchaseComments(row.comentarios);
      const itemCategoriesFromComments = parsedCompraComments.item_categorias || {};

      const areaRow = await client.query(
        `
          SELECT COALESCE(a_fin.nombre, a_sol.nombre, '') AS area_destino_nombre
          FROM compras c
          LEFT JOIN areas a_sol ON a_sol.id = c.id_area_solicitante
          LEFT JOIN areas a_fin ON a_fin.id = c.id_area_final
          WHERE c.id = $1
        `,
        [id]
      );
      const estadoActual = normalize(row.estado);
      const areaDestinoNorm = normalize(areaRow.rows[0]?.area_destino_nombre || '');
      const isWarehouseDestination = isWarehouseAreaName(areaDestinoNorm);
      const isOtherAreaDelivery = Boolean(areaDestinoNorm && !isWarehouseDestination);

      if (estadoActual === 'RECIBIDA') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'La compra ya fue recepcionada y procesada' });
      }

      if (!['PENDIENTE', 'POR_RECIBIR'].includes(estadoActual)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Solo se puede confirmar recepcion para compras pendientes o por recibir' });
      }

      const hasDetalleCategoria = schemaMeta.detalleComprasColumns.has('categoria');
      const hasDetalleSubtotal = schemaMeta.detalleComprasColumns.has('subtotal');

      const materialColumnsMeta = await client.query(
        `
          SELECT column_name
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'materiales'
        `
      );

      const materialColumns = new Set(materialColumnsMeta.rows.map((r) => String(r.column_name || '').trim()));
      const materialCostoColumn = pickExistingColumn(materialColumns, ['costo_unitario', 'precio_unitario', 'costo']);
      const materialCategoriaColumn = materialColumns.has('categoria') ? 'categoria' : null;
      const materialIdMonedaColumn = ['id_moneda']
        .find((candidate) => materialColumns.has(candidate));

      const pendingLinkRows = await client.query(
        `
          SELECT
            dc.id,
            COALESCE(
              NULLIF(to_jsonb(dc)->>'descripcion', ''),
              NULLIF(to_jsonb(dc)->>'nombre_material', ''),
              ''
            ) AS descripcion,
            COALESCE(dc.cantidad, 0)::numeric AS cantidad,
            NULLIF(to_jsonb(dc)->>'id_unidad', '')::int AS id_unidad,
            ${hasDetalleCategoria ? "COALESCE(NULLIF(to_jsonb(dc)->>'categoria', ''), '')" : "''"} AS categoria,
            ${hasDetalleSubtotal ? 'COALESCE(dc.subtotal, 0)::numeric' : '0::numeric'} AS subtotal_item,
            NULLIF(to_jsonb(dc)->>'id_categoria', '')::int AS id_categoria,
            COALESCE(cat.nombre, '') AS categoria_por_id
          FROM detalle_compras dc
          LEFT JOIN categorias cat ON cat.id = NULLIF(to_jsonb(dc)->>'id_categoria', '')::int
          WHERE dc.id_compra = $1
            AND dc.id_material IS NULL
        `,
        [id]
      );

      const compraUnitId = Number(row.id_unidad || 0);
      if (compraUnitId > 0) {
        await client.query(
          `
            UPDATE detalle_compras
            SET id_unidad = $1
            WHERE id_compra = $2
              AND id_material IS NOT NULL
              AND (id_unidad IS NULL OR id_unidad = 0)
          `,
          [compraUnitId, id]
        );
      }

      const materialUnitRows = await client.query(
        `
          SELECT
            id_material,
            MAX(NULLIF(to_jsonb(dc)->>'id_unidad', '')::int) AS id_unidad
          FROM detalle_compras dc
          WHERE dc.id_compra = $1
            AND dc.id_material IS NOT NULL
          GROUP BY id_material
        `,
        [id]
      );

      for (const materialUnitRow of materialUnitRows.rows) {
        const materialId = Number(materialUnitRow.id_material || 0);
        const detailUnitId = Number(materialUnitRow.id_unidad || 0);
        const unitIdToUse = detailUnitId || compraUnitId;
        if (!materialId || !unitIdToUse) continue;

        await client.query(
          'UPDATE materiales SET id_unidad = $1 WHERE id = $2',
          [unitIdToUse, materialId]
        );
      }

      const currencyIdResolved = Number(row.id_moneda || 0);
      if (!currencyIdResolved) {
        throw new Error('La compra debe tener una moneda definida');
      }

      const currencyLookup = await client.query(
        `
          SELECT id, nombre
          FROM monedas
          WHERE id = $1
          LIMIT 1
        `,
        [currencyIdResolved]
      );

      if (currencyLookup.rows.length === 0) {
        throw new Error('La moneda de la compra no existe en la tabla monedas');
      }

      const tableFlags = await client.query(
        `
          SELECT
            to_regclass('public.categorias') IS NOT NULL AS has_categorias,
            to_regclass('public.material_categoria') IS NOT NULL AS has_material_categoria
        `
      );
      const hasCategorias = Boolean(tableFlags.rows[0]?.has_categorias);
      const hasMaterialCategoria = Boolean(tableFlags.rows[0]?.has_material_categoria);

      const ensureMaterialCategoryLink = async (idMaterial, categoriaNombre) => {
        if (!categoriaNombre || !hasCategorias) return;

        let categoriaId = null;
        const existingCategoria = await client.query(
          'SELECT id FROM categorias WHERE lower(trim(nombre)) = lower(trim($1)) LIMIT 1',
          [categoriaNombre]
        );

        if (existingCategoria.rows.length > 0) {
          categoriaId = Number(existingCategoria.rows[0].id);
        } else {
          const createdCategoria = await client.query(
            'INSERT INTO categorias (nombre) VALUES ($1) RETURNING id',
            [categoriaNombre]
          );
          categoriaId = Number(createdCategoria.rows[0].id);
        }

        await client.query(
          'UPDATE materiales SET id_categoria = $1 WHERE id = $2',
          [categoriaId, idMaterial]
        );

        if (hasMaterialCategoria) {
          const hasLink = await client.query(
            'SELECT 1 FROM material_categoria WHERE id_material = $1 AND id_categoria = $2 LIMIT 1',
            [idMaterial, categoriaId]
          );

          if (hasLink.rows.length === 0) {
            await client.query(
              'INSERT INTO material_categoria (id_material, id_categoria) VALUES ($1, $2)',
              [idMaterial, categoriaId]
            );
          }
        }
      };

      const idProveedorCompra = Number(row.id_proveedor || 0);
      let idUnidadDefault = null;
      const ensureDefaultUnit = async () => {
        if (idUnidadDefault) return idUnidadDefault;

        const unidad = await client.query(
          `
            SELECT id
            FROM unidades
            ORDER BY CASE WHEN upper(trim(nombre)) = 'UNIDAD' THEN 0 ELSE 1 END, id ASC
            LIMIT 1
          `
        );

        if (unidad.rows.length === 0) {
          throw new Error('No existe una unidad configurada para crear materiales automaticamente');
        }

        idUnidadDefault = Number(unidad.rows[0].id);
        return idUnidadDefault;
      };

      const unresolvedDescriptions = [];

      const subtotalCompraPersistido = Number(row.subtotal || 0) > 0
        ? Number(row.subtotal || 0)
        : Number((
          Number(row.total || 0)
          - Number(row.igv || 0)
          - Number(row.costo_envio || 0)
          - Number(row.otros_costos || 0)
        ).toFixed(6));

      if (!Number.isFinite(subtotalCompraPersistido) || subtotalCompraPersistido <= 0) {
        throw new Error('Subtotal invalido en la orden de compra. Debe ser mayor a 0 para calcular costo unitario');
      }

      for (const pending of pendingLinkRows.rows) {
        const descripcion = String(pending.descripcion || '').trim();
        const categoriaDetalle = String(pending.categoria || '').trim();
        const categoriaPorId = String(pending.categoria_por_id || '').trim();
        const categoriaFallback = String(itemCategoriesFromComments[normalizeItemCategoryKey(descripcion)] || '').trim();
        const categoria = categoriaDetalle || categoriaPorId || categoriaFallback;
        const idUnidadPendiente = Number(pending.id_unidad || 0);
        const idUnidadCompra = Number(row.id_unidad || 0);
        const idUnidadSeleccionada = Number.isInteger(idUnidadPendiente) && idUnidadPendiente > 0
          ? idUnidadPendiente
          : (Number.isInteger(idUnidadCompra) && idUnidadCompra > 0 ? idUnidadCompra : await ensureDefaultUnit());

        const cantidadItem = Number(pending.cantidad || 0);
        if (cantidadItem <= 0) {
          throw new Error(
            `Item "${descripcion}": cantidad inválida (${cantidadItem}). La cantidad debe ser mayor a 0.`
          );
        }

        const precioUnitarioFinal = Number((subtotalCompraPersistido / cantidadItem).toFixed(6));
        if (!Number.isFinite(precioUnitarioFinal)) {
          throw new Error(`Item "${descripcion}": no fue posible calcular precio unitario desde subtotal y cantidad.`);
        }

        if (!descripcion) {
          unresolvedDescriptions.push('(sin descripcion)');
          continue;
        }

        const match = await client.query(
          `
            SELECT id
            FROM materiales
            WHERE lower(trim(nombre)) = lower(trim($1))
            ORDER BY id ASC
            LIMIT 1
          `,
          [descripcion]
        );

        if (match.rows.length === 1) {
          await ensureMaterialCategoryLink(Number(match.rows[0].id), categoria);
          await client.query(
            'UPDATE materiales SET id_unidad = $1 WHERE id = $2',
            [idUnidadSeleccionada, Number(match.rows[0].id)]
          );
          await client.query(
            'UPDATE detalle_compras SET id_material = $1 WHERE id = $2',
            [Number(match.rows[0].id), Number(pending.id)]
          );
        } else {
          if (!idProveedorCompra) {
            throw new Error('La compra tiene items sin material vinculado y no tiene proveedor para crearlos automaticamente');
          }

          const idUnidad = idUnidadSeleccionada;

          const insertColumns = ['nombre', 'descripcion', 'id_unidad', 'id_proveedor'];
          const insertValues = [
            descripcion,
            'Generado automaticamente desde recepcion de compra',
            idUnidad,
            idProveedorCompra,
          ];

          if (materialCostoColumn) {
            insertColumns.push(materialCostoColumn);
            insertValues.push(precioUnitarioFinal);
          }

          if (materialCategoriaColumn && categoria) {
            insertColumns.push(materialCategoriaColumn);
            insertValues.push(categoria);
          }

          if (materialIdMonedaColumn && currencyIdResolved > 0) {
            insertColumns.push(materialIdMonedaColumn);
            insertValues.push(currencyIdResolved);
          }

          const placeholders = insertValues.map((_, idx) => `$${idx + 1}`);
          const createdMaterial = await client.query(
            `
              INSERT INTO materiales (${insertColumns.join(', ')})
              VALUES (${placeholders.join(', ')})
              RETURNING id
            `,
            insertValues
          );

          if (createdMaterial.rows.length === 0) {
            unresolvedDescriptions.push(descripcion);
            continue;
          }

          await ensureMaterialCategoryLink(Number(createdMaterial.rows[0].id), categoria);

          await client.query(
            'UPDATE detalle_compras SET id_material = $1 WHERE id = $2',
            [Number(createdMaterial.rows[0].id), Number(pending.id)]
          );
        }
      }

      if (unresolvedDescriptions.length > 0) {
        throw new Error(`La compra tiene items sin material vinculado: ${unresolvedDescriptions.join(', ')}`);
      }

      const allDetailWithMaterialRows = await client.query(
        `
          SELECT
            id_material,
            COALESCE(
              NULLIF(to_jsonb(detalle_compras)->>'descripcion', ''),
              NULLIF(to_jsonb(detalle_compras)->>'nombre_material', ''),
              ''
            ) AS descripcion,
            COALESCE(NULLIF(to_jsonb(detalle_compras)->>'categoria', ''), '') AS categoria,
            COALESCE(cat.nombre, '') AS categoria_por_id
          FROM detalle_compras
          LEFT JOIN categorias cat ON cat.id = NULLIF(to_jsonb(detalle_compras)->>'id_categoria', '')::int
          WHERE id_compra = $1
            AND id_material IS NOT NULL
        `,
        [id]
      );

      for (const detail of allDetailWithMaterialRows.rows) {
        const idMaterial = Number(detail.id_material || 0);
        if (!idMaterial) continue;

        const descripcion = String(detail.descripcion || '').trim();
        const categoriaDetalle = String(detail.categoria || '').trim();
        const categoriaPorId = String(detail.categoria_por_id || '').trim();
        const categoriaFallback = descripcion
          ? String(itemCategoriesFromComments[normalizeItemCategoryKey(descripcion)] || '').trim()
          : '';
        const categoria = categoriaDetalle || categoriaPorId || categoriaFallback;

        await ensureMaterialCategoryLink(idMaterial, categoria);
      }

      const detailRows = await client.query(
        `
          SELECT id_material, SUM(cantidad)::numeric AS cantidad_total
          FROM detalle_compras
          WHERE id_compra = $1
            AND id_material IS NOT NULL
          GROUP BY id_material
        `,
        [id]
      );

      if (detailRows.rows.length === 0) {
        throw new Error('La compra no tiene materiales vinculados para generar movimientos');
      }

      let idAlmacen = null;
      if (isWarehouseDestination) {
        const defaultWarehouse = await client.query(
          `
            SELECT id
            FROM almacenes
            ORDER BY CASE WHEN upper(trim(nombre)) = 'GENERAL' THEN 0 ELSE 1 END, id ASC
            LIMIT 1
          `
        );

        if (defaultWarehouse.rows.length === 0) {
          throw new Error('No existe un almacen configurado para registrar recepcion');
        }

        idAlmacen = Number(defaultWarehouse.rows[0].id);
      }

      const movimientoIds = [];

      const idMovimientoEntrada = await insertMovimiento(client, {
        tipo: 'ENTRADA',
        usuarioRegistro: req.user.id,
        idAlmacen,
      });
      movimientoIds.push(idMovimientoEntrada);

      for (const detail of detailRows.rows) {
        const idMaterial = Number(detail.id_material || 0);
        const qty = Number(detail.cantidad_total || 0);

        if (!idMaterial || qty <= 0) continue;

        await client.query(
          `
            INSERT INTO movimiento_detalles (id_movimiento, id_material, cantidad)
            VALUES ($1, $2, $3)
          `,
          [idMovimientoEntrada, idMaterial, qty]
        );

        if (!isWarehouseDestination) {
          continue;
        }

        const stockRow = await client.query(
          'SELECT id FROM stock WHERE id_material = $1 AND id_almacen = $2 FOR UPDATE',
          [idMaterial, idAlmacen]
        );

        if (stockRow.rows.length === 0) {
          await client.query(
            'INSERT INTO stock (id_material, id_almacen, cantidad) VALUES ($1, $2, $3)',
            [idMaterial, idAlmacen, qty]
          );
        } else {
          await client.query('UPDATE stock SET cantidad = cantidad + $1 WHERE id = $2', [qty, stockRow.rows[0].id]);
        }
      }

      const entregaAreaPayload = isOtherAreaDelivery
        ? {
            pendiente: true,
            entregado: false,
            area_destino: areaRow.rows[0]?.area_destino_nombre || '',
            fecha_recepcion_almacen: currentPetDateTime(),
          }
        : null;

      const estadoFinal = isWarehouseDestination ? 'ENTREGADO' : 'PENDIENTE_ENTREGA';

      const comentariosConRecepcion = buildPurchaseComment({
        comentarios: parsedCompraComments.comentarios,
        itemCategorias: itemCategoriesFromComments,
        recibidoPor: req.user.nombre || 'Usuario',
        entregaArea: entregaAreaPayload,
        comentariosHistorial: parsedCompraComments.comentarios_historial,
      });

      await client.query(
        'UPDATE compras SET estado_pedido = $1, comentarios = $2 WHERE id = $3',
        [estadoFinal, comentariosConRecepcion, id]
      );

      if (row.id_proveedor && puntuacion) {
        try {
          await upsertProveedorRating(client, {
            user: req.user,
            proveedorId: row.id_proveedor,
            puntuacion,
            comentario,
            tipo: 'compra',
            idReferencia: Number(id),
          });
        } catch (ratingErr) {
          if (ratingErr.code === 'RATING_ALREADY_EXISTS') {
            console.warn('[RECEPCION] Proveedor ya calificado:', ratingErr.message);
          } else {
            throw ratingErr;
          }
        }
      }

      await client.query('COMMIT');

      const result = await fetchComprasRows([id], 'WHERE c.id = $1');
      const response = {
        ...result[0],
        receptor: null,
        movimientos_generados: movimientoIds,
        id_almacen_entrada: idAlmacen,
      };
      res.json(response);
    } catch (error) {
      if (client) await client.query('ROLLBACK');
      res.status(500).json({ error: error.message });
    } finally {
      if (client) client.release();
    }
  });

  app.patch('/api/compras/:id/entregar-area', authMiddleware, async (req, res) => {
    let client;

    try {
      client = await pool.connect();
      if (!canManageDeliveryRole(req.user?.rol) && !isComprasOperatorUser(req.user)) {
        return res.status(403).json({ error: 'Sin permiso para gestionar entrega' });
      }

      const { id } = req.params;
      const receptorUserId = Number(req.body?.receptor_user_id || 0);
      if (!receptorUserId) {
        return res.status(400).json({ error: 'Debes seleccionar un receptor valido para confirmar entrega' });
      }

      await client.query('BEGIN');

      const compra = await client.query(
        `
          SELECT
            id,
            id_usuario,
            COALESCE(to_jsonb(compras)->>'estado_pedido', to_jsonb(compras)->>'estado', '') AS estado,
            COALESCE(to_jsonb(compras)->>'comentarios', '') AS comentarios,
            NULLIF(to_jsonb(compras)->>'id_area_solicitante', '')::int AS id_area_solicitante,
            NULLIF(to_jsonb(compras)->>'id_area_final', '')::int AS id_area_final
          FROM compras
          WHERE id = $1
          FOR UPDATE
        `,
        [id]
      );

      if (compra.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Compra no encontrada' });
      }

      const row = compra.rows[0];
      const estadoActual = normalize(row.estado);
      if (estadoActual !== 'PENDIENTE_ENTREGA') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'La orden debe estar en estado PENDIENTE_ENTREGA para marcar entrega al area' });
      }

      const areaRow = await client.query(
        `
          SELECT COALESCE(a_fin.nombre, a_sol.nombre, '') AS area_destino_nombre
          FROM compras c
          LEFT JOIN areas a_sol ON a_sol.id = c.id_area_solicitante
          LEFT JOIN areas a_fin ON a_fin.id = c.id_area_final
          WHERE c.id = $1
        `,
        [id]
      );

      const areaDestinoNorm = normalize(areaRow.rows[0]?.area_destino_nombre || '');
      if (!areaDestinoNorm || isWarehouseAreaName(areaDestinoNorm)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Esta orden no requiere entrega al area porque su destino es General' });
      }

      const parsedCompraComments = parsePurchaseComments(row.comentarios);
      if (parsedCompraComments?.entrega_area?.entregado === true) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'La orden ya fue entregada al area destino' });
      }

      const areaDestinoId = Number(row.id_area_final || row.id_area_solicitante || 0);
      const receptorParams = [receptorUserId];
      let receptorQuery = `
        SELECT
          u.id,
          u.nombre,
          COALESCE(NULLIF(trim(COALESCE(to_jsonb(u)->>'dni', '')), ''), '') AS dni,
          COALESCE(NULLIF(trim(COALESCE(to_jsonb(u)->>'imagen', to_jsonb(u)->>'foto', '')), ''), '') AS imagen
        FROM usuarios u
        WHERE u.id = $1
      `;

      if (areaDestinoId > 0) {
        receptorParams.push(areaDestinoId);
        receptorQuery += ' AND u.id_area = $2';
      }

      receptorQuery += ' LIMIT 1';

      const receptorResult = await client.query(receptorQuery, receptorParams);
      if (receptorResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'El receptor seleccionado no es valido para el area destino de la orden' });
      }

      const receptor = receptorResult.rows[0];
      const receptorDni = String(receptor.dni || '').trim();
      if (!receptorDni) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'El receptor seleccionado no tiene DNI registrado' });
      }

      const detailRows = await client.query(
        `
          SELECT id_material, SUM(cantidad)::numeric AS cantidad_total
          FROM detalle_compras
          WHERE id_compra = $1
            AND id_material IS NOT NULL
          GROUP BY id_material
        `,
        [id]
      );

      let idMovimientoSalida = null;
      if (detailRows.rows.length > 0) {
        idMovimientoSalida = await insertMovimiento(client, {
          tipo: 'SALIDA',
          usuarioRegistro: row.id_usuario,
        });

        for (const detail of detailRows.rows) {
          const idMaterial = Number(detail.id_material || 0);
          const qty = Number(detail.cantidad_total || 0);
          if (!idMaterial || qty <= 0) continue;

          const stockTotal = await getMaterialStockTotal(client, idMaterial);
          if (stockTotal > 0) {
            await discountMaterialStockDistributed(client, idMaterial, Math.min(stockTotal, qty));
          }

          await client.query(
            `
              INSERT INTO movimiento_detalles (id_movimiento, id_material, cantidad)
              VALUES ($1, $2, $3)
            `,
            [idMovimientoSalida, idMaterial, qty]
          );
        }
      }

      const itemCategoriesFromComments = parsedCompraComments.item_categorias || {};
      const comentariosConEntrega = buildPurchaseComment({
        comentarios: parsedCompraComments.comentarios,
        itemCategorias: itemCategoriesFromComments,
        recibidoPor: `${String(receptor.nombre || '').trim()} - DNI ${receptorDni}`,
        entregaArea: {
          pendiente: false,
          entregado: true,
          receptor_user_id: receptor.id,
          receptor_nombre: receptor.nombre,
          receptor_dni: receptorDni,
          fecha_entrega_area: currentPetDateTime(),
        },
        comentariosHistorial: parsedCompraComments.comentarios_historial,
      });

      await client.query(
        'UPDATE compras SET estado_pedido = $1, comentarios = $2 WHERE id = $3',
        ['ENTREGADO', comentariosConEntrega, id]
      );

      await client.query('COMMIT');

      const result = await fetchComprasRows([id], 'WHERE c.id = $1');
      return res.json({
        ...result[0],
        receptor: {
          id: receptor.id,
          nombre: receptor.nombre,
          dni: receptorDni,
          imagen: receptor.imagen || DEFAULT_USER_AVATAR,
        },
        movimientos_generados: idMovimientoSalida ? [idMovimientoSalida] : [],
        id_almacen_salida: null,
      });
    } catch (error) {
      if (client) await client.query('ROLLBACK');
      return res.status(500).json({ error: error.message });
    } finally {
      if (client) client.release();
    }
  });

  app.get('/api/compras/:id/receptores', authMiddleware, async (req, res) => {
    try {
      const { id } = req.params;
      const term = String(req.query.query || '').trim();

      const compraArea = await pool.query(
        `
          SELECT
            COALESCE(c.id_area_final, c.id_area_solicitante) AS id_area,
            COALESCE(a_fin.nombre, a_sol.nombre, '') AS area_destino_nombre
          FROM compras c
          LEFT JOIN areas a_sol ON a_sol.id = c.id_area_solicitante
          LEFT JOIN areas a_fin ON a_fin.id = c.id_area_final
          WHERE c.id = $1
          LIMIT 1
        `,
        [id]
      );

      if (compraArea.rows.length === 0) {
        return res.status(404).json({ error: 'Compra no encontrada' });
      }

      const areaNameNorm = normalize(compraArea.rows[0].area_destino_nombre || '');
      if (!areaNameNorm || isWarehouseAreaName(areaNameNorm)) {
        return res.json([]);
      }

      const areaId = Number(compraArea.rows[0].id_area || 0);
      if (!areaId) {
        return res.json([]);
      }

      const fields = [
        'u.id',
        'u.nombre',
        `COALESCE(NULLIF(trim(COALESCE(to_jsonb(u)->>'dni', '')), ''), '') AS dni`,
        `COALESCE(ar.nombre, '') AS area`,
        `COALESCE(NULLIF(trim(COALESCE(to_jsonb(u)->>'imagen', to_jsonb(u)->>'foto', '')), ''), '') AS imagen`,
      ];

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
          SELECT ${fields.join(', ')}
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

  app.get('/api/compras/:id/pdf', authMiddleware, async (req, res) => {
    try {
      const { id } = req.params;

      const compras = await fetchComprasRows([id], 'WHERE c.id = $1');
      if (compras.length === 0) {
        return res.status(404).json({ error: 'Compra no encontrada' });
      }

      const compra = compras[0];

      const canOperateCompra = isComprasOperatorUser(req.user) || canManageDeliveryRole(req.user?.rol) || canManagePurchasesRole(req.user?.rol);
      const isOwner = Number(compra.id_usuario) === Number(req.user.id);

      if (!isOwner && !canOperateCompra) {
        return res.status(403).json({ error: 'No autorizado para descargar PDF de esta compra' });
      }

      if (!isOwner) {
        const hasFinalApproval = await hasEffectiveFinalApprovalByRole(pool, {
          tipo: 'COMPRA',
          referenciaId: id,
          roleId: 7,
        });

        if (!hasFinalApproval) {
          return res.status(400).json({ error: 'La compra aun no tiene aprobacion final de gerencia de finanzas' });
        }
      }

      compra.aprobadores = await fetchApprovedApproversByEntity(pool, {
        tipo: 'COMPRA',
        referenciaId: compra.id,
      });
      compra.historial_aprobaciones = await fetchApprovalHistoryByEntity(pool, {
        tipo: 'COMPRA',
        referenciaId: compra.id,
      });

      const pdfBase64 = await buildCompraPdfBase64(compra);
      const pdfBuffer = Buffer.from(pdfBase64, 'base64');

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="orden_compra_${compra.id}.pdf"`);
      res.send(pdfBuffer);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
};
