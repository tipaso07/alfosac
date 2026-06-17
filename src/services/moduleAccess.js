const normalizePermissionName = (value) => String(value || '')
  .trim()
  .toUpperCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^A-Z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '')

const PERMISSION_ALIASES = {
  EDITAR_MATERIAL: 'EDITAR_INVENTARIO',
  GESTIONAR_ORDENES_COMPRA: 'GESTIONAR_COMPRAS',
}

const canonicalizePermissionName = (value) => {
  const normalized = normalizePermissionName(value)
  return PERMISSION_ALIASES[normalized] || normalized
}

export const hasPermission = (sourcePermissions, permission) => {
  const normalizedPermission = canonicalizePermissionName(permission)
  if (!normalizedPermission) return false

  const permissions = Array.isArray(sourcePermissions) ? sourcePermissions : []
  return permissions.some((item) => canonicalizePermissionName(item) === normalizedPermission)
}

export const getModulesByRole = (rolId) => {
  void rolId
  return []
}

export const modules = [
  { id: 12, name: 'Dashboard', path: '/dashboard' },
  { id: 1, name: 'Inventario', path: '/inventario' },
  { id: 2, name: 'Solicitar Requerimiento', path: '/requerimiento' },
  { id: 3, name: 'Solicitar Compra', path: '/compra' },
  { id: 4, name: 'Solicitar Servicio', path: '/servicio' },
  { id: 5, name: 'Gestionar Solicitudes', path: '/gestionar' },
  { id: 6, name: 'Mis Ordenes', path: '/mis-compras' },
  { id: 7, name: 'Gestionar Entregas', path: '/entregas' },
  { id: 13, name: 'Historial de Servicios', path: '/historial-servicios' },
  { id: 8, name: 'Movimientos', path: '/movimientos' },
  { id: 10, name: 'Gestion de Proveedores', path: '/proveedores' },
  { id: 11, name: 'Ajustes', path: '/ajustes' },
  { id: 14, name: 'Notificaciones', path: '/notificaciones' },
  { id: 15, name: 'Roles y Permisos', path: '/roles-permisos' },
  { id: 17, name: 'Gestionar Cuentas', path: '/gestionar-cuentas' },
  { id: 16, name: 'Calificar materiales', path: '/calificar-productos' },
  { id: 18, name: 'Compras Directas', path: '/compras-directas' },
]

export const TAB_BY_MODULE_ID = {
  12: 'admin-dashboard',
  1: 'materials',
  2: 'request-material',
  3: 'request-purchase',
  4: 'request-service',
  5: 'manage-requests',
  6: 'my-purchase-orders',
  7: 'manage-delivery',
  13: 'services-history',
  8: 'movements',
  10: 'manage-providers',
  11: 'settings',
  14: 'notifications',
  15: 'roles-permissions',
  17: 'manage-accounts',
  16: 'rate-products',
  18: 'direct-purchases',
}

export const MODULE_ID_BY_PATH = {
  '/dashboard': 12,
  '/inventario': 1,
  '/requerimiento': 2,
  '/requerimientos': 2,
  '/compra': 3,
  '/solicitar-compra': 3,
  '/servicio': 4,
  '/gestionar': 5,
  '/gestionar-requerimientos': 5,
  '/gestionar-compras': 5,
  '/mis-compras': 6,
  '/compras': 6,
  '/entregas': 7,
  '/historial-servicios': 13,
  '/movimientos': 8,
  '/mis-servicios': 6,
  '/proveedores': 10,
  '/ajustes': 11,
  '/notificaciones': 14,
  '/roles-permisos': 15,
  '/gestionar-cuentas': 17,
  '/calificar-productos': 16,
  '/compras-directas': 18,
}

export const buildAllowedTabs = (rolId, sourcePermissions = []) => {
  return buildAllowedModules(rolId, sourcePermissions)
    .map((moduleId) => TAB_BY_MODULE_ID[moduleId])
    .filter(Boolean)
}

export const buildAllowedModules = (rolId, sourcePermissions = []) => {
  const numericRoleId = Number(rolId || 0)
  const explicitPermissions = Array.isArray(sourcePermissions) ? sourcePermissions : []
  const effectivePermissions = [...new Set(explicitPermissions)]
  const allowedModules = [...getModulesByRole(numericRoleId)]

  if (hasPermission(effectivePermissions, 'VER_DASHBOARD')) allowedModules.push(12)
  if (hasPermission(effectivePermissions, 'VER_INVENTARIO')) allowedModules.push(1)
  if (hasPermission(effectivePermissions, 'VER_MOVIMIENTOS')) allowedModules.push(8)
  if (hasPermission(effectivePermissions, 'CREAR_REQUERIMIENTO')) allowedModules.push(2)
  if (hasPermission(effectivePermissions, 'CREAR_SOLICITUD_COMPRA')) allowedModules.push(3)
  if (hasPermission(effectivePermissions, 'CREAR_SOLICITUD_SERVICIO')) allowedModules.push(4)
  if (hasPermission(effectivePermissions, 'GESTIONAR_SOLICITUDES')) {
    allowedModules.push(5)
  }
  if (hasPermission(effectivePermissions, 'GESTIONAR_COMPRAS')) {
    allowedModules.push(6)
  }
  if (hasPermission(effectivePermissions, 'GESTIONAR_ENTREGAS')) allowedModules.push(7)
  if (hasPermission(effectivePermissions, 'GESTIONAR_PROVEEDORES')) allowedModules.push(10)
  if (hasPermission(effectivePermissions, 'VER_AJUSTES')) allowedModules.push(11)
  if (hasPermission(effectivePermissions, 'VER_NOTIFICACIONES_PROVEEDOR')) allowedModules.push(14)
  if (hasPermission(effectivePermissions, 'VER_HISTORIAL_SERVICIOS')) allowedModules.push(13)
  if (hasPermission(effectivePermissions, 'GESTIONAR_ROLES')) allowedModules.push(15)
  if (hasPermission(effectivePermissions, 'GESTIONAR_CUENTAS')) allowedModules.push(17)
  if (
    hasPermission(effectivePermissions, 'CALIFICAR_COMPRA')
    || hasPermission(effectivePermissions, 'CALIFICAR_REQUERIMIENTO')
    || hasPermission(effectivePermissions, 'CALIFICAR_SERVICIO')
  ) {
    allowedModules.push(16)
  }
  if (hasPermission(effectivePermissions, 'CREAR_COMPRA_DIRECTA')
    || hasPermission(effectivePermissions, 'VER_HISTORIAL_COMPRAS_DIRECTAS')) allowedModules.push(18)

  return [...new Set(allowedModules)]
}
