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

export const ROLE_IDS = {
  GERENTES: 1,
  COMPRAS: 2,
  ALMACENERO: 3,
  SOLICITANTES: 4,
  SERVICIOS_GENERALES: 8,
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
  { id: 17, name: 'Gestionar Cuentas', path: '/gestionar-cuentas' },
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
  17: 'manage-accounts',
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
  '/gestionar-cuentas': 17,
  '/compras-directas': 18,
}

const MODULES_BY_ROLE = {
  [ROLE_IDS.GERENTES]: [
    12, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 13, 14, 17, 18,
  ],
  [ROLE_IDS.SOLICITANTES]: [
    1, 2, 3, 8, 11, 13,
  ],
  [ROLE_IDS.ALMACENERO]: [
    1, 7, 8, 11,
  ],
  [ROLE_IDS.COMPRAS]: [
    12, 1, 2, 3, 6, 8, 10, 11, 14, 17,
  ],
  [ROLE_IDS.SERVICIOS_GENERALES]: [
    1, 4, 8, 11,
  ],
}

export const getModulesByRole = (rolId) => {
  const numericRoleId = Number(rolId || 0)
  return [...(MODULES_BY_ROLE[numericRoleId] || [])]
}

export const buildAllowedTabs = (rolId, sourcePermissions = []) => {
  return buildAllowedModules(rolId, sourcePermissions)
    .map((moduleId) => TAB_BY_MODULE_ID[moduleId])
    .filter(Boolean)
}

export const buildAllowedModules = (rolId, sourcePermissions = []) => {
  const numericRoleId = Number(rolId || 0)
  const allowedModules = [...getModulesByRole(numericRoleId)]
  return [...new Set(allowedModules)]
}
