const { buildProveedorSelectExpressions, getProveedorColumn } = require('../db/pool');
const { fetchProveedorRatingsSummary, fetchProveedorAverageRatingsForAutomation, normalizeRatingType, upsertProveedorRating } = require('../services/proveedores');

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
    let client;
    try {
      client = await pool.connect();
      const {
        razon_social, nombre, ruc, direccion, distrito, correo,
        persona_responsable, telefono, condiciones_pago, banco,
        id_moneda, numero_cuenta, cci, id_area_destino, descripcion,
        retencion, categoria, descuento, tipo, tipo_retencion,
        contacto, estado,
      } = req.body;

      const razonSocialNorm = String(razon_social || nombre || '').trim();
      const rucNorm = String(ruc || '').trim();

      if (!razonSocialNorm) {
        return res.status(400).json({ error: 'Razon social es requerida' });
      }

      if (!rucNorm) {
        return res.status(400).json({ error: 'RUC es requerido' });
      }

      await client.query('BEGIN');

      const insertColumns = [];
      const insertValues = [];

      const addCol = (key, value) => {
        if (value === undefined || value === '') return;
        const col = getProveedorColumn(key);
        if (!col) return;
        insertColumns.push(col);
        insertValues.push(String(value).trim());
      };

      const addColLower = (key, value) => {
        if (value === undefined || value === '') return;
        const col = getProveedorColumn(key);
        if (!col) return;
        insertColumns.push(col);
        insertValues.push(String(value).trim().toLowerCase());
      };

      const addColUpper = (key, value) => {
        if (value === undefined || value === '') return;
        const col = getProveedorColumn(key);
        if (!col) return;
        insertColumns.push(col);
        insertValues.push(String(value).trim().toUpperCase());
      };

      const addColNum = (key, value) => {
        if (value === undefined || value === '' || value === null) return;
        const col = getProveedorColumn(key);
        if (!col) return;
        insertColumns.push(col);
        insertValues.push(Number(value));
      };

      const addColNumNull = (key, value) => {
        if (value === undefined) return;
        const col = getProveedorColumn(key);
        if (!col) return;
        insertColumns.push(col);
        insertValues.push(value === '' || value === null ? null : Number(value));
      };

      const razonSocialCol = getProveedorColumn('razon_social');
      if (razonSocialCol) { insertColumns.push(razonSocialCol); insertValues.push(razonSocialNorm); }

      const nombreCol = getProveedorColumn('nombre');
      if (nombreCol) { insertColumns.push(nombreCol); insertValues.push(String(nombre || razon_social || '').trim() || razonSocialNorm); }

      const rucCol = getProveedorColumn('ruc');
      if (rucCol) { insertColumns.push(rucCol); insertValues.push(rucNorm); }

      addCol('direccion', direccion);
      addCol('distrito', distrito);
      addColLower('correo', correo);
      addCol('persona_responsable', persona_responsable);
      addCol('telefono', telefono);
      addCol('condiciones_pago', condiciones_pago);
      addCol('banco', banco);
      addColNum('id_moneda', id_moneda);
      addCol('numero_cuenta', numero_cuenta);
      addCol('cci', cci);
      addColNumNull('id_area_destino', id_area_destino);
      addCol('descripcion', descripcion);
      addColUpper('retencion', retencion);
      addCol('categoria', categoria);
      addColNum('descuento', descuento);
      addColUpper('tipo', tipo);
      addColUpper('tipo_retencion', tipo_retencion);
      addCol('contacto', contacto);
      addColUpper('estado', estado);

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
      if (client) await client.query('ROLLBACK');
      res.status(500).json({ error: error.message });
    } finally {
      if (client) client.release();
    }
  });

  app.post('/api/proveedores/bulk-import', authMiddleware, requirePermissions('GESTIONAR_PROVEEDORES'), async (req, res) => {
    let client;
    try {
      const providers = Array.isArray(req.body?.providers) ? req.body.providers : [];
      const skipInvalidRows = req.body?.skipInvalidRows === true;

      if (providers.length === 0) {
        return res.status(400).json({ error: 'No se proporcionaron proveedores' });
      }

      const errors = [];
      const validProviders = [];

      for (let i = 0; i < providers.length; i++) {
        const row = providers[i];
        const rowIndex = i + 1;
        const razonSocial = String(row.razon_social || row.nombre || '').trim();
        const ruc = String(row.ruc || '').trim();

        if (!razonSocial && !ruc) {
          errors.push({ rowIndex, nombre: '', ruc: '', error: 'Fila vacia o sin datos' });
          continue;
        }

        if (!razonSocial) {
          errors.push({ rowIndex, nombre: row.nombre || '', ruc, error: 'Razon social o nombre es requerido' });
          continue;
        }

        if (!ruc) {
          errors.push({ rowIndex, nombre: razonSocial, ruc: '', error: 'RUC es requerido' });
          continue;
        }

        const rucInBatch = validProviders.find(p => p.ruc === ruc);
        if (rucInBatch) {
          errors.push({ rowIndex, nombre: razonSocial, ruc, error: `RUC duplicado en fila ${rucInBatch.rowIndex}` });
          continue;
        }

        const existing = await pool.query('SELECT id FROM proveedores WHERE ruc = $1', [ruc]);
        if (existing.rows.length > 0) {
          errors.push({ rowIndex, nombre: razonSocial, ruc, error: `El RUC ya existe (ID: ${existing.rows[0].id})` });
          continue;
        }

        validProviders.push({ rowIndex, data: row, razonSocial, ruc });
      }

      if (!skipInvalidRows && errors.length > 0) {
        return res.status(200).json({ created: [], errors });
      }

      if (validProviders.length === 0) {
        return res.status(200).json({ created: [], errors });
      }

      client = await pool.connect();
      await client.query('BEGIN');

      const addCol = (columns, values, key, value) => {
        if (value === undefined || value === '') return;
        const col = getProveedorColumn(key);
        if (!col) return;
        columns.push(col);
        values.push(String(value).trim());
      };

      const addColLower = (columns, values, key, value) => {
        if (value === undefined || value === '') return;
        const col = getProveedorColumn(key);
        if (!col) return;
        columns.push(col);
        values.push(String(value).trim().toLowerCase());
      };

      const addColUpper = (columns, values, key, value) => {
        if (value === undefined || value === '') return;
        const col = getProveedorColumn(key);
        if (!col) return;
        columns.push(col);
        values.push(String(value).trim().toUpperCase());
      };

      const addColNum = (columns, values, key, value) => {
        if (value === undefined || value === '' || value === null) return;
        const col = getProveedorColumn(key);
        if (!col) return;
        columns.push(col);
        values.push(Number(value));
      };

      const addColNumNull = (columns, values, key, value) => {
        if (value === undefined) return;
        const col = getProveedorColumn(key);
        if (!col) return;
        columns.push(col);
        values.push(value === '' || value === null ? null : Number(value));
      };

      const created = [];

      for (const vp of validProviders) {
        const row = vp.data;
        const insertColumns = [];
        const insertValues = [];

        const rsc = getProveedorColumn('razon_social');
        if (rsc) { insertColumns.push(rsc); insertValues.push(vp.razonSocial); }

        const nc = getProveedorColumn('nombre');
        if (nc) { insertColumns.push(nc); insertValues.push(String(row.nombre || vp.razonSocial).trim()); }

        const rucCol = getProveedorColumn('ruc');
        if (rucCol) { insertColumns.push(rucCol); insertValues.push(vp.ruc); }

        addCol(insertColumns, insertValues, 'direccion', row.direccion);
        addCol(insertColumns, insertValues, 'distrito', row.distrito);
        addColLower(insertColumns, insertValues, 'correo', row.correo || row.email);
        addCol(insertColumns, insertValues, 'persona_responsable', row.persona_responsable);
        addCol(insertColumns, insertValues, 'telefono', row.telefono);
        addCol(insertColumns, insertValues, 'condiciones_pago', row.condiciones_pago);
        addCol(insertColumns, insertValues, 'banco', row.banco);
        addColNum(insertColumns, insertValues, 'id_moneda', row.id_moneda);
        addCol(insertColumns, insertValues, 'numero_cuenta', row.numero_cuenta);
        addCol(insertColumns, insertValues, 'cci', row.cci);
        addColNumNull(insertColumns, insertValues, 'id_area_destino', row.id_area_destino);
        addCol(insertColumns, insertValues, 'descripcion', row.descripcion);
        addColUpper(insertColumns, insertValues, 'retencion', row.retencion);
        addCol(insertColumns, insertValues, 'categoria', row.categoria);
        addColNum(insertColumns, insertValues, 'descuento', row.descuento);
        addColUpper(insertColumns, insertValues, 'tipo', row.tipo);
        addColUpper(insertColumns, insertValues, 'tipo_retencion', row.tipo_retencion);
        addCol(insertColumns, insertValues, 'contacto', row.contacto);
        addColUpper(insertColumns, insertValues, 'estado', row.estado || 't');

        const placeholders = insertValues.map((_, idx) => `$${idx + 1}`);

        const result = await client.query(
          `INSERT INTO proveedores (${insertColumns.map(col => `"${col}"`).join(', ')})
           VALUES (${placeholders.join(', ')})
           RETURNING id`,
          insertValues
        );

        created.push({ id: result.rows[0].id, nombre: vp.razonSocial, ruc: vp.ruc });
      }

      await client.query('COMMIT');
      res.status(200).json({ created, errors });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      if (!res.headersSent) {
        res.status(500).json({ error: error.message });
      }
    } finally {
      if (client) client.release();
    }
  });

  app.put('/api/proveedores/:id', authMiddleware, requirePermissions('GESTIONAR_PROVEEDORES'), async (req, res) => {
    let client;
    try {
      client = await pool.connect();
      const id = Number(req.params.id || 0);
      if (!id) {
        return res.status(400).json({ error: 'ID invalido' });
      }

      const proveedorCheck = await client.query('SELECT id FROM proveedores WHERE id = $1', [id]);
      if (proveedorCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Proveedor no encontrado' });
      }

      const {
        razon_social, nombre, ruc, direccion, distrito, correo,
        persona_responsable, telefono, condiciones_pago, banco,
        id_moneda, numero_cuenta, cci, id_area_destino, descripcion,
        retencion, categoria, descuento, tipo, tipo_retencion,
        contacto, estado,
      } = req.body;

      const updates = [];
      const values = [];
      let paramCount = 1;

      const addStr = (key, value) => {
        if (value === undefined) return;
        const col = getProveedorColumn(key);
        if (!col) return;
        updates.push(`"${col}" = $${paramCount}`);
        values.push(String(value).trim());
        paramCount += 1;
      };

      const addStrLower = (key, value) => {
        if (value === undefined) return;
        const col = getProveedorColumn(key);
        if (!col) return;
        updates.push(`"${col}" = $${paramCount}`);
        values.push(String(value).trim().toLowerCase());
        paramCount += 1;
      };

      const addStrUpper = (key, value) => {
        if (value === undefined) return;
        const col = getProveedorColumn(key);
        if (!col) return;
        updates.push(`"${col}" = $${paramCount}`);
        values.push(String(value).trim().toUpperCase());
        paramCount += 1;
      };

      const addNum = (key, value) => {
        if (value === undefined) return;
        const col = getProveedorColumn(key);
        if (!col) return;
        updates.push(`"${col}" = $${paramCount}`);
        values.push(Number(value));
        paramCount += 1;
      };

      const addNumNull = (key, value) => {
        if (value === undefined) return;
        const col = getProveedorColumn(key);
        if (!col) return;
        updates.push(`"${col}" = $${paramCount}`);
        values.push(value === '' || value === null ? null : Number(value));
        paramCount += 1;
      };

      addStr('razon_social', razon_social);
      addStr('nombre', nombre);
      addStr('ruc', ruc);
      addStr('direccion', direccion);
      addStr('distrito', distrito);
      addStrLower('correo', correo);
      addStr('persona_responsable', persona_responsable);
      addStr('telefono', telefono);
      addStr('condiciones_pago', condiciones_pago);
      addStr('banco', banco);
      addNum('id_moneda', id_moneda);
      addStr('numero_cuenta', numero_cuenta);
      addStr('cci', cci);
      addNumNull('id_area_destino', id_area_destino);
      addStr('descripcion', descripcion);
      addStrUpper('retencion', retencion);
      addStr('categoria', categoria);
      addNum('descuento', descuento);
      addStrUpper('tipo', tipo);
      addStrUpper('tipo_retencion', tipo_retencion);
      addStr('contacto', contacto);
      addStrUpper('estado', estado);

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
      if (client) await client.query('ROLLBACK');
      res.status(500).json({ error: error.message });
    } finally {
      if (client) client.release();
    }
  });

  app.post('/api/proveedores/:id/calificaciones', authMiddleware, async (req, res) => {
    try {
      const proveedorId = Number(req.params?.id || 0);
      if (!proveedorId) {
        return res.status(400).json({ error: 'ID de proveedor invalido' });
      }

      const puntuacion = Number(req.body?.puntuacion || 0);
      const comentario = String(req.body?.comentario || '').trim();
      const tipo = String(req.body?.tipo || 'compra').trim();
      const idReferencia = Number(req.body?.id_referencia || 0) || null;

      if (!Number.isInteger(puntuacion) || puntuacion < 1 || puntuacion > 5) {
        return res.status(400).json({ error: 'La puntuacion debe ser un entero entre 1 y 5' });
      }

      const summary = await upsertProveedorRating(pool, {
        user: req.user,
        proveedorId,
        puntuacion,
        comentario,
        tipo,
        idReferencia,
      });

      res.json(summary);
    } catch (error) {
      if (error.code === 'RATING_ALREADY_EXISTS') {
        return res.status(409).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  });
};
