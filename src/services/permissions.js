// Permission helpers for frontend authorization checks

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

export const hasAnyPermission = (sourcePermissions, permissions = []) => {
  return permissions.some((permission) => hasPermission(sourcePermissions, permission))
}

export const tienePermiso = (user, permission) => {
  if (!user || !user.permisos) return false
  return hasPermission(user.permisos, permission)
}

export const tieneCualquierPermiso = (user, permissions = []) => {
  if (!user || !user.permisos) return false
  return hasAnyPermission(user.permisos, permissions)
}
