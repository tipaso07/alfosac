module.exports = function(app, deps) {
  const { pool, authMiddleware, requirePermissions } = deps;

  app.get('/api/almacenes', authMiddleware, async (req, res) => {
    try {
      const result = await pool.query('SELECT id, nombre FROM almacenes ORDER BY id');
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/areas', authMiddleware, async (req, res) => {
    try {
      const term = String(req.query.query || '').trim();
      const limit = term ? 20 : 200;

      const result = await pool.query(
        `
          SELECT a.id, a.nombre
          FROM areas a
          WHERE ($1::text = '' OR a.nombre ILIKE $2)
          ORDER BY a.nombre ASC
          LIMIT ${limit}
        `,
        [term, `%${term}%`]
      );

      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/areas', authMiddleware, requirePermissions('GESTIONAR_CUENTAS'), async (req, res) => {
    try {
      const { nombre, descripcion } = req.body;
      
      console.log('POST /api/areas - Datos recibidos:', { nombre, descripcion, body: req.body });

      if (!nombre || !String(nombre).trim()) {
        console.log('Error: nombre vacío o no existe');
        return res.status(400).json({ error: 'Nombre es requerido' });
      }

      const sanitizedNombre = String(nombre).trim();
      console.log('Nombre sanitizado:', sanitizedNombre);
      
      // Verificar si ya existe
      const existCheck = await pool.query(
        'SELECT id FROM areas WHERE LOWER(nombre) = LOWER($1)',
        [sanitizedNombre]
      );
      if (existCheck.rows.length > 0) {
        return res.status(400).json({ error: 'El área ya existe' });
      }

      const result = await pool.query(
        `
          INSERT INTO areas (nombre, descripcion)
          VALUES ($1, $2)
          RETURNING id, nombre, descripcion
        `,
        [sanitizedNombre, descripcion || null]
      );

      console.log('Área creada:', result.rows[0]);
      res.status(201).json(result.rows[0]);
    } catch (error) {
      console.log('Error en POST /api/areas:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/categorias', authMiddleware, async (req, res) => {
    try {
      const tableCheck = await pool.query("SELECT to_regclass('public.categorias') IS NOT NULL AS exists");
      if (!tableCheck.rows[0]?.exists) {
        return res.json([]);
      }

      const result = await pool.query(
        `
          SELECT id, nombre
          FROM categorias
          WHERE trim(COALESCE(nombre, '')) <> ''
          ORDER BY nombre ASC
        `
      );

      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/unidades', authMiddleware, async (req, res) => {
    try {
      const tableCheck = await pool.query("SELECT to_regclass('public.unidades') IS NOT NULL AS exists");
      if (!tableCheck.rows[0]?.exists) {
        return res.json([]);
      }

      const result = await pool.query(
        `
          SELECT id, nombre
          FROM unidades
          WHERE trim(COALESCE(nombre, '')) <> ''
          ORDER BY CASE WHEN upper(trim(nombre)) = 'UNIDAD' THEN 0 ELSE 1 END, nombre ASC, id ASC
        `
      );

      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/monedas', authMiddleware, async (req, res) => {
    try {
      const result = await pool.query('SELECT id, nombre, COALESCE(simbolo, '') AS simbolo FROM monedas ORDER BY id');
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
};