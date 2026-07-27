const { pool, insertMovimiento, getRequerimientoDescripcionColumn, quoteIdentifier } = require('./pool');

const seedInventoryDemoData = async () => {
  const materialCount = await pool.query('SELECT COUNT(*)::int AS total FROM materiales');
  if (Number(materialCount.rows[0]?.total || 0) > 0) {
    return;
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const gerentesRole = await client.query("SELECT id FROM roles WHERE upper(trim(nombre)) = 'GERENTES' LIMIT 1");
    const comprasRole = await client.query("SELECT id FROM roles WHERE upper(trim(nombre)) = 'COMPRAS' LIMIT 1");
    const areaRow = await client.query('SELECT id FROM areas ORDER BY id ASC LIMIT 1');
    const warehouseRow = await client.query('SELECT id FROM almacenes ORDER BY id ASC LIMIT 1');
    const unitRow = await client.query("SELECT id FROM unidades WHERE upper(trim(nombre)) = 'UND' LIMIT 1");
    const currencyRow = await client.query("SELECT id FROM monedas WHERE upper(trim(nombre)) = 'SOLES' LIMIT 1");
    const categoryRow = await client.query('SELECT id FROM categorias ORDER BY id ASC LIMIT 1');
    const adminUserRow = await client.query("SELECT id, nombre, email, id_area FROM usuarios WHERE lower(trim(email)) = 'admin@alfosac.pe' LIMIT 1");

    const idGerentesRole = Number(gerentesRole.rows[0]?.id || 0);
    const idComprasRole = Number(comprasRole.rows[0]?.id || 0);
    const idArea = Number(areaRow.rows[0]?.id || 0);
    const idWarehouse = Number(warehouseRow.rows[0]?.id || 0);
    const idUnit = Number(unitRow.rows[0]?.id || 0);
    const idCurrency = Number(currencyRow.rows[0]?.id || 0);
    const idCategory = Number(categoryRow.rows[0]?.id || 0);
    const adminUser = adminUserRow.rows[0];

    if (!idGerentesRole || !idComprasRole || !idArea || !idWarehouse || !idUnit || !idCurrency || !idCategory || !adminUser?.id) {
      throw new Error('No se pudieron resolver las claves base para la semilla del inventario');
    }

    const providerResult = await client.query(
      `
        INSERT INTO proveedores (
          nombre, razon_social, direccion, distrito, ruc, correo,
          persona_responsable, telefono, condiciones_pago, banco,
          numero_cuenta, cci, id_moneda, id_area_destino,
          descripcion, retencion, categoria, descuento,
          tipo, tipo_retencion, moneda_nombre
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
        ON CONFLICT (ruc) DO UPDATE SET
          nombre = EXCLUDED.nombre,
          razon_social = EXCLUDED.razon_social,
          correo = EXCLUDED.correo,
          telefono = EXCLUDED.telefono
        RETURNING id
      `,
      [
        'Proveedor Demo', 'Proveedor Demo SAC', 'Av. Principal 123', 'Lima',
        '20123456789', 'proveedor.demo@alfosac.pe', 'Carlos Demo', '999999999',
        '30 dias', 'Banco Demo', '123-456', '000-111-222', idCurrency, idArea,
        'Proveedor inicial para inventario', 'NO', 'GENERAL', 0,
        'BIEN', 'RETENCION', 'SOLES',
      ]
    );

    console.log('[SEED] proveedor demo listo');

    const providerId = Number(providerResult.rows[0]?.id || 0);

    const materialResult = await client.query(
      `
        INSERT INTO materiales (
          nombre,
          descripcion,
          id_unidad,
          id_proveedor,
          costo_unitario,
          id_moneda,
          imagen,
          id_categoria,
          categoria
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        RETURNING id
      `,
      [
        'Material Demo',
        'Material semilla para validar inventario',
        idUnit,
        providerId,
        25.5,
        idCurrency,
        null,
        idCategory,
        'General',
      ]
    );

    console.log('[SEED] material demo listo');

    const materialId = Number(materialResult.rows[0]?.id || 0);

    await client.query(
      'INSERT INTO material_categoria (id_material, id_categoria) VALUES ($1, $2) ON CONFLICT (id_material, id_categoria) DO NOTHING',
      [materialId, idCategory]
    );

    await client.query(
      'INSERT INTO stock (id_material, id_almacen, cantidad) VALUES ($1, $2, $3) ON CONFLICT (id_material, id_almacen) DO UPDATE SET cantidad = EXCLUDED.cantidad',
      [materialId, idWarehouse, 120]
    );

    const seedReqDescripcionColumn = getRequerimientoDescripcionColumn();

    const requerimientoResult = await client.query(
      `
          INSERT INTO requerimientos (estado, prioridad, ${quoteIdentifier(seedReqDescripcionColumn)}, id_usuario, id_area, fecha_creacion, nombre_receptor, dni_receptor, estado_entrega)
        VALUES ($1, $2, $3, $4, $5, timezone('America/Lima', now()), $6, $7, $8)
        RETURNING id
      `,
      ['APROBADO', 'MEDIA', 'Requerimiento semilla', adminUser.id, idArea, 'Usuario Demo', '00000000', 'ENTREGADO']
    );

    console.log('[SEED] requerimiento demo listo');

    const requerimientoId = Number(requerimientoResult.rows[0]?.id || 0);

    await client.query(
      'INSERT INTO detalle_requerimiento (id_requerimiento, id_material, cantidad, observaciones) VALUES ($1, $2, $3, $4)',
      [requerimientoId, materialId, 10, 'Semilla inventario']
    );

    await client.query(
      'INSERT INTO requerimiento_productos (id_requerimiento, nombre_producto, cantidad, comentarios) VALUES ($1, $2, $3, $4)',
      [requerimientoId, 'Material Demo', 10, 'Semilla inventario']
    );

    const compraResult = await client.query(
      `
        INSERT INTO compras (
          numero_compra,
          id_usuario,
          id_area_solicitante,
          id_area_final,
          id_proveedor,
          estado,
          proveedor,
          ruc,
          direccion,
          distrito,
          correo,
          persona_responsable,
          telefono,
          contacto_proveedor,
          banco,
          numero_cuenta,
          cuenta,
          cci,
          retencion,
          descuento,
          aplica_retencion,
          tipo,
          tipo_retencion,
          importe_final,
          condiciones_pago,
          monto_total,
          subtotal,
          costo_envio,
          otros_costos,
          igv,
          total,
          moneda,
          id_moneda,
          numero_orden,
          comentarios
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35)
        RETURNING id
      `,
      [
        'OC-DEMO-001',
        adminUser.id,
        idArea,
        idArea,
        providerId,
        'PENDIENTE',
        'Proveedor Demo SAC',
        '20123456789',
        'Av. Principal 123',
        'Lima',
        'proveedor.demo@alfosac.pe',
        'Carlos Demo',
        '999999999',
        'Carlos Demo',
        'Banco Demo',
        '123-456',
        '123-456',
        '000-111-222',
        'NO',
        0,
        false,
        'BIEN',
        'RETENCION',
        25.5,
        '30 dias',
        25.5,
        25.5,
        0,
        0,
        0,
        25.5,
        'SOLES',
        idCurrency,
        'OC-DEMO-001',
        'Compra semilla para inventario',
      ]
    );

    console.log('[SEED] compra demo lista');

    const compraId = Number(compraResult.rows[0]?.id || 0);

    await client.query(
      `
        INSERT INTO detalle_compras (id_compra, id_material, nombre_material, cantidad, precio_unitario, subtotal, id_categoria, comentarios)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [compraId, materialId, 'Material Demo', 10, 25.5, 255, idCategory, 'Detalle semilla']
    );

    const movimientoId = await insertMovimiento(client, {
      tipo: 'ENTRADA',
      usuarioRegistro: adminUser.id,
      idRequerimiento: requerimientoId,
      idMaterial: materialId,
      cantidad: 120,
      documentoReferencia: 'SEED-001',
      idAlmacen: idWarehouse,
      observaciones: 'Movimiento semilla',
      fechaExpression: 'CURRENT_DATE',
    });

    console.log('[SEED] movimiento demo listo');

    await client.query(
      'INSERT INTO movimiento_detalles (id_movimiento, id_material, cantidad) VALUES ($1, $2, $3)',
      [movimientoId, materialId, 120]
    );

    await client.query('COMMIT');
    console.log('Semilla de inventario cargada correctamente');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  seedInventoryDemoData,
};
