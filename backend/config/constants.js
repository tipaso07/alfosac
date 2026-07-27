const { normalizeRoleName, normalizePermissionName } = require('../utils/normalize');

const ESTADOS = ['PENDIENTE', 'APROBADO', 'RECHAZADO', 'COMPLETADO'];
const PRIORIDADES = ['BAJA', 'MEDIA', 'ALTA'];
const ESTADOS_ENTREGA = ['POR_RECOGER', 'ENTREGADO'];
const ESTADOS_COMPRA = ['PENDIENTE', 'APROBADA', 'POR_RECIBIR', 'RECIBIDA', 'ENTREGADO', 'RECHAZADA'];
const ESTADOS_SERVICIO_APROBACION = ['PENDIENTE', 'APROBADO', 'RECHAZADO'];
const ESTADOS_SERVICIO_FLUJO = ['DATOS_COMPLETADOS', 'PENDIENTE', 'REALIZADO'];
const DEFAULT_USER_AVATAR = 'https://ui-avatars.com/api/?name=Usuario&background=e5e7eb&color=111827';

const JWT_SECRET = process.env.JWT_SECRET || 'alfosac-dev-jwt-secret-change-me';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';

const GERENTES_ROLE = 'GERENTES';
const SOLICITANTES_ROLE = 'SOLICITANTES';
const ALMACENERO_ROLE = 'ALMACENERO';
const COMPRAS_ROLE = 'COMPRAS';
const SERVICIOS_GENERALES_ROLE = 'SERVICIOS GENERALES';

const isGerentesRole = (role) => normalizeRoleName(role) === GERENTES_ROLE;
const isSolicitantesRole = (role) => normalizeRoleName(role) === SOLICITANTES_ROLE;
const isAlmaceneroRole = (role) => normalizeRoleName(role) === ALMACENERO_ROLE;
const isComprasRole = (role) => normalizeRoleName(role) === COMPRAS_ROLE;
const isServiciosGeneralesRole = (role) => normalizeRoleName(role) === SERVICIOS_GENERALES_ROLE;

const isWarehouseAreaName = (value) => {
  const normalizedValue = normalizeRoleName(value);
  return normalizedValue === 'GENERAL' || normalizedValue.includes('ALMACEN');
};
const getNormalizedRoles = (roleInput) => {
  if (Array.isArray(roleInput)) {
    return roleInput.map((role) => normalizeRoleName(role)).filter(Boolean);
  }

  return String(roleInput || '')
    .split(',')
    .map((role) => normalizeRoleName(role))
    .filter(Boolean);
};

const hasAnyRole = (roleInput, allowedRoles = []) => {
  const currentRoles = new Set(getNormalizedRoles(roleInput));
  const allowed = allowedRoles.map((role) => normalizeRoleName(role)).filter(Boolean);
  return allowed.some((role) => currentRoles.has(role));
};

const canManageRequirementsRole = (role) => hasAnyRole(role, ['GERENTES', 'COMPRAS', 'SOLICITANTES']);
const canManagePurchasesRole = (role) => hasAnyRole(role, ['GERENTES', 'COMPRAS']);
const canManageDeliveryRole = (role) => hasAnyRole(role, ['ALMACENERO']);

// Approval chains are hardcoded - role 1 = GERENTES approves all
const APPROVAL_ROLES_BY_LEVEL = [1];

const BASE_PERMISSION_NAMES = [
  'VER_INVENTARIO',
  'CREAR_REQUERIMIENTO',
  'CREAR_SOLICITUD_COMPRA',
  'VER_AJUSTES',
];

const ROLE_PERMISSION_NAMES_BY_ID = new Map([
  [1, [ // GERENTES
    'VER_DASHBOARD', 'VER_INVENTARIO',
    'CREAR_REQUERIMIENTO', 'CREAR_SOLICITUD_COMPRA',
    'GESTIONAR_SOLICITUDES', 'GESTIONAR_COMPRAS',
    'VER_MOVIMIENTOS', 'VER_AJUSTES',
    'VER_HISTORIAL_COMPRAS_DIRECTAS', 'APROBAR_REQUERIMIENTO',
    'GESTIONAR_ORDENES_COMPRA', 'CAMBIAR_ESTADO_SERVICIO',
  ]],
  [2, [ // COMPRAS
    'VER_DASHBOARD', 'VER_INVENTARIO', 'EDITAR_INVENTARIO', 'AGREGAR_INVENTARIO_MANUAL',
    'CREAR_REQUERIMIENTO', 'CREAR_SOLICITUD_COMPRA',
    'GESTIONAR_COMPRAS', 'GESTIONAR_PROVEEDORES', 'GESTIONAR_CUENTAS',
    'VER_MOVIMIENTOS', 'VER_AJUSTES', 'VER_NOTIFICACIONES_PROVEEDOR',
    'VER_HISTORIAL_COMPRAS_DIRECTAS', 'CREAR_COMPRA_DIRECTA', 'GESTIONAR_ORDENES_COMPRA',
  ]],
  [3, [ // ALMACENERO
    'VER_INVENTARIO', 'GESTIONAR_ENTREGAS',
    'VER_MOVIMIENTOS', 'VER_AJUSTES',
  ]],
  [4, [ // SOLICITANTES
    'VER_INVENTARIO', 'CREAR_REQUERIMIENTO', 'CREAR_SOLICITUD_COMPRA',
    'GESTIONAR_SOLICITUDES',
    'VER_MOVIMIENTOS', 'VER_AJUSTES', 'VER_HISTORIAL_SERVICIOS',
    'CAMBIAR_ESTADO_SERVICIO',
  ]],
  [8, [ // SERVICIOS GENERALES
    'VER_INVENTARIO', 'CREAR_REQUERIMIENTO', 'CREAR_SOLICITUD_COMPRA',
    'CREAR_SOLICITUD_SERVICIO', 'GESTIONAR_SOLICITUDES', 'VER_MOVIMIENTOS', 'VER_AJUSTES',
  ]],
]);

const getPermissionsByRoleId = (roleId) => {
  const numericRoleId = Number(roleId || 0);
  if (ROLE_PERMISSION_NAMES_BY_ID.has(numericRoleId)) {
    return [...new Set(ROLE_PERMISSION_NAMES_BY_ID.get(numericRoleId))];
  }

  return [...BASE_PERMISSION_NAMES];
};

module.exports = {
  ESTADOS,
  PRIORIDADES,
  ESTADOS_ENTREGA,
  ESTADOS_COMPRA,
  ESTADOS_SERVICIO_APROBACION,
  ESTADOS_SERVICIO_FLUJO,
  DEFAULT_USER_AVATAR,
  JWT_SECRET,
  JWT_EXPIRES_IN,
  GERENTES_ROLE,
  SOLICITANTES_ROLE,
  ALMACENERO_ROLE,
  COMPRAS_ROLE,
  SERVICIOS_GENERALES_ROLE,
  isGerentesRole,
  isSolicitantesRole,
  isAlmaceneroRole,
  isComprasRole,
  isServiciosGeneralesRole,
  isWarehouseAreaName,
  getNormalizedRoles,
  hasAnyRole,
  canManageRequirementsRole,
  canManagePurchasesRole,
  canManageDeliveryRole,
  APPROVAL_ROLES_BY_LEVEL,
  BASE_PERMISSION_NAMES,
  ROLE_PERMISSION_NAMES_BY_ID,
  getPermissionsByRoleId,
};
