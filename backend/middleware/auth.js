const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool, getUserRoleIdExpr, getUserEmailExpr, getUserPasswordExpr, ROLE_NAME_BY_ID } = require('../db/pool');
const { JWT_SECRET, JWT_EXPIRES_IN, isGerentesRole, isComprasRole, hasAnyRole, getNormalizedRoles, APPROVAL_ROLES_BY_LEVEL, getPermissionsByRoleId } = require('../config/constants');
const { normalizePermissionName, normalizeRoleName } = require('../utils/normalize');
const { isValidPhotoValue } = require('../utils/validation');
const { hashPassword } = require('../utils/helpers');
const { requirePermissions } = require('./permissions');

const fetchPermissionNamesByUserId = async (db, userId) => {
  const id = Number(userId || 0);
  if (!id) return [];
  const result = await db.query(`SELECT id_role FROM usuarios WHERE id = $1`, [id]);
  const roleId = Number(result.rows[0]?.id_role || 0);
  return getPermissionsByRoleId(roleId);
};

const tienePermiso = (usuario, permiso) => {
  const normalizedPermission = normalizePermissionName(permiso);
  if (!normalizedPermission) return false;

  const roleId = Number(usuario?.id_role || usuario?.rol_id || 0);
  const directPermissions = Array.isArray(usuario?.permisos) ? usuario.permisos : [];
  const fallbackPermissions = typeof getPermissionsByRoleId === 'function'
    ? getPermissionsByRoleId(roleId)
    : [];
  const permissions = [...new Set([...directPermissions, ...fallbackPermissions])];

  return permissions.some((item) => normalizePermissionName(item) === normalizedPermission);
};

const isApprovalHierarchyRoleId = (roleId) => {
  const numericRoleId = Number(roleId || 0);
  return APPROVAL_ROLES_BY_LEVEL.includes(numericRoleId);
};

const resolveApprovalRoleId = (user) => {
  const numericRoleId = Number(user?.id_role || user?.rol_id || 0);
  if (isApprovalHierarchyRoleId(numericRoleId)) {
    return numericRoleId;
  }

  const normalizedRoles = getNormalizedRoles(user?.rol);
  for (const roleName of normalizedRoles) {
    for (const [roleIdFromCache, cachedRoleName] of ROLE_NAME_BY_ID.entries()) {
      if (normalizeRoleName(cachedRoleName) === roleName && isApprovalHierarchyRoleId(roleIdFromCache)) {
        return roleIdFromCache;
      }
    }
  }

  return 0;
};

const isApprovalRoleIdConfigured = async (roleId) => {
  const numericRoleId = Number(roleId || 0);
  if (!Number.isInteger(numericRoleId) || numericRoleId <= 0) {
    return false;
  }
  return APPROVAL_ROLES_BY_LEVEL.includes(numericRoleId);
};

const canAccessManageRequestsModule = async (user) => {
  const roleId = resolveApprovalRoleId(user);
  if (!Number.isInteger(roleId) || roleId <= 0) {
    return false;
  }

  return await isApprovalRoleIdConfigured(roleId);
};

const filterUserPermissions = async (permissions, user) => {
  const normalizedPermissions = [...new Set((permissions || [])
    .map((perm) => normalizePermissionName(perm))
    .filter(Boolean))];

  if (!await canAccessManageRequestsModule(user)) {
    const isSolicitante = Number(user?.id_role || user?.rol_id || 0) === 4;
    const isSsgg = Number(user?.id_role || user?.rol_id || 0) === 8;
    return normalizedPermissions.filter((perm) => {
      if (perm === 'GESTIONAR_SOLICITUDES' && (isSolicitante || isSsgg)) return true;
      return perm !== 'GESTIONAR_SOLICITUDES';
    });
  }

  return normalizedPermissions;
};

const hasPurchaseOrdersAccess = (user) => (
  tienePermiso(user, 'GESTIONAR_COMPRAS')
  || tienePermiso(user, 'GESTIONAR_ORDENES_COMPRA')
);

const canAccessPurchaseOrdersModule = (user) => (
  tienePermiso(user, 'GESTIONAR_COMPRAS')
  || hasPurchaseOrdersAccess(user)
  || isGerentesRole(user?.rol)
  || isComprasRole(user?.rol)
);

const createAuthToken = (user) => {
  const payload = {
    id: Number(user.id),
    sub: Number(user.id),
    rol_id: Number(user.id_role || user.rol_id || 0),
    rol: user.rol,
    nombre: user.nombre,
    correo: user.email,
    id_area: user.id_area,
    sub_area: user.sub_area || '',
  };

  console.log('[AUTH] payload del token:', payload);
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
};

const getBearerToken = (req) => {
  const authHeader = String(req.header('authorization') || '').trim();
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? String(match[1] || '').trim() : '';
};

const authMiddleware = async (req, res, next) => {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return res.status(401).json({ error: 'Falta token Bearer en Authorization' });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (_error) {
      return res.status(401).json({ error: 'Token invalido o expirado' });
    }

    const userId = Number(decoded?.id || decoded?.sub || 0);
    if (!userId) {
      return res.status(401).json({ error: 'Token sin usuario valido' });
    }

    const userRoleExpr = getUserRoleIdExpr('usuarios');
    const userEmailExpr = getUserEmailExpr('usuarios');
    const result = await pool.query(
      `
        SELECT
          usuarios.id,
          usuarios.nombre,
          ${userEmailExpr} AS email,
          ${userEmailExpr} AS correo,
          usuarios.id_area,
          COALESCE(usuarios.sub_area, '') AS sub_area,
          ${userRoleExpr} AS id_role,
          COALESCE(areas.nombre, '') AS area,
          COALESCE(roles.nombre, '') AS rol
        FROM usuarios
        LEFT JOIN areas ON areas.id = usuarios.id_area
        LEFT JOIN roles ON roles.id = ${userRoleExpr}
        WHERE usuarios.id = $1
        LIMIT 1
      `,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Usuario no encontrado' });
    }

    req.user = result.rows[0];
    const dbPermissions = await fetchPermissionNamesByUserId(pool, req.user.id);
    req.user.permisos = await filterUserPermissions(dbPermissions, req.user);
    req.auth = decoded;
    console.log('[AUTH] req.user en middleware:', req.user);
    next();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const requireRoles = (...roles) => (req, res, next) => {
  if (!hasAnyRole(req.user?.rol || '', roles)) {
    return res.status(403).json({ error: 'No autorizado' });
  }
  next();
};

const requireRoleIds = (...roleIds) => (req, res, next) => {
  const roleId = Number(req.user?.id_role || req.user?.rol_id || 0);
  if (!roleIds.includes(roleId)) {
    return res.status(403).json({ error: 'No autorizado' });
  }
  next();
};
const requireAdmin = requireRoles('GERENTES');

const requireCompras = requireRoles('GERENTES', 'COMPRAS');

const requireRoleAdminOrCompras = (req, res, next) => {
  const roleId = Number(req.user?.id_role || req.user?.rol_id || 0);
  if (isGerentesRole(req.user?.rol) || isComprasRole(req.user?.rol) || hasPurchaseOrdersAccess(req.user)) {
    return next();
  }

  return res.status(403).json({ error: 'No autorizado' });
};

const loginHandler = async (req, res) => {
  try {
    const { correo, contrasena } = req.body;
    if (!correo || !contrasena) {
      return res.status(400).json({ error: 'Correo y contrasena son obligatorios' });
    }

    const userRoleExpr = getUserRoleIdExpr('usuarios');
    const userEmailExpr = getUserEmailExpr('usuarios');
    const userPasswordExpr = getUserPasswordExpr('usuarios');
    const result = await pool.query(
      `
        SELECT
          usuarios.id,
          usuarios.nombre,
          ${userEmailExpr} AS email,
          usuarios.id_area,
          COALESCE(usuarios.sub_area, '') AS sub_area,
          ${userRoleExpr} AS id_role,
          COALESCE(${userPasswordExpr}, '') AS password_hash,
          roles.nombre AS rol
        FROM usuarios
        JOIN roles ON roles.id = ${userRoleExpr}
        WHERE lower(trim(COALESCE(${userEmailExpr}, ''))) = lower(trim($1))
        LIMIT 1
      `,
      [correo]
    );

    if (result.rows.length === 0) {
      console.log('[AUTH][LOGIN] usuario no encontrado para correo:', String(correo || '').trim().toLowerCase());
      return res.status(401).json({ error: 'Credenciales invalidas' });
    }

    const user = result.rows[0];
    console.log('[AUTH][LOGIN] usuario encontrado:', {
      id: user.id,
      email: user.email,
      rol: user.rol,
    });
    const providedPassword = String(contrasena || '').trim();
    const storedPassword = String(user.password_hash || '').trim();
    
    let validPassword = false;
    const isBcryptHash = /^\$2[aby]\$\d{2}\$/.test(storedPassword);
    
    if (isBcryptHash) {
      validPassword = await bcrypt.compare(providedPassword, storedPassword);
    } else {
      validPassword = storedPassword === providedPassword;
    }

    if (!validPassword) {
      return res.status(401).json({ error: 'Credenciales invalidas' });
    }

    const requiresPasswordChange = providedPassword.toLowerCase() === user.email.toLowerCase();

    const token = createAuthToken(user);

    res.json({
      token,
      token_type: 'Bearer',
      expires_in: JWT_EXPIRES_IN,
      requires_password_change: requiresPasswordChange,
      user: {
        id: user.id,
        nombre: user.nombre,
        correo: user.email,
        id_area: user.id_area,
        sub_area: user.sub_area,
        rol_id: user.id_role,
        id_role: user.id_role,
        rol: user.rol,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const registerAuthRoutes = (app) => {
  app.post('/api/login', loginHandler);
  app.post('/api/auth/login', loginHandler);

  app.post('/api/logout', authMiddleware, async (req, res) => {
    try {
      console.log('[AUTH][LOGOUT] usuario:', req.user.id);
      res.json({ success: true, message: 'Logout successful' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/me', authMiddleware, async (req, res) => {
    try {
      const profileResult = await pool.query(
        `
          SELECT
            u.id,
            u.nombre,
            COALESCE(NULLIF(trim(COALESCE(to_jsonb(u)->>'email', to_jsonb(u)->>'correo', '')), ''), '') AS correo,
            u.id_area,
            COALESCE(a.nombre, '') AS area,
            COALESCE(NULLIF(trim(COALESCE(to_jsonb(u)->>'sub_area', '')), ''), '') AS sub_area,
            ${getUserRoleIdExpr('u')} AS rol_id,
            ${getUserRoleIdExpr('u')} AS id_role,
            COALESCE(r.nombre, '') AS rol,
            COALESCE(NULLIF(trim(COALESCE(to_jsonb(u)->>'dni', '')), ''), '') AS dni,
            COALESCE(NULLIF(trim(COALESCE(to_jsonb(u)->>'foto', '')), ''), '') AS foto,
            COALESCE(NULLIF(trim(COALESCE(to_jsonb(u)->>'imagen', '')), ''), '') AS imagen
          FROM usuarios u
          LEFT JOIN areas a ON a.id = u.id_area
          LEFT JOIN roles r ON r.id = ${getUserRoleIdExpr('u')}
          WHERE u.id = $1
          LIMIT 1
        `,
        [req.user.id]
      );

      const profile = profileResult.rows[0];
      if (!profile) {
        return res.status(404).json({ error: 'Usuario no encontrado' });
      }

      let dbPermissions = await fetchPermissionNamesByUserId(pool, profile.id);
      const canAccessManageRequests = await canAccessManageRequestsModule(req.user, dbPermissions);
      dbPermissions = await filterUserPermissions(dbPermissions, req.user);

      if (canAccessManageRequests && !dbPermissions.includes('GESTIONAR_SOLICITUDES')) {
        dbPermissions.push('GESTIONAR_SOLICITUDES');
      }

      res.json({
        id: profile.id,
        nombre: profile.nombre,
        correo: profile.correo || req.user.correo || '',
        email: profile.correo || req.user.correo || '',
        id_area: profile.id_area,
        area: profile.area || req.user.area || '',
        sub_area: profile.sub_area || '',
        rol_id: profile.rol_id,
        id_role: profile.id_role,
        rol: profile.rol || req.user.rol || '',
        dni: profile.dni,
        imagen: profile.imagen,
        permisos: dbPermissions,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch('/api/me/foto', authMiddleware, async (req, res) => {
    try {
      const imagen = String(req.body?.imagen || req.body?.foto || '').trim();
      if (!imagen) {
        return res.status(400).json({ error: 'La foto (imagen) es obligatoria' });
      }

      if (!isValidPhotoValue(imagen)) {
        return res.status(400).json({ error: 'La foto debe ser URL valida (http/https) o base64 valida' });
      }

      const updated = await pool.query(
        `
          UPDATE usuarios
          SET imagen = $1
          WHERE id = $2
          RETURNING
            id,
            nombre,
            COALESCE(NULLIF(trim(COALESCE(to_jsonb(usuarios)->>'email', to_jsonb(usuarios)->>'correo', '')), ''), '') AS correo,
            COALESCE(NULLIF(trim(COALESCE(to_jsonb(usuarios)->>'dni', '')), ''), '') AS dni,
            COALESCE(NULLIF(trim(COALESCE(to_jsonb(usuarios)->>'foto', '')), ''), '') AS foto,
            COALESCE(NULLIF(trim(COALESCE(to_jsonb(usuarios)->>'imagen', '')), ''), '') AS imagen
        `,
        [imagen, req.user.id]
      );

      if (updated.rows.length === 0) {
        return res.status(404).json({ error: 'Usuario no encontrado' });
      }

      return res.json({
        success: true,
        message: 'Foto actualizada correctamente',
        user: updated.rows[0],
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.put('/api/me/cambiar-contrasena', authMiddleware, async (req, res) => {
    try {
      const { password_actual, password_nueva, password_confirmacion } = req.body;
      const userId = req.user.id;

      if (!password_actual || !String(password_actual).trim()) {
        return res.status(400).json({ error: 'Contrasena actual es requerida' });
      }

      if (!password_nueva || !String(password_nueva).trim()) {
        return res.status(400).json({ error: 'Nueva contrasena es requerida' });
      }

      if (!password_confirmacion || !String(password_confirmacion).trim()) {
        return res.status(400).json({ error: 'Confirmacion de contrasena es requerida' });
      }

      const cleanNew = String(password_nueva).trim();
      const cleanConfirm = String(password_confirmacion).trim();

      if (cleanNew !== cleanConfirm) {
        return res.status(400).json({ error: 'Las contrasenas no coinciden' });
      }

      if (cleanNew.length < 8) {
        return res.status(400).json({ error: 'La contrasena debe tener al menos 8 caracteres' });
      }

      const userCheck = await pool.query('SELECT email, password_hash FROM usuarios WHERE id = $1', [userId]);
      if (userCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Usuario no encontrado' });
      }

      const userRow = userCheck.rows[0];

      const storedPassword = String(userRow.password_hash || '').trim();
      const validPassword = await bcrypt.compare(String(password_actual).trim(), storedPassword);
      if (!validPassword) {
        return res.status(400).json({ error: 'La contrasena actual no es correcta' });
      }

      const userEmail = String(userRow.email || '').trim().toLowerCase();
      if (cleanNew.toLowerCase() === userEmail) {
        return res.status(400).json({ error: 'La contrasena no puede ser igual al correo' });
      }

      const hashedPassword = await hashPassword(cleanNew);

      await pool.query(
        'UPDATE usuarios SET password_hash = $1 WHERE id = $2',
        [hashedPassword, userId]
      );

      res.json({ success: true, message: 'Contrasena actualizada correctamente' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
};

module.exports = {
  createAuthToken,
  getBearerToken,
  authMiddleware,
  requireRoles,
  requireRoleIds,
  requireAdmin,
  requireCompras,
  hasPurchaseOrdersAccess,
  requireRoleAdminOrCompras,
  loginHandler,
  registerAuthRoutes,
  fetchPermissionNamesByUserId,
  filterUserPermissions,
  canAccessManageRequestsModule,
  canAccessPurchaseOrdersModule,
  tienePermiso,
  resolveApprovalRoleId,
  isApprovalHierarchyRoleId,
};
