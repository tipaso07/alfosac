export const getModulesByRole = (rolId) => {
  switch (rolId) {
    case 4:
      return [1, 2, 3, 4, 11]
    case 5:
    case 6:
    case 7:
      return [1, 2, 3, 4, 5, 11]
    case 8:
      return [12, 1, 2, 3, 4, 5, 6, 7, 13, 8, 10, 11]
    case 9:
      return [1, 2, 3, 4, 6, 13, 8, 10, 11]
    case 10:
      return [1, 2, 3, 4, 7, 11]
    default:
      return [11]
  }
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
}

export const buildAllowedTabs = (rolId) => {
  const allowedModules = getModulesByRole(rolId)
  return allowedModules
    .map((moduleId) => TAB_BY_MODULE_ID[moduleId])
    .filter(Boolean)
}
