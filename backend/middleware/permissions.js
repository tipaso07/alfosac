const { normalizePermissionName } = require('../utils/normalize');
const { getPermissionsByRoleId } = require('../config/constants');

const requirePermissions = (...permissions) => (req, res, next) => {
  const roleId = Number(req.user?.id_role || req.user?.rol_id || 0);
  const userPermissions = new Set((req.user?.permisos || getPermissionsByRoleId(roleId))
    .map((perm) => normalizePermissionName(perm))
    .filter(Boolean));
  const normalizedPermissions = permissions
    .map((perm) => normalizePermissionName(perm))
    .filter(Boolean);

  if (!normalizedPermissions.some((permission) => userPermissions.has(permission))) {
    return res.status(403).json({ error: 'No autorizado' });
  }

  next();
};

module.exports = {
  requirePermissions,
};
