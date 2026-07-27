const { buildProveedorSelectExpressions, getProveedorColumn } = require('../db/pool');
const { fetchProveedorRatingsSummary, fetchProveedorAverageRatingsForAutomation, normalizeRatingType } = require('../services/proveedores');

module.exports = function(app, deps) {
  const { pool, authMiddleware, requirePermissions } = deps;

  app.get('/api/proveedores', authMiddleware, requirePermissions('GESTIONAR_PROVEEDORES'), async (req, res) => {
    try {
      const userId = Number(req.user?.id || 0);
      const term = String(req.query.query || '').trim();
      const limit = term ? 20 : 100;
      const likeTerm = `%${term}%`;

      const selectExprs = buildProveedorSelectExpressions();
      const razonSocialCol = getProveedorColumn('razon_social');
      const nombreCol = getProveedorColumn('nombre');
      const rucCol = getProveedorColumn('ruc');

      const whereParts = [];
      const params = [];

      if (term) {
        params.push(likeTerm);
        const pos = params.length;

        if (razonSocialCol && rucCol && nombreCol) {
          whereParts.push(`(p.${razonSocialCol} ILIKE $${pos} OR p.${nombreCol} ILIKE $${pos} OR p.${rucCol}::text ILIKE $${pos})`);
        } else if (razonSocialCol && rucCol) {
          whereParts.push(`(p.${razonSocialCol} ILIKE $${pos} OR p.${rucCol}::text ILIKE $${pos})`);
        } else if (nombreCol && rucCol) {
          whereParts.push(`(p.${nombreCol} ILIKE $${pos} OR p.${rucCol}::text ILIKE $${pos})`);
        } else if (razonSocialCol) {
          whereParts.push(`p.${razonSocialCol} ILIKE $${pos}`);
        } else if (nombreCol) {
          whereParts.push(`p.${nombreCol} ILIKE $${pos}`);
        } else if (rucCol) {
          whereParts.push(`p.${rucCol}::text ILIKE $${pos}`);
        }
      }

      const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';
      const orderBy = razonSocialCol
        ? `ORDER BY p.${razonSocialCol} ASC`
        : (nombreCol ? `ORDER BY p.${nombreCol} ASC` : 'ORDER BY p.id ASC');

      const result = await pool.query(
        `
          SELECT ${selectExprs.join(', ')}, COALESCE(mo.nombre, '') AS moneda_nombre
          FROM proveedores p
          LEFT JOIN monedas mo ON mo.id = p.id_moneda
          ${whereClause}
          ${orderBy}
          LIMIT ${limit}
        `,
        params
      );

      const ratingsMap = await fetchProveedorRatingsSummary(pool, {
        proveedorIds: result.rows.map((row) => Number(row.id || 0)),
        userId,
      });

      const rows = result.rows.map((row) => ({
        ...row,
        ...(ratingsMap.get(Number(row.id || 0)) || {
          calificacion_promedio: 0,
          calificacion_total: 0,
          alerta_cambio_proveedor: false,
          alerta_critica: false,
          mi_calificacion: null,
          mi_comentario: '',
          mi_fecha: null,
        }),
      }));

      res.json(rows);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/proveedores/calificaciones/promedios', authMiddleware, async (_req, res) => {
    try {
      const rows = await fetchProveedorAverageRatingsForAutomation(pool);
      return res.json(rows);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/proveedores/:id/calificaciones', authMiddleware, async (req, res) => {
    try {
      const proveedorId = Number(req.params?.id || 0);
      const rawTipo = String(req.query?.tipo || '').trim();
      const hasTipoFilter = rawTipo.length > 0;
      const tipo = hasTipoFilter ? normalizeRatingType(rawTipo) : null;
      const queryReference = Number(req.query?.id_referencia || 0);
      const referenceId = hasTipoFilter ? (queryReference > 0 ? queryReference : 0) : null;

      if (!proveedorId) {
        return res.status(400).json({ error: 'ID de proveedor invalido' });
      }

      const whereParts = ['cp.id_proveedor = $1'];
      const params = [proveedorId];

      if (tipo) {
        params.push(tipo);
        whereParts.push(`lower(trim(cp.tipo)) = $${params.length}`);
      }

      if (referenceId) {
        params.push(referenceId);
        whereParts.push(`cp.id_referencia = $${params.length}`);
      }

      const result = await pool.query(
        `
          SELECT
            cp.id,
            cp.id_proveedor,
            cp.tipo,
            cp.id_referencia,
            cp.puntuacion,
            COALESCE(cp.comentario, '') AS comentario,
            cp.fecha,
            COALESCE(u.nombre, '') AS usuario_nombre
          FROM calificaciones_proveedor cp
          LEFT JOIN usuarios u ON u.id = cp.id_usuario
          WHERE ${whereParts.join(' AND ')}
          ORDER BY cp.fecha DESC, cp.id DESC
        `,
        params
      );

      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/proveedores', authMiddleware, requirePermissions('GESTIONAR_PROVEEDORES'), async (req, res) => {
    const client = await pool.connect();
    try {
      const {
        razon_social,
        nombre,
        ruc,
        direccion,
        telefono,
        email,
        contacto,
        id_moneda,
        estado,
      } = req.body;

      const razonSocialNorm = String(razon_social || nombre || '').trim();
      const rucNorm = String(ruc || '').trim();

      if (!razonSocialNorm) {
        return res.status(400).json({ error: 'Razon social es requerida' });
      }

      if (!rucNorm) {
        return res.status(400).json({ error: 'RUC es requerido' });
      }

      const razonSocialCol = getProveedorColumn('razon_social');
      const nombreCol = getProveedorColumn('nombre');
      const rucCol = getProveedorColumn('ruc');

      await client.query('BEGIN');

      const insertColumns = [];
      const insertValues = [];
      let paramCount = 1;

      if (razonSocialCol) {
        insertColumns.push(razonSocialCol);
        insertValues.push(razonSocialNorm);
        paramCount += 1;
      }

      if (nombreCol) {
        insertColumns.push(nombreCol);
        insertValues.push(String(nombre || razon_social || '').trim() || razonSocialNorm);
        paramCount += 1;
      }

      if (rucCol) {
        insertColumns.push(rucCol);
        insertValues.push(rucNorm);
        paramCount += 1;
      }

      if (direccion) {
        insertColumns.push('direccion');
        insertValues.push(String(direccion).trim());
        paramCount += 1;
      }

      if (telefono) {
        insertColumns.push('telefono');
        insertValues.push(String(telefono).trim());
        paramCount += 1;
      }

      if (email) {
        insertColumns.push('email');
        insertValues.push(String(email).trim().toLowerCase());
        paramCount += 1;
      }

      if (contacto) {
        insertColumns.push('contacto');
        insertValues.push(String(contacto).trim());
        paramCount += 1;
      }

      if (id_moneda) {
        insertColumns.push('id_moneda');
        insertValues.push(Number(id_moneda));
        paramCount += 1;
      }

      if (estado) {
        insertColumns.push('estado');
        insertValues.push(String(estado).trim().toUpperCase());
        paramCount += 1;
      }

      const placeholders = insertValues.map((_, idx) => `$${idx + 1}`);

      const result = await client.query(
        `
          INSERT INTO proveedores (${insertColumns.map(col => `"${col}"`).join(', ')})
          VALUES (${placeholders.join(', ')})
          RETURNING id
        `,
        insertValues
      );

      await client.query('COMMIT');

      const created = await pool.query('SELECT * FROM proveedores WHERE id = $1', [result.rows[0].id]);
      res.status(201).json(created.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: error.message });
    } finally {
      client.release();
    }
  });

  app.put('/api/proveedores/:id', authMiddleware, requirePermissions('GESTIONAR_PROVEEDORES'), async (req, res) => {
    const client = await pool.connect();
    try {
      const id = Number(req.params.id || 0);
      if (!id) {
        return res.status(400).json({ error: 'ID invalido' });
      }

      const proveedorCheck = await client.query('SELECT id FROM proveedores WHERE id = $1', [id]);
      if (proveedorCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Proveedor no encontrado' });
      }

      const {
        razon_social,
        nombre,
        ruc,
        direccion,
        telefono,
        email,
        contacto,
        id_moneda,
        estado,
      } = req.body;

      const updates = [];
      const values = [];
      let paramCount = 1;

      if (razon_social !== undefined) {
        const col = getProveedorColumn('razon_social');
        if (col) {
          updates.push(`"${col}" = $${paramCount}`);
          values.push(String(razon_social).trim());
          paramCount += 1;
        }
      }

      if (nombre !== undefined) {
        const col = getProveedorColumn('nombre');
        if (col) {
          updates.push(`"${col}" = $${paramCount}`);
          values.push(String(nombre).trim());
          paramCount += 1;
        }
      }

      if (ruc !== undefined) {
        const col = getProveedorColumn('ruc');
        if (col) {
          updates.push(`"${col}" = $${paramCount}`);
          values.push(String(ruc).trim());
          paramCount += 1;
        }
      }

      if (direccion !== undefined) {
        updates.push(`direccion = $${paramCount}`);
        values.push(String(direccion).trim());
        paramCount += 1;
      }

      if (telefono !== undefined) {
        updates.push(`telefono = $${paramCount}`);
        values.push(String(telefono).trim());
        paramCount += 1;
      }

      if (email !== undefined) {
        updates.push(`email = $${paramCount}`);
        values.push(String(email).trim().toLowerCase());
        paramCount += 1;
      }

      if (contacto !== undefined) {
        updates.push(`contacto = $${paramCount}`);
        values.push(String(contacto).trim());
        paramCount += 1;
      }

      if (id_moneda !== undefined) {
        updates.push(`id_moneda = $${paramCount}`);
        values.push(Number(id_moneda));
        paramCount += 1;
      }

      if (estado !== undefined) {
        updates.push(`estado = $${paramCount}`);
        values.push(String(estado).trim().toUpperCase());
        paramCount += 1;
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: 'No hay campos para actualizar' });
      }

      values.push(id);

      await client.query('BEGIN');

      await client.query(
        `UPDATE proveedores SET ${updates.join(', ')} WHERE id = $${paramCount}`,
        values
      );

      await client.query('COMMIT');

      const updated = await pool.query('SELECT * FROM proveedores WHERE id = $1', [id]);
      res.json(updated.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: error.message });
    } finally {
      client.release();
    }
  });
};