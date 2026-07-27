const { pool } = require('../db/pool');

const getMaterialStockTotal = async (client, idMaterial) => {
  const result = await client.query(
    'SELECT COALESCE(SUM(cantidad), 0) AS total FROM stock WHERE id_material = $1',
    [idMaterial]
  );
  return Number(result.rows[0]?.total || 0);
};

const isMaterialVisibleInInventory = async (client, idMaterial) => {
  const result = await client.query(
    `
      SELECT
        EXISTS(
          SELECT 1
          FROM stock s
          WHERE s.id_material = $1
        ) AS has_stock,
        EXISTS(
          SELECT 1
          FROM detalle_compras dc
          WHERE dc.id_material = $1
        ) AS has_purchase_history
    `,
    [idMaterial]
  );

  const row = result.rows[0] || {};
  return Boolean(row.has_stock || !row.has_purchase_history);
};

const discountMaterialStockDistributed = async (client, idMaterial, quantity) => {
  let pending = Number(quantity);
  const allocations = [];

  const rows = await client.query(
    `
      SELECT id_material, id_almacen, cantidad
      FROM stock
      WHERE id_material = $1
      ORDER BY cantidad DESC
      FOR UPDATE
    `,
    [idMaterial]
  );

  for (const row of rows.rows) {
    if (pending <= 0) break;
    const available = Number(row.cantidad || 0);

    if (available >= pending) {
      await client.query(
        'UPDATE stock SET cantidad = cantidad - $1 WHERE id_material = $2 AND id_almacen = $3',
        [pending, row.id_material, row.id_almacen]
      );
      allocations.push({ id_almacen: Number(row.id_almacen), cantidad: Number(pending) });
      pending = 0;
    } else {
      await client.query(
        'UPDATE stock SET cantidad = 0 WHERE id_material = $1 AND id_almacen = $2',
        [row.id_material, row.id_almacen]
      );
      if (available > 0) {
        allocations.push({ id_almacen: Number(row.id_almacen), cantidad: Number(available) });
      }
      pending -= available;
    }
  }

  if (pending > 0) {
    throw new Error(`Stock insuficiente para material ${idMaterial}`);
  }

  return allocations;
};

module.exports = {
  getMaterialStockTotal,
  isMaterialVisibleInInventory,
  discountMaterialStockDistributed,
};
