const { getUserRoleIdExpr, pickExistingColumn, schemaMeta, quoteIdentifier } = require('../db/pool');

module.exports = function(app, deps) {
  const { pool, authMiddleware, requirePermissions } = deps;

  app.get('/api/materiales', authMiddleware, requirePermissions('VER_INVENTARIO'), async (req, res) => {
    try {
      const { id_almacen } = req.query;
      const params = [req.user.id];
      const userRoleExpr = getUserRoleIdExpr('u');

      if (id_almacen) {
        params.push(Number(id_almacen));
      }

      const result = await pool.query(
        `
          WITH usuario_actual AS (
            SELECT
              u.id AS usuario_actual_id,
              u.nombre AS usuario_actual_nombre,
              COALESCE(a.nombre, 'Sin area') AS usuario_actual_area,
              COALESCE(r.nombre, 'Sin rol') AS usuario_actual_rol
            FROM usuarios u
            LEFT JOIN areas a ON a.id = u.id_area
            LEFT JOIN roles r ON r.id = ${userRoleExpr}
            WHERE u.id = $1
            GROUP BY u.id, u.nombre, a.nombre, r.nombre
          ),
          stock_resumen AS (
            SELECT
              s.id_material,
              COALESCE(SUM(s.cantidad), 0) AS stock_total,
              COALESCE(SUM(COALESCE(NULLIF(to_jsonb(s)->>'stock_seguridad', '')::numeric, 0)), 0) AS stock_seguridad,
              COALESCE(STRING_AGG(DISTINCT al.nombre, ', '), 'Sin almacen') AS ubicacion,
              MIN(s.id_almacen) AS id_almacen
            FROM stock s
            LEFT JOIN almacenes al ON al.id = s.id_almacen
            ${id_almacen ? 'WHERE s.id_almacen = $2' : ''}
            GROUP BY s.id_material
          ),
          requerimiento_resumen AS (
            SELECT
              dr.id_material,
              COUNT(DISTINCT r.id) AS total_requerimientos,
              COALESCE(SUM(dr.cantidad), 0) AS cantidad_requerida,
              COALESCE(SUM(CASE WHEN upper(trim(COALESCE(r.estado, ''))) = 'APROBADO' THEN dr.cantidad ELSE 0 END), 0) AS cantidad_aprobada
            FROM detalle_requerimiento dr
            JOIN requerimientos r ON r.id = dr.id_requerimiento
            GROUP BY dr.id_material
          ),
          requerimiento_producto_resumen AS (
            SELECT
              COUNT(*) AS total_requerimiento_productos,
              COALESCE(SUM(COALESCE(rp.cantidad, 0)), 0) AS cantidad_requerimiento_productos
            FROM requerimiento_productos rp
            JOIN requerimientos r ON r.id = rp.id_requerimiento
          ),
          compra_resumen AS (
            SELECT
              dc.id_material,
              COUNT(DISTINCT c.id) AS total_compras,
              COALESCE(SUM(dc.cantidad), 0) AS cantidad_compras,
              COALESCE(SUM(COALESCE(NULLIF(to_jsonb(dc)->>'subtotal', '')::numeric, 0)), 0) AS subtotal_compras
            FROM detalle_compras dc
            JOIN compras c ON c.id = dc.id_compra
            GROUP BY dc.id_material
          ),
          movimiento_resumen AS (
            SELECT
              COALESCE(
                NULLIF(to_jsonb(dm)->>'id_material', '')::int,
                NULLIF(to_jsonb(m)->>'id_material', '')::int
              ) AS id_material,
              COALESCE(
                SUM(
                  CASE
                    WHEN upper(trim(COALESCE(to_jsonb(m)->>'tipo_movimiento', to_jsonb(m)->>'tipo', ''))) = 'ENTRADA'
                      THEN COALESCE(NULLIF(to_jsonb(dm)->>'cantidad', '')::numeric, NULLIF(to_jsonb(m)->>'cantidad', '')::numeric, 0)
                    ELSE 0
                  END
                ),
                0
              ) AS entradas,
              COALESCE(
                SUM(
                  CASE
                    WHEN upper(trim(COALESCE(to_jsonb(m)->>'tipo_movimiento', to_jsonb(m)->>'tipo', ''))) = 'SALIDA'
                      THEN COALESCE(NULLIF(to_jsonb(dm)->>'cantidad', '')::numeric, NULLIF(to_jsonb(m)->>'cantidad', '')::numeric, 0)
                    ELSE 0
                  END
                ),
                0
              ) AS salidas,
              COUNT(DISTINCT m.id) AS total_movimientos
            FROM movimientos m
            LEFT JOIN movimiento_detalles dm ON dm.id_movimiento = m.id
            GROUP BY COALESCE(
              NULLIF(to_jsonb(dm)->>'id_material', '')::int,
              NULLIF(to_jsonb(m)->>'id_material', '')::int
            )
          ),
          movimiento_detalle_resumen AS (
            SELECT
              COUNT(*) AS total_movimiento_detalles,
              COALESCE(SUM(COALESCE(NULLIF(to_jsonb(md)->>'cantidad', '')::numeric, 0)), 0) AS cantidad_movimiento_detalles
            FROM movimiento_detalles md
          ),
          detalle_movimiento_resumen AS (
            SELECT
              COUNT(*) AS total_detalle_movimientos,
              COALESCE(SUM(COALESCE(NULLIF(to_jsonb(dm)->>'cantidad', '')::numeric, 0)), 0) AS cantidad_detalle_movimientos
            FROM detalle_movimientos dm
          )
          SELECT
            m.id,
            m.id AS id_material,
            m.id AS nro_creacion,
            m.nombre AS nombre_producto,
            m.nombre,
            m.descripcion,
            NULLIF(to_jsonb(m)->>'id_moneda', '')::int AS moneda_id,
            NULLIF(to_jsonb(m)->>'id_categoria', '')::int AS id_categoria,
            COALESCE(cat.nombre, 'Sin categoria') AS categoria,
            COALESCE(un.nombre, 'Sin unidad') AS unidad_medida,
            COALESCE(sr.stock_total, 0) AS stock,
            COALESCE(sr.stock_seguridad, 0) AS stock_seguridad,
            COALESCE(sr.ubicacion, 'Sin almacen') AS ubicacion,
            COALESCE(
              NULLIF(to_jsonb(m)->>'costo_unitario', '')::numeric,
              NULLIF(to_jsonb(m)->>'precio_unitario', '')::numeric,
              NULLIF(to_jsonb(m)->>'costo', '')::numeric,
              0
            ) AS costo_unitario,
            ROUND((
              COALESCE(
                NULLIF(to_jsonb(m)->>'costo_unitario', '')::numeric,
                NULLIF(to_jsonb(m)->>'precio_unitario', '')::numeric,
                NULLIF(to_jsonb(m)->>'costo', '')::numeric,
                0
              ) * 1.18
            ), 2) AS costo_con_igv,
            COALESCE(mo.nombre, 'N/D') AS moneda,
            COALESCE(mo.simbolo, '') AS moneda_simbolo,
            NULLIF(trim(COALESCE(to_jsonb(m)->>'imagen', '')), '') AS imagen,
            COALESCE(sr.id_almacen, NULL) AS id_almacen,
            COALESCE(sr.ubicacion, 'Sin almacen') AS almacen,
            NULLIF(to_jsonb(m)->>'id_unidad', '')::int AS id_unidad,
            NULLIF(to_jsonb(m)->>'id_proveedor', '')::int AS id_proveedor,
            COALESCE(un.nombre, 'Sin unidad') AS unidad,
            COALESCE(p.nombre, 'Sin proveedor') AS proveedor,
            COALESCE(sr.stock_total, 0) AS cantidad,
            COALESCE(rr.total_requerimientos, 0) AS total_requerimientos,
            COALESCE(rr.cantidad_requerida, 0) AS cantidad_requerida,
            COALESCE(rr.cantidad_aprobada, 0) AS cantidad_aprobada,
            COALESCE(rpr.total_requerimiento_productos, 0) AS total_requerimiento_productos,
            COALESCE(rpr.cantidad_requerimiento_productos, 0) AS cantidad_requerimiento_productos,
            COALESCE(cr.total_compras, 0) AS total_compras,
            COALESCE(cr.cantidad_compras, 0) AS cantidad_compras,
            COALESCE(cr.subtotal_compras, 0) AS subtotal_compras,
            COALESCE(mr.entradas, 0) AS entradas,
            COALESCE(mr.salidas, 0) AS salidas,
            COALESCE(mr.total_movimientos, 0) AS total_movimientos,
            COALESCE(mdr.total_movimiento_detalles, 0) AS total_movimiento_detalles,
            COALESCE(mdr.cantidad_movimiento_detalles, 0) AS cantidad_movimiento_detalles,
            COALESCE(dmr.total_detalle_movimientos, 0) AS total_detalle_movimientos,
            COALESCE(dmr.cantidad_detalle_movimientos, 0) AS cantidad_detalle_movimientos,
            ua.usuario_actual_nombre,
            ua.usuario_actual_area,
            ua.usuario_actual_rol
          FROM materiales m
          LEFT JOIN unidades un ON un.id = NULLIF(to_jsonb(m)->>'id_unidad', '')::int
          LEFT JOIN proveedores p ON p.id = NULLIF(to_jsonb(m)->>'id_proveedor', '')::int
          LEFT JOIN categorias cat ON cat.id = NULLIF(to_jsonb(m)->>'id_categoria', '')::int
          LEFT JOIN stock_resumen sr ON sr.id_material = m.id
          LEFT JOIN monedas mo ON mo.id = NULLIF(to_jsonb(m)->>'id_moneda', '')::int
          LEFT JOIN requerimiento_resumen rr ON rr.id_material = m.id
          CROSS JOIN requerimiento_producto_resumen rpr
          LEFT JOIN compra_resumen cr ON cr.id_material = m.id
          LEFT JOIN movimiento_resumen mr ON mr.id_material = m.id
          CROSS JOIN movimiento_detalle_resumen mdr
          CROSS JOIN detalle_movimiento_resumen dmr
          CROSS JOIN usuario_actual ua
          WHERE sr.id_material IS NOT NULL OR cr.id_material IS NULL
          ORDER BY m.id DESC
        `,
        params
      );

      res.json(result.rows.map((row) => ({
        ...row,
        stock: Number(row.stock || 0),
        stock_seguridad: Number(row.stock_seguridad || 0),
        costo_unitario: Number(row.costo_unitario || 0),
        costo_con_igv: Number(row.costo_con_igv || 0),
        cantidad: Number(row.cantidad || 0),
        total_requerimientos: Number(row.total_requerimientos || 0),
        cantidad_requerida: Number(row.cantidad_requerida || 0),
        cantidad_aprobada: Number(row.cantidad_aprobada || 0),
        total_requerimiento_productos: Number(row.total_requerimiento_productos || 0),
        cantidad_requerimiento_productos: Number(row.cantidad_requerimiento_productos || 0),
        total_compras: Number(row.total_compras || 0),
        cantidad_compras: Number(row.cantidad_compras || 0),
        subtotal_compras: Number(row.subtotal_compras || 0),
        entradas: Number(row.entradas || 0),
        salidas: Number(row.salidas || 0),
        total_movimientos: Number(row.total_movimientos || 0),
        total_movimiento_detalles: Number(row.total_movimiento_detalles || 0),
        cantidad_movimiento_detalles: Number(row.cantidad_movimiento_detalles || 0),
        total_detalle_movimientos: Number(row.total_detalle_movimientos || 0),
        cantidad_detalle_movimientos: Number(row.cantidad_detalle_movimientos || 0),
      })));
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/materiales', authMiddleware, requirePermissions('AGREGAR_INVENTARIO_MANUAL'), async (req, res) => {
    let client;
    try {
      client = await pool.connect();
      const {
        nombre,
        descripcion,
        id_unidad,
        id_proveedor,
        id_moneda,
        id_categoria,
        categoria,
        stock,
        stock_seguridad,
        ubicacion,
        costo_unitario,
        imagen,
        id_almacen,
      } = req.body;

      const nombreNorm = String(nombre || '').trim();
      const categoriaNombre = String(categoria || '').trim();
      const ubicacionNombre = String(ubicacion || '').trim();
      const imagenUrl = String(imagen || '').trim() || null;
      const stockValue = Number(stock);
      const stockSeguridadValue = Number(stock_seguridad);
      const costoUnitarioValue = Number(costo_unitario);

      if (!nombreNorm || !id_unidad || !id_proveedor) {
        return res.status(400).json({
          error: 'nombre, id_unidad e id_proveedor son obligatorios',
        });
      }

      if (!categoriaNombre && !(id_categoria !== null && id_categoria !== undefined && id_categoria !== '')) {
        return res.status(400).json({ error: 'categoria es obligatoria' });
      }

      if (!Number.isFinite(stockValue) || stockValue < 0) {
        return res.status(400).json({ error: 'stock debe ser numerico y mayor o igual a 0' });
      }

      if (!Number.isFinite(stockSeguridadValue) || stockSeguridadValue < 0) {
        return res.status(400).json({ error: 'stock_seguridad debe ser numerico y mayor o igual a 0' });
      }

      if (!Number.isFinite(costoUnitarioValue) || costoUnitarioValue < 0) {
        return res.status(400).json({ error: 'costo_unitario debe ser numerico y mayor o igual a 0' });
      }

      const idMoneda = id_moneda ? Number(id_moneda) : null;
      if (idMoneda) {
        const moneda = await client.query('SELECT id FROM monedas WHERE id = $1 LIMIT 1', [idMoneda]);
        if (moneda.rows.length === 0) {
          return res.status(400).json({ error: 'id_moneda no existe en monedas' });
        }
      }

      const idUnidad = Number(id_unidad || 0);
      if (!Number.isInteger(idUnidad) || idUnidad <= 0) {
        return res.status(400).json({ error: 'id_unidad debe ser valido' });
      }

      const unidad = await client.query('SELECT id FROM unidades WHERE id = $1 LIMIT 1', [idUnidad]);
      if (unidad.rows.length === 0) {
        return res.status(400).json({ error: 'id_unidad no existe en unidades' });
      }

      const idProveedor = Number(id_proveedor || 0);
      if (!Number.isInteger(idProveedor) || idProveedor <= 0) {
        return res.status(400).json({ error: 'id_proveedor debe ser valido' });
      }

      const proveedor = await client.query('SELECT id FROM proveedores WHERE id = $1 LIMIT 1', [idProveedor]);
      if (proveedor.rows.length === 0) {
        return res.status(400).json({ error: 'id_proveedor no existe en proveedores' });
      }

      const tableFlags = await client.query(
        `
          SELECT
            to_regclass('public.categorias') IS NOT NULL AS has_categorias,
            to_regclass('public.material_categoria') IS NOT NULL AS has_material_categoria,
            to_regclass('public.almacenes') IS NOT NULL AS has_almacenes,
            to_regclass('public.stock') IS NOT NULL AS has_stock
        `
      );
      const hasCategorias = Boolean(tableFlags.rows[0]?.has_categorias);
      const hasMaterialCategoria = Boolean(tableFlags.rows[0]?.has_material_categoria);
      const hasAlmacenes = Boolean(tableFlags.rows[0]?.has_almacenes);
      const hasStock = Boolean(tableFlags.rows[0]?.has_stock);

      let idCategoria = id_categoria === null || id_categoria === undefined || id_categoria === ''
        ? null
        : Number(id_categoria);
      let idAlmacen = id_almacen === null || id_almacen === undefined || id_almacen === ''
        ? null
        : Number(id_almacen);

      if (idCategoria !== null && (!Number.isInteger(idCategoria) || idCategoria <= 0)) {
        return res.status(400).json({ error: 'id_categoria debe ser valido o NULL' });
      }

      if ((idCategoria !== null || categoriaNombre) && !hasCategorias) {
        return res.status(400).json({ error: 'La tabla categorias no esta disponible' });
      }

      if (!hasAlmacenes) {
        return res.status(400).json({ error: 'La tabla almacenes no esta disponible' });
      }

      if (!hasStock) {
        return res.status(400).json({ error: 'La tabla stock no esta disponible' });
      }

      const materialCostoColumn = pickExistingColumn(schemaMeta.materialesColumns, ['costo_unitario', 'precio_unitario', 'costo']);
      const stockSafetyColumn = pickExistingColumn(schemaMeta.stockColumns, ['stock_seguridad']);
      const materialImagenColumn = pickExistingColumn(schemaMeta.materialesColumns, ['imagen']);

      if (!stockSafetyColumn) {
        return res.status(400).json({ error: 'La tabla stock no tiene columna stock_seguridad' });
      }

      await client.query('BEGIN');

      if (idCategoria !== null) {
        const categoriaRow = await client.query('SELECT id FROM categorias WHERE id = $1 LIMIT 1', [idCategoria]);
        if (categoriaRow.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'id_categoria no existe en categorias' });
        }
      } else if (categoriaNombre) {
        const categoriaRow = await client.query(
          'SELECT id FROM categorias WHERE lower(trim(nombre)) = lower(trim($1)) LIMIT 1',
          [categoriaNombre]
        );

        if (categoriaRow.rows.length > 0) {
          idCategoria = Number(categoriaRow.rows[0].id);
        } else {
          const createdCategoria = await client.query(
            'INSERT INTO categorias (nombre) VALUES ($1) RETURNING id',
            [categoriaNombre]
          );
          idCategoria = Number(createdCategoria.rows[0].id);
        }
      }

      if (idAlmacen !== null) {
        if (!Number.isInteger(idAlmacen) || idAlmacen <= 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'id_almacen debe ser valido' });
        }

        const almacenById = await client.query('SELECT id FROM almacenes WHERE id = $1 LIMIT 1', [idAlmacen]);
        if (almacenById.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'id_almacen no existe en almacenes' });
        }
      } else if (ubicacionNombre) {
        const existingAlmacen = await client.query(
          'SELECT id FROM almacenes WHERE lower(trim(nombre)) = lower(trim($1)) LIMIT 1',
          [ubicacionNombre]
        );

        if (existingAlmacen.rows.length > 0) {
          idAlmacen = Number(existingAlmacen.rows[0].id);
        } else {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'El almacen indicado no existe. Selecciona un almacen registrado' });
        }
      }

      if (idAlmacen === null) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'id_almacen es obligatorio' });
      }

      const insertColumns = ['nombre', 'descripcion', 'id_unidad', 'id_proveedor', 'id_moneda', 'id_categoria'];
      const insertValues = [nombreNorm, descripcion || null, idUnidad, idProveedor, idMoneda, idCategoria];

      if (materialCostoColumn) {
        insertColumns.push(materialCostoColumn);
        insertValues.push(costoUnitarioValue);
      }

      if (materialImagenColumn && imagenUrl) {
        insertColumns.push(materialImagenColumn);
        insertValues.push(imagenUrl);
      }

      const insertPlaceholders = insertValues.map((_, idx) => `$${idx + 1}`);

      const result = await client.query(
        `
          INSERT INTO materiales (${insertColumns.map((column) => quoteIdentifier(column)).join(', ')})
          VALUES (${insertPlaceholders.join(', ')})
          RETURNING id, nombre, descripcion, id_unidad, id_proveedor, id_moneda, id_categoria
        `,
        insertValues
      );

      const materialId = Number(result.rows[0]?.id || 0);
      if (materialId > 0 && idCategoria && hasMaterialCategoria) {
        const existingMaterialCategoria = await client.query(
          'SELECT 1 FROM material_categoria WHERE id_material = $1 AND id_categoria = $2 LIMIT 1',
          [materialId, idCategoria]
        );
        if (existingMaterialCategoria.rows.length === 0) {
          await client.query(
            'INSERT INTO material_categoria (id_material, id_categoria) VALUES ($1, $2)',
            [materialId, idCategoria]
          );
        }
      }

      if (materialId > 0 && idAlmacen) {
        const updateStockResult = await client.query(
          `UPDATE stock SET cantidad = $3, ${quoteIdentifier(stockSafetyColumn)} = $4 WHERE id_material = $1 AND id_almacen = $2`,
          [materialId, idAlmacen, stockValue, stockSeguridadValue]
        );
        if (Number(updateStockResult.rowCount || 0) === 0) {
          await client.query(
            `INSERT INTO stock (id_material, id_almacen, cantidad, ${quoteIdentifier(stockSafetyColumn)}) VALUES ($1, $2, $3, $4)`,
            [materialId, idAlmacen, stockValue, stockSeguridadValue]
          );
        }
      }

      await client.query('COMMIT');
      res.status(201).json(result.rows[0]);
    } catch (error) {
      if (client) await client.query('ROLLBACK');
      res.status(500).json({ error: error.message });
    } finally {
      if (client) client.release();
    }
  });

  app.put('/api/materiales/:id', authMiddleware, requirePermissions('EDITAR_INVENTARIO'), async (req, res) => {
    let client;
    try {
      client = await pool.connect();
    try {
      const materialId = Number(req.params.id || 0);
      if (!Number.isInteger(materialId) || materialId <= 0) {
        return res.status(400).json({ error: 'ID de material invalido' });
      }

      const {
        nombre,
        descripcion,
        id_unidad,
        id_proveedor,
        id_moneda,
        id_categoria,
        costo_unitario,
        stock_seguridad,
        id_almacen,
        imagen,
      } = req.body;

      const nombreNorm = String(nombre || '').trim();
      if (!nombreNorm) {
        return res.status(400).json({ error: 'nombre es obligatorio' });
      }

      const idUnidad = Number(id_unidad || 0);
      if (!Number.isInteger(idUnidad) || idUnidad <= 0) {
        return res.status(400).json({ error: 'id_unidad debe ser valido' });
      }

      const idProveedor = Number(id_proveedor || 0);
      if (!Number.isInteger(idProveedor) || idProveedor <= 0) {
        return res.status(400).json({ error: 'id_proveedor debe ser valido' });
      }

      const idAlmacen = id_almacen === null || id_almacen === undefined || id_almacen === ''
        ? null
        : Number(id_almacen);
      if (idAlmacen !== null && (!Number.isInteger(idAlmacen) || idAlmacen <= 0)) {
        return res.status(400).json({ error: 'id_almacen debe ser valido' });
      }

      const stockSeguridadValue = Number(stock_seguridad);
      if (!Number.isFinite(stockSeguridadValue) || stockSeguridadValue < 0) {
        return res.status(400).json({ error: 'stock_seguridad debe ser numerico y >= 0' });
      }

      const costoUnitarioValue = Number(costo_unitario);
      if (!Number.isFinite(costoUnitarioValue) || costoUnitarioValue < 0) {
        return res.status(400).json({ error: 'costo_unitario debe ser numerico y >= 0' });
      }

      const idMoneda = id_moneda ? Number(id_moneda) : null;
      if (idMoneda && (!Number.isInteger(idMoneda) || idMoneda <= 0)) {
        return res.status(400).json({ error: 'id_moneda debe ser valido' });
      }

      let idCategoria = id_categoria === null || id_categoria === undefined || id_categoria === ''
        ? null
        : Number(id_categoria);
      if (idCategoria !== null && (!Number.isInteger(idCategoria) || idCategoria <= 0)) {
        return res.status(400).json({ error: 'id_categoria debe ser valido' });
      }

      const imagenUrl = imagen === null || imagen === undefined
        ? null
        : String(imagen || '').trim() || null;

      const existing = await client.query('SELECT id FROM materiales WHERE id = $1', [materialId]);
      if (existing.rows.length === 0) {
        return res.status(404).json({ error: 'Material no encontrado' });
      }

      await client.query('BEGIN');

      const unidad = await client.query('SELECT id FROM unidades WHERE id = $1 LIMIT 1', [idUnidad]);
      if (unidad.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'id_unidad no existe en unidades' });
      }

      const proveedor = await client.query('SELECT id FROM proveedores WHERE id = $1 LIMIT 1', [idProveedor]);
      if (proveedor.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'id_proveedor no existe en proveedores' });
      }

      if (idMoneda) {
        const moneda = await client.query('SELECT id FROM monedas WHERE id = $1 LIMIT 1', [idMoneda]);
        if (moneda.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'id_moneda no existe en monedas' });
        }
      }

      if (idCategoria !== null) {
        const categoria = await client.query('SELECT id FROM categorias WHERE id = $1 LIMIT 1', [idCategoria]);
        if (categoria.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'id_categoria no existe en categorias' });
        }
      }

      if (idAlmacen !== null) {
        const almacen = await client.query('SELECT id FROM almacenes WHERE id = $1 LIMIT 1', [idAlmacen]);
        if (almacen.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'id_almacen no existe en almacenes' });
        }
      }

      const materialCostoColumn = pickExistingColumn(schemaMeta.materialesColumns, ['costo_unitario', 'precio_unitario', 'costo']);
      const stockSafetyColumn = pickExistingColumn(schemaMeta.stockColumns, ['stock_seguridad']);
      const materialImagenColumn = pickExistingColumn(schemaMeta.materialesColumns, ['imagen']);

      const setClauses = [
        'nombre = $1',
        'descripcion = $2',
        'id_unidad = $3',
        'id_proveedor = $4',
        'id_moneda = $5',
        'id_categoria = $6',
      ];
      const setValues = [nombreNorm, descripcion || null, idUnidad, idProveedor, idMoneda, idCategoria];

      if (materialCostoColumn) {
        setClauses.push(`${quoteIdentifier(materialCostoColumn)} = $${setValues.length + 1}`);
        setValues.push(costoUnitarioValue);
      }

      if (materialImagenColumn) {
        setClauses.push(`${quoteIdentifier(materialImagenColumn)} = $${setValues.length + 1}`);
        setValues.push(imagenUrl);
      }

      setValues.push(materialId);

      await client.query(
        `UPDATE materiales SET ${setClauses.join(', ')} WHERE id = $${setValues.length}`,
        setValues
      );

      if (idAlmacen && stockSafetyColumn) {
        const updateStock = await client.query(
          `UPDATE stock SET ${quoteIdentifier(stockSafetyColumn)} = $3 WHERE id_material = $1 AND id_almacen = $2`,
          [materialId, idAlmacen, stockSeguridadValue]
        );
        if (Number(updateStock.rowCount || 0) === 0) {
          await client.query(
            `INSERT INTO stock (id_material, id_almacen, cantidad, ${quoteIdentifier(stockSafetyColumn)}) VALUES ($1, $2, 0, $3)`,
            [materialId, idAlmacen, stockSeguridadValue]
          );
        }
      }

      await client.query('COMMIT');
      res.json({ ok: true, id: materialId });
    } catch (error) {
      if (client) await client.query('ROLLBACK');
      res.status(500).json({ error: error.message });
    } finally {
      if (client) client.release();
    }
  });

  app.get('/api/stock', authMiddleware, async (req, res) => {
    try {
      const result = await pool.query(
        `
          SELECT
            s.id_material,
            m.nombre AS material,
            s.id_almacen,
            a.nombre AS almacen,
            s.cantidad,
            COALESCE(NULLIF(to_jsonb(s)->>'stock_seguridad', '')::numeric, 0) AS stock_seguridad
          FROM stock s
          JOIN materiales m ON m.id = s.id_material
          JOIN almacenes a ON a.id = s.id_almacen
          ORDER BY m.nombre, a.nombre
        `
      );
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
};
