const { getUserRoleIdExpr, getUserEmailExpr, getUserRoleIdColumn, getUserEstadoExpr } = require('../db/pool');
const { hashPassword } = require('../utils/helpers');

module.exports = function(app, deps) {
  const { pool, authMiddleware, requirePermissions } = deps;

  app.get('/api/usuarios', authMiddleware, requirePermissions('GESTIONAR_CUENTAS'), async (req, res) => {
    try {
      const userRoleExpr = getUserRoleIdExpr('usuarios');
      const userEmailExpr = getUserEmailExpr('usuarios');
      const userEstadoExpr = getUserEstadoExpr('usuarios');
      const result = await pool.query(
        `
          SELECT
            usuarios.id,
            usuarios.nombre,
            ${userEmailExpr} AS email,
            COALESCE(NULLIF(trim(COALESCE(to_jsonb(usuarios)->>'dni', '')), ''), '') AS dni,
            ${userRoleExpr} AS id_role,
            usuarios.id_area,
            COALESCE(${userEstadoExpr}, 'ACTIVO') AS estado,
            roles.nombre AS rol,
            COALESCE(areas.nombre, '') AS area,
            usuarios.imagen
          FROM usuarios
          JOIN roles ON roles.id = ${userRoleExpr}
          LEFT JOIN areas ON areas.id = usuarios.id_area
          ORDER BY usuarios.id
        `
      );
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/usuarios', authMiddleware, requirePermissions('GESTIONAR_CUENTAS'), async (req, res) => {
    try {
      const { nombre, email, dni, id_role, id_area, estado, password, foto } = req.body;
      const userRoleColumn = getUserRoleIdColumn();

      if (!nombre || !String(nombre).trim()) {
        return res.status(400).json({ error: 'Nombre es requerido' });
      }

      if (!email || !String(email).trim()) {
        return res.status(400).json({ error: 'Correo es requerido' });
      }

      if (!dni || !String(dni).trim()) {
        return res.status(400).json({ error: 'DNI es requerido' });
      }

      const providedPassword = password && String(password).trim();
      const rawPassword = providedPassword || 'admin';

      if (providedPassword && providedPassword.length < 8) {
        return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
      }

      if (!id_role) {
        return res.status(400).json({ error: 'Rol es requerido' });
      }

      const roleCheck = await pool.query('SELECT id FROM roles WHERE id = $1', [id_role]);
      if (roleCheck.rows.length === 0) {
        return res.status(400).json({ error: 'Rol no existe' });
      }

      if (id_area) {
        const areaCheck = await pool.query('SELECT id FROM areas WHERE id = $1', [id_area]);
        if (areaCheck.rows.length === 0) {
          return res.status(400).json({ error: 'Area no existe' });
        }
      }

      const sanitizedEmail = String(email).trim().toLowerCase();
      const emailCheck = await pool.query('SELECT id FROM usuarios WHERE email = $1', [sanitizedEmail]);
      if (emailCheck.rows.length > 0) {
        return res.status(400).json({ error: 'Correo ya existe' });
      }

      const cleanPassword = String(rawPassword).trim();
      if (providedPassword && cleanPassword.toLowerCase() === sanitizedEmail) {
        return res.status(400).json({ error: 'La contraseña no puede ser igual al correo' });
      }

      const hashedPassword = await hashPassword(cleanPassword);
      const fotoBase64 = foto && String(foto).trim() ? String(foto).trim() : null;

      const result = await pool.query(
        `
          INSERT INTO usuarios (nombre, email, password_hash, dni, ${userRoleColumn}, id_area, estado, imagen)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING id, nombre, email, dni, ${userRoleColumn} AS id_role, id_area, estado, imagen
        `,
        [
          String(nombre).trim(),
          sanitizedEmail,
          hashedPassword,
          String(dni).trim(),
          Number(id_role),
          id_area ? Number(id_area) : null,
          estado || 'ACTIVO',
          fotoBase64
        ]
      );

      res.status(201).json(result.rows[0]);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put('/api/usuarios/:id', authMiddleware, requirePermissions('GESTIONAR_CUENTAS'), async (req, res) => {
    try {
      const { id } = req.params;
      const { nombre, email, dni, id_role, id_area, estado, foto } = req.body;
      const userRoleColumn = getUserRoleIdColumn();

      const userId = Number(id);
      if (!userId) {
        return res.status(400).json({ error: 'ID de usuario invalido' });
      }

      const userCheck = await pool.query('SELECT id FROM usuarios WHERE id = $1', [userId]);
      if (userCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Usuario no encontrado' });
      }

      if (nombre && !String(nombre).trim()) {
        return res.status(400).json({ error: 'Nombre no puede estar vacio' });
      }

      if (email && !String(email).trim()) {
        return res.status(400).json({ error: 'Email no puede estar vacio' });
      }

      if (email) {
        const emailCheck = await pool.query(
          'SELECT id FROM usuarios WHERE email = $1 AND id != $2',
          [String(email).trim().toLowerCase(), userId]
        );
        if (emailCheck.rows.length > 0) {
          return res.status(400).json({ error: 'Email ya existe' });
        }
      }

      if (dni !== undefined && !String(dni).trim()) {
        return res.status(400).json({ error: 'DNI no puede estar vacio' });
      }

      if (id_role) {
        const roleCheck = await pool.query('SELECT id FROM roles WHERE id = $1', [id_role]);
        if (roleCheck.rows.length === 0) {
          return res.status(400).json({ error: 'Rol no existe' });
        }
      }

      if (id_area) {
        const areaCheck = await pool.query('SELECT id FROM areas WHERE id = $1', [id_area]);
        if (areaCheck.rows.length === 0) {
          return res.status(400).json({ error: 'Area no existe' });
        }
      }

      const updates = [];
      const values = [];
      let paramCount = 1;

      if (nombre) {
        updates.push(`nombre = $${paramCount}`);
        values.push(String(nombre).trim());
        paramCount += 1;
      }

      if (email) {
        updates.push(`email = $${paramCount}`);
        values.push(String(email).trim().toLowerCase());
        paramCount += 1;
      }

      if (dni !== undefined) {
        updates.push(`dni = $${paramCount}`);
        values.push(String(dni).trim());
        paramCount += 1;
      }

      if (id_role) {
        updates.push(`${userRoleColumn} = $${paramCount}`);
        values.push(Number(id_role));
        paramCount += 1;
      }

      if (id_area !== undefined) {
        updates.push(`id_area = $${paramCount}`);
        values.push(id_area ? Number(id_area) : null);
        paramCount += 1;
      }

      if (estado) {
        updates.push(`estado = $${paramCount}`);
        values.push(String(estado).toUpperCase());
        paramCount += 1;
      }

      if (foto !== undefined) {
        const fotoBase64 = foto && String(foto).trim() ? String(foto).trim() : null;
        updates.push(`imagen = $${paramCount}`);
        values.push(fotoBase64);
        paramCount += 1;
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: 'No hay campos para actualizar' });
      }

      values.push(userId);

      const result = await pool.query(
        `
          UPDATE usuarios
          SET ${updates.join(', ')}
          WHERE id = $${paramCount}
          RETURNING id, nombre, email, dni, ${userRoleColumn} AS id_role, id_area, estado, imagen
        `,
        values
      );

      res.json(result.rows[0]);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put('/api/usuarios/:id/password', authMiddleware, requirePermissions('GESTIONAR_CUENTAS'), async (req, res) => {
    try {
      const { id } = req.params;
      const { password } = req.body;

      const userId = Number(id);
      if (!userId) {
        return res.status(400).json({ error: 'ID de usuario invalido' });
      }

      if (!password || !String(password).trim()) {
        return res.status(400).json({ error: 'Contraseña es requerida' });
      }

      if (String(password).trim().length < 8) {
        return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
      }

      const userCheck = await pool.query('SELECT id, email FROM usuarios WHERE id = $1', [userId]);
      if (userCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Usuario no encontrado' });
      }

      const userEmail = String(userCheck.rows[0].email || '').trim().toLowerCase();
      const cleanPassword = String(password).trim();
      if (cleanPassword.toLowerCase() === userEmail) {
        return res.status(400).json({ error: 'La contraseña no puede ser igual al correo' });
      }

      const hashedPassword = await hashPassword(cleanPassword);

      await pool.query(
        'UPDATE usuarios SET password_hash = $1 WHERE id = $2',
        [hashedPassword, userId]
      );

      res.json({ success: true, message: 'Contraseña actualizada correctamente' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/usuarios/:id', authMiddleware, requirePermissions('GESTIONAR_CUENTAS'), async (req, res) => {
    try {
      const { id } = req.params;

      const userId = Number(id);
      if (!userId) {
        return res.status(400).json({ error: 'ID de usuario invalido' });
      }

      if (userId === req.user.id) {
        return res.status(400).json({ error: 'No puedes eliminar tu propio usuario' });
      }

      const result = await pool.query('SELECT id FROM usuarios WHERE id = $1', [userId]);
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Usuario no encontrado' });
      }

      await pool.query('DELETE FROM usuarios WHERE id = $1', [userId]);

      res.json({ success: true, message: 'Usuario eliminado correctamente' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
};