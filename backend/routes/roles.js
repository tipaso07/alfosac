const { ROLE_PERMISSION_NAMES_BY_ID } = require('../config/constants');
const { normalizeRoleName } = require('../utils/normalize');
const { getUserRoleIdExpr } = require('../db/pool');

const HIDDEN_MANAGED_PERMISSIONS = new Set(['GESTIONAR_SOLICITUDES']);

const canManageRoles = (user) => {
  const { tienePermiso } = require('../middleware/auth');
  return tienePermiso(user, 'GESTIONAR_ROLES');
};

module.exports = function(app, deps) {
  const { pool, authMiddleware, requirePermissions } = deps;

  app.get('/api/roles', authMiddleware, async (req, res) => {
    if (!canManageRoles(req.user)) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    try {
      const result = await pool.query('SELECT id, nombre FROM roles ORDER BY id');
      res.json(result.rows.filter((row) => !HIDDEN_MANAGED_PERMISSIONS.has(String(row.nombre || '').trim().toUpperCase())));
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/permisos', authMiddleware, async (req, res) => {
    if (!canManageRoles(req.user)) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    try {
      const allPerms = new Set();
      ROLE_PERMISSION_NAMES_BY_ID.forEach((perms) => perms.forEach((p) => allPerms.add(p)));
      const result = [...allPerms].sort().map((nombre, idx) => ({ id: idx + 1, nombre }));
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/roles/:id/permisos', authMiddleware, async (req, res) => {
    if (!canManageRoles(req.user)) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    try {
      const roleId = Number(req.params?.id || 0);
      if (!Number.isInteger(roleId) || roleId <= 0) {
        return res.status(400).json({ error: 'id_rol invalido' });
      }

      const roleResult = await pool.query('SELECT id, nombre FROM roles WHERE id = $1 LIMIT 1', [roleId]);
      if (roleResult.rows.length === 0) {
        return res.status(404).json({ error: 'Rol no encontrado' });
      }

      const permissionNames = ROLE_PERMISSION_NAMES_BY_ID.get(roleId) || [];
      const permisos = permissionNames.map((name, idx) => ({ id: idx + 1, nombre: name }));

      res.json({
        rol: roleResult.rows[0],
        permisos,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put('/api/roles/:id/permisos', authMiddleware, async (req, res) => {
    if (!canManageRoles(req.user)) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    try {
      const roleId = Number(req.params?.id || 0);
      if (!Number.isInteger(roleId) || roleId <= 0) {
        return res.status(400).json({ error: 'id_rol invalido' });
      }

      const roleResult = await pool.query('SELECT id, nombre FROM roles WHERE id = $1 LIMIT 1', [roleId]);
      if (roleResult.rows.length === 0) {
        return res.status(404).json({ error: 'Rol no encontrado' });
      }

      const permissionNames = ROLE_PERMISSION_NAMES_BY_ID.get(roleId) || [];
      const permisos = permissionNames.map((name, idx) => ({ id: idx + 1, nombre: name }));

      return res.json({
        rol: roleResult.rows[0],
        permisos,
        message: 'Los permisos ahora estan hardcodeados por rol y no se pueden modificar',
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/roles/:id', authMiddleware, async (req, res) => {
    if (!canManageRoles(req.user)) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    let client;

    try {
      client = await pool.connect();
      const roleId = Number(req.params?.id || 0);
      if (!Number.isInteger(roleId) || roleId <= 0) {
        return res.status(400).json({ error: 'id_rol invalido' });
      }

      await client.query('BEGIN');

      const roleResult = await client.query(
        'SELECT id, nombre FROM roles WHERE id = $1 LIMIT 1 FOR UPDATE',
        [roleId]
      );

      if (roleResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Rol no encontrado' });
      }

      const roleName = String(roleResult.rows[0]?.nombre || '').trim();
      if (!roleName) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'No se pudo resolver el nombre del rol' });
      }

      if (normalizeRoleName(roleName) === 'GERENTES') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'No se puede eliminar el rol GERENTES' });
      }

      const userRoleColumn = getUserRoleIdExpr('u');
      const usersResult = await client.query(
        `
          SELECT COUNT(*) AS total
          FROM usuarios u
          WHERE ${userRoleColumn} = $1
        `,
        [roleId]
      );

      const assignedUsers = Number(usersResult.rows[0]?.total || 0);
      if (assignedUsers > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: `No se puede eliminar el rol porque tiene ${assignedUsers} usuario${assignedUsers === 1 ? '' : 's'} asignado${assignedUsers === 1 ? '' : 's'}`,
        });
      }

      await client.query('DELETE FROM roles WHERE id = $1', [roleId]);
      await client.query('COMMIT');

      return res.json({
        ok: true,
        id: roleId,
        nombre: roleName,
      });
    } catch (error) {
      if (client) await client.query('ROLLBACK');

      if (error?.code === '23503') {
        return res.status(409).json({ error: 'No se puede eliminar el rol porque tiene dependencias registradas' });
      }

      return res.status(500).json({ error: error.message });
    } finally {
      if (client) client.release();
    }
  });

  app.post('/api/roles', authMiddleware, async (req, res) => {
    if (!canManageRoles(req.user)) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    try {
      const nombre = String(req.body?.nombre || '').trim();
      if (!nombre) {
        return res.status(400).json({ error: 'Nombre de rol es obligatorio' });
      }

      const exists = await pool.query(
        'SELECT id FROM roles WHERE upper(trim(nombre)) = upper(trim($1)) LIMIT 1',
        [nombre]
      );
      if (exists.rows.length > 0) {
        return res.status(409).json({ error: 'Ya existe un rol con ese nombre' });
      }

      const created = await pool.query(
        `
          INSERT INTO roles (nombre)
          VALUES ($1)
          RETURNING id, nombre
        `,
        [nombre]
      );

      return res.status(201).json(created.rows[0]);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });
};
