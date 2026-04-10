const BASE_PERMISSION_NAMES = [
  'VER_INVENTARIO',
  'CREAR_REQUERIMIENTO',
  'CREAR_SOLICITUD_COMPRA',
  'VER_AJUSTES',
]

const ROLE_PERMISSION_NAMES_BY_ID = new Map([
  [4, [...BASE_PERMISSION_NAMES, 'CREAR_SOLICITUD_SERVICIO', 'CAMBIAR_ESTADO_SERVICIO']],
  [5, [...BASE_PERMISSION_NAMES, 'APROBAR_JEFE_AREA']],
  [6, [...BASE_PERMISSION_NAMES, 'APROBAR_GERENCIA_AREA', 'CALIFICAR_COMPRA', 'CALIFICAR_REQUERIMIENTO']],
  [7, [...BASE_PERMISSION_NAMES, 'APROBAR_FINANZAS']],
  [8, [
    ...BASE_PERMISSION_NAMES,
    'APROBAR_JEFE_AREA',
    'APROBAR_GERENCIA_AREA',
    'APROBAR_FINANZAS',
    'APROBAR_ADMIN',
    'GESTIONAR_ROLES',
    'CALIFICAR_COMPRA',
    'CALIFICAR_REQUERIMIENTO',
    'GESTIONAR_ORDENES_COMPRA',
    'GESTIONAR_PROVEEDORES',
    'EDITAR_INVENTARIO',
    'AGREGAR_INVENTARIO_MANUAL',
    'VER_NOTIFICACIONES_PROVEEDOR',
    'GESTIONAR_ENTREGAS',
    'CREAR_SOLICITUD_SERVICIO',
    'CAMBIAR_ESTADO_SERVICIO',
    'VER_HISTORIAL_SERVICIOS',
  ]],
  [9, [...BASE_PERMISSION_NAMES, 'GESTIONAR_ORDENES_COMPRA', 'GESTIONAR_PROVEEDORES', 'EDITAR_INVENTARIO', 'AGREGAR_INVENTARIO_MANUAL', 'VER_NOTIFICACIONES_PROVEEDOR', 'VER_HISTORIAL_SERVICIOS']],
  [10, [...BASE_PERMISSION_NAMES, 'GESTIONAR_ENTREGAS']],
  [11, [...BASE_PERMISSION_NAMES, 'VER_HISTORIAL_SERVICIOS']],
])

export const getPermissionsByRole = (rolId) => {
  const numericRoleId = Number(rolId || 0)
  if (ROLE_PERMISSION_NAMES_BY_ID.has(numericRoleId)) {
    return [...new Set(ROLE_PERMISSION_NAMES_BY_ID.get(numericRoleId))]
  }

  return [...BASE_PERMISSION_NAMES]
}

const normalizePermissionName = (value) => String(value || '')
  .trim()
  .toUpperCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^A-Z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '')

export const hasPermission = (sourcePermissions, permission) => {
  const normalizedPermission = normalizePermissionName(permission)
  if (!normalizedPermission) return false

  const permissions = Array.isArray(sourcePermissions) ? sourcePermissions : []
  return permissions.some((item) => normalizePermissionName(item) === normalizedPermission)
}

export const hasAnyPermission = (sourcePermissions, permissions = []) => {
  return permissions.some((permission) => hasPermission(sourcePermissions, permission))
}
