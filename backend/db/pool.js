// TODO: The following functions are referenced by fetchServiciosRows/fetchComprasRows
// and will need to be imported once extracted from server.js:
//   parseEmbeddedCommentsFromText, fetchCommentsForEntities,
//   fetchActionableApprovalReferenceIds, fetchFirstApprovalReferenceIdsByRole,
//   fetchNextPendingApprovalRoleByReferences, isPendingApprovalState,
//   mapCompraRows, fetchProveedorRatingsSummary,
//   getApprovalRoleIdFromState, getPendingStateByRoleId

const { Pool } = require('pg');
const { PET_SQL_NOW, formatPetDateTime } = require('../utils/datetime');

const configuredDbHost = process.env.DB_HOST || 'localhost';
const effectiveDbHost = configuredDbHost === 'postgres' && process.platform === 'win32'
  ? 'localhost'
  : configuredDbHost;

const pool = new Pool({
  host: effectiveDbHost,
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'postgres',
  options: '-c timezone=America/Lima',
});

let schemaMeta = {
  loaded: false,
  proveedoresColumns: new Set(),
  comprasColumns: new Set(),
  detalleComprasColumns: new Set(),
  stockColumns: new Set(),
  movimientosColumns: new Set(),
  serviciosColumns: new Set(),
  materialesColumns: new Set(),
  requerimientosColumns: new Set(),
  usuariosColumns: new Set(),
  requerimientoReceptorIdColumn: null,
  usuariosRoleIdColumn: 'id_role',
  usuariosEmailColumn: 'email',
  usuariosPasswordColumn: 'password_hash',
  usuariosEstadoColumn: null,
};

let ROLE_NAME_BY_ID = new Map(); // Cache: roleId → roleName for generating PENDIENTE_* states

const loadRoleNamesCache = async () => {
  try {
    const result = await pool.query(`SELECT id, nombre FROM roles`);
    ROLE_NAME_BY_ID.clear();
    result.rows.forEach((row) => {
      const roleId = Number(row.id || 0);
      const roleName = String(row.nombre || '').trim();
      if (roleId > 0 && roleName) {
        ROLE_NAME_BY_ID.set(roleId, roleName);
      }
    });
    console.log('[ROLES] Role names cache loaded:', Object.fromEntries(ROLE_NAME_BY_ID));
  } catch (err) {
    console.warn('[ROLES] Could not load role names:', err.message);
  }
};

const dbFunctionExists = async (signature) => {
  const [namePart, argsPart = ''] = String(signature || '').split('(');
  const functionName = namePart.trim();
  const argList = argsPart.replace(/\)\s*$/, '').trim();

  const result = await pool.query(
    `
      SELECT EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.proname = $1
          AND n.nspname = 'public'
          AND (
            $2 = ''
            OR pg_get_function_identity_arguments(p.oid) = $2
          )
      ) AS exists
    `,
    [functionName, argList]
  );

  return Boolean(result.rows[0]?.exists);
};

const pickExistingColumn = (columnSet, candidates = []) => {
  for (const candidate of candidates) {
    if (columnSet.has(candidate)) {
      return candidate;
    }
  }
  return null;
};

const getUserRoleIdExpr = (tableAlias) =>
  `NULLIF(COALESCE(to_jsonb(${tableAlias})->>'id_role', to_jsonb(${tableAlias})->>'id_rol', ''), '')::int`;

const getUserRoleIdColumn = () => schemaMeta.usuariosRoleIdColumn || 'id_role';
const getUserEmailExpr = (tableAlias) =>
  `NULLIF(COALESCE(to_jsonb(${tableAlias})->>'email', to_jsonb(${tableAlias})->>'correo', ''), '')`;
const getUserPhotoColumn = () => pickExistingColumn(schemaMeta.usuariosColumns, ['imagen', 'foto']);
const getUserPasswordExpr = (tableAlias) =>
  `NULLIF(COALESCE(to_jsonb(${tableAlias})->>'password_hash', to_jsonb(${tableAlias})->>'contraseña', to_jsonb(${tableAlias})->>'contrasena', ''), '')`;
const getUserEstadoExpr = (tableAlias) =>
  `NULLIF(COALESCE(to_jsonb(${tableAlias})->>'estado', ''), '')`;
const getRequerimientoDescripcionExpr = (tableAlias) =>
  `NULLIF(COALESCE(to_jsonb(${tableAlias})->>'comentario', to_jsonb(${tableAlias})->>'descripcion', to_jsonb(${tableAlias})->>'observaciones', ''), '')`;
const getRequerimientoDescripcionColumn = () =>
  pickExistingColumn(schemaMeta.requerimientosColumns, ['comentario', 'descripcion', 'observaciones']) || 'comentario';
const getRequerimientoApprovalColumn = () =>
  pickExistingColumn(schemaMeta.requerimientosColumns, ['estado_aprobacion']);
const getMovimientoTipoColumn = () =>
  pickExistingColumn(schemaMeta.movimientosColumns, ['tipo_movimiento', 'tipo']) || 'tipo';
const getMovimientoFechaColumn = () =>
  pickExistingColumn(schemaMeta.movimientosColumns, ['fecha_movimiento', 'fecha']);
const getMovimientoUsuarioColumn = () =>
  pickExistingColumn(schemaMeta.movimientosColumns, ['usuario_registro', 'id_usuario', 'usuario_id']);
const getMovimientoRequerimientoColumn = () =>
  pickExistingColumn(schemaMeta.movimientosColumns, ['id_requerimiento', 'requerimiento_id']);
const getMovimientoMaterialColumn = () =>
  pickExistingColumn(schemaMeta.movimientosColumns, ['id_material']);
const getMovimientoCantidadColumn = () =>
  pickExistingColumn(schemaMeta.movimientosColumns, ['cantidad']);
const getMovimientoDocumentoColumn = () =>
  pickExistingColumn(schemaMeta.movimientosColumns, ['documento_referencia', 'documento']);
const getMovimientoAlmacenColumn = () =>
  pickExistingColumn(schemaMeta.movimientosColumns, ['id_almacen']);
const getMovimientoObservacionesColumn = () =>
  pickExistingColumn(schemaMeta.movimientosColumns, ['observaciones', 'comentarios', 'descripcion']);
const getServicioUserIdColumn = () =>
  pickExistingColumn(schemaMeta.serviciosColumns, ['id_usuario', 'usuario_id']) || 'id_usuario';
const getServicioProviderIdColumn = () =>
  pickExistingColumn(schemaMeta.serviciosColumns, ['proveedor_id', 'id_proveedor']) || 'proveedor_id';
const getServicioAreaIdColumn = () =>
  pickExistingColumn(schemaMeta.serviciosColumns, ['area_id', 'id_area']) || 'area_id';
const getServicioDescriptionColumn = () =>
  pickExistingColumn(schemaMeta.serviciosColumns, ['descripcion_servicio', 'descripcion', 'comentario']) || 'descripcion_servicio';
const getServicioNameColumn = () =>
  pickExistingColumn(schemaMeta.serviciosColumns, ['nombre_servicio', 'nombre', 'titulo']) || 'nombre_servicio';
const getServicioPriorityColumn = () =>
  pickExistingColumn(schemaMeta.serviciosColumns, ['prioridad', 'nivel_prioridad']) || 'prioridad';
const getServicioDentroPlanColumn = () =>
  pickExistingColumn(schemaMeta.serviciosColumns, ['dentro_plan', 'en_plan']);
const getServicioSubtotalColumn = () =>
  pickExistingColumn(schemaMeta.serviciosColumns, ['subtotal']);
const getServicioImpuestosColumn = () =>
  pickExistingColumn(schemaMeta.serviciosColumns, ['impuestos', 'igv']);
const getServicioIgvColumn = () =>
  pickExistingColumn(schemaMeta.serviciosColumns, ['igv', 'impuestos']);
const getServicioCostoEnvioColumn = () =>
  pickExistingColumn(schemaMeta.serviciosColumns, ['costo_envio', 'envio']);
const getServicioOtrosCostosColumn = () =>
  pickExistingColumn(schemaMeta.serviciosColumns, ['otros_costos', 'otros_gastos']);
const getServicioTotalColumn = () =>
  pickExistingColumn(schemaMeta.serviciosColumns, ['total']);
const getServicioAplicaRetencionColumn = () =>
  pickExistingColumn(schemaMeta.serviciosColumns, ['aplica_retencion']);
const getServicioRetencionColumn = () =>
  pickExistingColumn(schemaMeta.serviciosColumns, ['retencion', 'descuento']);
const getServicioTipoRetencionColumn = () =>
  pickExistingColumn(schemaMeta.serviciosColumns, ['tipo_retencion']);
const getServicioTipoCambioColumn = () =>
  pickExistingColumn(schemaMeta.serviciosColumns, ['tipo_cambio']);
const getServicioCostColumn = () =>
  pickExistingColumn(schemaMeta.serviciosColumns, ['costo', 'importe', 'monto']) || 'costo';
const getServicioCurrencyIdColumn = () =>
  pickExistingColumn(schemaMeta.serviciosColumns, ['moneda_id', 'id_moneda']) || 'moneda_id';
const getServicioApprovalColumn = () =>
  pickExistingColumn(schemaMeta.serviciosColumns, ['estado_aprobacion', 'estado']) || 'estado_aprobacion';
const getServicioStatusColumn = () =>
  pickExistingColumn(schemaMeta.serviciosColumns, ['estado_flujo', 'estado_servicio']) || 'estado_flujo';
const quoteIdentifier = (name) => `"${String(name || '').replace(/"/g, '""')}"`;

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
        COALESCE(mo.nombre, '') AS moneda,
        COALESCE(u.nombre, 'Sin usuario') AS usuario,
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
    const parsedDescription = parseEmbeddedCommentsFromText(row.descripcion_servicio || '');
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

  const commentsByServicio = await fetchCommentsForEntities(pool, {
    tipoEntidad: 'servicio',
    entityIds: servicios.map((row) => Number(row.id || 0)),
  });

  servicios.forEach((row) => {
    row.comentarios_historial = commentsByServicio.get(Number(row.id || 0)) || [];
  });

  // Normalize legacy estado_flujo values: treat 'APROBADO' as 'DATOS_COMPLETADOS'
  // Keep estado_flujo as stored; do not remap 'APROBADO' to 'DATOS_COMPLETADOS'

  const approvalRoleId = Number(options?.approvalRoleId || 0);
  const approvalPermissionGranted = Boolean(options?.approvalPermissionGranted);
  if (approvalRoleId > 0) {
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
  }

  const nextPendingByRef = await fetchNextPendingApprovalRoleByReferences(pool, {
    tipo: 'SERVICIO',
    referenceIds: servicios.map((row) => Number(row.id || 0)),
  });

  return servicios;
};

const insertMovimiento = async (client, {
  tipo,
  usuarioRegistro,
  idRequerimiento = null,
  idMaterial = null,
  cantidad = null,
  documentoReferencia = null,
  idAlmacen = null,
  observaciones = null,
  fechaExpression = PET_SQL_NOW,
} = {}) => {
  const columns = [];
  const values = [];
  const valueTokens = [];

  const addValue = (columnName, value) => {
    if (!columnName) return;
    columns.push(columnName);
    values.push(value);
    valueTokens.push(`$${values.length}`);
  };

  const addExpression = (columnName, expression) => {
    if (!columnName) return;
    columns.push(columnName);
    valueTokens.push(String(expression || PET_SQL_NOW));
  };

  addValue(getMovimientoTipoColumn(), String(tipo || '').trim().toUpperCase());
  addExpression(getMovimientoFechaColumn(), fechaExpression);
  addValue(getMovimientoUsuarioColumn(), usuarioRegistro == null ? null : String(usuarioRegistro));
  addValue(getMovimientoRequerimientoColumn(), idRequerimiento == null ? null : Number(idRequerimiento));
  addValue(getMovimientoMaterialColumn(), idMaterial == null ? null : Number(idMaterial));
  addValue(getMovimientoCantidadColumn(), cantidad == null ? null : Number(cantidad));
  addValue(getMovimientoDocumentoColumn(), documentoReferencia == null ? null : String(documentoReferencia));
  addValue(getMovimientoAlmacenColumn(), idAlmacen == null ? null : Number(idAlmacen));
  addValue(getMovimientoObservacionesColumn(), observaciones == null ? null : String(observaciones));

  const result = await client.query(
    `
      INSERT INTO movimientos (${columns.join(', ')})
      VALUES (${valueTokens.join(', ')})
      RETURNING id
    `,
    values
  );

  return Number(result.rows[0]?.id || 0);
};

const getColumnSet = async (tableName) => {
  const result = await pool.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
    `,
    [tableName]
  );

  return new Set(result.rows.map((row) => row.column_name));
};

const loadSchemaMeta = async () => {
  schemaMeta.proveedoresColumns = await getColumnSet('proveedores');
  schemaMeta.comprasColumns = await getColumnSet('compras');
  schemaMeta.detalleComprasColumns = await getColumnSet('detalle_compras');
  schemaMeta.stockColumns = await getColumnSet('stock');
  schemaMeta.movimientosColumns = await getColumnSet('movimientos');
  schemaMeta.serviciosColumns = await getColumnSet('servicios');
  schemaMeta.materialesColumns = await getColumnSet('materiales');
  schemaMeta.requerimientosColumns = await getColumnSet('requerimientos');
  schemaMeta.usuariosColumns = await getColumnSet('usuarios');

  schemaMeta.requerimientoReceptorIdColumn = pickExistingColumn(schemaMeta.requerimientosColumns, ['receptor_user_id']);
  schemaMeta.usuariosRoleIdColumn = pickExistingColumn(schemaMeta.usuariosColumns, ['id_role', 'id_rol']) || 'id_role';
  schemaMeta.usuariosEmailColumn = pickExistingColumn(schemaMeta.usuariosColumns, ['email', 'correo']) || 'email';
  schemaMeta.usuariosPasswordColumn = pickExistingColumn(schemaMeta.usuariosColumns, ['password_hash', 'contraseña', 'contrasena']) || 'password_hash';
  schemaMeta.usuariosEstadoColumn = pickExistingColumn(schemaMeta.usuariosColumns, ['estado']);
  schemaMeta.loaded = true;
};

const proveedorFieldCandidates = {
  nombre: ['nombre', 'nombre_comercial'],
  razon_social: ['razon_social', 'nombre', 'nombre_comercial'],
  ruc: ['ruc'],
  direccion: ['direccion'],
  distrito: ['distrito'],
  correo: ['correo', 'email'],
  persona_responsable: ['persona_responsable', 'contacto', 'responsable'],
  telefono: ['telefono', 'celular'],
  condiciones_pago: ['condiciones_pago'],
  banco: ['banco'],
  moneda: ['moneda'],
  numero_cuenta: ['numero_cuenta', 'cuenta'],
  cci: ['cci'],
  retencion: ['retencion'],
  descuento: ['descuento'],
  categoria: ['categoria'],
  tipo: ['tipo'],
  tipo_retencion: ['tipo_retencion'],
  id_moneda: ['id_moneda'],
  id_area_destino: ['id_area_destino'],
  area_destino: ['area_destino'],
  descripcion: ['descripcion'],
};

const getProveedorColumn = (field) => pickExistingColumn(
  schemaMeta.proveedoresColumns,
  proveedorFieldCandidates[field] || []
);

const buildProveedorSelectExpressions = () => {
  const exprs = ['p.id'];

  Object.keys(proveedorFieldCandidates).forEach((field) => {
    const column = getProveedorColumn(field);
    if (column) {
      if (field === 'descuento') {
        exprs.push(`COALESCE(NULLIF(p.${column}::numeric, NULL), 0) AS ${field}`);
      } else if (field === 'id_moneda' || field === 'id_area_destino') {
        exprs.push(`NULLIF(p.${column}::int, NULL) AS ${field}`);
      } else {
        exprs.push(`COALESCE(NULLIF(trim(p.${column}::text), ''), '') AS ${field}`);
      }
    } else {
      if (field === 'descuento') {
        exprs.push(`0::numeric AS ${field}`);
      } else if (field === 'id_moneda' || field === 'id_area_destino') {
        exprs.push(`NULL::int AS ${field}`);
      } else {
        exprs.push(`''::text AS ${field}`);
      }
    }
  });

  return exprs;
};

const getMaterialStockTotal = async (client, idMaterial) => {
  const result = await client.query(
    'SELECT COALESCE(SUM(cantidad), 0) AS total FROM stock WHERE id_material = $1',
    [idMaterial]
  );
  return Number(result.rows[0]?.total || 0);
};

const isMaterialVisibleInInventory = async (client, idMaterial) => {
  const result = await client.query(
    `
      SELECT
        EXISTS(
          SELECT 1
          FROM stock s
          WHERE s.id_material = $1
        ) AS has_stock,
        EXISTS(
          SELECT 1
          FROM detalle_compras dc
          WHERE dc.id_material = $1
        ) AS has_purchase_history
    `,
    [idMaterial]
  );

  const row = result.rows[0] || {};
  return Boolean(row.has_stock || !row.has_purchase_history);
};

const discountMaterialStockDistributed = async (client, idMaterial, quantity) => {
  let pending = Number(quantity);
  const allocations = [];

  const rows = await client.query(
    `
      SELECT id_material, id_almacen, cantidad
      FROM stock
      WHERE id_material = $1
      ORDER BY cantidad DESC
      FOR UPDATE
    `,
    [idMaterial]
  );

  for (const row of rows.rows) {
    if (pending <= 0) break;
    const available = Number(row.cantidad || 0);

    if (available >= pending) {
      await client.query(
        'UPDATE stock SET cantidad = cantidad - $1 WHERE id_material = $2 AND id_almacen = $3',
        [pending, row.id_material, row.id_almacen]
      );
      allocations.push({ id_almacen: Number(row.id_almacen), cantidad: Number(pending) });
      pending = 0;
    } else {
      await client.query(
        'UPDATE stock SET cantidad = 0 WHERE id_material = $1 AND id_almacen = $2',
        [row.id_material, row.id_almacen]
      );
      if (available > 0) {
        allocations.push({ id_almacen: Number(row.id_almacen), cantidad: Number(available) });
      }
      pending -= available;
    }
  }

  if (pending > 0) {
    throw new Error(`Stock insuficiente para material ${idMaterial}`);
  }

  return allocations;
};

const fetchComprasRows = async (params = [], whereClause = '', options = {}) => {
  const result = await pool.query(
    `
      SELECT
        c.id,
        -- Keep estado and estado_pedido as separate fields; prefer estado when deciding
        COALESCE(upper(trim(NULLIF(to_jsonb(c)->>'estado', ''))), '') AS estado,
        COALESCE(upper(trim(NULLIF(to_jsonb(c)->>'estado_pedido', ''))), '') AS estado_pedido,
        NULLIF(to_jsonb(c)->>'id_usuario', '')::int AS id_usuario,
        NULLIF(to_jsonb(c)->>'id_proveedor', '')::int AS id_proveedor,
        u.nombre AS usuario,
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
        COALESCE(NULLIF(to_jsonb(dc)->>'cantidad', '')::numeric, 0) AS cantidad
      FROM compras c
      JOIN usuarios u ON u.id = c.id_usuario
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

  // Build canonical `estado` value: prefer `estado` column, fall back to `estado_pedido`.
  compras.forEach((row) => {
    try {
      const rawEstado = String(row.estado || row.estado_pedido || '').trim();
      row.estado = rawEstado ? rawEstado.toUpperCase() : 'PENDIENTE';

      // Normalize any legacy or named PENDIENTE states to the canonical numeric form
      // (e.g. PENDIENTE_JEFE_DE_AREA -> PENDIENTE_<roleId>) so the API always
      // exposes a consistent `estado` value that frontends can rely on.
      const roleIdFromState = getApprovalRoleIdFromState(String(row.estado || '')) || 0;
      if (roleIdFromState > 0) {
        row.estado = getPendingStateByRoleId(roleIdFromState);
      }
    } catch (err) {
      // leave as-is on error
    }
  });

  const commentsByCompra = await fetchCommentsForEntities(pool, {
    tipoEntidad: 'compra',
    entityIds: compras.map((row) => Number(row.id || 0)),
  });

  compras.forEach((row) => {
    row.comentarios_historial = commentsByCompra.get(Number(row.id || 0)) || [];
  });

  const providerIds = [...new Set(
    compras
      .map((row) => Number(row.id_proveedor || 0))
      .filter((id) => Number.isInteger(id) && id > 0)
  )];

  if (providerIds.length > 0) {
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
  }

  const approvalRoleId = Number(options?.approvalRoleId || 0);
  const approvalPermissionGranted = Boolean(options?.approvalPermissionGranted);
  if (approvalRoleId > 0) {
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
  }

  const nextPendingByRef = await fetchNextPendingApprovalRoleByReferences(pool, {
    tipo: 'COMPRA',
    referenceIds: compras.map((row) => Number(row.id || 0)),
  });

  // Note: `estado_aprobacion_detalle` is a UI label generated by `buildApprovalStatusLabel`.
  // Per request, do not expose `estado_aprobacion_detalle` in the API response here.

  // Aggregate approvers for these compras so callers can know who approved each one.
  const compraIds = compras.map((r) => Number(r.id || 0)).filter((v) => Number.isInteger(v) && v > 0);
  if (compraIds.length > 0) {
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
  }

  return compras;
};

module.exports = {
  pool,
  schemaMeta,
  ROLE_NAME_BY_ID,
  loadRoleNamesCache,
  loadSchemaMeta,
  getColumnSet,
  dbFunctionExists,
  pickExistingColumn,
  getUserRoleIdExpr,
  getUserRoleIdColumn,
  getUserEmailExpr,
  getUserPhotoColumn,
  getUserPasswordExpr,
  getUserEstadoExpr,
  getRequerimientoDescripcionExpr,
  getRequerimientoDescripcionColumn,
  getRequerimientoApprovalColumn,
  getMovimientoTipoColumn,
  getMovimientoFechaColumn,
  getMovimientoUsuarioColumn,
  getMovimientoRequerimientoColumn,
  getMovimientoMaterialColumn,
  getMovimientoCantidadColumn,
  getMovimientoDocumentoColumn,
  getMovimientoAlmacenColumn,
  getMovimientoObservacionesColumn,
  getServicioUserIdColumn,
  getServicioProviderIdColumn,
  getServicioAreaIdColumn,
  getServicioDescriptionColumn,
  getServicioNameColumn,
  getServicioPriorityColumn,
  getServicioDentroPlanColumn,
  getServicioSubtotalColumn,
  getServicioImpuestosColumn,
  getServicioIgvColumn,
  getServicioCostoEnvioColumn,
  getServicioOtrosCostosColumn,
  getServicioTotalColumn,
  getServicioAplicaRetencionColumn,
  getServicioRetencionColumn,
  getServicioTipoRetencionColumn,
  getServicioTipoCambioColumn,
  getServicioCostColumn,
  getServicioCurrencyIdColumn,
  getServicioApprovalColumn,
  getServicioStatusColumn,
  quoteIdentifier,
  fetchServiciosRows,
  insertMovimiento,
  proveedorFieldCandidates,
  getProveedorColumn,
  buildProveedorSelectExpressions,
  getMaterialStockTotal,
  isMaterialVisibleInInventory,
  discountMaterialStockDistributed,
  fetchComprasRows,
};
