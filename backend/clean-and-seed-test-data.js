const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });
const { Pool } = require('pg');

const configuredDbHost = process.env.DB_HOST || 'localhost';
const effectiveDbHost = configuredDbHost === 'postgres' && process.platform === 'win32'
  ? 'localhost'
  : configuredDbHost;

const pool = new Pool({
  host: effectiveDbHost,
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'postgres',
});

async function cleanAndSeed() {
  const client = await pool.connect();
  try {
    // Limpiar datos (sin borrar tablas ni roles/usuarios)
    console.log('Limpiando datos...');
    const tablesToClean = [
      'item_aprobaciones',
      'aprobaciones',
      'aprobaciones_config',
      'compra_items',
      'detalle_compras',
      'compras',
      'servicio_items',
      'servicios',
      'proveedor_calificaciones',
      'materiales_proveedores',
      'stock',
      'movimiento_detalles',
      'movimientos',
      'detalle_movimientos',
      'detalle_requerimiento',
      'requerimiento_productos',
      'requerimientos',
      'material_categoria',
      'materiales',
      'proveedores',
      'almacenes',
      'categorias',
      'permisos',
      'rol_permiso',
      // No limpiar: roles, usuarios, areas, unidades, monedas
    ];

    for (const table of tablesToClean) {
      try {
        await client.query(`DELETE FROM ${table}`);
        console.log(`✓ ${table} limpiada`);
      } catch (err) {
        // Silenciar errores si la tabla no existe
      }
    }

    console.log('\nInsertando datos de prueba mínimos...');

    // Categorías
    const categorias = [
      'Electrónica',
      'Oficina',
      'Herramientas',
    ];
    for (const cat of categorias) {
      try {
        await client.query(
          'INSERT INTO categorias (nombre, descripcion) VALUES ($1, $2)',
          [cat, cat]
        );
      } catch (err) {
        // Ignorar si ya existe
      }
    }
    console.log('✓ Categorías');

    // Almacén
    try {
      await client.query(
        "INSERT INTO almacenes (nombre, ubicacion) VALUES ($1, $2)",
        ['Almacén Principal', 'Edificio Central']
      );
    } catch (err) {
      // Ya existe
    }
    console.log('✓ Almacén');

    // Proveedores (3 de prueba)
    const providers = [
      { nombre: 'Proveedor A', ruc: '20123456789', correo: 'contacto@proveedora.pe' },
      { nombre: 'Proveedor B', ruc: '20987654321', correo: 'info@proveedorb.pe' },
      { nombre: 'Proveedor C', ruc: '20555666777', correo: 'ventas@proveedorc.pe' },
    ];

    const solesId = await client.query('SELECT id FROM monedas WHERE nombre = $1', ['SOLES']);
    const solesIdVal = solesId.rows[0]?.id || 1;
    const adminAreaId = await client.query('SELECT id FROM areas WHERE nombre = $1', ['ADMINISTRACIÓN']);
    const adminAreaIdVal = adminAreaId.rows[0]?.id || 1;

    const providerIds = [];
    for (const prov of providers) {
      try {
        const res = await client.query(
          `INSERT INTO proveedores (nombre, ruc, correo, id_moneda, id_area_destino)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [prov.nombre, prov.ruc, prov.correo, solesIdVal, adminAreaIdVal]
        );
        if (res.rows.length > 0) {
          providerIds.push(res.rows[0].id);
        }
      } catch (err) {
        // Ya existe
      }
    }
    console.log('✓ Proveedores');

    // Permisos
    const permisosNames = [
      'VER_DASHBOARD',
      'VER_INVENTARIO',
      'EDITAR_INVENTARIO',
      'AGREGAR_INVENTARIO_MANUAL',
      'CREAR_REQUERIMIENTO',
      'CREAR_SOLICITUD_COMPRA',
      'CREAR_SOLICITUD_SERVICIO',
      'CAMBIAR_ESTADO_SERVICIO',
      'APROBAR_JEFE_AREA',
      'APROBAR_GERENCIA_AREA',
      'APROBAR_FINANZAS',
      'APROBAR_ADMIN',
      'APROBAR_SIN_ADMIN_SERVICIOS',
      'CALIFICAR_COMPRA',
      'CALIFICAR_REQUERIMIENTO',
      'GESTIONAR_ENTREGAS',
      'VER_HISTORIAL_SERVICIOS',
      'VER_MOVIMIENTOS',
      'GESTIONAR_PROVEEDORES',
      'VER_AJUSTES',
      'VER_NOTIFICACIONES_PROVEEDOR',
      'GESTIONAR_ROLES',
      'GESTIONAR_CUENTAS',
      'GESTIONAR_COMPRAS',
      'EDITAR_CALIFICACION_PROVEEDOR',
    ];

    for (const perm of permisosNames) {
      try {
        await client.query(
          'INSERT INTO permisos (nombre, descripcion) VALUES ($1, $2)',
          [perm, perm]
        );
      } catch (err) {
        // Ya existe
      }
    }
    console.log('✓ Permisos');

    // Asignar permisos a roles
    const roles = [
      { nombre: 'ADMIN', permisos: permisosNames },
      { nombre: 'COMPRAS', permisos: ['VER_INVENTARIO', 'GESTIONAR_COMPRAS', 'VER_MOVIMIENTOS', 'GESTIONAR_PROVEEDORES'] },
      { nombre: 'ALMACENERO', permisos: ['VER_INVENTARIO', 'GESTIONAR_ENTREGAS', 'VER_MOVIMIENTOS'] },
      { nombre: 'SOLICITANTE', permisos: ['VER_INVENTARIO', 'CREAR_REQUERIMIENTO', 'CREAR_SOLICITUD_COMPRA', 'CREAR_SOLICITUD_SERVICIO'] },
      { nombre: 'JEFE DE AREA/SUBGERENTE', permisos: ['APROBAR_JEFE_AREA', 'VER_INVENTARIO', 'GESTIONAR_COMPRAS'] },
      { nombre: 'GERENCIA DEL AREA', permisos: ['APROBAR_GERENCIA_AREA', 'VER_INVENTARIO', 'GESTIONAR_COMPRAS'] },
      { nombre: 'GERENCIA DE FINANZAS', permisos: ['APROBAR_FINANZAS', 'APROBAR_SIN_ADMIN_SERVICIOS', 'VER_INVENTARIO'] },
    ];

    for (const role of roles) {
      const roleRes = await client.query('SELECT id FROM roles WHERE nombre = $1', [role.nombre]);
      if (roleRes.rows.length === 0) continue;

      const roleId = roleRes.rows[0].id;
      for (const permName of role.permisos) {
        const permRes = await client.query('SELECT id FROM permisos WHERE nombre = $1', [permName]);
        if (permRes.rows.length === 0) continue;

        const permId = permRes.rows[0].id;
        try {
          await client.query(
            'INSERT INTO rol_permiso (id_rol, id_permiso) VALUES ($1, $2)',
            [roleId, permId]
          );
        } catch (err) {
          // Ya existe
        }
      }
    }
    console.log('✓ Permisos por rol');

    // Crear flujos de aprobación dinámicos
    const approvalFlows = [
      { flujo: 'COMPRA', rol: 'JEFE DE AREA/SUBGERENTE', orden: 1 },
      { flujo: 'COMPRA', rol: 'GERENCIA DEL AREA', orden: 2 },
      { flujo: 'COMPRA', rol: 'GERENCIA DE FINANZAS', orden: 3 },
      { flujo: 'COMPRA', rol: 'ADMIN', orden: 4 },
      { flujo: 'SERVICIO_DENTRO_PLAN', rol: 'JEFE DE AREA/SUBGERENTE', orden: 1 },
      { flujo: 'SERVICIO_DENTRO_PLAN', rol: 'GERENCIA DE FINANZAS', orden: 2 },
      { flujo: 'SERVICIO_FUERA_PLAN', rol: 'JEFE DE AREA/SUBGERENTE', orden: 1 },
      { flujo: 'SERVICIO_FUERA_PLAN', rol: 'GERENCIA DEL AREA', orden: 2 },
      { flujo: 'SERVICIO_FUERA_PLAN', rol: 'GERENCIA DE FINANZAS', orden: 3 },
    ];

    for (const flow of approvalFlows) {
      const roleRes = await client.query('SELECT id FROM roles WHERE nombre = $1', [flow.rol]);
      if (roleRes.rows.length === 0) continue;

      const roleId = roleRes.rows[0].id;
      try {
        await client.query(
          'INSERT INTO aprobaciones_config (flujo, rol_id, orden) VALUES ($1, $2, $3)',
          [flow.flujo, roleId, flow.orden]
        );
      } catch (err) {
        // Ya existe
      }
    }
    console.log('✓ Flujos de aprobación dinámicos');

    console.log('\n✓✓✓ Base de datos lista para testing ✓✓✓');
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

cleanAndSeed();
