const { getUserRoleIdExpr } = require('../db/pool');
const { fetchPermissionNamesByUserId } = require('../middleware/auth');
const { canAccessManageRequestsModule, filterUserPermissions } = require('../services/approval');
const { isValidPhotoValue } = require('../utils/validation');
const { hashPassword, comparePassword } = require('../utils/helpers');

module.exports = function(app, deps) {
  const { pool, authMiddleware } = deps;

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
        return res.status(400).json({ error: 'Contraseña actual es requerida' });
      }

      if (!password_nueva || !String(password_nueva).trim()) {
        return res.status(400).json({ error: 'Nueva contraseña es requerida' });
      }

      if (!password_confirmacion || !String(password_confirmacion).trim()) {
        return res.status(400).json({ error: 'Confirmación de contraseña es requerida' });
      }

      const cleanNew = String(password_nueva).trim();
      const cleanConfirm = String(password_confirmacion).trim();

      if (cleanNew !== cleanConfirm) {
        return res.status(400).json({ error: 'Las contraseñas no coinciden' });
      }

      if (cleanNew.length < 8) {
        return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
      }

      const userCheck = await pool.query('SELECT email, password_hash FROM usuarios WHERE id = $1', [userId]);
      if (userCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Usuario no encontrado' });
      }

      const userRow = userCheck.rows[0];

      const passwordMatch = await comparePassword(password_actual, userRow.password_hash);
      if (!passwordMatch) {
        return res.status(400).json({ error: 'La contraseña actual no es correcta' });
      }

      const userEmail = String(userRow.email || '').trim().toLowerCase();
      if (cleanNew.toLowerCase() === userEmail) {
        return res.status(400).json({ error: 'La contraseña no puede ser igual al correo' });
      }

      const hashedPassword = await hashPassword(cleanNew);

      await pool.query(
        'UPDATE usuarios SET password_hash = $1 WHERE id = $2',
        [hashedPassword, userId]
      );

      res.json({ success: true, message: 'Contraseña actualizada correctamente' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
};
