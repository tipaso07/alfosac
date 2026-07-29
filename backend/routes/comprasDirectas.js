const { tienePermiso } = require('../middleware/auth');

module.exports = function(app, deps) {
  const { pool, authMiddleware, requirePermissions } = deps;

  app.get('/api/compras-directas', authMiddleware, async (req, res) => {
    if (!tienePermiso(req.user, 'VER_HISTORIAL_COMPRAS_DIRECTAS')) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    try {
      const desde = String(req.query.desde || '').trim();
      const hasta = String(req.query.hasta || '').trim();
      const idArea = Number(req.query.id_area || 0);

      const conditions = [];
      const params = [];

      if (desde) {
        conditions.push(`cd.fecha_compra >= $${params.length + 1}::date`);
        params.push(desde);
      }
      if (hasta) {
        conditions.push(`cd.fecha_compra <= $${params.length + 1}::date`);
        params.push(hasta);
      }
      if (Number.isInteger(idArea) && idArea > 0) {
        conditions.push(`cd.id_area = $${params.length + 1}`);
        params.push(idArea);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const result = await pool.query(`
        SELECT
          cd.id,
          cd.proveedor_texto,
          cd.tipo_pago,
          cd.numero_comprobante,
          cd.fecha_compra,
          cd.observaciones,
          cd.foto,
          cd.created_at AS fecha_creacion,
          cd.id_moneda,
          COALESCE(a.nombre, '') AS area_nombre,
          COALESCE(u.nombre, '') AS usuario_nombre,
          COALESCE(
            (SELECT SUM(d.total) FROM detalle_compras_directas d WHERE d.id_compra_directa = cd.id),
            0
          ) AS total
        FROM compras_directas cd
        LEFT JOIN areas a ON a.id = cd.id_area
        LEFT JOIN usuarios u ON u.id = cd.id_usuario
        ${whereClause}
        ORDER BY cd.fecha_compra DESC, cd.id DESC
      `, params);

      return res.json(result.rows);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/compras-directas/:id', authMiddleware, async (req, res) => {
    if (!tienePermiso(req.user, 'VER_HISTORIAL_COMPRAS_DIRECTAS')) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    try {
      const id = Number(req.params.id || 0);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'ID invalido' });
      }

      const headerResult = await pool.query(`
        SELECT
          cd.id,
          cd.id_usuario,
          cd.proveedor_texto,
          cd.id_area,
          cd.tipo_pago,
          cd.numero_comprobante,
          cd.total AS total_registro,
          cd.foto,
          cd.observaciones,
          cd.fecha_compra,
          cd.created_at AS fecha_creacion,
          cd.updated_at AS fecha_actualizacion,
          cd.id_moneda,
          COALESCE(a.nombre, '') AS area_nombre,
          COALESCE(u.nombre, '') AS usuario_nombre
        FROM compras_directas cd
        LEFT JOIN areas a ON a.id = cd.id_area
        LEFT JOIN usuarios u ON u.id = cd.id_usuario
        WHERE cd.id = $1
        LIMIT 1
      `, [id]);

      if (headerResult.rows.length === 0) {
        return res.status(404).json({ error: 'Compra directa no encontrada' });
      }

      const detalleResult = await pool.query(`
        SELECT
          d.id,
          d.descripcion AS nombre_material,
          d.cantidad,
          d.precio_unitario,
          d.total AS subtotal
        FROM detalle_compras_directas d
        WHERE d.id_compra_directa = $1
        ORDER BY d.id ASC
      `, [id]);

      return res.json({
        ...headerResult.rows[0],
        detalle: detalleResult.rows,
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/compras-directas', authMiddleware, requirePermissions('CREAR_COMPRA_DIRECTA'), async (req, res) => {
    let client;
    try {
      client = await pool.connect();
      const {
        proveedor_texto,
        id_area,
        fecha_compra,
        tipo_pago,
        numero_comprobante,
        foto,
        observaciones,
        id_moneda,
        detalle = [],
      } = req.body;

      if (!Array.isArray(detalle) || detalle.length === 0) {
        return res.status(400).json({ error: 'Debe incluir al menos un detalle' });
      }

      let totalCalculado = 0;
      for (const item of detalle) {
        totalCalculado += Number(item.cantidad || 0) * Number(item.precio_unitario || 0);
      }

      await client.query('BEGIN');

      const headerInsert = await client.query(`
        INSERT INTO compras_directas (id_usuario, proveedor_texto, id_area, fecha_compra, tipo_pago, numero_comprobante, foto, observaciones, total, id_moneda)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id
      `, [
        req.user.id,
        proveedor_texto || null,
        Number.isInteger(id_area) && id_area > 0 ? id_area : null,
        fecha_compra || (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })(),
        tipo_pago || 'EFECTIVO',
        numero_comprobante || null,
        foto || null,
        observaciones || null,
        totalCalculado,
        Number.isInteger(id_moneda) && id_moneda > 0 ? id_moneda : 1,
      ]);

      const idCompraDirecta = headerInsert.rows[0].id;

      for (const item of detalle) {
        const cantidad = Number(item.cantidad || 0);
        const precioUnitario = Number(item.precio_unitario || 0);
        if (cantidad <= 0) {
          throw new Error('La cantidad debe ser mayor a 0');
        }

        await client.query(`
          INSERT INTO detalle_compras_directas (id_compra_directa, descripcion, cantidad, precio_unitario, total)
          VALUES ($1, $2, $3, $4, $5)
        `, [
          idCompraDirecta,
          String(item.nombre_material || item.descripcion || '').trim() || 'N/D',
          cantidad,
          precioUnitario,
          cantidad * precioUnitario,
        ]);
      }

      await client.query('COMMIT');

      const created = await pool.query(`
        SELECT cd.*, COALESCE(a.nombre, '') AS area_nombre
        FROM compras_directas cd
        LEFT JOIN areas a ON a.id = cd.id_area
        WHERE cd.id = $1
        LIMIT 1
      `, [idCompraDirecta]);

      return res.status(201).json(created.rows[0]);
    } catch (error) {
      if (client) await client.query('ROLLBACK');
      return res.status(500).json({ error: error.message });
    } finally {
      if (client) client.release();
    }
  });

  app.put('/api/compras-directas/:id', authMiddleware, requirePermissions('CREAR_COMPRA_DIRECTA'), async (req, res) => {
    let client;
    try {
      client = await pool.connect();
      const id = Number(req.params.id || 0);
      if (!id) {
        return res.status(400).json({ error: 'ID invalido' });
      }

      const compraCheck = await client.query('SELECT id FROM compras_directas WHERE id = $1', [id]);
      if (compraCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Compra directa no encontrada' });
      }

      const {
        proveedor_texto,
        id_area,
        fecha_compra,
        tipo_pago,
        numero_comprobante,
        foto,
        observaciones,
        id_moneda,
        detalle = [],
      } = req.body;

      await client.query('BEGIN');

      await client.query('DELETE FROM detalle_compras_directas WHERE id_compra_directa = $1', [id]);

      let totalCalculado = 0;
      for (const item of detalle) {
        totalCalculado += Number(item.cantidad || 0) * Number(item.precio_unitario || 0);
      }

      await client.query(`
        UPDATE compras_directas
        SET proveedor_texto = $2, id_area = $3, fecha_compra = $4, tipo_pago = $5,
            numero_comprobante = $6, foto = $7, observaciones = $8, total = $9, id_moneda = $10,
            updated_at = NOW()
        WHERE id = $1
      `, [
        id,
        proveedor_texto || null,
        Number.isInteger(id_area) && id_area > 0 ? id_area : null,
        fecha_compra || (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })(),
        tipo_pago || 'EFECTIVO',
        numero_comprobante || null,
        foto || null,
        observaciones || null,
        totalCalculado,
        Number.isInteger(id_moneda) && id_moneda > 0 ? id_moneda : 1,
      ]);

      for (const item of detalle) {
        const cantidad = Number(item.cantidad || 0);
        const precioUnitario = Number(item.precio_unitario || 0);
        if (cantidad <= 0) {
          throw new Error('La cantidad debe ser mayor a 0');
        }

        await client.query(`
          INSERT INTO detalle_compras_directas (id_compra_directa, descripcion, cantidad, precio_unitario, total)
          VALUES ($1, $2, $3, $4, $5)
        `, [
          id,
          String(item.nombre_material || item.descripcion || '').trim() || 'N/D',
          cantidad,
          precioUnitario,
          cantidad * precioUnitario,
        ]);
      }

      await client.query('COMMIT');

      const updated = await pool.query(`
        SELECT cd.*, COALESCE(a.nombre, '') AS area_nombre
        FROM compras_directas cd
        LEFT JOIN areas a ON a.id = cd.id_area
        WHERE cd.id = $1
        LIMIT 1
      `, [id]);

      return res.json(updated.rows[0]);
    } catch (error) {
      if (client) await client.query('ROLLBACK');
      return res.status(500).json({ error: error.message });
    } finally {
      if (client) client.release();
    }
  });

  app.delete('/api/compras-directas/:id', authMiddleware, requirePermissions('CREAR_COMPRA_DIRECTA'), async (req, res) => {
    let client;
    try {
      client = await pool.connect();
      const id = Number(req.params.id || 0);
      if (!id) {
        return res.status(400).json({ error: 'ID invalido' });
      }

      const compraCheck = await client.query('SELECT id FROM compras_directas WHERE id = $1', [id]);
      if (compraCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Compra directa no encontrada' });
      }

      await client.query('BEGIN');
      await client.query('DELETE FROM detalle_compras_directas WHERE id_compra_directa = $1', [id]);
      await client.query('DELETE FROM compras_directas WHERE id = $1', [id]);
      await client.query('COMMIT');

      return res.json({ success: true, message: 'Compra directa eliminada correctamente' });
    } catch (error) {
      if (client) await client.query('ROLLBACK');
      return res.status(500).json({ error: error.message });
    } finally {
      if (client) client.release();
    }
  });
};
