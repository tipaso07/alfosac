const { pool } = require('../db/pool');
const { fetchServiciosRows, fetchComprasRows } = require('../db/queries');
const { normalize } = require('../utils/normalize');
const { isServiciosGeneralesRole } = require('../config/constants');
const { currentPetDateTime, PET_SQL_NOW } = require('../utils/datetime');
const { COMMENT_THREAD_NOTE_PREFIX, ITEM_CATEGORY_NOTE_PREFIX, RECEIPT_NOTE_PREFIX, AREA_DELIVERY_NOTE_PREFIX } = require('./comments');
const { tienePermiso } = require('./approval');

const normalizeRatingType = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'servicio') return 'servicio';
  if (['compra', 'entrada', 'salida', 'material', 'material_entrada', 'material_salida'].includes(normalized)) return 'compra';
  return null;
};

const canRateCompra = (user) => tienePermiso(user, 'CALIFICAR_COMPRA');
const canRateRequerimiento = (user) => tienePermiso(user, 'CALIFICAR_REQUERIMIENTO');
const canRateAnyProvider = (user) => canRateCompra(user) || canRateRequerimiento(user);

const canEditUnifiedProveedorRating = (user) => {
  const roleId = Number(user?.id_role || user?.rol_id || 0);
  if (isServiciosGeneralesRole(user?.rol)) return true;

  const roleName = normalize(user?.rol || '');
  return roleName === 'SERVICIOS_GENERALES' || roleName === 'SERVICIOS GENERALES';
};

const resolveSalidaRatingContext = async (db, { idMovimiento, idMaterial, idProveedor } = {}) => {
  const movimientoId = Number(idMovimiento || 0);
  const materialId = Number(idMaterial || 0);
  const proveedorId = Number(idProveedor || 0);

  if (!Number.isInteger(movimientoId) || movimientoId <= 0) return null;
  if (!Number.isInteger(materialId) || materialId <= 0) return null;
  if (!Number.isInteger(proveedorId) || proveedorId <= 0) return null;

  const result = await db.query(
    `
      SELECT
        m.id AS id_movimiento,
        upper(trim(COALESCE(NULLIF(to_jsonb(m)->>'tipo_movimiento', ''), NULLIF(to_jsonb(m)->>'tipo', ''), ''))) AS tipo_movimiento,
        md.id AS id_movimiento_detalle,
        md.id_material,
        NULLIF(to_jsonb(mat)->>'id_proveedor', '')::int AS id_proveedor,
        COALESCE(
          (
            SELECT areas.nombre
            FROM requerimientos
            JOIN usuarios ON usuarios.id = requerimientos.id_usuario
            LEFT JOIN areas ON areas.id = usuarios.id_area
            WHERE requerimientos.id = NULLIF(
              COALESCE(
                NULLIF(to_jsonb(m)->>'id_requerimiento', ''),
                NULLIF(to_jsonb(m)->>'requerimiento_id', ''),
                ''
              ),
              ''
            )::int
            LIMIT 1
          ),
          COALESCE(a_mov.nombre, 'Sin area')
        ) AS area_destino
      FROM movimientos m
      JOIN movimiento_detalles md ON md.id_movimiento = m.id
      JOIN materiales mat ON mat.id = md.id_material
      LEFT JOIN usuarios u_mov ON u_mov.id = CASE
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
      END
      LEFT JOIN areas a_mov ON a_mov.id = u_mov.id_area
      WHERE m.id = $1
        AND md.id_material = $2
      LIMIT 1
    `,
    [movimientoId, materialId]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  const providerFromMaterial = Number(row.id_proveedor || 0);
  if (!providerFromMaterial || providerFromMaterial !== proveedorId) return null;

  return {
    id_movimiento: Number(row.id_movimiento || 0),
    id_movimiento_detalle: Number(row.id_movimiento_detalle || 0),
    id_material: Number(row.id_material || 0),
    id_proveedor: providerFromMaterial,
    tipo_movimiento: normalize(row.tipo_movimiento || ''),
    area_destino: String(row.area_destino || 'Sin area').trim() || 'Sin area',
  };
};

const fetchProveedorRatingsSummary = async (db, { proveedorIds = [], userId = null } = {}) => {
  const ids = [...new Set((Array.isArray(proveedorIds) ? proveedorIds : [])
    .map((id) => Number(id || 0))
    .filter((id) => Number.isInteger(id) && id > 0))];

  if (ids.length === 0) {
    return new Map();
  }

  const summaryResult = await db.query(
    `
      SELECT
        cp.id_proveedor,
        ROUND(AVG(cp.puntuacion)::numeric, 2) AS promedio,
        COUNT(*)::int AS total,
        COALESCE(BOOL_OR(cp.puntuacion <= 2), false) AS existe_critica
      FROM calificaciones_proveedor cp
      WHERE cp.id_proveedor = ANY($1::int[])
        AND lower(trim(COALESCE(cp.tipo, ''))) IN ('compra', 'servicio')
      GROUP BY cp.id_proveedor
    `,
    [ids]
  );

  const userResult = Number(userId || 0) > 0
    ? await db.query(
      `
        SELECT DISTINCT ON (cp.id_proveedor)
          cp.id_proveedor,
          cp.puntuacion,
          cp.comentario,
          cp.fecha
        FROM calificaciones_proveedor cp
        WHERE cp.id_proveedor = ANY($1::int[])
          AND cp.id_usuario = $2
          AND lower(trim(COALESCE(cp.tipo, ''))) IN ('compra', 'servicio')
        ORDER BY cp.id_proveedor, cp.fecha DESC, cp.id DESC
      `,
      [ids, Number(userId)]
    )
    : { rows: [] };

  const latestResult = await db.query(
    `
      SELECT DISTINCT ON (cp.id_proveedor)
        cp.id_proveedor,
        cp.puntuacion,
        cp.comentario,
        cp.fecha
      FROM calificaciones_proveedor cp
      WHERE cp.id_proveedor = ANY($1::int[])
        AND lower(trim(COALESCE(cp.tipo, ''))) IN ('compra', 'servicio')
      ORDER BY cp.id_proveedor, cp.fecha DESC, cp.id DESC
    `,
    [ids]
  );

  const userMap = new Map(
    userResult.rows.map((row) => [Number(row.id_proveedor || 0), {
      puntuacion: Number(row.puntuacion || 0) || null,
      comentario: String(row.comentario || '').trim(),
      fecha: row.fecha || null,
    }])
  );

  const latestMap = new Map(
    latestResult.rows.map((row) => [Number(row.id_proveedor || 0), {
      puntuacion: Number(row.puntuacion || 0) || null,
      comentario: String(row.comentario || '').trim(),
      fecha: row.fecha || null,
    }])
  );

  const map = new Map();
  summaryResult.rows.forEach((row) => {
    const proveedorId = Number(row.id_proveedor || 0);
    if (!proveedorId) return;
    const own = userMap.get(proveedorId) || {};
    const latest = latestMap.get(proveedorId) || {};
    map.set(proveedorId, {
      calificacion_promedio: Number(row.promedio || 0) || 0,
      calificacion_total: Number(row.total || 0) || 0,
      alerta_cambio_proveedor: Number(row.total || 0) > 0 && (Number(row.promedio || 0) < 4),
      alerta_critica: Boolean(row.existe_critica),
      mi_calificacion: own.puntuacion || null,
      mi_comentario: own.comentario || '',
      mi_fecha: own.fecha || null,
      ultimo_comentario: latest.comentario || '',
      ultima_calificacion: latest.fecha || null,
    });
  });

  ids.forEach((proveedorId) => {
    if (!map.has(proveedorId)) {
      const own = userMap.get(proveedorId) || {};
      const latest = latestMap.get(proveedorId) || {};
      map.set(proveedorId, {
        calificacion_promedio: 0,
        calificacion_total: 0,
        alerta_cambio_proveedor: false,
        alerta_critica: false,
        mi_calificacion: own.puntuacion || null,
        mi_comentario: own.comentario || '',
        mi_fecha: own.fecha || null,
        ultimo_comentario: latest.comentario || '',
        ultima_calificacion: latest.fecha || null,
      });
    }
  });

  return map;
};

const fetchProveedorAverageRatingsForAutomation = async (db) => {
  const result = await db.query(
    `
      SELECT
        cp.id_proveedor,
        ROUND(AVG(cp.puntuacion)::numeric, 2) AS promedio_puntuacion,
        COUNT(*)::int AS total_calificaciones,
        COALESCE(BOOL_OR(cp.puntuacion <= 2), false) AS existe_critica
      FROM calificaciones_proveedor cp
      WHERE lower(trim(COALESCE(cp.tipo, ''))) IN ('compra', 'servicio')
      GROUP BY cp.id_proveedor
      ORDER BY cp.id_proveedor ASC
    `
  );

  return result.rows.map((row) => ({
    id_proveedor: Number(row.id_proveedor || 0),
    promedio_puntuacion: Number(row.promedio_puntuacion || 0) || 0,
    total_calificaciones: Number(row.total_calificaciones || 0) || 0,
    alerta_cambio_proveedor: Number(row.total_calificaciones || 0) > 0 && (Number(row.promedio_puntuacion || 0) < 4),
    alerta_critica: Boolean(row.existe_critica),
  }));
};

const proveedorNotificationStore = new Map();

const sortProveedorNotifications = (notifications = []) => notifications
  .slice()
  .sort((a, b) => {
    const priorityRank = (value) => (String(value || '').trim().toUpperCase() === 'ALTA' ? 0 : 1);
    return priorityRank(a.prioridad) - priorityRank(b.prioridad)
      || Number(b.fecha_creacion_timestamp || 0) - Number(a.fecha_creacion_timestamp || 0)
      || String(a.proveedor_nombre || '').localeCompare(String(b.proveedor_nombre || ''));
  });

const buildProveedorNotificationKey = ({ proveedorId, tipo, idReferencia } = {}) => {
  const normalizedProveedorId = Number(proveedorId || 0);
  const normalizedTipo = normalizeRatingType(tipo) || 'general';
  const normalizedReferenceId = Number(idReferencia || 0) || 0;
  return `proveedor-${normalizedProveedorId}-${normalizedTipo}-${normalizedReferenceId}`;
};

const buildProveedorNotificationEntry = async (db, { proveedorId, summary, puntuacion, tipo, idReferencia }) => {
  const providerResult = await db.query(
    `
      SELECT
        COALESCE(NULLIF(trim(COALESCE(to_jsonb(p)->>'razon_social', to_jsonb(p)->>'nombre', '')), ''), 'Sin proveedor') AS proveedor_nombre
      FROM proveedores p
      WHERE p.id = $1
      LIMIT 1
    `,
    [Number(proveedorId || 0)]
  );

  const proveedorNombreFromDb = String(providerResult.rows[0]?.proveedor_nombre || '').trim();
  if (!proveedorNombreFromDb || proveedorNombreFromDb.toLowerCase() === 'sin proveedor') {
    return null
  }

  const resolveOrigin = async () => {
    const normalizedTipo = normalizeRatingType(tipo);
    const referenceId = Number(idReferencia || 0);
    const rawTipo = String(tipo || '').trim();

    const buildDefaultOrigin = (typeLabel, fallbackName) => ({
      origen_tipo: typeLabel,
      origen_nombre: Number.isInteger(referenceId) && referenceId > 0 ? `${fallbackName} #${referenceId}` : '',
      origen_detalle: '',
    });

    if (normalizedTipo === 'servicio' && Number.isInteger(referenceId) && referenceId > 0) {
      try {
        const servicios = await fetchServiciosRows([referenceId], 'WHERE s.id = $1');
        const servicio = servicios[0] || null;
        const servicioNombre = String(servicio?.nombre_servicio || servicio?.descripcion_servicio || '').trim();
        return {
          origen_tipo: 'Servicio',
          origen_nombre: servicioNombre || `Servicio #${referenceId}`,
          origen_detalle: String(servicio?.descripcion_servicio || '').trim(),
        };
      } catch (_error) {
        return buildDefaultOrigin('Servicio', 'Servicio');
      }
    }

    if (normalizedTipo === 'compra' && Number.isInteger(referenceId) && referenceId > 0) {
      try {
        const detalleResult = await db.query(
          `
            SELECT
              md.id AS id_movimiento_detalle,
              md.id_movimiento,
              md.id_material,
              COALESCE(mat.nombre, 'Material') AS material_nombre,
              COALESCE(mat.descripcion, '') AS material_descripcion
            FROM movimiento_detalles md
            LEFT JOIN materiales mat ON mat.id = md.id_material
            WHERE md.id = $1
            LIMIT 1
          `,
          [referenceId]
        );

        const detalle = detalleResult.rows[0] || null;
        if (detalle) {
          const materialNombre = String(detalle.material_nombre || '').trim() || `Material #${referenceId}`;
          return {
            origen_tipo: 'Producto',
            origen_nombre: materialNombre,
            origen_detalle: String(detalle.material_descripcion || '').trim() || `Detalle de movimiento #${referenceId}`,
          };
        }

        const compras = await fetchComprasRows([referenceId], 'WHERE c.id = $1');
        const compra = compras[0] || null;
        const itemNames = Array.isArray(compra?.items)
          ? compra.items.map((item) => String(item?.material || item?.descripcion || '').trim()).filter(Boolean)
          : [];
        const uniqueItems = [...new Set(itemNames)];
        const topItems = uniqueItems.slice(0, 3);
        const extraCount = Math.max(uniqueItems.length - topItems.length, 0);
        const itemLabel = topItems.length > 0
          ? topItems.join(', ') + (extraCount > 0 ? ` y ${extraCount} más` : '')
          : `Compra #${referenceId}`;

        return {
          origen_tipo: 'Producto',
          origen_nombre: itemLabel,
          origen_detalle: String(compra?.proveedor || '').trim() || `Compra #${referenceId}`,
        };
      } catch (_error) {
        return buildDefaultOrigin('Producto', 'Compra');
      }
    }

    if (Number.isInteger(referenceId) && referenceId > 0) {
      try {
        const servicioOrigin = await (async () => {
          const servicios = await fetchServiciosRows([referenceId], 'WHERE s.id = $1');
          if (servicios.length > 0) {
            const servicio = servicios[0];
            const servicioNombre = String(servicio?.nombre_servicio || servicio?.descripcion_servicio || '').trim();
            return {
              origen_tipo: 'Servicio',
              origen_nombre: servicioNombre || `Servicio #${referenceId}`,
              origen_detalle: String(servicio?.descripcion_servicio || '').trim(),
            };
          }
          return null;
        })();

        if (servicioOrigin) return servicioOrigin;
      } catch (_error) {
        // ignore fallback errors
      }

      try {
        const compraOrigin = await (async () => {
          const compras = await fetchComprasRows([referenceId], 'WHERE c.id = $1');
          if (compras.length > 0) {
            const compra = compras[0];
            const itemNames = Array.isArray(compra?.items)
              ? compra.items.map((item) => String(item?.material || item?.descripcion || '').trim()).filter(Boolean)
              : [];
            const uniqueItems = [...new Set(itemNames)];
            const topItems = uniqueItems.slice(0, 3);
            const extraCount = Math.max(uniqueItems.length - topItems.length, 0);
            const itemLabel = topItems.length > 0
              ? topItems.join(', ') + (extraCount > 0 ? ` y ${extraCount} más` : '')
              : `Compra #${referenceId}`;
            return {
              origen_tipo: 'Producto',
              origen_nombre: itemLabel,
              origen_detalle: String(compra?.proveedor || '').trim() || `Compra #${referenceId}`,
            };
          }
          return null;
        })();

        if (compraOrigin) return compraOrigin;
      } catch (_error) {
        // ignore fallback errors
      }
    }

    if (rawTipo) {
      const fallbackType = normalizeRatingType(rawTipo) === 'servicio' ? 'Servicio' : 'Producto';
      return buildDefaultOrigin(fallbackType, fallbackType === 'Servicio' ? 'Servicio' : 'Compra');
    }

    return buildDefaultOrigin('Producto', 'Compra');
  };

  const origin = await resolveOrigin();

  const proveedorNombre = proveedorNombreFromDb || (Number(proveedorId || 0) > 0 ? `Proveedor #${proveedorId}` : 'Proveedor desconocido');
  const promedio = Number(summary?.calificacion_promedio ?? summary?.promedio_puntuacion ?? 0) || 0;
  const individual = Number(puntuacion ?? summary?.mi_calificacion ?? 0) || 0;
  const total = Number(summary?.calificacion_total ?? summary?.total_calificaciones ?? 0) || 0;
  const comentario = String(summary?.ultimo_comentario || summary?.mi_comentario || '').trim();
  const shouldNotify = individual <= 3 || promedio <= 3;
  const notificationId = buildProveedorNotificationKey({ proveedorId, tipo, idReferencia });

  if (!shouldNotify) {
    proveedorNotificationStore.delete(notificationId);
    return null;
  }

  const priority = individual <= 2 || promedio <= 2 ? 'ALTA' : 'MEDIA';
  const entry = {
    id: notificationId,
    tipo: 'PROVEEDOR_CALIFICACION_BAJA',
    proveedor_id: Number(proveedorId || 0),
    proveedor_nombre: proveedorNombre,
    titulo: 'Notificación de proveedor',
    mensaje: `${proveedorNombre} tiene calificación baja, revisar desempeño`,
    detalle: `Calificación individual: ${individual}/5. Promedio actualizado: ${promedio.toFixed(2)}/5. Total de calificaciones: ${total}`,
    comentario: comentario || null,
    origen_tipo: origin.origen_tipo,
    origen_nombre: origin.origen_nombre,
    origen_detalle: origin.origen_detalle,
    prioridad: priority,
    promedio_puntuacion: promedio,
    puntuacion_individual: individual,
    puntuacion_minima: Math.min(individual || 5, Number(summary?.puntuacion_minima || 5) || 5),
    total_calificaciones: total,
    tipo_calificacion: String(tipo || '').trim() || null,
    id_referencia: Number(idReferencia || 0) || null,
    fecha: currentPetDateTime(),
    fecha_creacion_timestamp: Date.now(),
    leida: false,
  };

  const current = proveedorNotificationStore.get(entry.id);
  if (
    current
    && current.promedio_puntuacion === entry.promedio_puntuacion
    && current.puntuacion_individual === entry.puntuacion_individual
    && current.total_calificaciones === entry.total_calificaciones
    && current.id_referencia === entry.id_referencia
    && current.tipo_calificacion === entry.tipo_calificacion
  ) {
    return current;
  }

  proveedorNotificationStore.set(entry.id, entry);
  return entry;
};

const hydrateProveedorNotificationsFromDb = async (db) => {
  const result = await db.query(
    `
      SELECT
        cp.id,
        cp.id_proveedor,
        COALESCE(p.razon_social, p.nombre, 'Sin proveedor') AS proveedor_nombre,
        cp.tipo,
        cp.id_referencia,
        cp.puntuacion,
        cp.comentario,
        cp.fecha,
        ROUND(AVG(cp.puntuacion) OVER (PARTITION BY cp.id_proveedor)::numeric, 2) AS promedio_puntuacion,
        MIN(cp.puntuacion) OVER (PARTITION BY cp.id_proveedor)::int AS puntuacion_minima,
        COUNT(*) OVER (PARTITION BY cp.id_proveedor)::int AS total_calificaciones
      FROM calificaciones_proveedor cp
      INNER JOIN proveedores p ON p.id = cp.id_proveedor
      WHERE lower(trim(COALESCE(cp.tipo, ''))) IN ('compra', 'servicio')
        AND cp.puntuacion <= 3
      ORDER BY cp.fecha DESC, cp.id DESC
    `
  );

  const entries = [];

  for (const row of result.rows) {
    const entry = await buildProveedorNotificationEntry(db, {
      proveedorId: Number(row.id_proveedor || 0),
      summary: {
        calificacion_promedio: Number(row.promedio_puntuacion || 0) || 0,
        calificacion_total: Number(row.total_calificaciones || 0) || 0,
        puntuacion_minima: Number(row.puntuacion_minima || 0) || 0,
      },
      puntuacion: Number(row.puntuacion || 0) || 0,
      tipo: row.tipo,
      idReferencia: Number(row.id_referencia || 0) || 0,
    });

    if (entry) entries.push(entry);
  }

  return entries;
};

const fetchProveedorNotifications = async (db) => {
  if (proveedorNotificationStore.size === 0) {
    const entries = await hydrateProveedorNotificationsFromDb(db);
    entries.forEach((entry) => proveedorNotificationStore.set(entry.id, entry));
  }

  return sortProveedorNotifications([...proveedorNotificationStore.values()]);
};

const evaluarProveedor = async (idProveedor, {
  db = pool,
  summary = null,
  puntuacion = null,
  tipo = null,
  idReferencia = null,
} = {}) => {
  const proveedorId = Number(idProveedor || 0);
  if (!Number.isInteger(proveedorId) || proveedorId <= 0) {
    return null;
  }

  let resolvedSummary = summary;
  if (!resolvedSummary) {
    const summaryMap = await fetchProveedorRatingsSummary(db, { proveedorIds: [proveedorId] });
    resolvedSummary = summaryMap.get(proveedorId) || null;
  }

  return buildProveedorNotificationEntry(db, {
    proveedorId,
    summary: resolvedSummary,
    puntuacion,
    tipo,
    idReferencia,
  });
};

const upsertProveedorRating = async (db, { user, proveedorId, puntuacion, comentario, tipo = '', idReferencia = null } = {}) => {
  const userId = Number(user?.id || 0);
  const idProveedor = Number(proveedorId || 0);
  const score = Number(puntuacion || 0);
  const note = String(comentario || '').trim();
  const ratingType = normalizeRatingType(tipo);
  const referenceId = Number(idReferencia || 0) || idProveedor;

  if (!userId || !idProveedor) {
    throw new Error('Proveedor invalido para calificar');
  }

  if (!ratingType) {
    throw new Error("tipo invalido. Solo se permite 'compra' o 'servicio'");
  }

  if (!Number.isInteger(score) || score < 1 || score > 5) {
    throw new Error('La puntuacion debe estar entre 1 y 5');
  }

  const existing = ratingType === 'servicio'
    ? await db.query(
      `
        SELECT id
        FROM calificaciones_proveedor
        WHERE id_proveedor = $1
          AND lower(trim(COALESCE(tipo, ''))) = $2
          AND id_referencia = $3
        LIMIT 1
        FOR UPDATE
      `,
      [idProveedor, ratingType, referenceId]
    )
    : await db.query(
      `
        SELECT id
        FROM calificaciones_proveedor
        WHERE id_proveedor = $1
          AND lower(trim(COALESCE(tipo, ''))) = $2
          AND id_referencia = $3
        LIMIT 1
        FOR UPDATE
      `,
      [idProveedor, ratingType, referenceId]
    );

  if (existing.rows.length > 0) {
    const alreadyRatedError = new Error('Ya calificaste este proveedor');
    alreadyRatedError.code = 'RATING_ALREADY_EXISTS';
    throw alreadyRatedError;
  }

  await db.query(
    `
      INSERT INTO calificaciones_proveedor (
        id_proveedor,
        id_usuario,
        tipo,
        id_referencia,
        puntuacion,
        comentario,
        fecha
      )
      VALUES ($1, $2, $3, $4, $5, $6, timezone('America/Lima', now()))
    `,
    [idProveedor, userId, ratingType, referenceId, score, note || null]
  );

  const [summary] = await fetchProveedorRatingsSummary(db, { proveedorIds: [idProveedor], userId })
    .then((result) => [result.get(idProveedor)])
    .catch(() => [null]);

  return summary || {
    calificacion_promedio: 0,
    calificacion_total: 0,
    alerta_cambio_proveedor: false,
    alerta_critica: false,
    mi_calificacion: score,
    mi_comentario: note,
    mi_fecha: currentPetDateTime(),
  };
};

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

const buildPurchaseComment = ({ comentarios = '', recibidoPor = '', itemCategorias = {}, entregaArea = null, comentariosHistorial = [] } = {}) => {
  let text = String(comentarios || '').trim();

  if (Array.isArray(comentariosHistorial) && comentariosHistorial.length > 0) {
    const encodedComments = Buffer.from(JSON.stringify(comentariosHistorial), 'utf8').toString('base64');
    text = `${text}${text ? '\n' : ''}${COMMENT_THREAD_NOTE_PREFIX}${encodedComments}]]`;
  }

  if (itemCategorias && typeof itemCategorias === 'object' && !Array.isArray(itemCategorias) && Object.keys(itemCategorias).length > 0) {
    const encoded = Buffer.from(JSON.stringify(itemCategorias), 'utf8').toString('base64');
    text = `${text}${text ? '\n' : ''}${ITEM_CATEGORY_NOTE_PREFIX}${encoded}]]`;
  }

  if (String(recibidoPor || '').trim()) {
    text = `${text}${text ? '\n' : ''}${RECEIPT_NOTE_PREFIX}${String(recibidoPor).trim()}]]`;
  }

  if (entregaArea && typeof entregaArea === 'object' && !Array.isArray(entregaArea)) {
    const encoded = Buffer.from(JSON.stringify(entregaArea), 'utf8').toString('base64');
    text = `${text}${text ? '\n' : ''}${AREA_DELIVERY_NOTE_PREFIX}${encoded}]]`;
  }

  return text;
};

module.exports = {
  normalizeRatingType,
  canRateCompra,
  canRateRequerimiento,
  canRateAnyProvider,
  canEditUnifiedProveedorRating,
  resolveSalidaRatingContext,
  fetchProveedorRatingsSummary,
  fetchProveedorAverageRatingsForAutomation,
  sortProveedorNotifications,
  buildProveedorNotificationKey,
  buildProveedorNotificationEntry,
  hydrateProveedorNotificationsFromDb,
  fetchProveedorNotifications,
  evaluarProveedor,
  upsertProveedorRating,
  parsePurchaseComments,
  buildPurchaseComment,
};
