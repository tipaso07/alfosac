const { pool, getServicioStatusColumn, getUserRoleIdExpr } = require('./pool');
const { normalize } = require('../utils/normalize');
const { isWarehouseAreaName } = require('../config/constants');
const { formatPetDateTime } = require('../utils/datetime');

// ---------------------------------------------------------------------------
// Embedded comment parsing (purchase-specific)
// ---------------------------------------------------------------------------

const normalizeItemCategoryKey = (value) => String(value || '').trim().toLowerCase();

const parsePurchaseComments = (value) => {
  let text = String(value || '').trim();
  let recibidoPor = '';
  let itemCategorias = {};
  let entregaArea = null;
  let comentariosHistorial = [];

  let changed = true;
  while (changed) {
    changed = false;

    const deliveryMatch = text.match(/\n?\[\[ENTREGA_AREA:([A-Za-z0-9+/=]+)\]\]\s*$/s);
    if (deliveryMatch) {
      try {
        const decoded = Buffer.from(String(deliveryMatch[1] || ''), 'base64').toString('utf8');
        const parsed = JSON.parse(decoded);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          entregaArea = parsed;
        }
      } catch (_) {
        entregaArea = null;
      }
      text = text.slice(0, deliveryMatch.index || 0).trim();
      changed = true;
      continue;
    }

    const commentsMatch = text.match(/\n?\[\[COMENTARIOS_HIST:([A-Za-z0-9+/=]+)\]\]\s*$/s);
    if (commentsMatch) {
      try {
        const decoded = Buffer.from(String(commentsMatch[1] || ''), 'base64').toString('utf8');
        const parsed = JSON.parse(decoded);
        if (Array.isArray(parsed)) {
          comentariosHistorial = parsed
            .filter((item) => item && typeof item === 'object')
            .map((item) => ({
              usuario_id: Number(item.usuario_id || 0) || null,
              usuario: String(item.usuario || '').trim(),
              fecha: String(item.fecha || '').trim(),
              contenido: String(item.contenido || '').trim(),
            }))
            .filter((item) => item.contenido);
        }
      } catch (_) {
        comentariosHistorial = [];
      }
      text = text.slice(0, commentsMatch.index || 0).trim();
      changed = true;
      continue;
    }

    const categoriesMatch = text.match(/\n?\[\[ITEM_CATEGORIAS:([A-Za-z0-9+/=]+)\]\]\s*$/s);
    if (categoriesMatch) {
      try {
        const decoded = Buffer.from(String(categoriesMatch[1] || ''), 'base64').toString('utf8');
        const parsed = JSON.parse(decoded);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          itemCategorias = parsed;
        }
      } catch (_) {
        itemCategorias = {};
      }
      text = text.slice(0, categoriesMatch.index || 0).trim();
      changed = true;
      continue;
    }

    const receiptMatch = text.match(/\n?\[\[RECIBIDO_POR:(.*?)\]\]\s*$/s);
    if (receiptMatch) {
      recibidoPor = String(receiptMatch[1] || '').trim();
      text = text.slice(0, receiptMatch.index || 0).trim();
      changed = true;
      continue;
    }
  }

  return {
    comentarios: text,
    recibido_por: recibidoPor,
    item_categorias: itemCategorias,
    entrega_area: entregaArea,
    comentarios_historial: comentariosHistorial,
  };
};

// ---------------------------------------------------------------------------
// Services query
// ---------------------------------------------------------------------------

const fetchServiciosRows = async (params = [], whereClause = '', options = {}) => {
  const servicioProviderExpr = `NULLIF(COALESCE(to_jsonb(s)->>'proveedor_id', to_jsonb(s)->>'id_proveedor', ''), '')::int`;
  const servicioAreaExpr = `NULLIF(COALESCE(to_jsonb(s)->>'area_id', to_jsonb(s)->>'id_area', ''), '')::int`;
  const servicioUserExpr = `NULLIF(COALESCE(to_jsonb(s)->>'id_usuario', to_jsonb(s)->>'usuario_id', ''), '')::int`;
  const servicioMonedaExpr = `NULLIF(COALESCE(to_jsonb(s)->>'moneda_id', to_jsonb(s)->>'id_moneda', ''), '')::int`;
  const servicioStatusColumn = getServicioStatusColumn();

  const result = await pool.query(
    `
      SELECT
        s.id,
        ${servicioUserExpr} AS id_usuario,
        ${getUserRoleIdExpr('u')} AS usuario_rol_id,
        COALESCE(r_usuario.nombre, '') AS usuario_rol,
        ${servicioProviderExpr} AS proveedor_id,
        ${servicioAreaExpr} AS area_id,
        ${servicioMonedaExpr} AS moneda_id,
        COALESCE(NULLIF(COALESCE(to_jsonb(s)->>'nombre_servicio', to_jsonb(s)->>'nombre', to_jsonb(s)->>'titulo', ''), ''), '') AS nombre_servicio,
        COALESCE(NULLIF(COALESCE(to_jsonb(s)->>'prioridad', to_jsonb(s)->>'nivel_prioridad', 'MEDIA'), ''), 'MEDIA') AS prioridad,
        COALESCE(NULLIF(COALESCE(to_jsonb(s)->>'descripcion_servicio', to_jsonb(s)->>'descripcion', to_jsonb(s)->>'comentario', ''), ''), '') AS descripcion_servicio,
        CASE
          WHEN lower(trim(COALESCE(to_jsonb(s)->>'dentro_plan', to_jsonb(s)->>'en_plan', 'false'))) IN ('true', 't', '1', 'si', 'yes', 'y') THEN TRUE
          ELSE FALSE
        END AS dentro_plan,
        COALESCE(NULLIF(COALESCE(to_jsonb(s)->>'costo', to_jsonb(s)->>'importe', to_jsonb(s)->>'monto', '0'), '')::numeric, 0) AS costo,
        NULLIF(COALESCE(to_jsonb(s)->>'subtotal', ''), '')::numeric AS subtotal,
        NULLIF(COALESCE(to_jsonb(s)->>'igv', to_jsonb(s)->>'impuestos', ''), '')::numeric AS igv,
        NULLIF(COALESCE(to_jsonb(s)->>'costo_envio', ''), '')::numeric AS costo_envio,
        NULLIF(COALESCE(to_jsonb(s)->>'otros_costos', ''), '')::numeric AS otros_costos,
        NULLIF(COALESCE(to_jsonb(s)->>'total', ''), '')::numeric AS total,
        NULLIF(COALESCE(to_jsonb(s)->>'tipo_cambio', ''), '')::numeric AS tipo_cambio,
        CASE
          WHEN upper(trim(COALESCE(to_jsonb(s)->>'aplica_retencion', ''))) IN ('TRUE', 'T', '1', 'SI', 'YES') THEN TRUE
          ELSE FALSE
        END AS aplica_retencion,
        NULLIF(COALESCE(to_jsonb(s)->>'retencion', to_jsonb(s)->>'descuento', ''), '')::numeric AS retencion,
        COALESCE(NULLIF(upper(trim(COALESCE(to_jsonb(s)->>'tipo_retencion', ''))), ''), 'RETENCION') AS tipo_retencion,
        COALESCE(upper(trim(COALESCE(to_jsonb(s)->>'estado_aprobacion', to_jsonb(s)->>'estado', 'PENDIENTE'))), 'PENDIENTE') AS estado_aprobacion,
        COALESCE(NULLIF(upper(trim(COALESCE(to_jsonb(s)->>'${servicioStatusColumn}', ''))), ''), NULL) AS estado_flujo,
        COALESCE(NULLIF(upper(trim(COALESCE(to_jsonb(s)->>'${servicioStatusColumn}', ''))), ''), NULL) AS estado_servicio,
        COALESCE(
          NULLIF(to_jsonb(s)->>'fecha_creacion', '')::timestamp,
          NULLIF(to_jsonb(s)->>'created_at', '')::timestamp,
          NULLIF(to_jsonb(s)->>'fecha', '')::timestamp,
          timezone('America/Lima', now())
        ) AS fecha,
        COALESCE(p.razon_social, p.nombre, 'Sin proveedor') AS proveedor,
        COALESCE(to_jsonb(p)->>'ruc', '') AS proveedor_ruc,
        COALESCE(to_jsonb(p)->>'direccion', '') AS proveedor_direccion,
        COALESCE(to_jsonb(p)->>'banco', '') AS proveedor_banco,
        COALESCE(to_jsonb(p)->>'numero_cuenta', to_jsonb(p)->>'cuenta', '') AS proveedor_cuenta,
        COALESCE(to_jsonb(p)->>'cci', '') AS proveedor_cci,
        COALESCE(to_jsonb(p)->>'condiciones_pago', '') AS proveedor_condiciones_pago,
        COALESCE(to_jsonb(p)->>'correo', '') AS proveedor_correo,
        COALESCE(to_jsonb(p)->>'telefono', '') AS proveedor_telefono,
        COALESCE(upper(trim(COALESCE(to_jsonb(p)->>'retencion', 'NO'))), 'NO') AS proveedor_retencion,
        COALESCE(NULLIF(upper(trim(COALESCE(to_jsonb(p)->>'tipo_retencion', ''))), ''), 'RETENCION') AS proveedor_tipo_retencion,
        COALESCE(NULLIF(COALESCE(to_jsonb(p)->>'descuento', ''), '')::numeric, 0) AS proveedor_retencion_pct,
        COALESCE(pm.nombre, '') AS proveedor_moneda,
        COALESCE(a.nombre, 'Sin area') AS area,
        COALESCE(NULLIF(COALESCE(to_jsonb(s)->>'sub_area', ''), ''), '') AS sub_area,
        COALESCE(mo.nombre, '') AS moneda,
        COALESCE(u.nombre, 'Sin usuario') AS usuario,
        u.email AS usuario_email,
        COALESCE(u.telefono, '') AS usuario_telefono,
        (csr.puntuacion IS NOT NULL) AS calificacion_servicio_existe,
        csr.puntuacion AS calificacion_servicio_puntuacion,
        COALESCE(csr.comentario, '') AS calificacion_servicio_comentario,
        csr.fecha AS calificacion_servicio_fecha
      FROM servicios s
      LEFT JOIN proveedores p ON p.id = ${servicioProviderExpr}
      LEFT JOIN monedas pm ON pm.id = NULLIF(COALESCE(to_jsonb(p)->>'id_moneda', ''), '')::int
      LEFT JOIN areas a ON a.id = ${servicioAreaExpr}
      LEFT JOIN monedas mo ON mo.id = ${servicioMonedaExpr}
      LEFT JOIN usuarios u ON u.id = ${servicioUserExpr}
      LEFT JOIN roles r_usuario ON r_usuario.id = ${getUserRoleIdExpr('u')}
      LEFT JOIN LATERAL (
        SELECT cp.puntuacion, cp.comentario, cp.fecha
        FROM calificaciones_proveedor cp
        WHERE cp.id_proveedor = ${servicioProviderExpr}
          AND lower(trim(COALESCE(cp.tipo, ''))) = 'servicio'
          AND cp.id_referencia = s.id
        ORDER BY cp.fecha DESC, cp.id DESC
        LIMIT 1
      ) csr ON TRUE
      ${whereClause}
      ORDER BY
        CASE upper(trim(COALESCE(to_jsonb(s)->>'prioridad', to_jsonb(s)->>'nivel_prioridad', 'MEDIA')))
          WHEN 'ALTA' THEN 1
          WHEN 'MEDIA' THEN 2
          WHEN 'BAJA' THEN 3
          ELSE 4
        END,
        fecha DESC,
        s.id DESC
    `,
    params
  );

  const servicios = result.rows.map((row) => {
    let parsedDescription = { text: row.descripcion_servicio || '', comments: [] };
    try {
      const { parseEmbeddedCommentsFromText } = require('../services/comments');
      parsedDescription = parseEmbeddedCommentsFromText(row.descripcion_servicio || '');
    } catch (_) {
      // fallback: use raw text
    }
    return {
      ...row,
      fecha: formatPetDateTime(row.fecha),
      calificacion_servicio_fecha: formatPetDateTime(row.calificacion_servicio_fecha),
      descripcion_servicio: parsedDescription.text,
      comentarios_historial: [],
      usuario_rol_id: Number(row.usuario_rol_id || 0) || null,
      usuario_rol: row.usuario_rol,
    };
  });

  try {
    const { fetchCommentsForEntities } = require('../services/comments');
    const commentsByServicio = await fetchCommentsForEntities(pool, {
      tipoEntidad: 'servicio',
      entityIds: servicios.map((row) => Number(row.id || 0)),
    });
    servicios.forEach((row) => {
      row.comentarios_historial = commentsByServicio.get(Number(row.id || 0)) || [];
    });
  } catch (_) {
    // comments not available
  }

  const approvalRoleId = Number(options?.approvalRoleId || 0);
  const approvalPermissionGranted = Boolean(options?.approvalPermissionGranted);
  if (approvalRoleId > 0) {
    try {
      const { fetchActionableApprovalReferenceIds, fetchFirstApprovalReferenceIdsByRole, isPendingApprovalState, fetchNextPendingApprovalRoleByReferences } = require('../services/approval');
      const referenceIds = servicios.map((row) => Number(row.id || 0));
      const actionableIds = await fetchActionableApprovalReferenceIds(pool, {
        tipo: 'SERVICIO',
        roleId: approvalRoleId,
        userId: Number(options?.userId || 0),
        referenceIds,
      });

      const firstApproverIds = await fetchFirstApprovalReferenceIdsByRole(pool, {
        tipo: 'SERVICIO',
        roleId: approvalRoleId,
        referenceIds,
      });

      servicios.forEach((row) => {
        const canApprove = approvalPermissionGranted
          && actionableIds.has(Number(row.id || 0))
          && isPendingApprovalState(row.estado_aprobacion);
        row.puede_aprobar = canApprove;
        row.puede_rechazar = canApprove;
        row.es_primer_aprobador = canApprove && firstApproverIds.has(Number(row.id || 0));
      });
    } catch (_) {
      // approval filtering not available
    }
  }

  try {
    const { fetchNextPendingApprovalRoleByReferences } = require('../services/approval');
    await fetchNextPendingApprovalRoleByReferences(pool, {
      tipo: 'SERVICIO',
      referenceIds: servicios.map((row) => Number(row.id || 0)),
    });
  } catch (_) {
    // ok
  }

  return servicios;
};

// ---------------------------------------------------------------------------
// mapCompraRows
// ---------------------------------------------------------------------------

const mapCompraRows = (rows) => {
  const grouped = rows.reduce((acc, row) => {
    if (!acc[row.id]) {
      const parsedComments = parsePurchaseComments(row.comentarios);
      const areaDestinoNorm = normalize(row.area_final || row.area_solicitante);
      const isOtherArea = Boolean(areaDestinoNorm && !isWarehouseAreaName(areaDestinoNorm));
      const entregaArea = parsedComments.entrega_area && typeof parsedComments.entrega_area === 'object'
        ? parsedComments.entrega_area
        : null;
      const estadoNorm = normalize(row.estado);
      const pendingEntregaFlag = entregaArea
        ? Boolean(entregaArea?.pendiente === true && entregaArea?.entregado !== true)
        : Boolean(isOtherArea && ['RECIBIDA', 'RECIBIDO'].includes(estadoNorm));
      acc[row.id] = {
        id: row.id,
        estado: row.estado,
        estado_pedido: row.estado_pedido,
        id_usuario: row.id_usuario,
        usuario_rol_id: Number(row.usuario_rol_id || 0) || null,
        usuario_rol: row.usuario_rol,
        id_proveedor: row.id_proveedor,
        usuario: row.usuario,
        usuario_email: row.usuario_email,
        usuario_telefono: row.usuario_telefono,
        id_area_solicitante: row.id_area_solicitante,
        area_solicitante: row.area_solicitante,
        id_area_final: row.id_area_final,
        area_final: row.area_final,
        proveedor: row.proveedor,
        ruc: row.ruc,
        direccion: row.direccion,
        distrito: row.distrito,
        correo: row.correo,
        persona_responsable: row.persona_responsable,
        telefono: row.telefono,
        contacto_proveedor: row.contacto_proveedor,
        banco: row.banco,
        id_moneda: row.id_moneda,
        id_unidad: row.id_unidad,
        moneda: row.moneda,
        numero_cuenta: row.numero_cuenta,
        cuenta: row.cuenta,
        cci: row.cci,
        retencion: row.retencion,
        descuento: row.descuento,
        aplica_retencion: Boolean(row.aplica_retencion),
        tipo: row.tipo,
        tipo_retencion: row.tipo_retencion,
        importe_final: Number(row.importe_final || row.total || 0),
        condiciones_pago: row.condiciones_pago,
        subtotal: Number(row.subtotal || 0),
        costo_envio: Number(row.costo_envio || 0),
        otros_costos: Number(row.otros_costos || 0),
        igv: Number(row.igv || 0),
        total: Number(row.total || 0),
        detalle: String(row.detalle || '').trim(),
        comentarios: parsedComments.comentarios,
        comentarios_historial: [],
        recibido_por: parsedComments.recibido_por,
        entrega_area: entregaArea,
        pendiente_entrega: pendingEntregaFlag,
        numero_orden: row.numero_orden,
        fecha_creacion: formatPetDateTime(row.fecha_creacion),
        fecha_actualizacion: formatPetDateTime(row.fecha_actualizacion),
        puede_aprobar: false,
        puede_rechazar: false,
        items: [],
        _item_categories_map: parsedComments.item_categorias || {},
      };
    }

    if (row.id_detalle) {
      const itemNameForCategory = String(row.descripcion || row.material || '').trim();
      const categoriaFromComments = itemNameForCategory
        ? String(acc[row.id]._item_categories_map?.[normalizeItemCategoryKey(itemNameForCategory)] || '').trim()
        : '';
      const categoriaFinal = String(row.categoria || '').trim() || categoriaFromComments;

      acc[row.id].items.push({
        id_detalle: row.id_detalle,
        id_material: row.id_material,
        id_unidad: row.id_unidad,
        id_categoria: row.id_categoria,
        categoria: categoriaFinal,
        material: row.material,
        descripcion: row.descripcion,
        cantidad: Number(row.cantidad || 0),
        precio_unitario: Number(row.precio_unitario || 0),
        total: Number(row.total_detalle || 0),
      });
    }

    return acc;
  }, {});

  return Object.values(grouped).map((row) => {
    const { _item_categories_map, ...safeRow } = row;
    return safeRow;
  });
};

// ---------------------------------------------------------------------------
// Purchases query
// ---------------------------------------------------------------------------

const fetchComprasRows = async (params = [], whereClause = '', options = {}) => {
  const result = await pool.query(
    `
      SELECT
        c.id,
        COALESCE(upper(trim(NULLIF(to_jsonb(c)->>'estado', ''))), '') AS estado,
        COALESCE(upper(trim(NULLIF(to_jsonb(c)->>'estado_pedido', ''))), '') AS estado_pedido,
        NULLIF(to_jsonb(c)->>'id_usuario', '')::int AS id_usuario,
        NULLIF(to_jsonb(c)->>'id_proveedor', '')::int AS id_proveedor,
        u.nombre AS usuario,
        u.email AS usuario_email,
        COALESCE(u.telefono, '') AS usuario_telefono,
        ${getUserRoleIdExpr('u')} AS usuario_rol_id,
        COALESCE(r.nombre, '') AS usuario_rol,
        NULLIF(to_jsonb(c)->>'id_area_solicitante', '')::int AS id_area_solicitante,
        COALESCE(a_sol.nombre, 'Sin area') AS area_solicitante,
        NULLIF(to_jsonb(c)->>'id_area_final', '')::int AS id_area_final,
        COALESCE(a_fin.nombre, COALESCE(a_sol.nombre, 'Sin area')) AS area_final,
        COALESCE(to_jsonb(c)->>'proveedor', '') AS proveedor,
        COALESCE(to_jsonb(c)->>'ruc', '') AS ruc,
        COALESCE(to_jsonb(c)->>'direccion', '') AS direccion,
        COALESCE(to_jsonb(c)->>'distrito', '') AS distrito,
        COALESCE(to_jsonb(c)->>'correo', '') AS correo,
        COALESCE(to_jsonb(c)->>'persona_responsable', '') AS persona_responsable,
        COALESCE(to_jsonb(c)->>'telefono', '') AS telefono,
        COALESCE(to_jsonb(c)->>'contacto_proveedor', '') AS contacto_proveedor,
        COALESCE(to_jsonb(c)->>'banco', '') AS banco,
        NULLIF(to_jsonb(c)->>'id_moneda', '')::int AS id_moneda,
        NULLIF(to_jsonb(c)->>'id_unidad', '')::int AS id_unidad,
        COALESCE(to_jsonb(c)->>'moneda', '') AS moneda,
        COALESCE(to_jsonb(c)->>'numero_cuenta', '') AS numero_cuenta,
        COALESCE(to_jsonb(c)->>'cuenta', '') AS cuenta,
        COALESCE(to_jsonb(c)->>'cci', '') AS cci,
        COALESCE(to_jsonb(c)->>'retencion', '') AS retencion,
        COALESCE(NULLIF(to_jsonb(c)->>'descuento', '')::numeric, 0) AS descuento,
        NULLIF(to_jsonb(c)->>'tipo_cambio', '')::numeric AS tipo_cambio,
        CASE WHEN upper(trim(COALESCE(to_jsonb(c)->>'aplica_retencion', to_jsonb(c)->>'retencion', ''))) IN ('TRUE', 'T', '1', 'SI', 'YES') THEN TRUE ELSE FALSE END AS aplica_retencion,
        COALESCE(to_jsonb(c)->>'tipo', '') AS tipo,
        COALESCE(to_jsonb(c)->>'tipo_retencion', '') AS tipo_retencion,
        COALESCE(NULLIF(to_jsonb(c)->>'importe_final', '')::numeric, 0) AS importe_final,
        COALESCE(to_jsonb(c)->>'condiciones_pago', '') AS condiciones_pago,
        COALESCE(NULLIF(to_jsonb(c)->>'subtotal', '')::numeric, 0) AS subtotal,
        COALESCE(NULLIF(to_jsonb(c)->>'costo_envio', '')::numeric, 0) AS costo_envio,
        COALESCE(NULLIF(to_jsonb(c)->>'otros_costos', '')::numeric, 0) AS otros_costos,
        COALESCE(NULLIF(to_jsonb(c)->>'igv', '')::numeric, 0) AS igv,
        COALESCE(NULLIF(to_jsonb(c)->>'total', '')::numeric, 0) AS total,
        COALESCE(to_jsonb(c)->>'detalle', to_jsonb(c)->>'observaciones', '') AS detalle,
        COALESCE(to_jsonb(c)->>'comentarios', '') AS comentarios,
        COALESCE(to_jsonb(c)->>'numero_orden', '') AS numero_orden,
        c.fecha_creacion AT TIME ZONE 'America/Lima' AS fecha_creacion,
        c.fecha_actualizacion AT TIME ZONE 'America/Lima' AS fecha_actualizacion,
        dc.id AS id_detalle,
        NULLIF(to_jsonb(dc)->>'id_material', '')::int AS id_material,
        NULLIF(to_jsonb(dc)->>'id_unidad', '')::int AS id_unidad,
        COALESCE(
          NULLIF(to_jsonb(dc)->>'id_categoria', '')::int,
          NULLIF(to_jsonb(m)->>'id_categoria', '')::int
        ) AS id_categoria,
        COALESCE(
          NULLIF(to_jsonb(dc)->>'categoria', ''),
          cat_dc.nombre,
          cat_m.nombre,
          NULLIF(to_jsonb(m)->>'categoria', ''),
          ''
        ) AS categoria,
        m.nombre AS material,
        COALESCE(
          NULLIF(to_jsonb(dc)->>'comentarios', ''),
          NULLIF(to_jsonb(dc)->>'nombre_material', ''),
          NULLIF(to_jsonb(dc)->>'descripcion', ''),
          ''
        ) AS descripcion,
        COALESCE(NULLIF(to_jsonb(dc)->>'cantidad', '')::numeric, 0) AS cantidad,
        COALESCE(NULLIF(to_jsonb(dc)->>'precio_unitario', '')::numeric, 0) AS precio_unitario,
        COALESCE(NULLIF(to_jsonb(dc)->>'total', '')::numeric, 0) AS total_detalle
      FROM compras c
      JOIN usuarios u ON u.id = c.id_usuario
      LEFT JOIN roles r ON r.id = ${getUserRoleIdExpr('u')}
      LEFT JOIN areas a_sol ON a_sol.id = c.id_area_solicitante
      LEFT JOIN areas a_fin ON a_fin.id = c.id_area_final
      LEFT JOIN detalle_compras dc ON dc.id_compra = c.id
      LEFT JOIN categorias cat_dc ON cat_dc.id = NULLIF(to_jsonb(dc)->>'id_categoria', '')::int
      LEFT JOIN materiales m ON m.id = NULLIF(to_jsonb(dc)->>'id_material', '')::int
      LEFT JOIN categorias cat_m ON cat_m.id = NULLIF(to_jsonb(m)->>'id_categoria', '')::int
      ${whereClause}
      ORDER BY c.fecha_creacion DESC, c.id DESC, dc.id ASC
    `,
    params
  );

  const compras = mapCompraRows(result.rows);

  try {
    const { getApprovalRoleIdFromState, getPendingStateByRoleId } = require('../services/approval');
    compras.forEach((row) => {
      try {
        const rawEstado = String(row.estado || row.estado_pedido || '').trim();
        row.estado = rawEstado ? rawEstado.toUpperCase() : 'PENDIENTE';
        const roleIdFromState = getApprovalRoleIdFromState(String(row.estado || '')) || 0;
        if (roleIdFromState > 0) {
          row.estado = getPendingStateByRoleId(roleIdFromState);
        }
      } catch (err) {
        // leave as-is on error
      }
    });
  } catch (_) {
    // approval normalization not available
  }

  try {
    const { fetchCommentsForEntities } = require('../services/comments');
    const commentsByCompra = await fetchCommentsForEntities(pool, {
      tipoEntidad: 'compra',
      entityIds: compras.map((row) => Number(row.id || 0)),
    });
    compras.forEach((row) => {
      row.comentarios_historial = commentsByCompra.get(Number(row.id || 0)) || [];
    });
  } catch (_) {
    // comments not available
  }

  const providerIds = [...new Set(
    compras
      .map((row) => Number(row.id_proveedor || 0))
      .filter((id) => Number.isInteger(id) && id > 0)
  )];

  if (providerIds.length > 0) {
    try {
      const { fetchProveedorRatingsSummary } = require('../services/proveedores');
      const ratingsMap = await fetchProveedorRatingsSummary(pool, {
        proveedorIds: providerIds,
        userId: Number(options?.userId || 0) || null,
      });

      compras.forEach((row) => {
        const proveedorId = Number(row.id_proveedor || 0);
        const rating = ratingsMap.get(proveedorId) || {
          calificacion_promedio: 0,
          calificacion_total: 0,
          alerta_cambio_proveedor: false,
          alerta_critica: false,
        };

        row.calificacion_promedio = Number(rating.calificacion_promedio || 0) || 0;
        row.calificacion_total = Number(rating.calificacion_total || 0) || 0;
        row.alerta_cambio_proveedor = Boolean(rating.alerta_cambio_proveedor);
        row.alerta_critica = Boolean(rating.alerta_critica);
      });
    } catch (_) {
      // ratings not available
    }
  }

  const approvalRoleId = Number(options?.approvalRoleId || 0);
  const approvalPermissionGranted = Boolean(options?.approvalPermissionGranted);
  if (approvalRoleId > 0) {
    try {
      const { fetchActionableApprovalReferenceIds, isPendingApprovalState } = require('../services/approval');
      const actionableIds = await fetchActionableApprovalReferenceIds(pool, {
        tipo: 'COMPRA',
        roleId: approvalRoleId,
        userId: Number(options?.userId || 0),
        referenceIds: compras.map((row) => Number(row.id || 0)),
      });

      compras.forEach((row) => {
        const canApprove = approvalPermissionGranted
          && actionableIds.has(Number(row.id || 0))
          && isPendingApprovalState(row.estado);
        row.puede_aprobar = canApprove;
        row.puede_rechazar = canApprove;
      });
    } catch (_) {
      // approval filtering not available
    }
  }

  try {
    const { fetchNextPendingApprovalRoleByReferences } = require('../services/approval');
    await fetchNextPendingApprovalRoleByReferences(pool, {
      tipo: 'COMPRA',
      referenceIds: compras.map((row) => Number(row.id || 0)),
    });
  } catch (_) {
    // ok
  }

  const compraIds = compras.map((r) => Number(r.id || 0)).filter((v) => Number.isInteger(v) && v > 0);
  if (compraIds.length > 0) {
    try {
      const aprobacionesRes = await pool.query(
        `
          SELECT referencia_id, usuario_id
          FROM aprobaciones
          WHERE upper(trim(tipo)) = 'COMPRA'
            AND referencia_id = ANY($1::int[])
            AND upper(trim(COALESCE(estado, ''))) = 'APROBADO'
            AND usuario_id IS NOT NULL
        `,
        [compraIds]
      );

      const aprobadoresMap = new Map();
      aprobacionesRes.rows.forEach((r) => {
        const ref = Number(r.referencia_id || 0);
        const uid = Number(r.usuario_id || 0);
        if (!aprobadoresMap.has(ref)) aprobadoresMap.set(ref, []);
        if (uid > 0) aprobadoresMap.get(ref).push(uid);
      });

      compras.forEach((row) => {
        const refId = Number(row.id || 0);
        const aprobadores = aprobadoresMap.get(refId) || [];
        row.aprobadores = [...new Set(aprobadores)];
        const userId = Number(options?.userId || 0) || 0;
        row.aprobado_por_usuario = userId > 0 ? row.aprobadores.includes(userId) : false;
      });
    } catch (_) {
      // aprobaciones table might not exist
    }
  }

  return compras;
};

module.exports = {
  parsePurchaseComments,
  normalizeItemCategoryKey,
  mapCompraRows,
  fetchServiciosRows,
  fetchComprasRows,
};
