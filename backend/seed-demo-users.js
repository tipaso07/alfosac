const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

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

const DEMO_PASSWORD = 'Demo123!';

const DEMO_USERS = [
  {
    nombre: 'Administradora Demo',
    email: 'admin.demo@alfosac.pe',
    dni: '10000001',
    rol: 'ADMIN',
    area: 'ADMINISTRACIÓN',
    estado: 'ACTIVO',
  },
  {
    nombre: 'Compras Demo',
    email: 'compras.demo@alfosac.pe',
    dni: '10000002',
    rol: 'COMPRAS',
    area: 'OPERACIONES',
    estado: 'ACTIVO',
  },
  {
    nombre: 'Almacén Demo',
    email: 'almacen.demo@alfosac.pe',
    dni: '10000003',
    rol: 'ALMACENERO',
    area: 'ALMACÉN',
    estado: 'ACTIVO',
  },
  {
    nombre: 'Solicitante Demo',
    email: 'solicitante.demo@alfosac.pe',
    dni: '10000004',
    rol: 'SOLICITANTE',
    area: 'OPERACIONES',
    estado: 'ACTIVO',
  },
  {
    nombre: 'Jefe de Area Demo',
    email: 'jefe.area.demo@alfosac.pe',
    dni: '10000005',
    rol: 'JEFE DE AREA/SUBGERENTE',
    area: 'OPERACIONES',
    estado: 'ACTIVO',
  },
  {
    nombre: 'Gerencia Area Demo',
    email: 'gerencia.area.demo@alfosac.pe',
    dni: '10000006',
    rol: 'GERENCIA DEL AREA',
    area: 'ADMINISTRACIÓN',
    estado: 'ACTIVO',
  },
  {
    nombre: 'Finanzas Demo',
    email: 'finanzas.demo@alfosac.pe',
    dni: '10000007',
    rol: 'GERENCIA DE FINANZAS',
    area: 'ADMINISTRACIÓN',
    estado: 'ACTIVO',
  },
]

async function getIdByName(client, table, name) {
  const result = await client.query(
    `SELECT id FROM ${table} WHERE upper(trim(nombre)) = upper(trim($1)) LIMIT 1`,
    [name]
  )
  return Number(result.rows[0]?.id || 0)
}

async function seedDemoUsers() {
  const client = await pool.connect()
  try {
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10)

    for (const user of DEMO_USERS) {
      const roleId = await getIdByName(client, 'roles', user.rol)
      const areaId = await getIdByName(client, 'areas', user.area)

      if (!roleId) {
        throw new Error(`No se encontro el rol ${user.rol}`)
      }

      const result = await client.query(
        `
          INSERT INTO usuarios (nombre, email, password_hash, dni, id_role, id_area, estado)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (email) DO UPDATE SET
            nombre = EXCLUDED.nombre,
            password_hash = EXCLUDED.password_hash,
            dni = EXCLUDED.dni,
            id_role = EXCLUDED.id_role,
            id_area = EXCLUDED.id_area,
            estado = EXCLUDED.estado,
            updated_at = CURRENT_TIMESTAMP
          RETURNING id, email, nombre
        `,
        [
          user.nombre,
          String(user.email || '').trim().toLowerCase(),
          passwordHash,
          user.dni || null,
          roleId,
          areaId || null,
          user.estado || 'ACTIVO',
        ]
      )

      const row = result.rows[0]
      console.log(`✓ Usuario demo listo: ${row.email} (${user.rol})`)
    }

    console.log(`\nCredencial común para todas las cuentas demo: ${DEMO_PASSWORD}`)
  } finally {
    client.release()
    await pool.end()
  }
}

seedDemoUsers().catch((error) => {
  console.error('Error sembrando usuarios demo:', error.message)
  process.exit(1)
})