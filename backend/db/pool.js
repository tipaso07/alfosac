const { Pool } = require('pg');
const { PET_SQL_NOW } = require('../utils/datetime');

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
  insertMovimiento,
  proveedorFieldCandidates,
  getProveedorColumn,
  buildProveedorSelectExpressions,
  getMaterialStockTotal,
  isMaterialVisibleInInventory,
  discountMaterialStockDistributed,
};
