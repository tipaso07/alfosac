const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const net = require('net');
require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });
const multer = require('multer');
const { Pool } = require('pg');
const PDFDocument = require('pdfkit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Global error handlers to aid debugging during development
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT_EXCEPTION]', err && err.stack ? err.stack : err);
  // keep process alive for nodemon to restart, but log clearly
});

process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED_REJECTION]', reason && reason.stack ? reason.stack : reason);
});

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));

const companyBlueLogoPath = path.join(__dirname, '..', 'public', 'alfosac-logo-azul.png');
const companyWhiteLogoPath = path.join(__dirname, '..', 'public', 'alfosac-logo-blanco.png');

const getCompanyLogoPath = (background = 'light') => {
  const darkBackground = String(background || '').trim().toLowerCase() === 'dark';
  if (darkBackground && fs.existsSync(companyWhiteLogoPath)) {
    return companyWhiteLogoPath;
  }

  if (fs.existsSync(companyBlueLogoPath)) {
    return companyBlueLogoPath;
  }

  if (fs.existsSync(companyWhiteLogoPath)) {
    return companyWhiteLogoPath;
  }

  return null;
};

const PDF_BRAND_COLORS = {
  primary: '#3b82f6',
  primaryDark: '#1e40af',
  line: '#bfdbfe',
  surface: '#f8fafc',
  sectionHeader: '#e0edff',
  textPrimary: '#1e293b',
  textSecondary: '#64748b',
};

const allowedImageMimeTypes = new Set(['image/jpeg', 'image/png']);

const imageStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (_req, file, cb) => {
    const originalName = String(file.originalname || 'imagen').replace(/[^a-zA-Z0-9._-]/g, '_');
    const ext = path.extname(originalName || '').toLowerCase();
    const safeExt = ext === '.jpg' || ext === '.jpeg' || ext === '.png' ? ext : '.jpg';
    cb(null, `material-${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`);
  },
});

const uploadImage = multer({
  storage: imageStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!allowedImageMimeTypes.has(String(file.mimetype || '').toLowerCase())) {
      cb(new Error('Solo se permiten archivos JPG, JPEG o PNG'));
      return;
    }
    cb(null, true);
  },
});

const configuredDbHost = process.env.DB_HOST || 'localhost';
    const ensureRolesHavePermissionByName = async (client, roleIds = [], permissionName = '') => {
      const normalizedRoleIds = [...new Set((Array.isArray(roleIds) ? roleIds : [])
        .map((value) => Number(value || 0))
        .filter((value) => Number.isInteger(value) && value > 0))];

      if (normalizedRoleIds.length === 0) {
        return;
      }

      const resolved = await resolvePermissionIds(client, [permissionName]);
      const permissionId = Number(resolved.ids[0] || 0);
      if (!permissionId) {
        return;
      }

      for (const roleId of normalizedRoleIds) {
        await client.query(
          `
            INSERT INTO rol_permiso (id_rol, id_permiso)
            VALUES ($1, $2)
            ON CONFLICT (id_rol, id_permiso) DO NOTHING
          `,
          [roleId, permissionId]
        );
      }
    };
const effectiveDbHost = configuredDbHost === 'postgres' && process.platform === 'win32'
  ? 'localhost'
  : configuredDbHost;

const pool = new Pool({
  host: effectiveDbHost,
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'postgres',
});

const SQL_DEBUG_ENABLED = String(process.env.SQL_DEBUG || 'true').toLowerCase() !== 'false';

const compactSql = (value) => String(value || '').replace(/\s+/g, ' ').trim();

const logSqlQuery = (origin, text, values) => {
  if (!SQL_DEBUG_ENABLED) return;
  const sqlText = typeof text === 'string' ? text : (text?.text || '');
  const sqlValues = Array.isArray(values) ? values : (Array.isArray(text?.values) ? text.values : []);
  console.log('[SQL][QUERY]', {
    origin,
    query: compactSql(sqlText),
    values: sqlValues,
  });
};

const ESTADOS = ['PENDIENTE', 'APROBADO', 'RECHAZADO', 'COMPLETADO'];
const PRIORIDADES = ['BAJA', 'MEDIA', 'ALTA'];
const ESTADOS_ENTREGA = ['POR_RECOGER', 'ENTREGADO'];
const ESTADOS_COMPRA = ['PENDIENTE', 'APROBADA', 'POR_RECIBIR', 'PENDIENTE_ENTREGA', 'RECIBIDA', 'ENTREGADO', 'RECHAZADA'];
const ESTADOS_SERVICIO_APROBACION = ['PENDIENTE', 'APROBADO', 'RECHAZADO'];
const ESTADOS_SERVICIO_FLUJO = ['DATOS_COMPLETADOS', 'PENDIENTE', 'REALIZADO'];
const DEFAULT_USER_AVATAR = 'https://ui-avatars.com/api/?name=Usuario&background=e5e7eb&color=111827';
const JWT_SECRET = process.env.JWT_SECRET || 'alfosac-dev-jwt-secret-change-me';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';

const normalize = (v) => String(v || '').trim().toUpperCase();
const normalizeRoleName = (value) => normalize(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ')
  .trim();
const normalizePermissionName = (value) => normalizeRoleName(value)
  .replace(/[^A-Z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '');

const PERMISSION_ALIASES = new Map([
  ['EDITAR_MATERIAL', 'EDITAR_INVENTARIO'],
  ['GESTIONAR_ORDENES_COMPRA', 'GESTIONAR_COMPRAS'],
]);

const canonicalizePermissionName = (value) => {
  const normalized = normalizePermissionName(value);
  return PERMISSION_ALIASES.get(normalized) || normalized;
};

const MANAGER_ROLES = new Set([
  'JEFE DE AREA/SUBGERENTE',
  'GERENCIA DEL AREA',
  'GERENCIA DE FINANZAS',
]);

const isAdminRole = (role) => normalizeRoleName(role) === 'ADMIN';
const isComprasRole = (role) => normalizeRoleName(role) === 'COMPRAS';
const isAlmaceneroRole = (role) => normalizeRoleName(role) === 'ALMACENERO';
const getNormalizedRoles = (roleInput) => {
  if (Array.isArray(roleInput)) {
    return roleInput.map((role) => normalizeRoleName(role)).filter(Boolean);
  }

  return String(roleInput || '')
    .split(',')
    .map((role) => normalizeRoleName(role))
    .filter(Boolean);
};

const hasAnyRole = (roleInput, allowedRoles = []) => {
  const currentRoles = new Set(getNormalizedRoles(roleInput));
  const allowed = allowedRoles.map((role) => normalizeRoleName(role)).filter(Boolean);
  return allowed.some((role) => currentRoles.has(role));
};

const isValidUrlValue = (value) => {
  try {
    const parsed = new URL(String(value || '').trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (_error) {
    return false;
  }
};

const isValidBase64ImageValue = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return false;

  const dataUrlRegex = /^data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+$/;
  if (dataUrlRegex.test(raw)) return true;

  const plainBase64Regex = /^[A-Za-z0-9+/=\s]+$/;
  return plainBase64Regex.test(raw) && raw.replace(/\s+/g, '').length > 80;
};

const isValidPhotoValue = (value) => isValidUrlValue(value) || isValidBase64ImageValue(value);

const canManageRequirementsRole = (role) => hasAnyRole(role, ['ADMIN', ...MANAGER_ROLES]);
const canManagePurchasesRole = (role) => hasAnyRole(role, ['ADMIN', ...MANAGER_ROLES]);
const canManageDeliveryRole = (role) => hasAnyRole(role, ['ADMIN', 'ALMACENERO']);

// Approval role IDs will be resolved from DB at runtime to avoid hardcoded numeric ids.
let APPROVAL_ROLES_BY_LEVEL = [];
let APPROVAL_CHAIN_COMPRA = [];
let APPROVAL_CHAIN_SERVICIO_DENTRO_PLAN = [];
let APPROVAL_CHAIN_SERVICIO_FUERA_PLAN = [];
let approvalsTableAvailableCache = null;

const normalizeApprovalTipo = (value) => normalize(value).replace(/\s+/g, '_');

const getApprovalChainForEntity = ({ tipo, dentroPlan = false, creatorRoleId = 0 } = {}) => {
  const normalizedTipo = normalizeApprovalTipo(tipo);

  if (normalizedTipo === 'COMPRA') {
    return [...APPROVAL_CHAIN_COMPRA];
  }

  if (normalizedTipo === 'SERVICIO') {
    // For servicios, use the configured service chains. Special numeric-role
    // exceptions were removed to avoid dependence on fixed role ids.
    return dentroPlan
      ? [...APPROVAL_CHAIN_SERVICIO_DENTRO_PLAN]
      : [...APPROVAL_CHAIN_SERVICIO_FUERA_PLAN];
  }

  return [];
};

const getApprovalCreationPlanForEntity = ({ tipo, dentroPlan = false, creatorRoleId = 0 } = {}) => {
  const roleChain = getApprovalChainForEntity({ tipo, dentroPlan, creatorRoleId })
    .map((roleId) => Number(roleId || 0))
    .filter((roleId) => Number.isInteger(roleId) && roleId > 0);
  const numericCreatorRoleId = Number(creatorRoleId || 0);
  const creatorIndex = numericCreatorRoleId > 0 ? roleChain.indexOf(numericCreatorRoleId) : -1;
  const firstPendingIndex = creatorIndex >= 0 ? creatorIndex + 1 : 0;

  return {
    roleChain,
    creatorIndex,
    approvedRoleIds: roleChain.slice(0, firstPendingIndex),
    pendingRoleIds: roleChain.slice(firstPendingIndex),
  };
};

const isApprovalHierarchyRoleId = (roleId) => APPROVAL_ROLES_BY_LEVEL.includes(Number(roleId || 0));

// Config for approval roles (canonical names, permission and intermediate state)
// Keys support multiple name variations for robustness (e.g., "JEFE DE AREA" vs "SUBGERENTE")
// New roles added in future will automatically generate PENDIENTE_ROLE_NAME states via generatePendingStateByRoleId()
const APPROVAL_ROLE_CONFIG = [
  { keys: ['JEFE DE AREA', 'JEFE DE AREA/SUBGERENTE', 'JEFE DE AREA SUBGERENTE', 'SUBGERENTE'], permission: 'APROBAR_JEFE_AREA', state: 'PENDIENTE_JEFE_DE_AREA_SUBGERENTE' },
  { keys: ['GERENCIA DEL AREA', 'GERENCIA AREA', 'GERENTE AREA'], permission: 'APROBAR_GERENCIA_AREA', state: 'PENDIENTE_GERENCIA_DEL_AREA' },
  { keys: ['GERENCIA DE FINANZAS', 'GERENCIA FINANZAS', 'GERENTE FINANZAS', 'FINANZAS'], permission: 'APROBAR_FINANZAS', state: 'PENDIENTE_GERENCIA_DE_FINANZAS' },
  { keys: ['ADMIN', 'ADMINISTRADOR', 'ADMINISTRATOR'], permission: 'APROBAR_ADMIN', state: 'PENDIENTE_ADMINISTRADOR' },
];

// Dynamic maps populated by loadApprovalRoleIds()
let APPROVAL_ROLE_ID_BY_NAME = new Map();
let APPROVAL_ROLE_NAME_BY_ID = new Map();
let APPROVAL_PERMISSION_BY_ROLE_ID = new Map();
let APPROVAL_PERMISSION_BY_STATE = new Map();
let APPROVAL_STATE_BY_PERMISSION = new Map();
let INTERMEDIATE_APPROVAL_STATE_BY_ROLE_ID = new Map();

// Initialize static permission/state maps (keys only) — values will be set when role ids are loaded.
for (const cfg of APPROVAL_ROLE_CONFIG) {
  APPROVAL_PERMISSION_BY_STATE.set(cfg.state, cfg.permission);
  APPROVAL_STATE_BY_PERMISSION.set(cfg.permission, cfg.state);
}

// Load role ids from DB and populate the approval mappings. This is invoked once at startup.
const loadApprovalRoleIds = async () => {
  try {
    const res = await pool.query('SELECT id, nombre FROM roles');
    const nameToId = new Map();
    const idToName = new Map();
    res.rows.forEach((r) => {
      const nm = normalizeRoleName(r.nombre || '');
      const roleId = Number(r.id || 0);
      if (nm) nameToId.set(nm, roleId);
      if (roleId > 0 && nm) {
        idToName.set(roleId, nm);
      }
    });

    const resolvedIds = [];
    APPROVAL_ROLE_ID_BY_NAME = new Map();
    APPROVAL_ROLE_NAME_BY_ID = new Map();
    APPROVAL_PERMISSION_BY_ROLE_ID = new Map();
    INTERMEDIATE_APPROVAL_STATE_BY_ROLE_ID = new Map();

    for (const [roleId, roleName] of idToName.entries()) {
      APPROVAL_ROLE_NAME_BY_ID.set(roleId, roleName);
    }

    for (const cfg of APPROVAL_ROLE_CONFIG) {
      let foundId = 0;
      for (const key of cfg.keys) {
        const id = nameToId.get(normalizeRoleName(key));
        if (id) {
          foundId = id;
          break;
        }
      }

      if (foundId) {
        resolvedIds.push(foundId);
        APPROVAL_ROLE_ID_BY_NAME.set(normalizeRoleName(cfg.keys[0]), foundId);
        APPROVAL_ROLE_NAME_BY_ID.set(foundId, normalizeRoleName(cfg.keys[0]));
        APPROVAL_PERMISSION_BY_ROLE_ID.set(foundId, cfg.permission);
        INTERMEDIATE_APPROVAL_STATE_BY_ROLE_ID.set(foundId, cfg.state);
      }
    }

    // Default chains follow the resolved order. Keep behavior consistent with previous hardcoded order.
    APPROVAL_CHAIN_COMPRA = resolvedIds.slice();
    APPROVAL_CHAIN_SERVICIO_DENTRO_PLAN = resolvedIds.slice(0, Math.max(0, resolvedIds.length - 1));
    APPROVAL_CHAIN_SERVICIO_FUERA_PLAN = resolvedIds.slice();
    APPROVAL_ROLES_BY_LEVEL = resolvedIds.slice();

    const configTableResult = await pool.query("SELECT to_regclass('public.aprobaciones_config') IS NOT NULL AS exists");
    const hasConfigTable = Boolean(configTableResult.rows[0]?.exists);

    if (hasConfigTable) {
      const configRows = await pool.query(
        `
          SELECT upper(trim(flujo)) AS flujo, orden, rol_id
          FROM aprobaciones_config
          WHERE activo = TRUE
          ORDER BY upper(trim(flujo)), orden ASC, id ASC
        `
      );

      const chainByFlow = new Map();
      configRows.rows.forEach((row) => {
        const flow = String(row.flujo || '').trim().toUpperCase();
        const roleId = Number(row.rol_id || 0);
        if (!flow || !Number.isInteger(roleId) || roleId <= 0) return;

        if (!chainByFlow.has(flow)) {
          chainByFlow.set(flow, []);
        }

        chainByFlow.get(flow).push(roleId);
      });

      if (chainByFlow.has('COMPRA') && chainByFlow.get('COMPRA').length > 0) {
        APPROVAL_CHAIN_COMPRA = chainByFlow.get('COMPRA').slice();
      }

      if (chainByFlow.has('SERVICIO_DENTRO_PLAN') && chainByFlow.get('SERVICIO_DENTRO_PLAN').length > 0) {
        APPROVAL_CHAIN_SERVICIO_DENTRO_PLAN = chainByFlow.get('SERVICIO_DENTRO_PLAN').slice();
      }

      if (chainByFlow.has('SERVICIO_FUERA_PLAN') && chainByFlow.get('SERVICIO_FUERA_PLAN').length > 0) {
        APPROVAL_CHAIN_SERVICIO_FUERA_PLAN = chainByFlow.get('SERVICIO_FUERA_PLAN').slice();
      }

      // Update APPROVAL_ROLES_BY_LEVEL with all unique roles from all approval chains
      const allRolesInChains = new Set();
      [APPROVAL_CHAIN_COMPRA, APPROVAL_CHAIN_SERVICIO_DENTRO_PLAN, APPROVAL_CHAIN_SERVICIO_FUERA_PLAN].forEach(chain => {
        chain.forEach(roleId => allRolesInChains.add(roleId));
      });
      APPROVAL_ROLES_BY_LEVEL = Array.from(allRolesInChains);
    }
  } catch (error) {
    console.error('[INIT] Error loading approval role ids:', error && error.message ? error.message : error);
  }
};

// Ensure core permissions and descriptions exist (moved out of loadApprovalRoleIds)
const ensureCoreApprovalPermissions = async () => {
  const client = await pool.connect();
  try {
    const permisosDescriptionColumn = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name='permisos' AND column_name='descripcion'");

    const allPermissions = [
      ['APROBAR_SIN_ADMIN_SERVICIOS', 'Permite finalizar aprobación de servicios sin pasar por administración.'],
      ['CALIFICAR_COMPRA', 'Permite calificar entregas vinculadas al flujo de compra.'],
      ['CALIFICAR_REQUERIMIENTO', 'Permite calificar entregas vinculadas al flujo de requerimiento.'],
      ['GESTIONAR_SOLICITUDES', 'Permite ver órdenes de compra, servicios y requerimientos en Mi Órdenes.'],
      ['GESTIONAR_ENTREGAS', 'Permite registrar y controlar entregas.'],
      ['VER_HISTORIAL_SERVICIOS', 'Permite acceder al historial de servicios.'],
      ['VER_MOVIMIENTOS', 'Habilita el modulo de Movimientos en el menu lateral.'],
      ['GESTIONAR_PROVEEDORES', 'Permite crear, editar y administrar proveedores.'],
      ['VER_AJUSTES', 'Permite acceder a la pantalla de ajustes del usuario.'],
      ['VER_NOTIFICACIONES_PROVEEDOR', 'Permite ver alertas de proveedores con calificación baja.'],
      ['GESTIONAR_ROLES', 'Permite crear roles y administrar sus permisos.'],
      ['GESTIONAR_CUENTAS', 'Permite ver, crear, editar y eliminar cuentas de usuario.'],
      ['GESTIONAR_COMPRAS', 'Puede gestionar compras'],
      ['EDITAR_CALIFICACION_PROVEEDOR', 'Permite editar calificaciones de proveedores'],
    ];

    if (permisosDescriptionColumn.rows.length > 0) {
      const valuesList = allPermissions.map(([nombre, desc]) => `('${nombre.replace(/'/g, "''")}', '${desc.replace(/'/g, "''")}')`).join(',');
      await client.query(
        `
          INSERT INTO permisos (nombre, descripcion)
          SELECT values_to_insert.nombre, values_to_insert.descripcion
          FROM (
            VALUES ${valuesList}
          ) AS values_to_insert(nombre, descripcion)
          WHERE NOT EXISTS (
            SELECT 1
            FROM permisos p
            WHERE upper(trim(p.nombre)) = upper(trim(values_to_insert.nombre))
          )
        `
      );
    } else {
      const valuesList = allPermissions.map(([nombre]) => `('${nombre.replace(/'/g, "''")}')`).join(',');
      await client.query(
        `
          INSERT INTO permisos (nombre)
          SELECT values_to_insert.nombre
          FROM (
            VALUES ${valuesList}
          ) AS values_to_insert(nombre)
          WHERE NOT EXISTS (
            SELECT 1
            FROM permisos p
            WHERE upper(trim(p.nombre)) = upper(trim(values_to_insert.nombre))
          )
        `
      );
    }

    client.release();
  } catch (err) {
    try { client.release(); } catch (e) {}
    throw err;
  }
};

// Assign default permissions to roles based on role name
const ensureDefaultRolePermissions = async () => {
  try {
    // Ensure permisos exist first
    await ensureCoreApprovalPermissions();

    // Define default permissions for each role type
    const rolePermissions = {
      'ADMIN': [
        'VER_DASHBOARD', 'VER_INVENTARIO', 'EDITAR_INVENTARIO', 'AGREGAR_INVENTARIO_MANUAL',
        'CREAR_REQUERIMIENTO', 'CREAR_SOLICITUD_COMPRA', 'CREAR_SOLICITUD_SERVICIO',
        'CAMBIAR_ESTADO_SERVICIO', 'APROBAR_JEFE_AREA', 'APROBAR_GERENCIA_AREA',
        'APROBAR_FINANZAS', 'APROBAR_ADMIN', 'CALIFICAR_COMPRA', 'CALIFICAR_REQUERIMIENTO',
        'GESTIONAR_ENTREGAS', 'VER_HISTORIAL_SERVICIOS', 'VER_MOVIMIENTOS',
        'GESTIONAR_PROVEEDORES', 'VER_AJUSTES', 'VER_NOTIFICACIONES_PROVEEDOR',
        'GESTIONAR_ROLES', 'GESTIONAR_CUENTAS', 'GESTIONAR_SOLICITUDES', 'GESTIONAR_COMPRAS', 'EDITAR_CALIFICACION_PROVEEDOR',
      ],
      'JEFE DE AREA/SUBGERENTE': ['APROBAR_JEFE_AREA', 'VER_INVENTARIO', 'GESTIONAR_SOLICITUDES', 'GESTIONAR_COMPRAS'],
      'GERENCIA DEL AREA': ['APROBAR_GERENCIA_AREA', 'VER_INVENTARIO', 'GESTIONAR_SOLICITUDES', 'GESTIONAR_COMPRAS'],
      'GERENCIA DE FINANZAS': ['APROBAR_FINANZAS', 'APROBAR_SIN_ADMIN_SERVICIOS', 'VER_INVENTARIO'],
      'COMPRAS': ['VER_INVENTARIO', 'GESTIONAR_SOLICITUDES', 'GESTIONAR_COMPRAS', 'VER_MOVIMIENTOS', 'GESTIONAR_PROVEEDORES'],
      'ALMACENERO': ['VER_INVENTARIO', 'GESTIONAR_ENTREGAS', 'VER_MOVIMIENTOS', 'GESTIONAR_SOLICITUDES'],
      'SOLICITANTE': ['VER_INVENTARIO', 'CREAR_REQUERIMIENTO', 'CREAR_SOLICITUD_COMPRA', 'CREAR_SOLICITUD_SERVICIO', 'GESTIONAR_SOLICITUDES'],
    };

    for (const [roleName, permisoNames] of Object.entries(rolePermissions)) {
      const roleResult = await pool.query(
        'SELECT id FROM roles WHERE upper(trim(nombre)) = upper(trim($1)) LIMIT 1',
        [roleName]
      );

      if (roleResult.rows.length === 0) continue;
      const roleId = Number(roleResult.rows[0].id);

      for (const permisoName of permisoNames) {
        const permisoResult = await pool.query(
          'SELECT id FROM permisos WHERE upper(trim(nombre)) = upper(trim($1)) LIMIT 1',
          [permisoName]
        );

        if (permisoResult.rows.length === 0) continue;
        const permisoId = Number(permisoResult.rows[0].id);

        // Insert if not exists
        await pool.query(
          `
            INSERT INTO rol_permiso (id_rol, id_permiso)
            VALUES ($1, $2)
            ON CONFLICT (id_rol, id_permiso) DO NOTHING
          `,
          [roleId, permisoId]
        );
      }
    }

    console.log('[INIT] Default role permissions assigned');
  } catch (err) {
    console.error('[INIT] Failed to assign default role permissions:', err && err.message ? err.message : err);
  }
};

// Trigger loading but don't block module evaluation; server logic uses these maps in async flows.
(async () => {
  await ensureDefaultRolePermissions();
  await loadApprovalRoleIds();
})().catch((e) => console.error('[INIT] Startup initialization error:', e));


let APPROVAL_PENDING_STATES = new Set([
  'PENDIENTE',
  'PENDIENTE_JEFE_AREA',
  'PENDIENTE_JEFE_DE_AREA_SUBGERENTE',
  'PENDIENTE_GERENCIA',
  'PENDIENTE_GERENCIA_DEL_AREA',
  'PENDIENTE_FINANZAS',
  'PENDIENTE_GERENCIA_DE_FINANZAS',
  'PENDIENTE_ADMIN',
  'PENDIENTE_ADMINISTRADOR',
]);

const getApprovalRoleLabel = (roleId, roleName = '') => {
  const numericRoleId = Number(roleId || 0);
  const explicitName = String(roleName || '').trim();
  if (explicitName) {
    return explicitName;
  }

  const mapped = String(APPROVAL_ROLE_NAME_BY_ID.get(numericRoleId) || '').trim();
  if (mapped) {
    // human-friendly capitalization
    return mapped
      .toLowerCase()
      .split(/\s+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ')
      .replace(/\//g, '/');
  }

  return numericRoleId > 0 ? `Rol ${numericRoleId}` : '';
};

const parseBooleanFlag = (value, defaultValue = false) => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value === 1;
  }

  const normalizedValue = normalize(value);
  if (['1', 'TRUE', 'VERDADERO', 'SI', 'S', 'YES', 'Y'].includes(normalizedValue)) {
    return true;
  }

  if (['0', 'FALSE', 'FALSO', 'NO', 'N'].includes(normalizedValue)) {
    return false;
  }

  return Boolean(defaultValue);
};

const tienePermiso = (usuario, permiso) => {
  const normalizedPermission = canonicalizePermissionName(permiso);
  if (!normalizedPermission) return false;

  const hasDirectPermissions = Array.isArray(usuario?.permisos);
  const directPermissions = hasDirectPermissions ? usuario.permisos : [];
  const permissions = directPermissions;

  return permissions.some((item) => canonicalizePermissionName(item) === normalizedPermission);
};

const getRequiredApprovalPermissionByRoleId = (roleId) => {
  const numericRoleId = Number(roleId || 0);
  return String(APPROVAL_PERMISSION_BY_ROLE_ID.get(numericRoleId) || '').trim().toUpperCase();
};

const getApprovalPermissionByState = (state) => {
  const normalizedState = normalize(state);
  if (APPROVAL_PERMISSION_BY_STATE.has(normalizedState)) {
    return APPROVAL_PERMISSION_BY_STATE.get(normalizedState);
  }

  return '';
};

const getApprovalStateByPermission = (permission) => {
  const normalizedPermission = normalize(permission);
  if (APPROVAL_STATE_BY_PERMISSION.has(normalizedPermission)) {
    return APPROVAL_STATE_BY_PERMISSION.get(normalizedPermission);
  }

  return '';
};

const getApprovalRoleIdByPermission = (permission) => {
  const normalizedPermission = normalize(permission);
  for (const [roleId, perm] of APPROVAL_PERMISSION_BY_ROLE_ID.entries()) {
    if (normalize(perm) === normalizedPermission) return Number(roleId || 0);
  }
  return 0;
};

const normalizeApprovalState = (state) => {
  const normalizedState = normalize(state);
  if (normalizedState === 'APROBADA') return 'APROBADO';
  if (normalizedState === 'RECHAZADA') return 'RECHAZADO';
  return normalizedState;
};

const getAllowedPendingApprovalStatesForRole = (roleId, tipo = '') => {
  const normalizedTipo = normalizeApprovalTipo(tipo);
  const role = Number(roleId || 0);
  const states = new Set();
  if (!role) {
    return [];
  }

  const canonical = normalizeApprovalState(generatePendingStateByRoleId(role));
  if (canonical) states.add(canonical);

  const legacy = normalizeApprovalState(getIntermediateApprovalStateByRoleId(role));
  if (legacy) states.add(legacy);

  if (normalizedTipo === 'COMPRA') {
    states.add('PENDIENTE');
  }

  return [...states];
};

const isPendingStateForRole = (state, roleId, tipo = '') => {
  const normalizedState = normalizeApprovalState(state);
  return getAllowedPendingApprovalStatesForRole(roleId, tipo).includes(normalizedState);
};

const isPendingServiceApprovalState = (state) => {
  const normalizedState = normalizeApprovalState(state);
  return normalizedState.startsWith('PENDIENTE_');
};

const isPendingApprovalState = (state) => APPROVAL_PENDING_STATES.has(normalizeApprovalState(state));

const getApprovalStagePermissionForUser = (usuario) => {
  const roleId = resolveApprovalRoleId(usuario);
  if (roleId > 0) {
    const roleState = getIntermediateApprovalStateByRoleId(roleId);
    if (roleState) {
      return roleState;
    }

    const rolePermission = getRequiredApprovalPermissionByRoleId(roleId);
    if (rolePermission) {
      return rolePermission;
    }
  }

  const rolePriority = [...APPROVAL_ROLES_BY_LEVEL].reverse();
  for (const roleId of rolePriority) {
    const permission = getRequiredApprovalPermissionByRoleId(roleId);
    if (permission && tienePermiso(usuario, permission)) {
      return permission;
    }
  }
  return '';
};

const getApprovalStageStateForUser = (usuario) => {
  const roleId = resolveApprovalRoleId(usuario);
  if (roleId > 0) {
    const roleState = getIntermediateApprovalStateByRoleId(roleId);
    if (roleState) {
      return roleState;
    }
  }

  return getApprovalStateByPermission(getApprovalStagePermissionForUser(usuario));
};

const getNextApprovalState = ({ tipo, currentState, dentroPlan }) => {
  const normalizedState = normalizeApprovalState(currentState);
  const chain = getApprovalChainForEntity({ tipo, dentroPlan });
  if (chain.length === 0) {
    return {
      permission: '',
      state: normalizedState,
    };
  }

  if (normalizedState === 'PENDIENTE') {
    const firstRoleId = Number(chain[0] || 0);
    return {
      permission: getRequiredApprovalPermissionByRoleId(firstRoleId),
      state: getIntermediateApprovalStateByRoleId(firstRoleId) || 'APROBADO',
    };
  }

  const currentIdx = chain.findIndex((roleId) => getIntermediateApprovalStateByRoleId(roleId) === normalizedState);
  if (currentIdx >= 0) {
    const currentRoleId = Number(chain[currentIdx] || 0);
    const nextRoleId = Number(chain[currentIdx + 1] || 0);
    return {
      permission: getRequiredApprovalPermissionByRoleId(currentRoleId),
      state: nextRoleId ? generatePendingStateByRoleId(nextRoleId) : 'APROBADO',
    };
  }

  return {
    permission: '',
    state: normalizedState,
  };
};

const aprobarEntidad = async (usuario, tipo, id, decision = 'APROBADO', options = {}) => {
  const normalizedTipo = normalize(tipo);
  const referenceId = Number(id || 0);
  const normalizedDecision = normalize(decision) === 'RECHAZADO' ? 'RECHAZADO' : 'APROBADO';
  const optionDentroPlan = options?.dentro_plan !== undefined ? parseBooleanFlag(options.dentro_plan, true) : null;

  if (!['COMPRA', 'SERVICIO'].includes(normalizedTipo)) {
    throw new Error('Tipo de entidad invalido');
  }

  if (!referenceId) {
    throw new Error('ID de entidad invalido');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const hasTable = await hasAprobacionesTable(client);
    if (!hasTable) {
      throw new Error('La tabla de aprobaciones no esta disponible');
    }

    const entityConfig = normalizedTipo === 'COMPRA'
      ? {
        tableName: 'compras',
        stateColumn: 'estado',
        selectQuery: `SELECT id, upper(trim(COALESCE(estado, 'PENDIENTE'))) AS estado, FALSE AS dentro_plan FROM compras WHERE id = $1 FOR UPDATE`,
        updateQuery: 'UPDATE compras SET estado = $1, fecha_actualizacion = NOW() WHERE id = $2',
      }
      : {
        tableName: 'servicios',
        stateColumn: getServicioApprovalColumn(),
        selectQuery: `
          SELECT
            id,
            upper(trim(COALESCE(to_jsonb(s)->>'estado_aprobacion', to_jsonb(s)->>'estado', 'PENDIENTE'))) AS estado,
            CASE
              WHEN lower(trim(COALESCE(to_jsonb(s)->>'dentro_plan', to_jsonb(s)->>'en_plan', 'true'))) IN ('true', 't', '1', 'si', 'yes', 'y') THEN TRUE
              ELSE FALSE
            END AS dentro_plan
          FROM servicios s
          WHERE id = $1
          FOR UPDATE
        `,
        updateQuery: '',
      };

    const entityResult = await client.query(entityConfig.selectQuery, [referenceId]);
    if (entityResult.rows.length === 0) {
      throw new Error('Entidad no encontrada');
    }

    const entityRow = entityResult.rows[0];
    const estadoAnterior = normalizeApprovalState(entityRow.estado);
    const dentroPlan = Boolean(entityRow.dentro_plan);

    if (estadoAnterior === 'APROBADO') {
      throw new Error('Ya esta aprobado');
    }

    if (!APPROVAL_PENDING_STATES.has(estadoAnterior)) {
      throw new Error('La entidad no se encuentra en una etapa aprobable');
    }

    const actorRoleId = Number(usuario?.id_role || usuario?.rol_id || resolveApprovalRoleId(usuario) || 0);
    if (!actorRoleId) {
      throw new Error('No se pudo resolver el rol aprobador del usuario');
    }

    const approvalRow = await client.query(
      `
        SELECT id, orden, upper(trim(COALESCE(estado, 'PENDIENTE'))) AS estado
        FROM aprobaciones
        WHERE upper(trim(tipo)) = $1
          AND referencia_id = $2
          AND rol_aprobador = $3
        ORDER BY orden ASC
        LIMIT 1
        FOR UPDATE
      `,
      [normalizedTipo, referenceId, actorRoleId]
    );

    if (approvalRow.rows.length === 0) {
      throw new Error('No existe una aprobacion pendiente para esta etapa');
    }

    const currentApproval = approvalRow.rows[0];
    if (normalize(currentApproval.estado) === 'APROBADO') {
      throw new Error('Esta etapa ya fue aprobada');
    }

    if (!isPendingStateForRole(currentApproval.estado, actorRoleId, normalizedTipo)) {
      throw new Error('La etapa actual no esta pendiente');
    }

    const previousApprovals = await client.query(
      `
        SELECT orden, upper(trim(COALESCE(estado, 'PENDIENTE'))) AS estado
        FROM aprobaciones
        WHERE upper(trim(tipo)) = $1
          AND referencia_id = $2
          AND orden < $3
        ORDER BY orden ASC
      `,
      [normalizedTipo, referenceId, Number(currentApproval.orden || 0)]
    );

    const previousBlocked = previousApprovals.rows.some((row) => normalize(row.estado) !== 'APROBADO');
    if (previousBlocked) {
      throw new Error('No se puede aprobar: aun hay niveles anteriores sin aprobar');
    }

    const isFirstApprovalStage = Number(currentApproval.orden || 0) === 1;
    if (
      normalizedTipo === 'SERVICIO'
      && normalizedDecision !== 'RECHAZADO'
      && isFirstApprovalStage
      && optionDentroPlan === null
    ) {
      throw new Error('Debes indicar si el servicio esta dentro del plan antes de aprobar');
    }

    let estadoNuevo = 'RECHAZADO';
    if (normalizedDecision !== 'RECHAZADO') {
      const nextPendingRow = await client.query(
        `
          SELECT rol_aprobador
          FROM aprobaciones
          WHERE upper(trim(tipo)) = $1
            AND referencia_id = $2
            AND orden > $3
            AND upper(trim(COALESCE(estado, 'PENDIENTE'))) LIKE 'PENDIENTE%'
          ORDER BY orden ASC
          LIMIT 1
        `,
        [normalizedTipo, referenceId, Number(currentApproval.orden || 0)]
      );

      if (nextPendingRow.rows.length === 0) {
        estadoNuevo = 'APROBADO';
      } else {
        const nextRoleId = Number(nextPendingRow.rows[0].rol_aprobador || 0);
        estadoNuevo = generatePendingStateByRoleId(nextRoleId);
      }
    }

    const actorId = Number(usuario?.id || 0) || null;
    await client.query(
      `
        UPDATE aprobaciones
        SET estado = $1,
            usuario_id = $2,
            fecha = NOW()
        WHERE id = $3
          AND upper(trim(COALESCE(estado, 'PENDIENTE'))) = 'PENDIENTE'
      `,
      [normalizedDecision, actorId, Number(currentApproval.id)]
    );

    if (normalizedTipo === 'COMPRA') {
      await client.query(
        'UPDATE compras SET estado = $1, fecha_actualizacion = NOW() WHERE id = $2',
        [estadoNuevo, referenceId]
      );
    } else {
      const serviceStateColumn = getServicioApprovalColumn();
      const dentroPlanColumn = getServicioDentroPlanColumn();
      
      // Si es la primera aprobación (orden = 1) y se recibió decisión de dentro_plan
      if (isFirstApprovalStage && optionDentroPlan !== null) {
        // Obtener estado actual de dentro_plan
        const currentState = await client.query(
          `SELECT ${dentroPlanColumn ? quoteIdentifier(dentroPlanColumn) : 'CAST(TRUE AS BOOLEAN)'} AS dentro_plan_actual FROM servicios WHERE id = $1`,
          [referenceId]
        );
        const currentDentroPlan = dentroPlanColumn && currentState.rows[0] 
          ? Boolean(currentState.rows[0].dentro_plan_actual)
          : true;

        // Si cambió la decisión, recrear las aprobaciones
        if (currentDentroPlan !== optionDentroPlan) {
          // Eliminar aprobaciones futuras (pendientes después de la actual)
          await client.query(
            `
              DELETE FROM aprobaciones
              WHERE upper(trim(tipo)) = $1
                AND referencia_id = $2
                AND orden > $3
                AND upper(trim(COALESCE(estado, 'PENDIENTE'))) = 'PENDIENTE'
            `,
            [normalizedTipo, referenceId, Number(currentApproval.orden || 0)]
          );

          // Obtener la nueva cadena de aprobaciones
          const newChain = getApprovalChainForEntity({
            tipo: normalizedTipo,
            dentroPlan: optionDentroPlan,
            creatorRoleId: 0,
          });

          // Recrear las aprobaciones futuras basadas en la nueva cadena
          const currentOrder = Number(currentApproval.orden || 0);
          for (let i = currentOrder; i < newChain.length; i++) {
            const roleId = Number(newChain[i] || 0);
            if (roleId > 0 && roleId !== Number(currentApproval.rol_aprobador || 0)) {
              await client.query(
                `
                  INSERT INTO aprobaciones (tipo, referencia_id, orden, rol_aprobador, estado)
                  VALUES ($1, $2, $3, $4, $5)
                `,
                [normalizedTipo, referenceId, i + 1, roleId, generatePendingStateByRoleId(roleId)]
              );
            }
          }
        }

        // Actualizar el campo dentro_plan en servicios
        if (dentroPlanColumn) {
          await client.query(
            `UPDATE servicios SET ${quoteIdentifier(dentroPlanColumn)} = $1 WHERE id = $2`,
            [optionDentroPlan, referenceId]
          );
        }

        // Recalcular la siguiente etapa pendiente en caso la cadena haya cambiado,
        // de modo que `estadoNuevo` refleje la nueva cadena de aprobaciones.
        const recomputeNextPending = await client.query(
        `
          SELECT rol_aprobador
          FROM aprobaciones
          WHERE upper(trim(tipo)) = $1
            AND referencia_id = $2
            AND orden > $3
            AND upper(trim(COALESCE(estado, 'PENDIENTE'))) LIKE 'PENDIENTE%'
          ORDER BY orden ASC
          LIMIT 1
        `,
        [normalizedTipo, referenceId, Number(currentApproval.orden || 0)]
        );

        if (recomputeNextPending.rows.length === 0) {
          estadoNuevo = 'APROBADO';
        } else {
          const nextRoleId = Number(recomputeNextPending.rows[0].rol_aprobador || 0);
          estadoNuevo = generatePendingStateByRoleId(nextRoleId);
        }
      }

      // Actualizar el estado de aprobación
      await client.query(
        `UPDATE servicios SET ${quoteIdentifier(serviceStateColumn)} = $1 WHERE id = $2`,
        [estadoNuevo, referenceId]
      );

      // Si la aprobación llegó al estado final (APROBADO), cambiar estado_flujo a APROBADO
      // para que aparezca en "Mis órdenes" en la sección de completar datos
      if (estadoNuevo === 'APROBADO') {
        const statusColumn = getServicioStatusColumn();
        await client.query(
          `UPDATE servicios SET ${quoteIdentifier(statusColumn)} = 'APROBADO' WHERE id = $1`,
          [referenceId]
        );
      }
    }

    await client.query('COMMIT');

    return {
      ok: true,
      estado_anterior: estadoAnterior,
      estado_nuevo: estadoNuevo,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const resolveApprovalRoleIdByPermissions = (user) => {
  const hasDirectPermissions = Array.isArray(user?.permisos);
  const directPermissions = hasDirectPermissions ? user.permisos : [];
  const permissionSet = new Set(directPermissions
    .map((perm) => String(perm || '').trim().toUpperCase())
    .filter(Boolean));

  const rolePriority = [...APPROVAL_ROLES_BY_LEVEL].reverse();
  for (const approvalRoleId of rolePriority) {
    const requiredPermission = getRequiredApprovalPermissionByRoleId(approvalRoleId);
    if (requiredPermission && permissionSet.has(requiredPermission)) {
      return approvalRoleId;
    }
  }

  return 0;
};

const getIntermediateApprovalStateByRoleId = (roleId) => {
  const numericRoleId = Number(roleId || 0);
  return String(INTERMEDIATE_APPROVAL_STATE_BY_ROLE_ID.get(numericRoleId) || '').trim().toUpperCase();
};

// Generate a descriptive PENDING state name for any role (configured or future).
// First checks INTERMEDIATE_APPROVAL_STATE_BY_ROLE_ID for explicitly mapped states.
// Falls back to auto-generating from role name for future roles (e.g., "PENDIENTE_NUEVO_ROL").
const generatePendingStateByRoleId = (roleId) => {
  const numericRoleId = Number(roleId || 0);
  
  // Try to use explicitly configured state (e.g., "PENDIENTE_JEFE_AREA", "PENDIENTE_FINANZAS")
  const mapped = String(INTERMEDIATE_APPROVAL_STATE_BY_ROLE_ID.get(numericRoleId) || '').trim().toUpperCase();
  if (mapped) {
    return mapped;
  }
  
  // Auto-generate from role name for future roles without explicit mapping
  const roleLabel = getApprovalRoleLabel(numericRoleId);
  if (roleLabel && roleLabel !== `Rol ${numericRoleId}`) {
    // Convert role label to state name: "JEFE DE AREA" → "PENDIENTE_JEFE_DE_AREA"
    const stateKey = normalize(roleLabel)
      .replace(/\s+/g, '_')
      .replace(/[^A-Z0-9_]/g, '');
    return `PENDIENTE_${stateKey}`;
  }
  
  // Final fallback: always use PENDIENTE_ROL_N format (never bare 'PENDIENTE')
  return `PENDIENTE_ROL_${numericRoleId}`;
};

const getInitialApprovalStateForEntity = ({ tipo, dentroPlan = false, creatorRoleId = 0 } = {}) => {
  const approvalPlan = getApprovalCreationPlanForEntity({ tipo, dentroPlan, creatorRoleId });
  if (approvalPlan.pendingRoleIds.length === 0) {
    return 'APROBADO';
  }

  const firstPendingRole = Number(approvalPlan.pendingRoleIds[0] || 0);
  return generatePendingStateByRoleId(firstPendingRole);
};

const getApprovalStageKeyByRoleId = (roleId) => {
  const intermediateState = getIntermediateApprovalStateByRoleId(roleId);
  if (intermediateState.startsWith('PENDIENTE_')) {
    return intermediateState.replace(/^PENDIENTE_/, '');
  }

  const fallback = normalize(getApprovalRoleLabel(roleId));
  if (!fallback) return '';

  return fallback
    .replace(/\s+/g, '_')
    .replace(/[^A-Z0-9_]/g, '');
};

const buildPdfApprovalEntries = ({ approvals = [], creatorUserId = 0, creatorRoleId = 0, creatorName = '' } = {}) => {
  const ordered = Array.isArray(approvals)
    ? approvals
      .map((row) => ({
        orden: Number(row.orden || 0),
        rol_aprobador: Number(row.rol_aprobador || 0),
        rol: String(row.rol || '').trim(),
        etapa: String(row.etapa || getApprovalStageKeyByRoleId(row.rol_aprobador)).trim(),
        aprobador: String(row.aprobador || '').trim(),
        usuario_id: Number(row.usuario_id || 0) || null,
        fecha: row.fecha || null,
      }))
      .filter((row) => row.aprobador || row.rol_aprobador > 0)
    : [];

  const creatorId = Number(creatorUserId || 0);
  const numericCreatorRoleId = Number(creatorRoleId || 0);
  const creatorLabel = String(creatorName || '').trim();

  if (creatorId > 0 && creatorLabel && isApprovalHierarchyRoleId(numericCreatorRoleId)) {
    const creatorAlreadyIncluded = ordered.some((row) => Number(row.usuario_id || 0) === creatorId || Number(row.rol_aprobador || 0) === numericCreatorRoleId);
    if (!creatorAlreadyIncluded) {
      ordered.unshift({
        orden: numericCreatorRoleId,
        rol_aprobador: numericCreatorRoleId,
        rol: getApprovalRoleLabel(numericCreatorRoleId),
        etapa: getApprovalStageKeyByRoleId(numericCreatorRoleId),
        aprobador: creatorLabel,
        usuario_id: creatorId,
        fecha: null,
      });
    }
  }

  const deduped = [];
  const seen = new Set();
  ordered
    .sort((a, b) => Number(a.orden || 0) - Number(b.orden || 0) || Number(a.rol_aprobador || 0) - Number(b.rol_aprobador || 0))
    .forEach((row) => {
      const key = `${Number(row.usuario_id || 0)}:${Number(row.rol_aprobador || 0)}:${String(row.aprobador || '').toLowerCase()}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      deduped.push(row);
    });

  return deduped;
};

const parseReceiptInfo = (value) => {
  const text = String(value || '').trim();
  const match = text.match(/^(.*?)(?:\s*-\s*DNI\s*(.+))?$/i);
  const nombre = String(match?.[1] || '').trim();
  const dni = String(match?.[2] || '').trim();
  return {
    nombre: nombre || text,
    dni,
  };
};

const resolveApprovalRoleId = (user) => {
  const numericRoleId = Number(user?.id_role || user?.rol_id || 0);
  if (isApprovalHierarchyRoleId(numericRoleId)) {
    return numericRoleId;
  }

  const roleByPermission = resolveApprovalRoleIdByPermissions(user);
  if (roleByPermission > 0) {
    return roleByPermission;
  }

  if (APPROVAL_ROLES_BY_LEVEL.includes(numericRoleId)) {
    return numericRoleId;
  }

  const normalizedRoles = getNormalizedRoles(user?.rol);
  for (const roleName of normalizedRoles) {
    const mapped = Number(APPROVAL_ROLE_ID_BY_NAME.get(roleName) || 0);
    if (isApprovalHierarchyRoleId(mapped)) {
      return mapped;
    }
  }

  return 0;
};

const hashPassword = async (plainPassword) => {
  if (!plainPassword) return '';
  const cleaned = String(plainPassword).trim();
  if (!cleaned) return '';
  return bcrypt.hash(cleaned, 10);
};

const isStrongPassword = (value) => {
  const password = String(value || '');
  const hasMinLength = password.length > 8;
  const hasUppercase = /[A-Z]/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);
  return hasMinLength && hasUppercase && hasSpecial;
};

const hasAprobacionesTable = async (client = pool) => {
  if (approvalsTableAvailableCache === true) {
    return true;
  }

  const result = await client.query("SELECT to_regclass('public.aprobaciones') IS NOT NULL AS exists");
  const tableExists = Boolean(result.rows[0]?.exists);

  if (tableExists) {
    approvalsTableAvailableCache = true;
  }

  return tableExists;
};

const hasAprobacionesConfigTable = async (client = pool) => {
  const result = await client.query("SELECT to_regclass('public.aprobaciones_config') IS NOT NULL AS exists");
  return Boolean(result.rows[0]?.exists);
};

const APPROVAL_FLOW_KEYS = new Set(['COMPRA', 'SERVICIO_DENTRO_PLAN', 'SERVICIO_FUERA_PLAN']);

const fetchApprovalFlowConfig = async (client = pool) => {
  const hasConfig = await hasAprobacionesConfigTable(client);
  if (!hasConfig) {
    return [];
  }

  const result = await client.query(
    `
      SELECT
        upper(trim(ac.flujo)) AS flujo,
        ac.orden,
        ac.rol_id,
        COALESCE(r.nombre, '') AS rol_nombre
      FROM aprobaciones_config ac
      LEFT JOIN roles r ON r.id = ac.rol_id
      WHERE ac.activo = TRUE
      ORDER BY upper(trim(ac.flujo)), ac.orden ASC, ac.id ASC
    `
  );

  return result.rows;
};

const replaceApprovalFlowConfig = async (client, { flujo, roleIds = [] } = {}) => {
  const normalizedFlow = String(flujo || '').trim().toUpperCase();
  if (!APPROVAL_FLOW_KEYS.has(normalizedFlow)) {
    throw new Error('Flujo de aprobación inválido');
  }

  const normalizedRoleIds = [...new Set((Array.isArray(roleIds) ? roleIds : [])
    .map((value) => Number(value || 0))
    .filter((value) => Number.isInteger(value) && value > 0))];

  if (normalizedRoleIds.length === 0) {
    throw new Error('Debes enviar al menos un rol para el flujo');
  }

  await client.query('DELETE FROM aprobaciones_config WHERE upper(trim(flujo)) = $1', [normalizedFlow]);

  for (let idx = 0; idx < normalizedRoleIds.length; idx += 1) {
    await client.query(
      `
        INSERT INTO aprobaciones_config (flujo, orden, rol_id, activo)
        VALUES ($1, $2, $3, TRUE)
      `,
      [normalizedFlow, idx + 1, normalizedRoleIds[idx]]
    );
  }
};

const fetchPendingApprovalReferenceIdsByRole = async (client, {
  tipo,
  roleId,
}) => {
  const tableExists = await hasAprobacionesTable(client);
  if (!tableExists) {
    return [];
  }

  const normalizedTipo = normalizeApprovalTipo(tipo);
  const role = Number(roleId || 0);
  if (!role) {
    return [];
  }

  const pendingStates = getAllowedPendingApprovalStatesForRole(role, normalizedTipo);
  if (pendingStates.length === 0) {
    return [];
  }

  const result = await client.query(
    `
      SELECT DISTINCT a.referencia_id
      FROM aprobaciones a
      WHERE upper(trim(a.tipo)) = $1
        AND a.rol_aprobador = $2
        AND upper(trim(COALESCE(a.estado, 'PENDIENTE'))) = ANY($3::text[])
        AND NOT EXISTS (
          SELECT 1
          FROM aprobaciones prev
          WHERE upper(trim(prev.tipo)) = upper(trim(a.tipo))
            AND prev.referencia_id = a.referencia_id
            AND prev.orden < a.orden
            AND upper(trim(COALESCE(prev.estado, 'PENDIENTE'))) <> 'APROBADO'
        )
      ORDER BY a.referencia_id DESC
    `,
    [normalizedTipo, role, pendingStates]
  );

  return result.rows
    .map((row) => Number(row.referencia_id || 0))
    .filter((value) => Number.isInteger(value) && value > 0);
};

const fetchManagedApprovalStatesByUser = async (client, {
  tipo,
  roleId,
  userId,
}) => {
  const tableExists = await hasAprobacionesTable(client);
  if (!tableExists) {
    return new Map();
  }

  const normalizedTipo = normalizeApprovalTipo(tipo);
  const role = Number(roleId || 0);
  const actor = Number(userId || 0);
  if (!role || !actor) {
    return new Map();
  }

  const result = await client.query(
    `
      SELECT
        a.referencia_id,
        upper(trim(COALESCE(a.estado, 'PENDIENTE'))) AS estado
      FROM aprobaciones a
      WHERE upper(trim(a.tipo)) = $1
        AND a.rol_aprobador = $2
        AND a.usuario_id = $3
        AND upper(trim(COALESCE(a.estado, 'PENDIENTE'))) IN ('APROBADO', 'RECHAZADO')
      ORDER BY a.fecha DESC NULLS LAST, a.id DESC
    `,
    [normalizedTipo, role, actor]
  );

  const managed = new Map();
  result.rows.forEach((row) => {
    const referenceId = Number(row.referencia_id || 0);
    if (!Number.isInteger(referenceId) || referenceId <= 0 || managed.has(referenceId)) {
      return;
    }

    managed.set(referenceId, String(row.estado || ''));
  });

  return managed;
};

const fetchFinalApprovedReferenceIdsByRole = async (client, {
  tipo,
  roleId,
}) => {
  const tableExists = await hasAprobacionesTable(client);
  if (!tableExists) {
    return [];
  }

  const normalizedTipo = normalizeApprovalTipo(tipo);
  const role = Number(roleId || 0);
  if (!role) {
    return [];
  }

  const result = await client.query(
    `
      SELECT DISTINCT a.referencia_id
      FROM aprobaciones a
      WHERE upper(trim(a.tipo)) = $1
        AND a.rol_aprobador = $2
        AND upper(trim(COALESCE(a.estado, 'PENDIENTE'))) = 'APROBADO'
        AND NOT EXISTS (
          SELECT 1
          FROM aprobaciones pending
          WHERE upper(trim(pending.tipo)) = upper(trim(a.tipo))
            AND pending.referencia_id = a.referencia_id
            AND upper(trim(COALESCE(pending.estado, 'PENDIENTE'))) = 'PENDIENTE'
        )
      ORDER BY a.referencia_id DESC
    `,
    [normalizedTipo, role]
  );

  return result.rows
    .map((row) => Number(row.referencia_id || 0))
    .filter((value) => Number.isInteger(value) && value > 0);
};

const hasFinalApprovalByRole = async (client, {
  tipo,
  referenciaId,
  roleId,
}) => {
  const tableExists = await hasAprobacionesTable(client);
  if (!tableExists) {
    return false;
  }

  const normalizedTipo = normalizeApprovalTipo(tipo);
  const reference = Number(referenciaId || 0);
  const role = Number(roleId || 0);
  if (!reference || !role) {
    return false;
  }

  const result = await client.query(
    `
      SELECT 1
      FROM aprobaciones a
      WHERE upper(trim(a.tipo)) = $1
        AND a.referencia_id = $2
        AND a.rol_aprobador = $3
        AND upper(trim(COALESCE(a.estado, 'PENDIENTE'))) = 'APROBADO'
      LIMIT 1
    `,
    [normalizedTipo, reference, role]
  );

  return result.rows.length > 0;
};

// Considera aprobacion final efectiva para casos autoaprobados por rol 7
// (creador de la solicitud) donde no necesariamente existe fila en aprobaciones.
const hasEffectiveFinalApprovalByRole = async (client, {
  tipo,
  referenciaId,
  roleId,
}) => {
  const explicitFinal = await hasFinalApprovalByRole(client, {
    tipo,
    referenciaId,
    roleId,
  });

  if (explicitFinal) {
    return true;
  }

  const finalRole = Number(roleId || 0);
  const reference = Number(referenciaId || 0);
  const normalizedTipo = normalizeApprovalTipo(tipo);

  const finanzasId = Number(APPROVAL_ROLE_ID_BY_NAME.get(normalizeRoleName('GERENCIA DE FINANZAS')) || 0);
  if (!finanzasId || finalRole !== finanzasId || !reference) {
    return false;
  }

  if (normalizedTipo === 'COMPRA') {
    const autoApproved = await client.query(
      `
        SELECT 1
        FROM compras c
        JOIN usuarios u ON u.id = c.id_usuario
        WHERE c.id = $1
          AND ${getUserRoleIdExpr('u')} = ${finanzasId}
          AND upper(trim(COALESCE(to_jsonb(c)->>'estado', ''))) IN ('APROBADA', 'POR_RECIBIR', 'RECIBIDA', 'RECIBIDO', 'ENTREGADO')
          AND NOT EXISTS (
            SELECT 1
            FROM aprobaciones a
            WHERE upper(trim(a.tipo)) = 'COMPRA'
              AND a.referencia_id = c.id
          )
        LIMIT 1
      `,
      [reference]
    );

    return autoApproved.rows.length > 0;
  }

  if (normalizedTipo === 'SERVICIO') {
    const autoApproved = await client.query(
      `
        SELECT 1
        FROM servicios s
        JOIN usuarios u ON u.id = NULLIF(COALESCE(to_jsonb(s)->>'id_usuario', to_jsonb(s)->>'usuario_id', ''), '')::int
        WHERE s.id = $1
          AND ${getUserRoleIdExpr('u')} = ${finanzasId}
          AND upper(trim(COALESCE(to_jsonb(s)->>'estado_aprobacion', to_jsonb(s)->>'estado', ''))) = 'APROBADO'
          AND NOT EXISTS (
            SELECT 1
            FROM aprobaciones a
            WHERE upper(trim(a.tipo)) = 'SERVICIO'
              AND a.referencia_id = s.id
          )
        LIMIT 1
      `,
      [reference]
    );

    return autoApproved.rows.length > 0;
  }

  return false;
};

// Flujo jerarquico: para mostrar estados tipo "Pendiente aprobacion rol X"
// resolvemos el siguiente aprobador pendiente habilitado por orden.
const fetchNextPendingApprovalRoleByReferences = async (client, {
  tipo,
  referenceIds,
}) => {
  const tableExists = await hasAprobacionesTable(client);
  const ids = Array.isArray(referenceIds)
    ? referenceIds.map((value) => Number(value || 0)).filter((value) => Number.isInteger(value) && value > 0)
    : [];

  if (!tableExists || ids.length === 0) {
    return new Map();
  }

  const normalizedTipo = normalizeApprovalTipo(tipo);
  const result = await client.query(
    `
      SELECT DISTINCT ON (a.referencia_id)
        a.referencia_id,
        a.rol_aprobador
      FROM aprobaciones a
      WHERE upper(trim(a.tipo)) = $1
        AND a.referencia_id = ANY($2::int[])
        AND upper(trim(COALESCE(a.estado, 'PENDIENTE'))) = 'PENDIENTE'
        AND NOT EXISTS (
          SELECT 1
          FROM aprobaciones prev
          WHERE upper(trim(prev.tipo)) = upper(trim(a.tipo))
            AND prev.referencia_id = a.referencia_id
            AND prev.orden < a.orden
            AND upper(trim(COALESCE(prev.estado, 'PENDIENTE'))) <> 'APROBADO'
        )
      ORDER BY a.referencia_id, a.orden ASC
    `,
    [normalizedTipo, ids]
  );

  const nextByRef = new Map();
  result.rows.forEach((row) => {
    const refId = Number(row.referencia_id || 0);
    const roleId = Number(row.rol_aprobador || 0);
    if (refId > 0 && roleId > 0) {
      nextByRef.set(refId, roleId);
    }
  });

  return nextByRef;
};

const buildApprovalStatusLabel = ({
  currentStatus,
  nextPendingRole,
}) => {
  const normalizedCurrentStatus = normalizeApprovalState(currentStatus);
  if (APPROVAL_PENDING_STATES.has(normalizedCurrentStatus)) {
    return normalizedCurrentStatus;
  }

  const pendingRole = Number(nextPendingRole || 0);
  if (pendingRole > 0) {
    const mappedPendingState = getIntermediateApprovalStateByRoleId(pendingRole);
    if (mappedPendingState) {
      return mappedPendingState;
    }

    // Generate state from role ID instead of generic 'PENDIENTE'
    return generatePendingStateByRoleId(pendingRole);
  }

  const statusNorm = normalizedCurrentStatus;
  if (['APROBADA', 'APROBADO', 'POR_RECIBIR', 'RECIBIDA', 'RECIBIDO', 'ENTREGADO', 'REALIZADO', 'DATOS_COMPLETADOS'].includes(statusNorm)) {
    return 'APROBADO';
  }

  if (['RECHAZADA', 'RECHAZADO'].includes(statusNorm)) {
    return 'RECHAZADO';
  }

  return 'PENDIENTE';
};

const fetchAutoApprovedByCreatorRoleIds = async (client, {
  tipo,
  creatorRoleId,
  creatorUserId,
}) => {
  const roleId = Number(creatorRoleId || 0);
  const creatorId = Number(creatorUserId || 0);
  if (!roleId) {
    return [];
  }

  const normalizedTipo = normalizeApprovalTipo(tipo);

  if (normalizedTipo === 'COMPRA') {
    const params = [roleId, normalizedTipo];
    const ownerFilter = creatorId > 0 ? ' AND c.id_usuario = $3' : '';
    if (creatorId > 0) {
      params.push(creatorId);
    }

    const rows = await client.query(
      `
        SELECT c.id
        FROM compras c
        JOIN usuarios u ON u.id = c.id_usuario
        WHERE ${getUserRoleIdExpr('u')} = $1
          ${ownerFilter}
          AND upper(trim(COALESCE(to_jsonb(c)->>'estado', ''))) IN ('APROBADA', 'POR_RECIBIR', 'RECIBIDA', 'RECIBIDO', 'ENTREGADO')
          AND NOT EXISTS (
            SELECT 1
            FROM aprobaciones a
            WHERE upper(trim(a.tipo)) = $2
              AND a.referencia_id = c.id
          )
        ORDER BY c.id DESC
      `,
      params
    );

    return rows.rows
      .map((row) => Number(row.id || 0))
      .filter((value) => Number.isInteger(value) && value > 0);
  }

  if (normalizedTipo === 'SERVICIO') {
    const params = [roleId, normalizedTipo];
    const ownerFilter = creatorId > 0
      ? " AND NULLIF(COALESCE(to_jsonb(s)->>'id_usuario', to_jsonb(s)->>'usuario_id', ''), '')::int = $3"
      : '';
    if (creatorId > 0) {
      params.push(creatorId);
    }

    const rows = await client.query(
      `
        SELECT s.id
        FROM servicios s
        JOIN usuarios u ON u.id = NULLIF(COALESCE(to_jsonb(s)->>'id_usuario', to_jsonb(s)->>'usuario_id', ''), '')::int
        WHERE ${getUserRoleIdExpr('u')} = $1
          ${ownerFilter}
          AND upper(trim(COALESCE(to_jsonb(s)->>'estado_aprobacion', to_jsonb(s)->>'estado', ''))) = 'APROBADO'
          AND NOT EXISTS (
            SELECT 1
            FROM aprobaciones a
            WHERE upper(trim(a.tipo)) = $2
              AND a.referencia_id = s.id
          )
        ORDER BY s.id DESC
      `,
      params
    );

    return rows.rows
      .map((row) => Number(row.id || 0))
      .filter((value) => Number.isInteger(value) && value > 0);
  }

  return [];
};

const fetchOwnCreatedByRoleIds = async (client, {
  tipo,
  creatorRoleId,
  creatorUserId,
}) => {
  const roleId = Number(creatorRoleId || 0);
  const userId = Number(creatorUserId || 0);
  if (!roleId || !userId) {
    return [];
  }

  const normalizedTipo = normalizeApprovalTipo(tipo);

  if (normalizedTipo === 'COMPRA') {
    const rows = await client.query(
      `
        SELECT c.id
        FROM compras c
        JOIN usuarios u ON u.id = c.id_usuario
        WHERE c.id_usuario = $1
          AND ${getUserRoleIdExpr('u')} = $2
          AND upper(trim(COALESCE(to_jsonb(c)->>'estado', 'PENDIENTE'))) <> 'RECHAZADA'
        ORDER BY c.id DESC
      `,
      [userId, roleId]
    );

    return rows.rows
      .map((row) => Number(row.id || 0))
      .filter((value) => Number.isInteger(value) && value > 0);
  }

  if (normalizedTipo === 'SERVICIO') {
    const rows = await client.query(
      `
        SELECT s.id
        FROM servicios s
        JOIN usuarios u ON u.id = NULLIF(COALESCE(to_jsonb(s)->>'id_usuario', to_jsonb(s)->>'usuario_id', ''), '')::int
        WHERE u.id = $1
          AND ${getUserRoleIdExpr('u')} = $2
          AND upper(trim(COALESCE(to_jsonb(s)->>'estado_aprobacion', to_jsonb(s)->>'estado', 'PENDIENTE'))) <> 'RECHAZADO'
        ORDER BY s.id DESC
      `,
      [userId, roleId]
    );

    return rows.rows
      .map((row) => Number(row.id || 0))
      .filter((value) => Number.isInteger(value) && value > 0);
  }

  return [];
};

const isComprasOperatorUser = (user) => {
  // Prefer role-name or permission checks instead of hardcoded numeric ids.
  return isAdminRole(user?.rol) || isComprasRole(user?.rol) || tienePermiso(user, 'GESTIONAR_COMPRAS');
};

const canViewMyOrdersModule = (user) => {
  return tienePermiso(user, 'GESTIONAR_SOLICITUDES') || tienePermiso(user, 'GESTIONAR_COMPRAS');
};

const createApprovalRowsForEntity = async (client, {
  tipo,
  referenciaId,
  dentroPlan = false,
  creatorRoleId = 0,
  creatorUserId = 0,
}) => {
  const tableExists = await hasAprobacionesTable(client);
  if (!tableExists) {
    return { usesApprovalTable: false, autoApproved: false };
  }

  const normalizedTipo = normalizeApprovalTipo(tipo);
  const reference = Number(referenciaId || 0);
  const approvalPlan = getApprovalCreationPlanForEntity({ tipo: normalizedTipo, dentroPlan, creatorRoleId });
  const creatorId = Number(creatorUserId || 0) || null;

  if (!reference) {
    throw new Error('referencia_id invalido para crear aprobaciones');
  }

  if (approvalPlan.roleChain.length === 0) {
    throw new Error(`No se pudo resolver la cadena de aprobaciones para tipo ${normalizedTipo}`);
  }

  await client.query('DELETE FROM aprobaciones WHERE upper(trim(tipo)) = $1 AND referencia_id = $2', [normalizedTipo, reference]);

  for (let idx = 0; idx < approvalPlan.roleChain.length; idx += 1) {
    const roleId = approvalPlan.roleChain[idx];
    const isAutoApproved = idx <= approvalPlan.creatorIndex;
    await client.query(
      `
        INSERT INTO aprobaciones (tipo, referencia_id, orden, rol_aprobador, estado, usuario_id, fecha)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        normalizedTipo,
        reference,
        idx + 1,
        roleId,
        isAutoApproved ? 'APROBADO' : generatePendingStateByRoleId(roleId),
        isAutoApproved ? creatorId : null,
        isAutoApproved ? new Date() : null,
      ]
    );
  }

  return { usesApprovalTable: true, autoApproved: approvalPlan.pendingRoleIds.length === 0 };
};

const fetchActionableApprovalReferenceIds = async (client, {
  tipo,
  roleId,
  referenceIds,
}) => {
  const tableExists = await hasAprobacionesTable(client);
  if (!tableExists) {
    return new Set();
  }

  const normalizedTipo = normalizeApprovalTipo(tipo);
  const role = Number(roleId || 0);
  const ids = Array.isArray(referenceIds)
    ? referenceIds.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0)
    : [];

  if (!role || ids.length === 0) {
    return new Set();
  }

  const pendingStates = getAllowedPendingApprovalStatesForRole(role, normalizedTipo);
  if (pendingStates.length === 0) {
    return new Set();
  }

  const result = await client.query(
    `
      SELECT DISTINCT a.referencia_id
      FROM aprobaciones a
      WHERE upper(trim(a.tipo)) = $1
        AND a.rol_aprobador = $2
        AND upper(trim(COALESCE(a.estado, 'PENDIENTE'))) = ANY($4::text[])
        AND a.referencia_id = ANY($3::int[])
        AND NOT EXISTS (
          SELECT 1
          FROM aprobaciones prev
          WHERE upper(trim(prev.tipo)) = upper(trim(a.tipo))
            AND prev.referencia_id = a.referencia_id
            AND prev.orden < a.orden
            AND upper(trim(COALESCE(prev.estado, 'PENDIENTE'))) <> 'APROBADO'
        )
    `,
    [normalizedTipo, role, ids, pendingStates]
  );

  return new Set(result.rows.map((row) => Number(row.referencia_id)).filter((value) => Number.isInteger(value) && value > 0));
};

const applyApprovalDecision = async (client, {
  tipo,
  referenciaId,
  roleId,
  userId,
  user,
  decision,
}) => {
  const tableExists = await hasAprobacionesTable(client);
  if (!tableExists) {
    return {
      usesApprovalTable: false,
      finalApproved: normalize(decision) === 'APROBADO',
      rejected: normalize(decision) === 'RECHAZADO',
      hasPendingApprovals: false,
    };
  }

  const normalizedTipo = normalizeApprovalTipo(tipo);
  const reference = Number(referenciaId || 0);
  const role = Number(roleId || 0);
  const actor = Number(userId || 0);
  const normalizedDecision = normalize(decision);
  const requiredPermission = getRequiredApprovalPermissionByRoleId(role);

  if (!['APROBADO', 'RECHAZADO'].includes(normalizedDecision)) {
    throw new Error('decision de aprobacion invalida');
  }

  if (!requiredPermission) {
    throw new Error('No existe un permiso de aprobacion configurado para este rol');
  }

  if (!tienePermiso(user, requiredPermission)) {
    throw new Error(`No tienes permiso para aprobar en este nivel (${requiredPermission})`);
  }

  const stageRowsResult = await client.query(
    `
      SELECT id, orden, upper(trim(COALESCE(estado, 'PENDIENTE'))) AS estado
      FROM aprobaciones
      WHERE upper(trim(tipo)) = $1
        AND referencia_id = $2
        AND rol_aprobador = $3
      ORDER BY orden ASC
      FOR UPDATE
    `,
    [normalizedTipo, reference, role]
  );

  if (stageRowsResult.rows.length === 0) {
    throw new Error('No existe etapa de aprobacion configurada para este nivel y registro');
  }

  const pendingRows = stageRowsResult.rows.filter((row) => normalize(row.estado) === 'PENDIENTE');
  if (pendingRows.length === 0) {
    const managedState = normalize(stageRowsResult.rows[0]?.estado || 'GESTIONADO');
    const stageName = getApprovalStageKeyByRoleId(role) || `ROL_${role}`;
    throw new Error(`La etapa ${stageName} ya fue gestionada (${managedState})`);
  }

  if (pendingRows.length > 1) {
    throw new Error('Inconsistencia de flujo: existe mas de una etapa pendiente para el mismo nivel');
  }

  const targetApproval = pendingRows[0];

  const blockedByPrevious = await client.query(
    `
      SELECT 1
      FROM aprobaciones prev
      WHERE upper(trim(prev.tipo)) = $1
        AND prev.referencia_id = $2
        AND prev.orden < $3
        AND upper(trim(COALESCE(prev.estado, 'PENDIENTE'))) <> 'APROBADO'
      LIMIT 1
    `,
    [normalizedTipo, reference, Number(targetApproval.orden || 0)]
  );

  if (blockedByPrevious.rows.length > 0) {
    throw new Error('Aun hay niveles anteriores sin aprobar');
  }

  const updateDecision = await client.query(
    `
      UPDATE aprobaciones
      SET estado = $1,
          usuario_id = $2,
          fecha = NOW()
      WHERE id = $3
        AND upper(trim(COALESCE(estado, 'PENDIENTE'))) = 'PENDIENTE'
      RETURNING id
    `,
    [normalizedDecision, actor || null, Number(targetApproval.id)]
  );

  if (updateDecision.rows.length === 0) {
    const stageName = getApprovalStageKeyByRoleId(role) || `ROL_${role}`;
    throw new Error(`La etapa ${stageName} ya fue gestionada por otro usuario`);
  }

  if (normalizedDecision === 'APROBADO') {
    await registrarAprobacion(client, usuario, normalizedTipo === 'COMPRA' ? 'compra' : 'servicio', referenceId, estadoAnterior);
  }

  const remainingPending = await client.query(
    `
      SELECT COUNT(*) AS total
      FROM aprobaciones
      WHERE upper(trim(tipo)) = $1
        AND referencia_id = $2
        AND upper(trim(COALESCE(estado, 'PENDIENTE'))) = 'PENDIENTE'
    `,
    [normalizedTipo, reference]
  );

  const pendingCount = Number(remainingPending.rows[0]?.total || 0);

  return {
    usesApprovalTable: true,
    finalApproved: normalizedDecision === 'APROBADO' && pendingCount === 0,
    rejected: normalizedDecision === 'RECHAZADO',
    hasPendingApprovals: pendingCount > 0,
  };
};

const fetchApprovedApproversByEntity = async (client, { tipo, referenciaId }) => {
  const tableExists = await hasAprobacionesTable(client);

  const normalizedTipo = normalizeApprovalTipo(tipo);
  const reference = Number(referenciaId || 0);
  if (!reference) {
    return [];
  }

  const approvalComments = await fetchApprovalCommentsByEntity(client, { tipo: normalizedTipo, referenciaId: reference });
  if (approvalComments.length > 0) {
    return approvalComments.map((row, index) => ({
      orden: Number(row.orden || index + 1),
      rol_aprobador: getApprovalRoleIdByPermission(getApprovalPermissionByState(`PENDIENTE_${String(row.etapa || '').toUpperCase()}`)) || 0,
      etapa: String(row.etapa || '').trim().toUpperCase(),
      aprobador: String(row.usuario || '').trim() || 'Usuario',
      usuario_id: Number(row.usuario_id || 0) || null,
      fecha: row.fecha || null,
      rol: String(row.etapa || '').trim().toUpperCase(),
    }));
  }

  if (!tableExists) {
    return [];
  }

  const rows = await client.query(
    `
      SELECT
        a.orden,
        a.rol_aprobador,
        a.usuario_id,
        COALESCE(u.nombre, '') AS aprobador,
        COALESCE(r.nombre, '') AS rol,
        a.fecha
      FROM aprobaciones a
      LEFT JOIN usuarios u ON u.id = a.usuario_id
      LEFT JOIN roles r ON r.id = a.rol_aprobador
      WHERE upper(trim(a.tipo)) = $1
        AND a.referencia_id = $2
        AND upper(trim(COALESCE(a.estado, 'PENDIENTE'))) = 'APROBADO'
      ORDER BY a.orden ASC
    `,
    [normalizedTipo, reference]
  );

  if (rows.rows.length === 0 && normalizedTipo === 'COMPRA') {
    const finanzasId = Number(APPROVAL_ROLE_ID_BY_NAME.get(normalizeRoleName('GERENCIA DE FINANZAS')) || 0);
    if (finanzasId) {
      const fallback = await client.query(
        `
          SELECT
            1 AS orden,
            ${getUserRoleIdExpr('u')} AS rol_aprobador,
            COALESCE(u.nombre, '') AS aprobador,
            COALESCE(r.nombre, 'ROL ${finanzasId}') AS rol,
            COALESCE(c.fecha_actualizacion, c.fecha_creacion, NOW()) AS fecha
          FROM compras c
          JOIN usuarios u ON u.id = c.id_usuario
          LEFT JOIN roles r ON r.id = ${getUserRoleIdExpr('u')}
          WHERE c.id = $1
            AND ${getUserRoleIdExpr('u')} = ${finanzasId}
            AND upper(trim(COALESCE(to_jsonb(c)->>'estado', ''))) IN ('APROBADA', 'POR_RECIBIR', 'RECIBIDA', 'RECIBIDO', 'ENTREGADO')
            AND NOT EXISTS (
              SELECT 1
              FROM aprobaciones a
              WHERE upper(trim(a.tipo)) = $2
                AND a.referencia_id = c.id
            )
          LIMIT 1
        `,
        [reference, normalizedTipo]
      );

      if (fallback.rows.length > 0) {
        return fallback.rows.map((row) => ({
          orden: Number(row.orden || 0),
          rol_aprobador: Number(row.rol_aprobador || 0),
          rol: row.rol || '',
          etapa: getApprovalStageKeyByRoleId(row.rol_aprobador),
          aprobador: row.aprobador || '',
          usuario_id: Number(row.usuario_id || 0) || null,
          fecha: row.fecha || null,
        }));
      }
    }
  }

  if (rows.rows.length === 0 && normalizedTipo === 'SERVICIO') {
    const finanzasId = Number(APPROVAL_ROLE_ID_BY_NAME.get(normalizeRoleName('GERENCIA DE FINANZAS')) || 0);
    if (finanzasId) {
      const fallback = await client.query(
        `
          SELECT
            1 AS orden,
            ${getUserRoleIdExpr('u')} AS rol_aprobador,
            COALESCE(u.nombre, '') AS aprobador,
            COALESCE(r.nombre, 'ROL ${finanzasId}') AS rol,
            COALESCE(NULLIF(to_jsonb(s)->>'fecha_creacion', '')::timestamp, NULLIF(to_jsonb(s)->>'created_at', '')::timestamp, NOW()) AS fecha
          FROM servicios s
          JOIN usuarios u ON u.id = NULLIF(COALESCE(to_jsonb(s)->>'id_usuario', to_jsonb(s)->>'usuario_id', ''), '')::int
          LEFT JOIN roles r ON r.id = ${getUserRoleIdExpr('u')}
          WHERE s.id = $1
            AND ${getUserRoleIdExpr('u')} = ${finanzasId}
            AND upper(trim(COALESCE(to_jsonb(s)->>'estado_aprobacion', to_jsonb(s)->>'estado', ''))) = 'APROBADO'
            AND NOT EXISTS (
              SELECT 1
              FROM aprobaciones a
              WHERE upper(trim(a.tipo)) = $2
                AND a.referencia_id = s.id
            )
          LIMIT 1
        `,
        [reference, normalizedTipo]
      );

      if (fallback.rows.length > 0) {
        return fallback.rows.map((row) => ({
          orden: Number(row.orden || 0),
          rol_aprobador: Number(row.rol_aprobador || 0),
          rol: row.rol || '',
          etapa: getApprovalStageKeyByRoleId(row.rol_aprobador),
          aprobador: row.aprobador || '',
          usuario_id: Number(row.usuario_id || 0) || null,
          fecha: row.fecha || null,
        }));
      }
    }
  }

  return rows.rows.map((row) => ({
    orden: Number(row.orden || 0),
    rol_aprobador: Number(row.rol_aprobador || 0),
    rol: row.rol || '',
    etapa: getApprovalStageKeyByRoleId(row.rol_aprobador),
    aprobador: row.aprobador || '',
    usuario_id: Number(row.usuario_id || 0) || null,
    fecha: row.fecha || null,
  }));
};

const fetchApprovalHistoryByEntity = async (client, { tipo, referenciaId }) => {
  const normalizedTipo = normalizeApprovalTipo(tipo);
  const reference = Number(referenciaId || 0);
  if (!reference) {
    return [];
  }

  const approvalComments = await fetchApprovalCommentsByEntity(client, { tipo: normalizedTipo, referenciaId: reference });
  if (approvalComments.length > 0) {
    return approvalComments.map((row, index) => ({
      orden: Number(row.orden || index + 1),
      etapa: String(row.etapa || '').trim().toUpperCase(),
      estado: 'APROBADO',
      usuario_id: Number(row.usuario_id || 0) || null,
      aprobador: String(row.usuario || '').trim() || 'Usuario',
      fecha: row.fecha || null,
    }));
  }

  const tableExists = await hasAprobacionesTable(client);
  if (!tableExists) {
    return [];
  }

  const result = await client.query(
    `
      SELECT
        a.orden,
        a.rol_aprobador,
        upper(trim(COALESCE(a.estado, 'PENDIENTE'))) AS estado,
        a.usuario_id,
        COALESCE(u.nombre, '') AS aprobador,
        COALESCE(r.nombre, '') AS rol,
        a.fecha
      FROM aprobaciones a
      LEFT JOIN usuarios u ON u.id = a.usuario_id
      LEFT JOIN roles r ON r.id = a.rol_aprobador
      WHERE upper(trim(a.tipo)) = $1
        AND a.referencia_id = $2
        AND upper(trim(COALESCE(a.estado, 'PENDIENTE'))) <> 'PENDIENTE'
      ORDER BY a.orden ASC, a.fecha ASC NULLS LAST
    `,
    [normalizedTipo, reference]
  );

  return result.rows.map((row) => ({
    orden: Number(row.orden || 0),
    rol_aprobador: Number(row.rol_aprobador || 0),
    rol: String(row.rol || '').trim(),
    etapa: getApprovalStageKeyByRoleId(row.rol_aprobador),
    estado: normalize(row.estado || ''),
    usuario_id: Number(row.usuario_id || 0) || null,
    aprobador: String(row.aprobador || '').trim(),
    fecha: row.fecha || null,
  }));
};

const mapApprovalDecisionErrorToHttp = (error) => {
  const message = normalize(error?.message || '');

  if (!message) {
    return { status: 500, expose: false };
  }

  if (message.includes('NO TIENES PERMISO') || message.includes('NO AUTORIZADO')) {
    return { status: 403, expose: true };
  }

  if (message.includes('INCONSISTENCIA DE FLUJO')
    || message.includes('YA FUE GESTIONADA')
    || message.includes('NIVELES ANTERIORES')
    || message.includes('NO TIENES UNA APROBACION PENDIENTE')) {
    return { status: 409, expose: true };
  }

  if (message.includes('DECISION DE APROBACION INVALIDA')
    || message.includes('NO EXISTE ETAPA DE APROBACION')
    || message.includes('NO EXISTE UN PERMISO DE APROBACION')) {
    return { status: 400, expose: true };
  }

  return { status: 500, expose: false };
};

const RECEIPT_NOTE_PREFIX = '[[RECIBIDO_POR:';
const ITEM_CATEGORY_NOTE_PREFIX = '[[ITEM_CATEGORIAS:';
const AREA_DELIVERY_NOTE_PREFIX = '[[ENTREGA_AREA:';
const COMMENT_THREAD_NOTE_PREFIX = '[[COMENTARIOS_HIST:';

const normalizeItemCategoryKey = (value) => String(value || '').trim().toLowerCase();

const parseEmbeddedCommentsFromText = (value) => {
  const text = String(value || '').trim();
  const match = text.match(/\n?\[\[COMENTARIOS_HIST:([A-Za-z0-9+/=]+)\]\]\s*$/s);
  if (!match) {
    return { text, comments: [] };
  }

  let comments = [];
  try {
    const decoded = Buffer.from(String(match[1] || ''), 'base64').toString('utf8');
    const parsed = JSON.parse(decoded);
    if (Array.isArray(parsed)) {
      comments = parsed
        .filter((item) => item && typeof item === 'object')
        .map((item) => ({
          usuario_id: Number(item.usuario_id || 0) || null,
          usuario: String(item.usuario || '').trim(),
          fecha: String(item.fecha || '').trim(),
          contenido: String(item.contenido || '').trim(),
        }))
        .filter((item) => item.contenido);
    }
  } catch (_) {
    comments = [];
  }

  const cleanText = text.slice(0, match.index || 0).trim();
  return { text: cleanText, comments };
};

const buildTextWithEmbeddedComments = ({ text = '', comments = [] } = {}) => {
  const baseText = String(text || '').trim();
  const safeComments = Array.isArray(comments)
    ? comments
      .filter((item) => item && typeof item === 'object' && String(item.contenido || '').trim())
      .map((item) => ({
        usuario_id: Number(item.usuario_id || 0) || null,
        usuario: String(item.usuario || '').trim(),
        fecha: String(item.fecha || '').trim(),
        contenido: String(item.contenido || '').trim(),
      }))
    : [];

  if (safeComments.length === 0) {
    return baseText;
  }

  const encoded = Buffer.from(JSON.stringify(safeComments), 'utf8').toString('base64');
  return `${baseText}${baseText ? '\n' : ''}${COMMENT_THREAD_NOTE_PREFIX}${encoded}]]`;
};

const buildCommentEntry = ({ user, content }) => ({
  usuario_id: Number(user?.id || 0) || null,
  usuario: String(user?.nombre || user?.username || user?.email || 'Usuario').trim(),
  fecha: new Date().toISOString(),
  contenido: String(content || '').trim(),
});

const normalizeCommentEntityType = (value) => String(value || '').trim().toLowerCase();

const fetchCommentsForEntities = async (db, { tipoEntidad, entityIds = [] } = {}) => {
  const normalizedType = normalizeCommentEntityType(tipoEntidad);
  const ids = [...new Set((Array.isArray(entityIds) ? entityIds : [])
    .map((id) => Number(id || 0))
    .filter((id) => Number.isInteger(id) && id > 0))];

  if (!normalizedType || ids.length === 0) {
    return new Map();
  }

  const result = await db.query(
    `
      SELECT
        c.id,
        c.id_entidad,
        c.id_usuario,
        COALESCE(u.nombre, 'Usuario') AS usuario,
        COALESCE(NULLIF(trim(COALESCE(to_jsonb(u)->>'foto', to_jsonb(u)->>'imagen', '')), ''), '') AS usuario_foto,
        c.contenido,
        c.fecha
      FROM comentarios c
      LEFT JOIN usuarios u ON u.id = c.id_usuario
      WHERE lower(trim(COALESCE(c.tipo_entidad, ''))) = $1
        AND c.id_entidad = ANY($2::int[])
      ORDER BY c.id_entidad ASC, c.fecha ASC, c.id ASC
    `,
    [normalizedType, ids]
  );

  const commentsByEntity = new Map();
  const seenByEntity = new Map();
  result.rows.forEach((row) => {
    const entityId = Number(row.id_entidad || 0);
    if (!entityId) return;
    const commentId = Number(row.id || 0) || null;

    if (!commentsByEntity.has(entityId)) {
      commentsByEntity.set(entityId, []);
    }

    if (!seenByEntity.has(entityId)) {
      seenByEntity.set(entityId, new Set());
    }

    if (commentId && seenByEntity.get(entityId).has(commentId)) {
      return;
    }

    if (commentId) {
      seenByEntity.get(entityId).add(commentId);
    }

    commentsByEntity.get(entityId).push({
      id: commentId,
      id_entidad: entityId,
      usuario_id: Number(row.id_usuario || 0) || null,
      usuario: String(row.usuario || 'Usuario').trim() || 'Usuario',
      foto: String(row.usuario_foto || '').trim(),
      fecha: row.fecha,
      contenido: String(row.contenido || '').trim(),
    });
  });

  return commentsByEntity;
};

const insertCommentForEntity = async (db, { user, tipoEntidad, idEntidad, contenido }) => {
  const normalizedType = normalizeCommentEntityType(tipoEntidad);
  const entityId = Number(idEntidad || 0);
  const userId = Number(user?.id || 0);
  const text = String(contenido || '').trim();

  if (!normalizedType || !entityId || !userId || !text) {
    throw new Error('Datos invalidos para registrar comentario');
  }

  const inserted = await db.query(
    `
      INSERT INTO comentarios (id_usuario, tipo_entidad, id_entidad, contenido, fecha)
      VALUES ($1, $2, $3, $4, NOW())
      RETURNING id, id_usuario, tipo_entidad, id_entidad, contenido, fecha
    `,
    [userId, normalizedType, entityId, text]
  );

  const row = inserted.rows[0] || {};
  return {
    id: Number(row.id || 0) || null,
    id_entidad: entityId,
    usuario_id: Number(row.id_usuario || 0) || userId,
    usuario: String(user?.nombre || user?.username || user?.email || 'Usuario').trim() || 'Usuario',
    foto: String(user?.foto || user?.imagen || '').trim(),
    fecha: row.fecha || new Date().toISOString(),
    contenido: String(row.contenido || text).trim(),
  };
};

const getApprovalStageLabelFromState = (state) => {
  const normalizedState = normalizeApprovalState(state);
  if (normalizedState.startsWith('PENDIENTE_')) return normalizedState.replace(/^PENDIENTE_/, '');
  if (normalizedState === 'PENDIENTE_JEFE_AREA') return 'JEFE_AREA';
  if (normalizedState === 'PENDIENTE_GERENCIA') return 'GERENCIA';
  if (normalizedState === 'PENDIENTE_FINANZAS') return 'FINANZAS';
  if (normalizedState === 'PENDIENTE_ADMIN') return 'ADMIN';
  return '';
};

const parseApprovalCommentContent = (content) => {
  const text = String(content || '').trim();
  const parts = text.split('|').map((part) => String(part || '').trim()).filter(Boolean);
  if (parts.length === 0 || normalize(parts[0]) !== 'APROBACION') {
    return null;
  }

  const etapa = String(parts[1] || '').trim().toUpperCase();
  const usuarioMatch = text.match(/usuario\s*:\s*([^|]+)/i);
  const fechaMatch = text.match(/fecha\s*:\s*([^|]+)/i);

  return {
    etapa,
    usuario: String(usuarioMatch?.[1] || '').trim(),
    fecha: String(fechaMatch?.[1] || '').trim(),
    contenido: text,
  };
};

const buildApprovalCommentContent = ({ etapa, usuario, fecha }) => {
  const stageLabel = String(etapa || '').trim().toUpperCase();
  const userLabel = String(usuario || '').trim() || 'Usuario';
  const dateLabel = String(fecha || new Date().toISOString()).trim();
  return `APROBACION | ${stageLabel} | usuario: ${userLabel} | fecha: ${dateLabel}`;
};

const registrarAprobacion = async (db, usuario, tipo, id, estadoActual) => {
  const normalizedType = normalizeCommentEntityType(tipo);
  const entityId = Number(id || 0);
  const userId = Number(usuario?.id || 0);
  const stageLabel = getApprovalStageLabelFromState(estadoActual);

  if (!normalizedType || !entityId || !userId || !stageLabel) {
    return null;
  }

  const userLabel = String(usuario?.nombre || usuario?.username || usuario?.email || 'Usuario').trim() || 'Usuario';
  const approvalDate = new Date().toISOString();
  const content = buildApprovalCommentContent({ etapa: stageLabel, usuario: userLabel, fecha: approvalDate });

  return insertCommentForEntity(db, {
    user: usuario,
    tipoEntidad: normalizedType,
    idEntidad: entityId,
    contenido: content,
  });
};

const fetchApprovalCommentsByEntity = async (db, { tipo, referenciaId }) => {
  const normalizedType = normalizeCommentEntityType(tipo);
  const reference = Number(referenciaId || 0);
  if (!normalizedType || !reference) {
    return [];
  }

  const result = await db.query(
    `
      SELECT
        c.id,
        c.id_usuario,
        COALESCE(u.nombre, 'Usuario') AS usuario,
        c.contenido,
        c.fecha
      FROM comentarios c
      LEFT JOIN usuarios u ON u.id = c.id_usuario
      WHERE lower(trim(COALESCE(c.tipo_entidad, ''))) = $1
        AND c.id_entidad = $2
        AND upper(trim(COALESCE(c.contenido, ''))) LIKE 'APROBACION%'
      ORDER BY c.fecha ASC, c.id ASC
    `,
    [normalizedType, reference]
  );

  return result.rows
    .map((row, index) => {
      const parsed = parseApprovalCommentContent(row.contenido);
      if (!parsed) {
        return null;
      }

      return {
        orden: index + 1,
        etapa: parsed.etapa || '',
        usuario_id: Number(row.id_usuario || 0) || null,
        usuario: parsed.usuario || String(row.usuario || 'Usuario').trim() || 'Usuario',
        fecha: row.fecha || parsed.fecha || null,
        contenido: parsed.contenido,
      };
    })
    .filter(Boolean);
};

const normalizeRatingType = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'servicio') return 'servicio';
  if (['compra', 'entrada', 'salida', 'material', 'material_entrada', 'material_salida'].includes(normalized)) return 'compra';
  return null;
};

const canRateCompra = (user) => tienePermiso(user, 'CALIFICAR_COMPRA');
const canRateRequerimiento = (user) => tienePermiso(user, 'CALIFICAR_REQUERIMIENTO');
const canRateServicio = (user) => tienePermiso(user, 'CALIFICAR_SERVICIO') || tienePermiso(user, 'VER_HISTORIAL_SERVICIOS');
const canRateAnyProvider = (user) => canRateCompra(user) || canRateRequerimiento(user) || canRateServicio(user);

const canEditUnifiedProveedorRating = (user) => {
  // Avoid numeric id checks; rely on role name or explicit permission if available.
  const roleName = normalize(user?.rol || '');
  if (roleName === 'SERVICIOS_GENERALES' || roleName === 'SERVICIOS GENERALES') return true;

  return tienePermiso(user, 'EDITAR_CALIFICACION_PROVEEDOR');
};

const resolveSalidaRatingContext = async (db, { idMovimiento, idMaterial, idProveedor } = {}) => {
  const movimientoId = Number(idMovimiento || 0);
  const materialId = Number(idMaterial || 0);
  const proveedorId = Number(idProveedor || 0);

  if (!Number.isInteger(movimientoId) || movimientoId <= 0) return null;
  if (!Number.isInteger(materialId) || materialId <= 0) return null;
  if (!Number.isInteger(proveedorId) || proveedorId <= 0) return null;

  const result = await db.query(
    `
      SELECT
        m.id AS id_movimiento,
        upper(trim(COALESCE(NULLIF(to_jsonb(m)->>'tipo_movimiento', ''), NULLIF(to_jsonb(m)->>'tipo', ''), ''))) AS tipo_movimiento,
        md.id AS id_movimiento_detalle,
        md.id_material,
        NULLIF(to_jsonb(mat)->>'id_proveedor', '')::int AS id_proveedor,
        COALESCE(
          (
            SELECT areas.nombre
            FROM requerimientos
            JOIN usuarios ON usuarios.id = requerimientos.id_usuario
            LEFT JOIN areas ON areas.id = usuarios.id_area
            WHERE requerimientos.id = NULLIF(
              COALESCE(
                NULLIF(to_jsonb(m)->>'id_requerimiento', ''),
                NULLIF(to_jsonb(m)->>'requerimiento_id', ''),
                ''
              ),
              ''
            )::int
            LIMIT 1
          ),
          COALESCE(a_mov.nombre, 'Sin area')
        ) AS area_destino
      FROM movimientos m
      JOIN movimiento_detalles md ON md.id_movimiento = m.id
      JOIN materiales mat ON mat.id = md.id_material
      LEFT JOIN usuarios u_mov ON u_mov.id = CASE
        WHEN COALESCE(
          NULLIF(to_jsonb(m)->>'usuario_registro', ''),
          NULLIF(to_jsonb(m)->>'id_usuario', ''),
          NULLIF(to_jsonb(m)->>'usuario_id', '')
        ) ~ '^\\d+$'
          THEN COALESCE(
            NULLIF(to_jsonb(m)->>'usuario_registro', ''),
            NULLIF(to_jsonb(m)->>'id_usuario', ''),
            NULLIF(to_jsonb(m)->>'usuario_id', '')
          )::int
        ELSE NULL
      END
      LEFT JOIN areas a_mov ON a_mov.id = u_mov.id_area
      WHERE m.id = $1
        AND md.id_material = $2
      LIMIT 1
    `,
    [movimientoId, materialId]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  const providerFromMaterial = Number(row.id_proveedor || 0);
  if (!providerFromMaterial || providerFromMaterial !== proveedorId) return null;

  return {
    id_movimiento: Number(row.id_movimiento || 0),
    id_movimiento_detalle: Number(row.id_movimiento_detalle || 0),
    id_material: Number(row.id_material || 0),
    id_proveedor: providerFromMaterial,
    tipo_movimiento: normalize(row.tipo_movimiento || ''),
    area_destino: String(row.area_destino || 'Sin area').trim() || 'Sin area',
  };
};

const fetchProveedorRatingsSummary = async (db, { proveedorIds = [], userId = null } = {}) => {
  const ids = [...new Set((Array.isArray(proveedorIds) ? proveedorIds : [])
    .map((id) => Number(id || 0))
    .filter((id) => Number.isInteger(id) && id > 0))];

  if (ids.length === 0) {
    return new Map();
  }

  const summaryResult = await db.query(
    `
      SELECT
        cp.id_proveedor,
        ROUND(AVG(cp.puntuacion)::numeric, 2) AS promedio,
        COUNT(*)::int AS total,
        COALESCE(BOOL_OR(cp.puntuacion <= 2), false) AS existe_critica
      FROM calificaciones_proveedor cp
      WHERE cp.id_proveedor = ANY($1::int[])
        AND lower(trim(COALESCE(cp.tipo, ''))) IN ('compra', 'servicio')
      GROUP BY cp.id_proveedor
    `,
    [ids]
  );

  const userResult = Number(userId || 0) > 0
    ? await db.query(
      `
        SELECT DISTINCT ON (cp.id_proveedor)
          cp.id_proveedor,
          cp.puntuacion,
          cp.comentario,
          cp.fecha
        FROM calificaciones_proveedor cp
        WHERE cp.id_proveedor = ANY($1::int[])
          AND cp.id_usuario = $2
          AND lower(trim(COALESCE(cp.tipo, ''))) IN ('compra', 'servicio')
        ORDER BY cp.id_proveedor, cp.fecha DESC, cp.id DESC
      `,
      [ids, Number(userId)]
    )
    : { rows: [] };

  const latestResult = await db.query(
    `
      SELECT DISTINCT ON (cp.id_proveedor)
        cp.id_proveedor,
        cp.puntuacion,
        cp.comentario,
        cp.fecha
      FROM calificaciones_proveedor cp
      WHERE cp.id_proveedor = ANY($1::int[])
        AND lower(trim(COALESCE(cp.tipo, ''))) IN ('compra', 'servicio')
      ORDER BY cp.id_proveedor, cp.fecha DESC, cp.id DESC
    `,
    [ids]
  );

  const userMap = new Map(
    userResult.rows.map((row) => [Number(row.id_proveedor || 0), {
      puntuacion: Number(row.puntuacion || 0) || null,
      comentario: String(row.comentario || '').trim(),
      fecha: row.fecha || null,
    }])
  );

  const latestMap = new Map(
    latestResult.rows.map((row) => [Number(row.id_proveedor || 0), {
      puntuacion: Number(row.puntuacion || 0) || null,
      comentario: String(row.comentario || '').trim(),
      fecha: row.fecha || null,
    }])
  );

  const map = new Map();
  summaryResult.rows.forEach((row) => {
    const proveedorId = Number(row.id_proveedor || 0);
    if (!proveedorId) return;
    const own = userMap.get(proveedorId) || {};
    const latest = latestMap.get(proveedorId) || {};
    map.set(proveedorId, {
      calificacion_promedio: Number(row.promedio || 0) || 0,
      calificacion_total: Number(row.total || 0) || 0,
      alerta_cambio_proveedor: Number(row.total || 0) > 0 && (Number(row.promedio || 0) < 4),
      alerta_critica: Boolean(row.existe_critica),
      mi_calificacion: own.puntuacion || null,
      mi_comentario: own.comentario || '',
      mi_fecha: own.fecha || null,
      ultimo_comentario: latest.comentario || '',
      ultima_calificacion: latest.fecha || null,
    });
  });

  ids.forEach((proveedorId) => {
    if (!map.has(proveedorId)) {
      const own = userMap.get(proveedorId) || {};
      const latest = latestMap.get(proveedorId) || {};
      map.set(proveedorId, {
        calificacion_promedio: 0,
        calificacion_total: 0,
        alerta_cambio_proveedor: false,
        alerta_critica: false,
        mi_calificacion: own.puntuacion || null,
        mi_comentario: own.comentario || '',
        mi_fecha: own.fecha || null,
        ultimo_comentario: latest.comentario || '',
        ultima_calificacion: latest.fecha || null,
      });
    }
  });

  return map;
};

const fetchProveedorAverageRatingsForAutomation = async (db) => {
  const result = await db.query(
    `
      SELECT
        cp.id_proveedor,
        ROUND(AVG(cp.puntuacion)::numeric, 2) AS promedio_puntuacion,
        COUNT(*)::int AS total_calificaciones,
        COALESCE(BOOL_OR(cp.puntuacion <= 2), false) AS existe_critica
      FROM calificaciones_proveedor cp
      WHERE lower(trim(COALESCE(cp.tipo, ''))) IN ('compra', 'servicio')
      GROUP BY cp.id_proveedor
      ORDER BY cp.id_proveedor ASC
    `
  );

  return result.rows.map((row) => ({
    id_proveedor: Number(row.id_proveedor || 0),
    promedio_puntuacion: Number(row.promedio_puntuacion || 0) || 0,
    total_calificaciones: Number(row.total_calificaciones || 0) || 0,
    alerta_cambio_proveedor: Number(row.total_calificaciones || 0) > 0 && (Number(row.promedio_puntuacion || 0) < 4),
    alerta_critica: Boolean(row.existe_critica),
  }));
};

const proveedorNotificationStore = new Map();

const sortProveedorNotifications = (notifications = []) => notifications
  .slice()
  .sort((a, b) => {
    const priorityRank = (value) => (String(value || '').trim().toUpperCase() === 'ALTA' ? 0 : 1);
    return priorityRank(a.prioridad) - priorityRank(b.prioridad)
      || Number(b.fecha_creacion_timestamp || 0) - Number(a.fecha_creacion_timestamp || 0)
      || String(a.proveedor_nombre || '').localeCompare(String(b.proveedor_nombre || ''));
  });

const buildProveedorNotificationKey = ({ proveedorId, tipo, idReferencia } = {}) => {
  const normalizedProveedorId = Number(proveedorId || 0);
  const normalizedTipo = normalizeRatingType(tipo) || 'general';
  const normalizedReferenceId = Number(idReferencia || 0) || 0;
  return `proveedor-${normalizedProveedorId}-${normalizedTipo}-${normalizedReferenceId}`;
};

const buildProveedorNotificationEntry = async (db, { proveedorId, summary, puntuacion, tipo, idReferencia }) => {
  const providerResult = await db.query(
    `
      SELECT
        COALESCE(NULLIF(trim(COALESCE(to_jsonb(p)->>'razon_social', to_jsonb(p)->>'nombre', '')), ''), 'Sin proveedor') AS proveedor_nombre
      FROM proveedores p
      WHERE p.id = $1
      LIMIT 1
    `,
    [Number(proveedorId || 0)]
  );

  const resolveOrigin = async () => {
    const normalizedTipo = normalizeRatingType(tipo);
    const referenceId = Number(idReferencia || 0);

    if (normalizedTipo === 'servicio' && Number.isInteger(referenceId) && referenceId > 0) {
      try {
        const servicios = await fetchServiciosRows([referenceId], 'WHERE s.id = $1');
        const servicio = servicios[0] || null;
        const servicioNombre = String(servicio?.nombre_servicio || servicio?.descripcion_servicio || '').trim();
        return {
          origen_tipo: 'Servicio',
          origen_nombre: servicioNombre || `Servicio #${referenceId}`,
          origen_detalle: String(servicio?.descripcion_servicio || '').trim(),
        };
      } catch (_error) {
        return {
          origen_tipo: 'Servicio',
          origen_nombre: `Servicio #${referenceId}`,
          origen_detalle: '',
        };
      }
    }

    if (normalizedTipo === 'compra' && Number.isInteger(referenceId) && referenceId > 0) {
      try {
        const detalleResult = await db.query(
          `
            SELECT
              md.id AS id_movimiento_detalle,
              md.id_movimiento,
              md.id_material,
              COALESCE(mat.nombre, 'Material') AS material_nombre,
              COALESCE(mat.descripcion, '') AS material_descripcion
            FROM movimiento_detalles md
            LEFT JOIN materiales mat ON mat.id = md.id_material
            WHERE md.id = $1
            LIMIT 1
          `,
          [referenceId]
        );

        const detalle = detalleResult.rows[0] || null;
        if (detalle) {
          const materialNombre = String(detalle.material_nombre || '').trim() || `Material #${referenceId}`;

          return {
            origen_tipo: 'Producto',
            origen_nombre: materialNombre,
            origen_detalle: String(detalle.material_descripcion || '').trim() || `Detalle de movimiento #${referenceId}`,
          };
        }

        const compras = await fetchComprasRows([referenceId], 'WHERE c.id = $1');
        const compra = compras[0] || null;
        const itemNames = Array.isArray(compra?.items)
          ? compra.items.map((item) => String(item?.material || item?.descripcion || '').trim()).filter(Boolean)
          : [];
        const uniqueItems = [...new Set(itemNames)];
        const topItems = uniqueItems.slice(0, 3);
        const extraCount = Math.max(uniqueItems.length - topItems.length, 0);
        const itemLabel = topItems.length > 0
          ? topItems.join(', ') + (extraCount > 0 ? ` y ${extraCount} más` : '')
          : `Compra #${referenceId}`;

        return {
          origen_tipo: 'Producto',
          origen_nombre: itemLabel,
          origen_detalle: String(compra?.proveedor || '').trim() || `Compra #${referenceId}`,
        };
      } catch (_error) {
        return {
          origen_tipo: 'Producto',
          origen_nombre: `Compra #${referenceId}`,
          origen_detalle: '',
        };
      }
    }

    return {
      origen_tipo: normalizedTipo === 'servicio' ? 'Servicio' : 'Producto',
      origen_nombre: Number.isInteger(referenceId) && referenceId > 0 ? `${normalizedTipo === 'servicio' ? 'Servicio' : 'Compra'} #${referenceId}` : '',
      origen_detalle: '',
    };
  };

  const origin = await resolveOrigin();

  const proveedorNombre = String(providerResult.rows[0]?.proveedor_nombre || 'Sin proveedor').trim() || 'Sin proveedor';
  const promedio = Number(summary?.calificacion_promedio ?? summary?.promedio_puntuacion ?? 0) || 0;
  const individual = Number(puntuacion ?? summary?.mi_calificacion ?? 0) || 0;
  const total = Number(summary?.calificacion_total ?? summary?.total_calificaciones ?? 0) || 0;
  const comentario = String(summary?.ultimo_comentario || summary?.mi_comentario || '').trim();
  const shouldNotify = individual <= 3 || promedio <= 3;
  const notificationId = buildProveedorNotificationKey({ proveedorId, tipo, idReferencia });

  if (!shouldNotify) {
    proveedorNotificationStore.delete(notificationId);
    return null;
  }

  const priority = individual <= 2 || promedio <= 2 ? 'ALTA' : 'MEDIA';
  const entry = {
    id: notificationId,
    tipo: 'PROVEEDOR_CALIFICACION_BAJA',
    proveedor_id: Number(proveedorId || 0),
    proveedor_nombre: proveedorNombre,
    titulo: 'Notificación de proveedor',
    mensaje: `${proveedorNombre} tiene calificación baja, revisar desempeño`,
    detalle: `Calificación individual: ${individual}/5. Promedio actualizado: ${promedio.toFixed(2)}/5. Total de calificaciones: ${total}`,
    comentario: comentario || null,
    origen_tipo: origin.origen_tipo,
    origen_nombre: origin.origen_nombre,
    origen_detalle: origin.origen_detalle,
    prioridad: priority,
    promedio_puntuacion: promedio,
    puntuacion_individual: individual,
    puntuacion_minima: Math.min(individual || 5, Number(summary?.puntuacion_minima || 5) || 5),
    total_calificaciones: total,
    tipo_calificacion: String(tipo || '').trim() || null,
    id_referencia: Number(idReferencia || 0) || null,
    fecha: new Date().toISOString(),
    fecha_creacion_timestamp: Date.now(),
    leida: false,
  };

  const current = proveedorNotificationStore.get(entry.id);
  if (
    current
    && current.promedio_puntuacion === entry.promedio_puntuacion
    && current.puntuacion_individual === entry.puntuacion_individual
    && current.total_calificaciones === entry.total_calificaciones
    && current.id_referencia === entry.id_referencia
    && current.tipo_calificacion === entry.tipo_calificacion
  ) {
    return current;
  }

  proveedorNotificationStore.set(entry.id, entry);
  return entry;
};

const hydrateProveedorNotificationsFromDb = async (db) => {
  const result = await db.query(
    `
      SELECT
        cp.id,
        cp.id_proveedor,
        COALESCE(p.razon_social, p.nombre, 'Sin proveedor') AS proveedor_nombre,
        cp.tipo,
        cp.id_referencia,
        cp.puntuacion,
        cp.comentario,
        cp.fecha,
        ROUND(AVG(cp.puntuacion) OVER (PARTITION BY cp.id_proveedor)::numeric, 2) AS promedio_puntuacion,
        MIN(cp.puntuacion) OVER (PARTITION BY cp.id_proveedor)::int AS puntuacion_minima,
        COUNT(*) OVER (PARTITION BY cp.id_proveedor)::int AS total_calificaciones
      FROM calificaciones_proveedor cp
      LEFT JOIN proveedores p ON p.id = cp.id_proveedor
      WHERE lower(trim(COALESCE(cp.tipo, ''))) IN ('compra', 'servicio')
        AND cp.puntuacion <= 3
      ORDER BY cp.fecha DESC, cp.id DESC
    `
  );

  const entries = [];

  for (const row of result.rows) {
    const entry = await buildProveedorNotificationEntry(db, {
      proveedorId: Number(row.id_proveedor || 0),
      summary: {
        calificacion_promedio: Number(row.promedio_puntuacion || 0) || 0,
        calificacion_total: Number(row.total_calificaciones || 0) || 0,
        puntuacion_minima: Number(row.puntuacion_minima || 0) || 0,
      },
      puntuacion: Number(row.puntuacion || 0) || 0,
      tipo: row.tipo,
      idReferencia: Number(row.id_referencia || 0) || 0,
    });

    if (entry) entries.push(entry);
  }

  return entries;
};

const fetchProveedorNotifications = async (db) => {
  if (proveedorNotificationStore.size === 0) {
    const entries = await hydrateProveedorNotificationsFromDb(db);
    entries.forEach((entry) => proveedorNotificationStore.set(entry.id, entry));
  }

  return sortProveedorNotifications([...proveedorNotificationStore.values()]);
};

const evaluarProveedor = async (idProveedor, {
  db = pool,
  summary = null,
  puntuacion = null,
  tipo = null,
  idReferencia = null,
} = {}) => {
  const proveedorId = Number(idProveedor || 0);
  if (!Number.isInteger(proveedorId) || proveedorId <= 0) {
    return null;
  }

  let resolvedSummary = summary;
  if (!resolvedSummary) {
    const summaryMap = await fetchProveedorRatingsSummary(db, { proveedorIds: [proveedorId] });
    resolvedSummary = summaryMap.get(proveedorId) || null;
  }

  return buildProveedorNotificationEntry(db, {
    proveedorId,
    summary: resolvedSummary,
    puntuacion,
    tipo,
    idReferencia,
  });
};

const upsertProveedorRating = async (db, { user, proveedorId, puntuacion, comentario, tipo = '', idReferencia = null } = {}) => {
  const userId = Number(user?.id || 0);
  const idProveedor = Number(proveedorId || 0);
  const score = Number(puntuacion || 0);
  const note = String(comentario || '').trim();
  const ratingType = normalizeRatingType(tipo);
  const referenceId = Number(idReferencia || 0) || idProveedor;

  if (!userId || !idProveedor) {
    throw new Error('Proveedor invalido para calificar');
  }

  if (!ratingType) {
    throw new Error("tipo invalido. Solo se permite 'compra' o 'servicio'");
  }

  if (!Number.isInteger(score) || score < 1 || score > 5) {
    throw new Error('La puntuacion debe estar entre 1 y 5');
  }

  const existing = ratingType === 'servicio'
    ? await db.query(
      `
        SELECT id
        FROM calificaciones_proveedor
        WHERE id_proveedor = $1
          AND lower(trim(COALESCE(tipo, ''))) = $2
          AND id_referencia = $3
        LIMIT 1
        FOR UPDATE
      `,
      [idProveedor, ratingType, referenceId]
    )
    : await db.query(
      `
        SELECT id
        FROM calificaciones_proveedor
        WHERE id_proveedor = $1
          AND lower(trim(COALESCE(tipo, ''))) = $2
          AND id_referencia = $3
        LIMIT 1
        FOR UPDATE
      `,
      [idProveedor, ratingType, referenceId]
    );

  if (existing.rows.length > 0) {
    const alreadyRatedError = new Error('Ya calificaste este proveedor');
    alreadyRatedError.code = 'RATING_ALREADY_EXISTS';
    throw alreadyRatedError;
  }

  await db.query(
    `
      INSERT INTO calificaciones_proveedor (
        id_proveedor,
        id_usuario,
        tipo,
        id_referencia,
        puntuacion,
        comentario,
        fecha
      )
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
    `,
    [idProveedor, userId, ratingType, referenceId, score, note || null]
  );

  const [summary] = await fetchProveedorRatingsSummary(db, { proveedorIds: [idProveedor], userId })
    .then((result) => [result.get(idProveedor)])
    .catch(() => [null]);

  return summary || {
    calificacion_promedio: 0,
    calificacion_total: 0,
    alerta_cambio_proveedor: false,
    alerta_critica: false,
    mi_calificacion: score,
    mi_comentario: note,
    mi_fecha: new Date().toISOString(),
  };
};

const parsePurchaseComments = (value) => {
  let text = String(value || '').trim();
  let recibidoPor = '';
  let itemCategorias = {};
  let entregaArea = null;
  let comentariosHistorial = [];

  let changed = true;
  while (changed) {
    changed = false;

    const deliveryMatch = text.match(/\n?\[\[ENTREGA_AREA:([A-Za-z0-9+/=]+)\]\]\s*$/s);
    if (deliveryMatch) {
      try {
        const decoded = Buffer.from(String(deliveryMatch[1] || ''), 'base64').toString('utf8');
        const parsed = JSON.parse(decoded);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          entregaArea = parsed;
        }
      } catch (_) {
        entregaArea = null;
      }

      text = text.slice(0, deliveryMatch.index || 0).trim();
      changed = true;
      continue;
    }

    const commentsMatch = text.match(/\n?\[\[COMENTARIOS_HIST:([A-Za-z0-9+/=]+)\]\]\s*$/s);
    if (commentsMatch) {
      try {
        const decoded = Buffer.from(String(commentsMatch[1] || ''), 'base64').toString('utf8');
        const parsed = JSON.parse(decoded);
        if (Array.isArray(parsed)) {
          comentariosHistorial = parsed
            .filter((item) => item && typeof item === 'object')
            .map((item) => ({
              usuario_id: Number(item.usuario_id || 0) || null,
              usuario: String(item.usuario || '').trim(),
              fecha: String(item.fecha || '').trim(),
              contenido: String(item.contenido || '').trim(),
            }))
            .filter((item) => item.contenido);
        }
      } catch (_) {
        comentariosHistorial = [];
      }

      text = text.slice(0, commentsMatch.index || 0).trim();
      changed = true;
      continue;
    }

    const categoriesMatch = text.match(/\n?\[\[ITEM_CATEGORIAS:([A-Za-z0-9+/=]+)\]\]\s*$/s);
    if (categoriesMatch) {
      try {
        const decoded = Buffer.from(String(categoriesMatch[1] || ''), 'base64').toString('utf8');
        const parsed = JSON.parse(decoded);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          itemCategorias = parsed;
        }
      } catch (_) {
        itemCategorias = {};
      }

      text = text.slice(0, categoriesMatch.index || 0).trim();
      changed = true;
      continue;
    }

    const receiptMatch = text.match(/\n?\[\[RECIBIDO_POR:(.*?)\]\]\s*$/s);
    if (receiptMatch) {
      recibidoPor = String(receiptMatch[1] || '').trim();
      text = text.slice(0, receiptMatch.index || 0).trim();
      changed = true;
      continue;
    }
  }

  return {
    comentarios: text,
    recibido_por: recibidoPor,
    item_categorias: itemCategorias,
    entrega_area: entregaArea,
    comentarios_historial: comentariosHistorial,
  };
};

const buildPurchaseComment = ({ comentarios = '', recibidoPor = '', itemCategorias = {}, entregaArea = null, comentariosHistorial = [] } = {}) => {
  let text = String(comentarios || '').trim();

  if (Array.isArray(comentariosHistorial) && comentariosHistorial.length > 0) {
    const encodedComments = Buffer.from(JSON.stringify(comentariosHistorial), 'utf8').toString('base64');
    text = `${text}${text ? '\n' : ''}${COMMENT_THREAD_NOTE_PREFIX}${encodedComments}]]`;
  }

  if (itemCategorias && typeof itemCategorias === 'object' && !Array.isArray(itemCategorias) && Object.keys(itemCategorias).length > 0) {
    const encoded = Buffer.from(JSON.stringify(itemCategorias), 'utf8').toString('base64');
    text = `${text}${text ? '\n' : ''}${ITEM_CATEGORY_NOTE_PREFIX}${encoded}]]`;
  }

  if (String(recibidoPor || '').trim()) {
    text = `${text}${text ? '\n' : ''}${RECEIPT_NOTE_PREFIX}${String(recibidoPor).trim()}]]`;
  }

  if (entregaArea && typeof entregaArea === 'object' && !Array.isArray(entregaArea)) {
    const encoded = Buffer.from(JSON.stringify(entregaArea), 'utf8').toString('base64');
    text = `${text}${text ? '\n' : ''}${AREA_DELIVERY_NOTE_PREFIX}${encoded}]]`;
  }

  return text;
};

const buildCompraPdfBase64 = (compra) => new Promise((resolve, reject) => {
  const doc = new PDFDocument({ margin: 36, size: 'A4', bufferPages: true });
  const chunks = [];

  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const left = 36;
  const right = 36;
  const usableWidth = pageWidth - left - right;
  const bottomLimit = pageHeight - 72;

  const safeText = (value) => String(value || '').replace(/\s+/g, ' ').trim() || 'N/D';
  const currencyLabel = safeText(compra.moneda || 'PEN');
  const money = (value, currency = currencyLabel) => `${Number(value || 0).toFixed(2)} ${safeText(currency)}`;
  const companyAddress = 'Av Nestor Gambeta N°4783 Callao - Callao';
  const companyRuc = '20606777257';
  const companyWeb = 'www.alfosac.pe';

  const ensureSpace = (needed = 24) => {
    if (doc.y + needed > bottomLimit) {
      doc.addPage();
      drawHeader();
    }
  };

  const writeSectionTitle = (title) => {
    ensureSpace(28);
    doc.font('Helvetica-Bold').fontSize(11).fillColor(PDF_BRAND_COLORS.primaryDark).text(title, left, doc.y, { width: usableWidth });
    doc.moveDown(0.2);
    doc.moveTo(left, doc.y).lineTo(pageWidth - right, doc.y).strokeColor(PDF_BRAND_COLORS.line).lineWidth(0.8).stroke();
    doc.moveDown(0.5);
  };

  const estimateBlockHeight = (rows = []) => {
    const measureRowHeight = (label, value, labelWidth, valueWidth) => {
      const textLabel = `${safeText(label)}:`;
      const textValue = safeText(value);
      doc.font('Helvetica-Bold').fontSize(8.5);
      const labelHeight = doc.heightOfString(textLabel, { width: labelWidth, align: 'left' });
      doc.font('Helvetica').fontSize(8.5);
      const valueHeight = doc.heightOfString(textValue, { width: valueWidth, align: 'left' });
      return Math.max(18, Math.max(labelHeight, valueHeight));
    };

    let total = 26;
    const labelWidth = 98;
    const valueWidth = 136;
    rows.forEach(([label, value]) => {
      total += measureRowHeight(label, value, labelWidth, valueWidth) + 8;
    });
    return total + 10;
  };

  const   drawInfoBlock = ({ title, rows, x, y, width }) => {
    const rowGap = 8;
    const paddingX = 10;
    const paddingY = 8;
    const titleHeight = 18;
    const labelWidth = Math.max(98, Math.floor(width * 0.38));
    const valueWidth = width - (paddingX * 2) - labelWidth - 8;

    // Filter out empty rows (both label and value empty) to avoid drawing useless boxes
    const effectiveRows = (Array.isArray(rows) ? rows : []).filter(([label, value]) => {
      return String(label || '').trim() !== '' || String(value || '').trim() !== '';
    });

    if (effectiveRows.length === 0) {
      return y;
    }

    const measureRowHeight = (label, value) => {
      const isLabelEmpty = !String(label || '').trim();
      const textValue = safeText(value);

      if (isLabelEmpty) {
        doc.font('Helvetica').fontSize(8.5);
        const valueHeight = doc.heightOfString(textValue, { width: width - (paddingX * 2), align: 'left' });
        return {
          textLabel: '',
          textValue,
          rowHeight: Math.max(18, valueHeight),
        };
      }

      const textLabel = `${safeText(label)}:`;
      doc.font('Helvetica-Bold').fontSize(8.5);
      const labelHeight = doc.heightOfString(textLabel, { width: labelWidth, align: 'left' });
      doc.font('Helvetica').fontSize(8.5);
      const valueHeight = doc.heightOfString(textValue, { width: valueWidth, align: 'left' });
      return {
        textLabel,
        textValue,
        rowHeight: Math.max(18, Math.max(labelHeight, valueHeight)),
      };
    };

    // If the block is a single full-width value (no labels), render the title header
    // and then flow the text normally so it can span pages without creating an oversized rect.
    const isSingleFullWidth = effectiveRows.length === 1 && String(effectiveRows[0][0] || '').trim() === '';
    if (isSingleFullWidth) {
      // Reserve small space for title + first lines
      ensureSpace(48);
      const actualY = doc.y;

      // Title header only
      doc.rect(x, actualY, width, titleHeight).fillAndStroke(PDF_BRAND_COLORS.sectionHeader, '#dbe3ec');
      doc.font('Helvetica-Bold').fontSize(9).fillColor(PDF_BRAND_COLORS.textPrimary).text(title, x + paddingX, actualY + 5, {
        width: width - (paddingX * 2),
      });

      doc.y = actualY + titleHeight + paddingY;

      // Flow the detail text; let PDFKit split across pages naturally
      doc.font('Helvetica').fontSize(8.5).fillColor(PDF_BRAND_COLORS.textPrimary).text(safeText(effectiveRows[0][1]), x + paddingX, doc.y, {
        width: width - (paddingX * 2),
        align: 'left',
      });

      return doc.y;
    }

    let contentHeight = 0;
    effectiveRows.forEach(([label, value]) => {
      const measured = measureRowHeight(label, value);
      contentHeight += measured.rowHeight + rowGap;
    });

    const blockHeight = titleHeight + (paddingY * 2) + contentHeight;

    // Ensure there is space for the whole block; if not, start on a new page
    ensureSpace(blockHeight);

    // Use current document y as block start (ignore provided y to avoid mismatches after paging)
    const actualY = doc.y;

    doc.rect(x, actualY, width, blockHeight).fillAndStroke(PDF_BRAND_COLORS.surface, '#dbe3ec');
    doc.rect(x, actualY, width, titleHeight).fillAndStroke(PDF_BRAND_COLORS.sectionHeader, '#dbe3ec');
    doc.font('Helvetica-Bold').fontSize(9).fillColor(PDF_BRAND_COLORS.textPrimary).text(title, x + paddingX, actualY + 5, {
      width: width - (paddingX * 2),
    });

    let rowY = actualY + titleHeight + paddingY;

    effectiveRows.forEach(([label, value]) => {
      const { textLabel, textValue, rowHeight } = measureRowHeight(label, value);
      const isLabelEmpty = !String(label || '').trim();

      if (isLabelEmpty) {
        doc.font('Helvetica').fontSize(8.5).fillColor(PDF_BRAND_COLORS.textPrimary).text(textValue, x + paddingX, rowY, {
          width: width - (paddingX * 2),
        });
      } else {
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(PDF_BRAND_COLORS.textSecondary).text(textLabel, x + paddingX, rowY, {
          width: labelWidth,
        });
        doc.font('Helvetica').fontSize(8.5).fillColor(PDF_BRAND_COLORS.textPrimary).text(textValue, x + paddingX + labelWidth + 8, rowY, {
          width: valueWidth,
        });
      }

      rowY += rowHeight + rowGap;
    });

    return actualY + blockHeight;
  };

  const renderTwoColumnBlocks = (blocks) => {
    const colGap = 12;
    const colWidth = (usableWidth - colGap) / 2;
    let cursorY = doc.y;

    for (let i = 0; i < blocks.length; i += 2) {
      const leftBlock = blocks[i];
      const rightBlock = blocks[i + 1] || null;
      const estimatedPairHeight = Math.max(
        estimateBlockHeight(leftBlock?.rows || []),
        rightBlock ? estimateBlockHeight(rightBlock.rows || []) : 0,
      ) + 10;

      ensureSpace(estimatedPairHeight);
      cursorY = Math.max(cursorY, doc.y);

      // Ensure doc.y is at cursorY so drawInfoBlock uses correct starting position
      doc.y = cursorY;

      const leftBottom = drawInfoBlock({
        title: leftBlock.title,
        rows: leftBlock.rows,
        x: left,
        y: cursorY,
        width: colWidth,
      });

      let pairBottom = leftBottom;
      if (rightBlock) {
        // For the right block, ensure doc.y is still the same starting cursorY
        doc.y = cursorY;
        const rightBottom = drawInfoBlock({
          title: rightBlock.title,
          rows: rightBlock.rows,
          x: left + colWidth + colGap,
          y: cursorY,
          width: colWidth,
        });
        pairBottom = Math.max(leftBottom, rightBottom);
      }

      cursorY = pairBottom + 10;
      doc.y = cursorY;
    }
  };

  const drawHeader = () => {
    const logoPath = getCompanyLogoPath('dark');

    doc.rect(left, 18, usableWidth, 62).fill(PDF_BRAND_COLORS.primaryDark);

    if (logoPath) {
      doc.image(logoPath, left + 12, 24, {
        fit: [84, 50],
        align: 'left',
        valign: 'center',
      });
    }

    doc.font('Helvetica-Bold').fontSize(15).fillColor('#ffffff').text('ORDEN DE COMPRA', left, 32, { width: usableWidth - 14, align: 'right' });
    doc.font('Helvetica').fontSize(9).fillColor(PDF_BRAND_COLORS.textSecondary).text(`Dirección: ${companyAddress}`, left, 94, { width: usableWidth, align: 'center' });
    doc.text(`RUC: ${companyRuc}`, left, 106, { width: usableWidth, align: 'center' });
    doc.text(`Sitio Web: ${companyWeb}`, left, 118, { width: usableWidth, align: 'center' });
    doc.moveTo(left, 132).lineTo(pageWidth - right, 132).strokeColor(PDF_BRAND_COLORS.line).lineWidth(0.9).stroke();
    doc.y = 140;
  };

  doc.on('data', (chunk) => chunks.push(chunk));
  doc.on('error', reject);
  doc.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));

  doc.on('pageAdded', () => {
    doc.y = 140;
  });

  drawHeader();

  const subtotal = Number(compra.subtotal || 0);
  const igv = Number(compra.igv || 0);
  const costoEnvio = Number(compra.costo_envio || 0);
  const otrosCostos = Number(compra.otros_costos || 0);
  const totalBase = Number((subtotal + igv + costoEnvio + otrosCostos).toFixed(2));
  const aplicaRetencion = Boolean(compra.aplica_retencion);
  const porcentajeRetencion = Number(compra.descuento || 0);
  const montoRetenido = aplicaRetencion ? Number((totalBase * (porcentajeRetencion / 100)).toFixed(2)) : 0;
  const totalFinal = Number(compra.importe_final || compra.total || totalBase);
  const approverEntries = buildPdfApprovalEntries({
    approvals: compra.aprobadores,
    creatorUserId: compra.id_usuario,
    creatorRoleId: compra.usuario_rol_id,
    creatorName: compra.usuario,
  });
  const approversSummary = approverEntries
    .map((row) => `${safeText(row.etapa || row.rol || getApprovalRoleLabel(row.rol_aprobador))} - ${safeText(row.aprobador || 'Pendiente')}`)
    .join(' | ');
  const entregaInfo = compra.entrega_area && compra.entrega_area.entregado === true
    ? {
      ...compra.entrega_area,
      ...parseReceiptInfo(compra.recibido_por),
    }
    : null;

  writeSectionTitle('Resumen');
  ensureSpace(98);
  const resumenTop = doc.y;
  const resumenRows = [
    ['Número de orden', compra.numero_orden || `OC-${compra.id}`],
    ['Fecha', new Date(compra.fecha_creacion || Date.now()).toLocaleDateString()],
    ['Proveedor', compra.proveedor || compra.razon_social],
    ['Área destino', compra.area_final],
  ];
  const resumenRowHeight = 20;
  const resumenLabelWidth = 160;

  doc.rect(left, resumenTop, usableWidth, 20).fillAndStroke(PDF_BRAND_COLORS.sectionHeader, '#cbd5e1');
  doc.font('Helvetica-Bold').fontSize(9).fillColor(PDF_BRAND_COLORS.textPrimary).text('Datos de la orden', left + 10, resumenTop + 6, {
    width: usableWidth - 20,
    align: 'left',
  });

  let resumenY = resumenTop + 20;
  resumenRows.forEach(([label, value], index) => {
    const isAlternate = index % 2 === 0;
    const valueHeight = doc.heightOfString(safeText(value), {
      width: usableWidth - resumenLabelWidth - 20,
      align: 'left',
    });
    const rowHeight = Math.max(resumenRowHeight, valueHeight + 12);
    doc.rect(left, resumenY, usableWidth, rowHeight).fillAndStroke(isAlternate ? '#f8fafc' : '#ffffff', '#e2e8f0');
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(PDF_BRAND_COLORS.textSecondary).text(`${label}:`, left + 10, resumenY + 6, {
      width: resumenLabelWidth,
      align: 'left',
    });
    doc.font('Helvetica').fontSize(8.5).fillColor(PDF_BRAND_COLORS.textPrimary).text(safeText(value), left + 10 + resumenLabelWidth, resumenY + 6, {
      width: usableWidth - resumenLabelWidth - 20,
      align: 'left',
    });
    resumenY += rowHeight;
  });
  doc.y = resumenY + 10;

  renderTwoColumnBlocks([
    {
      title: 'Orden y solicitante',
      rows: [
        ['Área solicitante', compra.area_solicitante],
        ['Solicitante', compra.usuario],
        ['Moneda', currencyLabel],
      ],
    },
    {
      title: 'Proveedor',
      rows: [
        ['RUC', compra.ruc],
        ['Dirección', compra.direccion],
        ['Distrito', compra.distrito],
        ['Banco', compra.banco],
        ['Cuenta', compra.cuenta || compra.numero_cuenta],
        ['CCI', compra.cci],
        ['Condiciones de pago', compra.condiciones_pago],
      ],
    },
    {
      title: 'Detalle financiero',
      rows: [
        ['Subtotal', money(subtotal, compra.moneda)],
        ['IGV', money(igv, compra.moneda)],
        ['Costo envío', money(costoEnvio, compra.moneda)],
        ['Otros costos', money(otrosCostos, compra.moneda)],
        ['Total base', money(totalBase, compra.moneda)],
        ['Retención aplicada', aplicaRetencion ? 'SÍ' : 'NO'],
        ['Porcentaje', `${porcentajeRetencion.toFixed(2)}%`],
        ['Monto retenido', money(montoRetenido, compra.moneda)],
      ],
    },
    {
      title: 'Contacto y observaciones',
      rows: [
        ['Correo', compra.correo || compra.contacto_proveedor],
        ['Persona responsable', compra.persona_responsable || compra.contacto_proveedor],
        ['Teléfono', compra.telefono],
        ['Aprobaciones', approversSummary || 'Sin aprobaciones registradas'],
      ],
    },
  ]);

  if (entregaInfo) {
    const entregaBottom = drawInfoBlock({
      title: 'Entrega al area / Estado de entrega',
      rows: [
        ['DNI receptor', entregaInfo.receptor_dni || entregaInfo.dni || 'N/D'],
        ['Nombre receptor', entregaInfo.receptor_nombre || entregaInfo.nombre || 'N/D'],
        ['Entregado', 'SI'],
        ['Fecha entrega', entregaInfo.fecha_entrega_area ? new Date(entregaInfo.fecha_entrega_area).toLocaleString() : 'N/D'],
      ],
      x: left,
      y: doc.y,
      width: usableWidth,
    });
    doc.y = entregaBottom + 10;
  }



  // Render detalle inside a titled info box if provided, otherwise render a simple title
  if (compra.detalle && String(compra.detalle || '').trim()) {
    const detalleBottom = drawInfoBlock({
      title: 'Detalle',
      rows: [[ '', compra.detalle ]],
      x: left,
      y: doc.y,
      width: usableWidth,
    });
    doc.y = detalleBottom + 10;
  } else {
    writeSectionTitle('Detalle');
  }

  const items = Array.isArray(compra.items) ? compra.items : [];
  const colWidths = [usableWidth - 110, 110];
  const headers = ['Material/Servicio', ''];
  let x = left;
  const drawDetailHeader = (startY) => {
    let headerX = left;
    doc.font('Helvetica-Bold').fontSize(9);
    headers.forEach((header, index) => {
      doc.rect(headerX, startY, colWidths[index], 20).fillAndStroke(PDF_BRAND_COLORS.sectionHeader, '#cbd5e1');
      doc.fillColor(PDF_BRAND_COLORS.textPrimary);
      doc.text(header, headerX + 6, startY + 6, {
        width: colWidths[index] - 12,
        align: index === 0 ? 'left' : 'center',
      });
      headerX += colWidths[index];
    });
    return startY + 20;
  };
  // Filter out items that are completely empty: no meaningful description and zero amounts
  const validItems = items.filter((item) => {
    const qty = Number(item.cantidad || 0);
    const unit = Number(item.precio_unitario || 0);
    const totalVal = Number(item.total || 0);
    const descSafe = safeText(item.material || item.descripcion || item.nombre);
    if (descSafe === 'N/D' && qty === 0 && unit === 0 && totalVal === 0) return false;
    return true;
  });

  // From validItems, keep only rows that are truly printable in the PDF table
  const displayedItems = validItems.filter((item) => {
    const rawDescription = String(item.material || item.descripcion || item.nombre || '').trim();
    const qty = Number(item.cantidad || 0);
    const unit = Number(item.precio_unitario || 0);
    const totalVal = Number(item.total ?? (qty * unit));
    return rawDescription !== '' && (qty > 0 || unit > 0 || totalVal > 0);
  });

  let rowY = displayedItems.length > 0 ? drawDetailHeader(doc.y) : doc.y;

  doc.font('Helvetica').fontSize(8.5).fillColor(PDF_BRAND_COLORS.textPrimary);
  displayedItems.forEach((item) => {
    const qty = Number(item.cantidad || 0);
    const unit = Number(item.precio_unitario || 0);
    const rowTotal = Number((qty * unit).toFixed(2));
    const descripcion = safeText(item.material || item.descripcion || item.nombre);
    const rowHeight = Math.max(20, doc.heightOfString(descripcion, { width: colWidths[0] - 12 }) + 8);

    if (rowY + rowHeight > bottomLimit - 32) {
      doc.addPage();
      drawHeader();
      rowY = drawDetailHeader(doc.y);
    }

    x = left;
    const cells = [
      descripcion,
      String(''),
    ];
    cells.forEach((cell, cellIndex) => {
      doc.rect(x, rowY, colWidths[cellIndex], rowHeight).fillAndStroke('#ffffff', '#e2e8f0');
      doc.fillColor(PDF_BRAND_COLORS.textPrimary);
      doc.text(cell, x + 6, rowY + 5, {
        width: colWidths[cellIndex] - 12,
        align: cellIndex === 0 ? 'left' : 'center',
      });
      x += colWidths[cellIndex];
    });
    rowY += rowHeight;
  });

  if (rowY + 24 > bottomLimit - 4) {
    doc.addPage();
    drawHeader();
    rowY = doc.y;
  }

  const resumenTotalY = rowY;
  const totalAmountWidth = 180;
  const totalLabelWidth = usableWidth - totalAmountWidth;
  doc.rect(left, resumenTotalY, totalLabelWidth, 22).fillAndStroke(PDF_BRAND_COLORS.surface, '#cbd5e1');
  doc.rect(left + totalLabelWidth, resumenTotalY, totalAmountWidth, 22).fillAndStroke(PDF_BRAND_COLORS.surface, '#cbd5e1');
  doc.font('Helvetica-Bold').fontSize(9).fillColor(PDF_BRAND_COLORS.textPrimary).text('TOTAL GENERAL', left + 8, resumenTotalY + 7, {
    width: totalLabelWidth - 16,
    align: 'right',
  });
  doc.text(money(totalFinal, compra.moneda), left + totalLabelWidth + 6, resumenTotalY + 7, {
    width: totalAmountWidth - 12,
    align: 'center',
  });

  doc.y = resumenTotalY + 28;

  doc.moveDown(1);
  doc.font('Helvetica').fontSize(8).fillColor(PDF_BRAND_COLORS.textSecondary).text(
    'Si tienes dudas, contactar a:\ncontacto@alfosac.pe\n+51 978772509',
    left,
    bottomLimit - 24,
    { width: usableWidth, align: 'center' }
  );

  doc.end();
});

const buildServicioPdfBase64 = (servicio) => new Promise((resolve, reject) => {
  const doc = new PDFDocument({ margin: 36, size: 'A4', bufferPages: true });
  const chunks = [];

  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const left = 36;
  const right = 36;
  const usableWidth = pageWidth - left - right;
  const bottomLimit = pageHeight - 72;

  const safeText = (value) => String(value || '').replace(/\s+/g, ' ').trim() || 'N/D';
  const currencyLabel = safeText(servicio.moneda || servicio.proveedor_moneda || 'PEN');
  const money = (value, currency = currencyLabel) => `${Number(value || 0).toFixed(2)} ${safeText(currency)}`;
  const companyAddress = 'Av Nestor Gambeta N°4783 Callao - Callao';
  const companyRuc = '20606777257';
  const companyWeb = 'www.alfosac.pe';

  const ensureSpace = (needed = 24) => {
    if (doc.y + needed > bottomLimit) {
      doc.addPage();
      drawHeader();
    }
  };

  const writeSectionTitle = (title) => {
    ensureSpace(28);
    doc.font('Helvetica-Bold').fontSize(11).fillColor(PDF_BRAND_COLORS.primaryDark).text(title, left, doc.y, { width: usableWidth });
    doc.moveDown(0.2);
    doc.moveTo(left, doc.y).lineTo(pageWidth - right, doc.y).strokeColor(PDF_BRAND_COLORS.line).lineWidth(0.8).stroke();
    doc.moveDown(0.5);
  };

  const estimateBlockHeight = (rows = []) => {
    const measureRowHeight = (label, value, labelWidth, valueWidth) => {
      const textLabel = `${safeText(label)}:`;
      const textValue = safeText(value);
      doc.font('Helvetica-Bold').fontSize(8.5);
      const labelHeight = doc.heightOfString(textLabel, { width: labelWidth, align: 'left' });
      doc.font('Helvetica').fontSize(8.5);
      const valueHeight = doc.heightOfString(textValue, { width: valueWidth, align: 'left' });
      return Math.max(18, Math.max(labelHeight, valueHeight));
    };

    let total = 26;
    const labelWidth = 98;
    const valueWidth = 136;
    rows.forEach(([label, value]) => {
      total += measureRowHeight(label, value, labelWidth, valueWidth) + 8;
    });
    return total + 10;
  };

  const drawInfoBlock = ({ title, rows, x, y, width }) => {
    const rowGap = 8;
    const paddingX = 10;
    const paddingY = 8;
    const titleHeight = 18;
    const labelWidth = Math.max(98, Math.floor(width * 0.38));
    const valueWidth = width - (paddingX * 2) - labelWidth - 8;

    // Filter out empty rows
    const effectiveRows = (Array.isArray(rows) ? rows : []).filter(([label, value]) => {
      return String(label || '').trim() !== '' || String(value || '').trim() !== '';
    });

    if (effectiveRows.length === 0) return y;

    const measureRowHeight = (label, value) => {
      const textLabel = `${safeText(label)}:`;
      const textValue = safeText(value);
      doc.font('Helvetica-Bold').fontSize(8.5);
      const labelHeight = doc.heightOfString(textLabel, { width: labelWidth, align: 'left' });
      doc.font('Helvetica').fontSize(8.5);
      const valueHeight = doc.heightOfString(textValue, { width: valueWidth, align: 'left' });
      return {
        textLabel,
        textValue,
        rowHeight: Math.max(18, Math.max(labelHeight, valueHeight)),
      };
    };

    // Special-case: single full-width value -> flow text across pages
    const isSingleFullWidth = effectiveRows.length === 1 && String(effectiveRows[0][0] || '').trim() === '';
    if (isSingleFullWidth) {
      const blockHeight = titleHeight + (paddingY * 2) + 40;
      ensureSpace(blockHeight);
      const actualY = doc.y;
      doc.rect(x, actualY, width, titleHeight).fillAndStroke(PDF_BRAND_COLORS.sectionHeader, '#dbe3ec');
      doc.font('Helvetica-Bold').fontSize(9).fillColor(PDF_BRAND_COLORS.textPrimary).text(title, x + paddingX, actualY + 5, {
        width: width - (paddingX * 2),
      });
      doc.font('Helvetica').fontSize(8.5).fillColor(PDF_BRAND_COLORS.textPrimary).text(safeText(effectiveRows[0][1]), x + paddingX, actualY + titleHeight + paddingY, {
        width: width - (paddingX * 2),
        align: 'left',
      });
      return actualY + blockHeight;
    }

    let contentHeight = 0;
    effectiveRows.forEach(([label, value]) => {
      const measured = measureRowHeight(label, value);
      contentHeight += measured.rowHeight + rowGap;
    });

    const blockHeight = titleHeight + (paddingY * 2) + contentHeight;

    // Ensure space but use provided Y position, not doc.y, to maintain alignment in two-column layout
    if (y + blockHeight > bottomLimit) {
      doc.addPage();
      drawHeader();
      // For two-column layout, adjust y to account for page break
      const adjustedY = doc.y;
      doc.rect(x, adjustedY, width, blockHeight).fillAndStroke(PDF_BRAND_COLORS.surface, '#dbe3ec');
      doc.rect(x, adjustedY, width, titleHeight).fillAndStroke(PDF_BRAND_COLORS.sectionHeader, '#dbe3ec');
      doc.font('Helvetica-Bold').fontSize(9).fillColor(PDF_BRAND_COLORS.textPrimary).text(title, x + paddingX, adjustedY + 5, {
        width: width - (paddingX * 2),
      });

      let rowY = adjustedY + titleHeight + paddingY;
      effectiveRows.forEach(([label, value]) => {
        const { textLabel, textValue, rowHeight } = measureRowHeight(label, value);
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(PDF_BRAND_COLORS.textSecondary).text(textLabel, x + paddingX, rowY, {
          width: labelWidth,
        });
        doc.font('Helvetica').fontSize(8.5).fillColor(PDF_BRAND_COLORS.textPrimary).text(textValue, x + paddingX + labelWidth + 8, rowY, {
          width: valueWidth,
        });
        rowY += rowHeight + rowGap;
      });
      return adjustedY + blockHeight;
    }

    // Draw block at provided y position (for two-column alignment)
    doc.rect(x, y, width, blockHeight).fillAndStroke(PDF_BRAND_COLORS.surface, '#dbe3ec');
    doc.rect(x, y, width, titleHeight).fillAndStroke(PDF_BRAND_COLORS.sectionHeader, '#dbe3ec');
    doc.font('Helvetica-Bold').fontSize(9).fillColor(PDF_BRAND_COLORS.textPrimary).text(title, x + paddingX, y + 5, {
      width: width - (paddingX * 2),
    });

    let rowY = y + titleHeight + paddingY;
    effectiveRows.forEach(([label, value]) => {
      const { textLabel, textValue, rowHeight } = measureRowHeight(label, value);

      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(PDF_BRAND_COLORS.textSecondary).text(textLabel, x + paddingX, rowY, {
        width: labelWidth,
      });
      doc.font('Helvetica').fontSize(8.5).fillColor(PDF_BRAND_COLORS.textPrimary).text(textValue, x + paddingX + labelWidth + 8, rowY, {
        width: valueWidth,
      });

      rowY += rowHeight + rowGap;
    });

    return y + blockHeight;
  };

  const renderTwoColumnBlocks = (blocks) => {
    const colGap = 12;
    const colWidth = (usableWidth - colGap) / 2;
    let cursorY = doc.y;

    for (let i = 0; i < blocks.length; i += 2) {
      const leftBlock = blocks[i];
      const rightBlock = blocks[i + 1] || null;
      const estimatedPairHeight = Math.max(
        estimateBlockHeight(leftBlock?.rows || []),
        rightBlock ? estimateBlockHeight(rightBlock.rows || []) : 0,
      ) + 10;

      // Check if we need a page break
      if (cursorY + estimatedPairHeight > bottomLimit) {
        doc.addPage();
        drawHeader();
        cursorY = doc.y;
      }

      // Draw left block at current cursor Y
      const leftBottom = drawInfoBlock({
        title: leftBlock.title,
        rows: leftBlock.rows,
        x: left,
        y: cursorY,
        width: colWidth,
      });

      // Draw right block at the SAME cursor Y for perfect alignment
      let pairBottom = leftBottom;
      if (rightBlock) {
        const rightBottom = drawInfoBlock({
          title: rightBlock.title,
          rows: rightBlock.rows,
          x: left + colWidth + colGap,
          y: cursorY,
          width: colWidth,
        });
        pairBottom = Math.max(leftBottom, rightBottom);
      }

      // Move cursor to the bottom of the taller block, plus gap
      cursorY = pairBottom + 10;
      doc.y = cursorY;
    }
  };

  const drawHeader = () => {
    const logoPath = getCompanyLogoPath('dark');

    doc.rect(left, 18, usableWidth, 62).fill(PDF_BRAND_COLORS.primaryDark);

    if (logoPath) {
      doc.image(logoPath, left + 12, 24, {
        fit: [84, 50],
        align: 'left',
        valign: 'center',
      });
    }

    doc.font('Helvetica-Bold').fontSize(15).fillColor('#ffffff').text('ORDEN DE SERVICIO', left, 32, { width: usableWidth - 14, align: 'right' });
    doc.font('Helvetica').fontSize(9).fillColor(PDF_BRAND_COLORS.textSecondary).text(`Dirección: ${companyAddress}`, left, 94, { width: usableWidth, align: 'center' });
    doc.text(`RUC: ${companyRuc}`, left, 106, { width: usableWidth, align: 'center' });
    doc.text(`Sitio Web: ${companyWeb}`, left, 118, { width: usableWidth, align: 'center' });
    doc.moveTo(left, 132).lineTo(pageWidth - right, 132).strokeColor(PDF_BRAND_COLORS.line).lineWidth(0.9).stroke();
    doc.y = 140;
  };

  doc.on('data', (chunk) => chunks.push(chunk));
  doc.on('error', reject);
  doc.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));

  doc.on('pageAdded', () => {
    doc.y = 140;
  });

  drawHeader();

  const parseAmount = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const hasSubtotal = servicio.subtotal !== null
    && servicio.subtotal !== undefined
    && String(servicio.subtotal).trim() !== '';

  const igv = Number(servicio.igv || 0);
  const costoEnvio = Number(servicio.costo_envio || 0);
  const otrosCostos = Number(servicio.otros_costos || 0);
  let subtotal = hasSubtotal ? parseAmount(servicio.subtotal) : 0;
  if (!hasSubtotal) {
    const sourceTotal = parseAmount(servicio.total || servicio.costo || 0);
    const derivedSubtotal = Number((sourceTotal - igv - costoEnvio - otrosCostos).toFixed(2));
    subtotal = derivedSubtotal > 0 ? derivedSubtotal : parseAmount(servicio.costo || 0);
  }

  const totalBase = Number((subtotal + igv + costoEnvio + otrosCostos).toFixed(2));
  const aplicaRetencion = Boolean(servicio.aplica_retencion);
  const porcentajeRetencion = Number(servicio.proveedor_retencion_pct || servicio.retencion || 0);
  const montoRetenido = aplicaRetencion ? Number((totalBase * (porcentajeRetencion / 100)).toFixed(2)) : 0;
  const totalFinal = parseAmount(servicio.total || totalBase);
  const approverEntries = buildPdfApprovalEntries({
    approvals: servicio.aprobadores,
    creatorUserId: servicio.id_usuario,
    creatorRoleId: servicio.usuario_rol_id,
    creatorName: servicio.usuario,
  });
  const approversSummary = approverEntries
    .map((row) => `${safeText(row.etapa || row.rol || getApprovalRoleLabel(row.rol_aprobador))} - ${safeText(row.aprobador || 'Pendiente')}`)
    .join(' | ');

  writeSectionTitle('Resumen');
  ensureSpace(98);
  const resumenTop = doc.y;
  const resumenRows = [
    ['Número de orden', servicio.numero_orden || `OS-${servicio.id}`],
    ['Fecha', new Date(servicio.fecha || Date.now()).toLocaleDateString()],
    ['Proveedor', servicio.proveedor],
    ['Área destino', servicio.area],
  ];
  const resumenRowHeight = 20;
  const resumenLabelWidth = 160;

  doc.rect(left, resumenTop, usableWidth, 20).fillAndStroke(PDF_BRAND_COLORS.sectionHeader, '#cbd5e1');
  doc.font('Helvetica-Bold').fontSize(9).fillColor(PDF_BRAND_COLORS.textPrimary).text('Datos de la orden', left + 10, resumenTop + 6, {
    width: usableWidth - 20,
    align: 'left',
  });

  let resumenY = resumenTop + 20;
  resumenRows.forEach(([label, value], index) => {
    const isAlternate = index % 2 === 0;
    const valueHeight = doc.heightOfString(safeText(value), {
      width: usableWidth - resumenLabelWidth - 20,
      align: 'left',
    });
    const rowHeight = Math.max(resumenRowHeight, valueHeight + 12);
    doc.rect(left, resumenY, usableWidth, rowHeight).fillAndStroke(isAlternate ? '#f8fafc' : '#ffffff', '#e2e8f0');
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(PDF_BRAND_COLORS.textSecondary).text(`${label}:`, left + 10, resumenY + 6, {
      width: resumenLabelWidth,
      align: 'left',
    });
    doc.font('Helvetica').fontSize(8.5).fillColor(PDF_BRAND_COLORS.textPrimary).text(safeText(value), left + 10 + resumenLabelWidth, resumenY + 6, {
      width: usableWidth - resumenLabelWidth - 20,
      align: 'left',
    });
    resumenY += rowHeight;
  });
  doc.y = resumenY + 10;

  doc.y += 10;

  renderTwoColumnBlocks([
    {
      title: 'Servicio y estado',
      rows: [
        ['Nombre', servicio.nombre_servicio || servicio.descripcion_servicio],
        ['Descripción', servicio.descripcion_servicio],
        ['Solicitante', servicio.usuario],
        ['Prioridad', servicio.prioridad],
        ['Estado', normalize(servicio.estado_flujo || servicio.estado_servicio) === 'PENDIENTE' ? 'PENDIENTE DE REALIZACION' : (servicio.estado_flujo || servicio.estado_servicio)],
        ['Estado aprobación', servicio.estado_aprobacion],
      ],
    },
    {
      title: 'Proveedor',
      rows: [
        ['Moneda', currencyLabel],
        ['RUC', servicio.proveedor_ruc],
        ['Dirección', servicio.proveedor_direccion],
        ['Banco', servicio.proveedor_banco],
        ['Cuenta', servicio.proveedor_cuenta],
        ['CCI', servicio.proveedor_cci],
        ['Condiciones de pago', servicio.proveedor_condiciones_pago],
      ],
    },
    {
      title: 'Detalle financiero',
      rows: [
        ['Subtotal', money(subtotal)],
        ['IGV', money(igv)],
        ['Costo envío', money(costoEnvio)],
        ['Otros costos', money(otrosCostos)],
        ['Total base', money(totalBase)],
        ['Retención aplicada', aplicaRetencion ? 'SÍ' : 'NO'],
        ['Porcentaje', `${porcentajeRetencion.toFixed(2)}%`],
        ['Monto retenido', money(montoRetenido)],
      ],
    },
    {
      title: 'Aprobaciones',
      rows: [
        ['Flujo', approversSummary || 'Sin aprobaciones registradas'],
      ],
    },
  ]);
  doc.y += 10;

  if (doc.y + 24 > bottomLimit - 4) {
    doc.addPage();
    drawHeader();
    doc.y = doc.y;
  }

  const resumenTotalY = doc.y;
  const totalAmountWidth = 180;
  const totalLabelWidth = usableWidth - totalAmountWidth;
  doc.rect(left, resumenTotalY, totalLabelWidth, 22).fillAndStroke(PDF_BRAND_COLORS.surface, '#cbd5e1');
  doc.rect(left + totalLabelWidth, resumenTotalY, totalAmountWidth, 22).fillAndStroke(PDF_BRAND_COLORS.surface, '#cbd5e1');
  doc.font('Helvetica-Bold').fontSize(9).fillColor(PDF_BRAND_COLORS.textPrimary).text('TOTAL GENERAL', left + 8, resumenTotalY + 7, {
    width: totalLabelWidth - 16,
    align: 'right',
  });
  doc.text(money(totalFinal), left + totalLabelWidth + 6, resumenTotalY + 7, {
    width: totalAmountWidth - 12,
    align: 'center',
  });

  doc.y = resumenTotalY + 28;

  doc.moveDown(1);
  doc.font('Helvetica').fontSize(8).fillColor(PDF_BRAND_COLORS.textSecondary).text(
    'Si tienes dudas, contactar a:\ncontacto@alfosac.pe\n+51 978772509',
    left,
    bottomLimit - 24,
    { width: usableWidth, align: 'center' }
  );

  doc.end();
});

const schemaMeta = {
  loaded: false,
  proveedoresColumns: new Set(),
  comprasColumns: new Set(),
  detalleComprasColumns: new Set(),
  stockColumns: new Set(),
  movimientosColumns: new Set(),
  serviciosColumns: new Set(),
  materialesColumns: new Set(),
  requerimientosColumns: new Set(),
  usuariosColumns: new Set(),
  requerimientoReceptorIdColumn: null,
  usuariosRoleIdColumn: 'id_role',
  usuariosEmailColumn: 'email',
  usuariosPasswordColumn: 'password_hash',
  usuariosEstadoColumn: null,
};

const getColumnSet = async (tableName) => {
  const result = await pool.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
    `,
    [tableName]
  );

  return new Set(result.rows.map((row) => row.column_name));
};

const dbFunctionExists = async (signature) => {
  const [namePart, argsPart = ''] = String(signature || '').split('(');
  const functionName = namePart.trim();
  const argList = argsPart.replace(/\)\s*$/, '').trim();

  const result = await pool.query(
    `
      SELECT EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.proname = $1
          AND n.nspname = 'public'
          AND (
            $2 = ''
            OR pg_get_function_identity_arguments(p.oid) = $2
          )
      ) AS exists
    `,
    [functionName, argList]
  );

  return Boolean(result.rows[0]?.exists);
};

const pickExistingColumn = (columnSet, candidates = []) => {
  for (const candidate of candidates) {
    if (columnSet.has(candidate)) {
      return candidate;
    }
  }
  return null;
};

const getUserRoleIdExpr = (tableAlias) => {
  // Try to use direct column reference, fallback to JSON extraction
  const columns = schemaMeta.usuariosColumns || new Set();
  const hasIdRole = columns.has('id_role');
  const hasIdRol = columns.has('id_rol');
  
  if (hasIdRole || hasIdRol) {
    // Use direct column reference if available
    const colName = hasIdRole ? 'id_role' : 'id_rol';
    return `COALESCE(${tableAlias}.${colName}, 0)`;
  }
  
  // Fallback to JSON extraction
  return `NULLIF(COALESCE(to_jsonb(${tableAlias})->>'id_role', to_jsonb(${tableAlias})->>'id_rol', ''), '')::int`;
};

const getUserRoleIdColumn = () => schemaMeta.usuariosRoleIdColumn || 'id_role';
const getUserEmailExpr = (tableAlias) =>
  `NULLIF(COALESCE(to_jsonb(${tableAlias})->>'email', to_jsonb(${tableAlias})->>'correo', ''), '')`;
const getUserPhotoColumn = () => pickExistingColumn(schemaMeta.usuariosColumns, ['foto', 'imagen']);
const getUserPasswordExpr = (tableAlias) =>
  `NULLIF(COALESCE(to_jsonb(${tableAlias})->>'password_hash', to_jsonb(${tableAlias})->>'contraseña', to_jsonb(${tableAlias})->>'contrasena', ''), '')`;
const getUserEstadoExpr = (tableAlias) =>
  `NULLIF(COALESCE(to_jsonb(${tableAlias})->>'estado', ''), '')`;
const getRequerimientoDescripcionExpr = (tableAlias) =>
  `NULLIF(COALESCE(to_jsonb(${tableAlias})->>'comentario', to_jsonb(${tableAlias})->>'descripcion', to_jsonb(${tableAlias})->>'observaciones', ''), '')`;
const getRequerimientoDescripcionColumn = () =>
  pickExistingColumn(schemaMeta.requerimientosColumns, ['comentario', 'descripcion', 'observaciones']) || 'comentario';
const getRequerimientoApprovalColumn = () =>
  pickExistingColumn(schemaMeta.requerimientosColumns, ['estado_aprobacion']);
const getMovimientoTipoColumn = () =>
  pickExistingColumn(schemaMeta.movimientosColumns, ['tipo_movimiento', 'tipo']) || 'tipo';
const getMovimientoFechaColumn = () =>
  pickExistingColumn(schemaMeta.movimientosColumns, ['fecha_movimiento', 'fecha']);
const getMovimientoUsuarioColumn = () =>
  pickExistingColumn(schemaMeta.movimientosColumns, ['usuario_registro', 'id_usuario', 'usuario_id']);
const getMovimientoRequerimientoColumn = () =>
  pickExistingColumn(schemaMeta.movimientosColumns, ['id_requerimiento', 'requerimiento_id']);
const getMovimientoMaterialColumn = () =>
  pickExistingColumn(schemaMeta.movimientosColumns, ['id_material']);
const getMovimientoCantidadColumn = () =>
  pickExistingColumn(schemaMeta.movimientosColumns, ['cantidad']);
const getMovimientoDocumentoColumn = () =>
  pickExistingColumn(schemaMeta.movimientosColumns, ['documento_referencia', 'documento']);
const getMovimientoAlmacenColumn = () =>
  pickExistingColumn(schemaMeta.movimientosColumns, ['id_almacen']);
const getMovimientoObservacionesColumn = () =>
  pickExistingColumn(schemaMeta.movimientosColumns, ['observaciones', 'comentarios', 'descripcion']);
const getServicioUserIdColumn = () =>
  pickExistingColumn(schemaMeta.serviciosColumns, ['id_usuario', 'usuario_id']) || 'id_usuario';
const getServicioProviderIdColumn = () =>
  pickExistingColumn(schemaMeta.serviciosColumns, ['proveedor_id', 'id_proveedor']) || 'proveedor_id';
const getServicioAreaIdColumn = () =>
  pickExistingColumn(schemaMeta.serviciosColumns, ['area_id', 'id_area']) || 'area_id';
const getServicioDescriptionColumn = () =>
  pickExistingColumn(schemaMeta.serviciosColumns, ['descripcion_servicio', 'descripcion', 'comentario']) || 'descripcion_servicio';
const getServicioNameColumn = () =>
  pickExistingColumn(schemaMeta.serviciosColumns, ['nombre_servicio', 'nombre', 'titulo']) || 'nombre_servicio';
const getServicioPriorityColumn = () =>
  pickExistingColumn(schemaMeta.serviciosColumns, ['prioridad', 'nivel_prioridad']) || 'prioridad';
const getServicioDentroPlanColumn = () =>
  pickExistingColumn(schemaMeta.serviciosColumns, ['dentro_plan', 'en_plan']);
const getServicioSubtotalColumn = () =>
  pickExistingColumn(schemaMeta.serviciosColumns, ['subtotal']);
const getServicioImpuestosColumn = () =>
  pickExistingColumn(schemaMeta.serviciosColumns, ['impuestos', 'igv']);
const getServicioIgvColumn = () =>
  pickExistingColumn(schemaMeta.serviciosColumns, ['igv', 'impuestos']);
const getServicioCostoEnvioColumn = () =>
  pickExistingColumn(schemaMeta.serviciosColumns, ['costo_envio', 'envio']);
const getServicioOtrosCostosColumn = () =>
  pickExistingColumn(schemaMeta.serviciosColumns, ['otros_costos', 'otros_gastos']);
const getServicioTotalColumn = () =>
  pickExistingColumn(schemaMeta.serviciosColumns, ['total']);
const getServicioAplicaRetencionColumn = () =>
  pickExistingColumn(schemaMeta.serviciosColumns, ['aplica_retencion']);
const getServicioRetencionColumn = () =>
  pickExistingColumn(schemaMeta.serviciosColumns, ['retencion', 'descuento']);
const getServicioTipoRetencionColumn = () =>
  pickExistingColumn(schemaMeta.serviciosColumns, ['tipo_retencion']);
const getServicioCostColumn = () =>
  pickExistingColumn(schemaMeta.serviciosColumns, ['costo', 'importe', 'monto']) || 'costo';
const getServicioCurrencyIdColumn = () =>
  pickExistingColumn(schemaMeta.serviciosColumns, ['moneda_id', 'id_moneda']) || 'moneda_id';
const getServicioApprovalColumn = () =>
  pickExistingColumn(schemaMeta.serviciosColumns, ['estado_aprobacion', 'estado']) || 'estado_aprobacion';
const getServicioStatusColumn = () =>
  pickExistingColumn(schemaMeta.serviciosColumns, ['estado_flujo', 'estado_servicio']) || 'estado_flujo';
const quoteIdentifier = (name) => `"${String(name || '').replace(/"/g, '""')}"`;

const fetchServiciosRows = async (params = [], whereClause = '', options = {}) => {
  const servicioProviderExpr = `NULLIF(COALESCE(to_jsonb(s)->>'proveedor_id', to_jsonb(s)->>'id_proveedor', ''), '')::int`;
  const servicioAreaExpr = `NULLIF(COALESCE(to_jsonb(s)->>'area_id', to_jsonb(s)->>'id_area', ''), '')::int`;
  const servicioUserExpr = `NULLIF(COALESCE(to_jsonb(s)->>'id_usuario', to_jsonb(s)->>'usuario_id', ''), '')::int`;
  const servicioMonedaExpr = `NULLIF(COALESCE(to_jsonb(s)->>'moneda_id', to_jsonb(s)->>'id_moneda', ''), '')::int`;

  const result = await pool.query(
    `
      SELECT
        s.id,
        ${servicioUserExpr} AS id_usuario,
        ${getUserRoleIdExpr('u')} AS usuario_rol_id,
        COALESCE(r_usuario.nombre, '') AS usuario_rol,
        ${servicioProviderExpr} AS proveedor_id,
        ${servicioAreaExpr} AS area_id,
        ${servicioMonedaExpr} AS moneda_id,
        COALESCE(NULLIF(COALESCE(to_jsonb(s)->>'nombre_servicio', to_jsonb(s)->>'nombre', to_jsonb(s)->>'titulo', ''), ''), '') AS nombre_servicio,
        COALESCE(NULLIF(COALESCE(to_jsonb(s)->>'prioridad', to_jsonb(s)->>'nivel_prioridad', 'MEDIA'), ''), 'MEDIA') AS prioridad,
        COALESCE(NULLIF(COALESCE(to_jsonb(s)->>'descripcion_servicio', to_jsonb(s)->>'descripcion', to_jsonb(s)->>'comentario', ''), ''), '') AS descripcion_servicio,
        CASE
          WHEN lower(trim(COALESCE(to_jsonb(s)->>'dentro_plan', to_jsonb(s)->>'en_plan', 'false'))) IN ('true', 't', '1', 'si', 'yes', 'y') THEN TRUE
          ELSE FALSE
        END AS dentro_plan,
        COALESCE(NULLIF(COALESCE(to_jsonb(s)->>'costo', to_jsonb(s)->>'importe', to_jsonb(s)->>'monto', '0'), '')::numeric, 0) AS costo,
        NULLIF(COALESCE(to_jsonb(s)->>'subtotal', ''), '')::numeric AS subtotal,
        NULLIF(COALESCE(to_jsonb(s)->>'igv', to_jsonb(s)->>'impuestos', ''), '')::numeric AS igv,
        NULLIF(COALESCE(to_jsonb(s)->>'costo_envio', ''), '')::numeric AS costo_envio,
        NULLIF(COALESCE(to_jsonb(s)->>'otros_costos', ''), '')::numeric AS otros_costos,
        NULLIF(COALESCE(to_jsonb(s)->>'total', ''), '')::numeric AS total,
        CASE
          WHEN upper(trim(COALESCE(to_jsonb(s)->>'aplica_retencion', ''))) IN ('TRUE', 'T', '1', 'SI', 'YES') THEN TRUE
          ELSE FALSE
        END AS aplica_retencion,
        NULLIF(COALESCE(to_jsonb(s)->>'retencion', to_jsonb(s)->>'descuento', ''), '')::numeric AS retencion,
        COALESCE(NULLIF(upper(trim(COALESCE(to_jsonb(s)->>'tipo_retencion', ''))), ''), 'RETENCION') AS tipo_retencion,
        COALESCE(upper(trim(COALESCE(to_jsonb(s)->>'estado_aprobacion', to_jsonb(s)->>'estado', 'PENDIENTE'))), 'PENDIENTE') AS estado_aprobacion,
        COALESCE(NULLIF(upper(trim(COALESCE(to_jsonb(s)->>'estado_flujo', to_jsonb(s)->>'estado_servicio', ''))), ''), NULL) AS estado_flujo,
        COALESCE(NULLIF(upper(trim(COALESCE(to_jsonb(s)->>'estado_flujo', to_jsonb(s)->>'estado_servicio', ''))), ''), NULL) AS estado_servicio,
        COALESCE(
          NULLIF(to_jsonb(s)->>'fecha_creacion', '')::timestamp,
          NULLIF(to_jsonb(s)->>'created_at', '')::timestamp,
          NULLIF(to_jsonb(s)->>'fecha', '')::timestamp,
          NOW()
        ) AS fecha,
        COALESCE(p.razon_social, p.nombre, 'Sin proveedor') AS proveedor,
        COALESCE(to_jsonb(p)->>'ruc', '') AS proveedor_ruc,
        COALESCE(to_jsonb(p)->>'direccion', '') AS proveedor_direccion,
        COALESCE(to_jsonb(p)->>'banco', '') AS proveedor_banco,
        COALESCE(to_jsonb(p)->>'numero_cuenta', to_jsonb(p)->>'cuenta', '') AS proveedor_cuenta,
        COALESCE(to_jsonb(p)->>'cci', '') AS proveedor_cci,
        COALESCE(to_jsonb(p)->>'condiciones_pago', '') AS proveedor_condiciones_pago,
        COALESCE(to_jsonb(p)->>'correo', '') AS proveedor_correo,
        COALESCE(to_jsonb(p)->>'telefono', '') AS proveedor_telefono,
        COALESCE(upper(trim(COALESCE(to_jsonb(p)->>'retencion', 'NO'))), 'NO') AS proveedor_retencion,
        COALESCE(NULLIF(upper(trim(COALESCE(to_jsonb(p)->>'tipo_retencion', ''))), ''), 'RETENCION') AS proveedor_tipo_retencion,
        COALESCE(NULLIF(COALESCE(to_jsonb(p)->>'descuento', ''), '')::numeric, 0) AS proveedor_retencion_pct,
        COALESCE(pm.nombre, '') AS proveedor_moneda,
        COALESCE(a.nombre, 'Sin area') AS area,
        COALESCE(mo.nombre, '') AS moneda,
        COALESCE(u.nombre, 'Sin usuario') AS usuario,
        (csr.puntuacion IS NOT NULL) AS calificacion_servicio_existe,
        csr.puntuacion AS calificacion_servicio_puntuacion,
        COALESCE(csr.comentario, '') AS calificacion_servicio_comentario,
        csr.fecha AS calificacion_servicio_fecha
      FROM servicios s
      LEFT JOIN proveedores p ON p.id = ${servicioProviderExpr}
      LEFT JOIN monedas pm ON pm.id = NULLIF(COALESCE(to_jsonb(p)->>'id_moneda', ''), '')::int
      LEFT JOIN areas a ON a.id = ${servicioAreaExpr}
      LEFT JOIN monedas mo ON mo.id = ${servicioMonedaExpr}
      LEFT JOIN usuarios u ON u.id = ${servicioUserExpr}
      LEFT JOIN roles r_usuario ON r_usuario.id = ${getUserRoleIdExpr('u')}
      LEFT JOIN LATERAL (
        SELECT cp.puntuacion, cp.comentario, cp.fecha
        FROM calificaciones_proveedor cp
        WHERE cp.id_proveedor = ${servicioProviderExpr}
          AND lower(trim(COALESCE(cp.tipo, ''))) = 'servicio'
          AND cp.id_referencia = s.id
        ORDER BY cp.fecha DESC, cp.id DESC
        LIMIT 1
      ) csr ON TRUE
      ${whereClause}
      ORDER BY
        CASE upper(trim(COALESCE(to_jsonb(s)->>'prioridad', to_jsonb(s)->>'nivel_prioridad', 'MEDIA')))
          WHEN 'ALTA' THEN 1
          WHEN 'MEDIA' THEN 2
          WHEN 'BAJA' THEN 3
          ELSE 4
        END,
        fecha DESC,
        s.id DESC
    `,
    params
  );

  const servicios = result.rows.map((row) => {
    const parsedDescription = parseEmbeddedCommentsFromText(row.descripcion_servicio || '');
    return {
      ...row,
      descripcion_servicio: parsedDescription.text,
      comentarios_historial: [],
      usuario_rol_id: Number(row.usuario_rol_id || 0) || null,
      usuario_rol: row.usuario_rol,
    };
  });

  const commentsByServicio = await fetchCommentsForEntities(pool, {
    tipoEntidad: 'servicio',
    entityIds: servicios.map((row) => Number(row.id || 0)),
  });

  servicios.forEach((row) => {
    row.comentarios_historial = commentsByServicio.get(Number(row.id || 0)) || [];
  });

  const approvalRoleId = Number(options?.approvalRoleId || 0);
  const approvalPermissionGranted = Boolean(options?.approvalPermissionGranted);
  if (approvalRoleId > 0) {
    const actionableIds = await fetchActionableApprovalReferenceIds(pool, {
      tipo: 'SERVICIO',
      roleId: approvalRoleId,
      referenceIds: servicios.map((row) => Number(row.id || 0)),
    });

    servicios.forEach((row) => {
      const canApprove = approvalPermissionGranted
        && actionableIds.has(Number(row.id || 0))
          && isPendingServiceApprovalState(row.estado_aprobacion);
    row.estado_aprobacion_detalle = buildApprovalStatusLabel({
      currentStatus: row.estado_aprobacion,
      nextPendingRole: nextPendingByRef.get(refId),
    });
  });

  return servicios;
};

const insertMovimiento = async (client, {
  tipo,
  usuarioRegistro,
  idRequerimiento = null,
  idMaterial = null,
  cantidad = null,
  documentoReferencia = null,
  idAlmacen = null,
  observaciones = null,
  fechaExpression = 'NOW()',
} = {}) => {
  const columns = [];
  const values = [];
  const valueTokens = [];

  const addValue = (columnName, value) => {
    if (!columnName) return;
    columns.push(columnName);
    values.push(value);
    valueTokens.push(`$${values.length}`);
  };

  const addExpression = (columnName, expression) => {
    if (!columnName) return;
    columns.push(columnName);
    valueTokens.push(String(expression || 'NOW()'));
  };

  addValue(getMovimientoTipoColumn(), String(tipo || '').trim().toUpperCase());
  addExpression(getMovimientoFechaColumn(), fechaExpression);
  addValue(getMovimientoUsuarioColumn(), usuarioRegistro == null ? null : String(usuarioRegistro));
  addValue(getMovimientoRequerimientoColumn(), idRequerimiento == null ? null : Number(idRequerimiento));
  addValue(getMovimientoMaterialColumn(), idMaterial == null ? null : Number(idMaterial));
  addValue(getMovimientoCantidadColumn(), cantidad == null ? null : Number(cantidad));
  addValue(getMovimientoDocumentoColumn(), documentoReferencia == null ? null : String(documentoReferencia));
  addValue(getMovimientoAlmacenColumn(), idAlmacen == null ? null : Number(idAlmacen));
  addValue(getMovimientoObservacionesColumn(), observaciones == null ? null : String(observaciones));

  const result = await client.query(
    `
      INSERT INTO movimientos (${columns.join(', ')})
      VALUES (${valueTokens.join(', ')})
      RETURNING id
    `,
    values
  );

  return Number(result.rows[0]?.id || 0);
};

const loadSchemaMeta = async () => {
  schemaMeta.proveedoresColumns = await getColumnSet('proveedores');
  schemaMeta.comprasColumns = await getColumnSet('compras');
  schemaMeta.detalleComprasColumns = await getColumnSet('detalle_compras');
  schemaMeta.stockColumns = await getColumnSet('stock');
  schemaMeta.movimientosColumns = await getColumnSet('movimientos');
  schemaMeta.serviciosColumns = await getColumnSet('servicios');
  schemaMeta.materialesColumns = await getColumnSet('materiales');
  schemaMeta.requerimientosColumns = await getColumnSet('requerimientos');
  schemaMeta.usuariosColumns = await getColumnSet('usuarios');

  schemaMeta.requerimientoReceptorIdColumn = pickExistingColumn(schemaMeta.requerimientosColumns, ['receptor_user_id']);
  schemaMeta.usuariosRoleIdColumn = pickExistingColumn(schemaMeta.usuariosColumns, ['id_role', 'id_rol']) || 'id_role';
  schemaMeta.usuariosEmailColumn = pickExistingColumn(schemaMeta.usuariosColumns, ['email', 'correo']) || 'email';
  schemaMeta.usuariosPasswordColumn = pickExistingColumn(schemaMeta.usuariosColumns, ['password_hash', 'contraseña', 'contrasena']) || 'password_hash';
  schemaMeta.usuariosEstadoColumn = pickExistingColumn(schemaMeta.usuariosColumns, ['estado']);
  schemaMeta.loaded = true;
};

const proveedorFieldCandidates = {
  nombre: ['nombre', 'nombre_comercial'],
  razon_social: ['razon_social', 'nombre', 'nombre_comercial'],
  ruc: ['ruc'],
  direccion: ['direccion'],
  distrito: ['distrito'],
  correo: ['correo', 'email'],
  persona_responsable: ['persona_responsable', 'contacto', 'responsable'],
  telefono: ['telefono', 'celular'],
  condiciones_pago: ['condiciones_pago'],
  banco: ['banco'],
  moneda: ['moneda'],
  numero_cuenta: ['numero_cuenta', 'cuenta'],
  cci: ['cci'],
  retencion: ['retencion'],
  descuento: ['descuento'],
  categoria: ['categoria'],
  tipo: ['tipo'],
  tipo_retencion: ['tipo_retencion'],
  id_moneda: ['id_moneda'],
  id_area_destino: ['id_area_destino'],
  area_destino: ['area_destino'],
  descripcion: ['descripcion'],
};

const getProveedorColumn = (field) => pickExistingColumn(
  schemaMeta.proveedoresColumns,
  proveedorFieldCandidates[field] || []
);

const buildProveedorSelectExpressions = () => {
  const exprs = ['p.id'];

  Object.keys(proveedorFieldCandidates).forEach((field) => {
    const column = getProveedorColumn(field);
    if (column) {
      exprs.push(`COALESCE(NULLIF(trim(p.${column}::text), ''), '') AS ${field}`);
    } else {
      exprs.push(`''::text AS ${field}`);
    }
  });

  return exprs;
};

const ensureRequerimientosColumns = async () => {
  await pool.query(`
    ALTER TABLE requerimientos
    ADD COLUMN IF NOT EXISTS prioridad VARCHAR(20) DEFAULT 'MEDIA';
  `);

  await pool.query(`
    ALTER TABLE requerimientos
    ADD COLUMN IF NOT EXISTS fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
  `);

  await pool.query(`
    UPDATE requerimientos
    SET prioridad = 'MEDIA'
    WHERE prioridad IS NULL OR trim(prioridad) = '';
  `);

  await pool.query(`
    UPDATE requerimientos
    SET prioridad = upper(trim(prioridad))
    WHERE prioridad IS NOT NULL;
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'requerimientos'
          AND column_name = 'created_at'
      ) THEN
        UPDATE requerimientos
        SET fecha_creacion = COALESCE(fecha_creacion, created_at)
        WHERE fecha_creacion IS NULL;
      END IF;
    END$$;
  `);

  schemaMeta.loaded = false;
  await loadSchemaMeta();
};

const ensureComprasColumns = async () => {
  const compraColumnStatements = [
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS id_usuario INTEGER;`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS id_area_solicitante INTEGER;`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS id_area_final INTEGER;`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS proveedor VARCHAR(200);`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS ruc VARCHAR(11);`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS direccion VARCHAR(255);`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS distrito VARCHAR(100);`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS correo VARCHAR(100);`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS persona_responsable VARCHAR(100);`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS telefono VARCHAR(20);`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS contacto_proveedor VARCHAR(100);`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS banco VARCHAR(100);`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS numero_cuenta VARCHAR(50);`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS cuenta VARCHAR(50);`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS cci VARCHAR(100);`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS retencion VARCHAR(10);`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS descuento NUMERIC(12,2);`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS aplica_retencion BOOLEAN DEFAULT FALSE;`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS tipo VARCHAR(20);`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS tipo_retencion VARCHAR(20);`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS importe_final NUMERIC(12,2);`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS condiciones_pago VARCHAR(100);`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS subtotal NUMERIC(12,2);`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS costo_envio NUMERIC(12,2);`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS otros_costos NUMERIC(12,2);`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS igv NUMERIC(12,2);`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS total NUMERIC(12,2);`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS numero_orden VARCHAR(50);`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS detalle TEXT;`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP;`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP;`,
  ];

  for (const statement of compraColumnStatements) {
    await pool.query(statement);
  }

  await pool.query(`
    ALTER TABLE materiales
    ADD COLUMN IF NOT EXISTS id_moneda INTEGER;
  `);

  await pool.query(`
    ALTER TABLE materiales
    ADD COLUMN IF NOT EXISTS id_proveedor INTEGER;
  `);

  await pool.query(`
    ALTER TABLE materiales
    ADD COLUMN IF NOT EXISTS imagen TEXT;
  `);

  await pool.query(`
    ALTER TABLE usuarios
    ADD COLUMN IF NOT EXISTS dni VARCHAR(20);
  `);

  await pool.query(`
    ALTER TABLE usuarios
    ADD COLUMN IF NOT EXISTS foto TEXT;
  `);

  await pool.query(`
    ALTER TABLE usuarios
    ADD COLUMN IF NOT EXISTS imagen TEXT;
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_materiales_monedas'
      ) THEN
        ALTER TABLE materiales
        ADD CONSTRAINT fk_materiales_monedas
        FOREIGN KEY (id_moneda) REFERENCES monedas(id);
      END IF;
    END$$;
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_materiales_proveedor'
      ) THEN
        ALTER TABLE materiales
        ADD CONSTRAINT fk_materiales_proveedor
        FOREIGN KEY (id_proveedor) REFERENCES proveedores(id);
      END IF;
    END$$;
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'materiales'
          AND column_name = 'moneda'
      ) THEN
        UPDATE materiales m
        SET id_moneda = mo.id
        FROM monedas mo
        WHERE m.id_moneda IS NULL
          AND (
            lower(trim(COALESCE(m.moneda, ''))) = lower(trim(COALESCE(mo.nombre, '')))
          );
      END IF;
    END$$;
  `);

  schemaMeta.loaded = false;
  await loadSchemaMeta();
};

const ensureUsuariosProfileColumns = async () => {
  await pool.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS dni VARCHAR(20);`);
  await pool.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS foto TEXT;`);
  await pool.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS imagen TEXT;`);
};

const ensureMovimientosColumns = async () => {
  await pool.query(`
    ALTER TABLE movimientos
    ADD COLUMN IF NOT EXISTS id_requerimiento INTEGER;
  `);
};

const seedInventoryDemoData = async () => {
  const materialCount = await pool.query('SELECT COUNT(*)::int AS total FROM materiales');
  if (Number(materialCount.rows[0]?.total || 0) > 0) {
    return;
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const adminRole = await client.query("SELECT id FROM roles WHERE upper(trim(nombre)) = 'ADMIN' LIMIT 1");
    const comprasRole = await client.query("SELECT id FROM roles WHERE upper(trim(nombre)) = 'COMPRAS' LIMIT 1");
    const areaRow = await client.query('SELECT id FROM areas ORDER BY id ASC LIMIT 1');
    const warehouseRow = await client.query('SELECT id FROM almacenes ORDER BY id ASC LIMIT 1');
    const unitRow = await client.query("SELECT id FROM unidades WHERE upper(trim(nombre)) = 'UND' LIMIT 1");
    const currencyRow = await client.query("SELECT id FROM monedas WHERE upper(trim(nombre)) = 'SOLES' LIMIT 1");
    const categoryRow = await client.query('SELECT id FROM categorias ORDER BY id ASC LIMIT 1');
    const adminUserRow = await client.query("SELECT id, nombre, email, id_area FROM usuarios WHERE lower(trim(email)) = 'admin@alfosac.pe' LIMIT 1");

    const idAdminRole = Number(adminRole.rows[0]?.id || 0);
    const idComprasRole = Number(comprasRole.rows[0]?.id || 0);
    const idArea = Number(areaRow.rows[0]?.id || 0);
    const idWarehouse = Number(warehouseRow.rows[0]?.id || 0);
    const idUnit = Number(unitRow.rows[0]?.id || 0);
    const idCurrency = Number(currencyRow.rows[0]?.id || 0);
    const idCategory = Number(categoryRow.rows[0]?.id || 0);
    const adminUser = adminUserRow.rows[0];

    if (!idAdminRole || !idComprasRole || !idArea || !idWarehouse || !idUnit || !idCurrency || !idCategory || !adminUser?.id) {
      throw new Error('No se pudieron resolver las claves base para la semilla del inventario');
    }

    await client.query(
      `
        INSERT INTO permisos (nombre, descripcion)
        VALUES
          ('VER_INVENTARIO', 'Puede ver inventario'),
          ('EDITAR_MATERIAL', 'Puede editar materiales'),
          ('GESTIONAR_COMPRAS', 'Puede gestionar compras'),
          ('APROBAR_REQUERIMIENTO', 'Puede aprobar requerimientos'),
          ('COMPLETAR_REQUERIMIENTO', 'Puede completar requerimientos')
        ON CONFLICT (nombre) DO NOTHING
      `
    );

    console.log('[SEED] permisos listos');

    await client.query(
      `
        INSERT INTO rol_permiso (id_rol, id_permiso)
        SELECT $1, p.id
        FROM permisos p
        WHERE upper(trim(p.nombre)) IN ('VER_INVENTARIO', 'EDITAR_MATERIAL', 'GESTIONAR_COMPRAS', 'APROBAR_REQUERIMIENTO', 'COMPLETAR_REQUERIMIENTO')
        ON CONFLICT (id_rol, id_permiso) DO NOTHING
      `,
      [idAdminRole]
    );

    console.log('[SEED] permisos admin listos');

    await client.query(
      `
        INSERT INTO rol_permiso (id_rol, id_permiso)
        SELECT $1, p.id
        FROM permisos p
        WHERE upper(trim(p.nombre)) IN ('VER_INVENTARIO', 'GESTIONAR_COMPRAS')
        ON CONFLICT (id_rol, id_permiso) DO NOTHING
      `,
      [idComprasRole]
    );

    console.log('[SEED] permisos compras listos');

    const providerResult = await client.query(
      `
        INSERT INTO proveedores (
          nombre,
          razon_social,
          direccion,
          distrito,
          ruc,
          correo,
          persona_responsable,
          telefono,
          condiciones_pago,
          banco,
          numero_cuenta,
          cci,
          id_moneda,
          id_area_destino,
          ${getUserRoleIdExpr('u')} AS usuario_rol_id,
          COALESCE(r_usuario.nombre, '') AS usuario_rol,
          descripcion,
          retencion,
          categoria,
          descuento,
        LEFT JOIN roles r_usuario ON r_usuario.id = ${getUserRoleIdExpr('u')}
          tipo,
          tipo_retencion,
          moneda_nombre
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
        ON CONFLICT (ruc) DO UPDATE SET
          nombre = EXCLUDED.nombre,
          razon_social = EXCLUDED.razon_social,
          correo = EXCLUDED.correo,
          telefono = EXCLUDED.telefono
        RETURNING id
      `,
      [
        'Proveedor Demo',
        'Proveedor Demo SAC',
        'Av. Principal 123',
        'Lima',
        '20123456789',
        'proveedor.demo@alfosac.pe',
        'Carlos Demo',
        '999999999',
        '30 dias',
        'Banco Demo',
        '123-456',
        '000-111-222',
        idCurrency,
        idArea,
        'Proveedor inicial para inventario',
        'NO',
        'GENERAL',
        0,
        'BIEN',
        'RETENCION',
        'SOLES',
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
        VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, $8)
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

const hasPermission = async (userId, permission) => {
  const canonicalPermission = canonicalizePermissionName(permission);
  const userRoleExpr = getUserRoleIdExpr('usuarios');
  const result = await pool.query(
    `
      SELECT COUNT(*) AS total
      FROM usuarios
      JOIN rol_permiso ON rol_permiso.id_rol = ${userRoleExpr}
      JOIN permisos ON permisos.id = rol_permiso.id_permiso
      WHERE usuarios.id = $1
        AND upper(trim(permisos.nombre)) IN (upper(trim($2)), upper(trim($3)))
    `,
    [userId, canonicalPermission, permission]
  );

  return Number(result.rows[0]?.total || 0) > 0;
};

const fetchPermissionNamesByUserId = async (db, userId) => {
  const id = Number(userId || 0);
  if (!Number.isInteger(id) || id <= 0) {
    return [];
  }

  const userRoleExpr = getUserRoleIdExpr('u');
  const result = await db.query(
    `
      SELECT DISTINCT upper(trim(p.nombre)) AS nombre
      FROM usuarios u
      JOIN rol_permiso rp ON rp.id_rol = ${userRoleExpr}
      JOIN permisos p ON p.id = rp.id_permiso
      WHERE u.id = $1
      ORDER BY upper(trim(p.nombre)) ASC
    `,
    [id]
  );

  const roleResult = await db.query(
    `
      SELECT ${getUserRoleIdExpr('u')} AS role_id
      FROM usuarios u
      WHERE u.id = $1
      LIMIT 1
    `,
    [id]
  );
  const roleId = Number(roleResult.rows[0]?.role_id || 0);

  const permissions = [...new Set(result.rows
    .map((row) => canonicalizePermissionName(row.nombre))
    .filter(Boolean))];

  if (roleId > 0 && isApprovalHierarchyRoleId(roleId)) {
    permissions.push('GESTIONAR_SOLICITUDES');
  }

  return [...new Set(permissions)];
};

const createAuthToken = (user) => {
  const payload = {
    id: Number(user.id),
    sub: Number(user.id),
    rol_id: Number(user.id_role || user.rol_id || 0),
    rol: user.rol,
    nombre: user.nombre,
    correo: user.email,
    id_area: user.id_area,
  };

  console.log('[AUTH] payload del token:', payload);
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
};

const getBearerToken = (req) => {
  const authHeader = String(req.header('authorization') || '').trim();
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? String(match[1] || '').trim() : '';
};

const authMiddleware = async (req, res, next) => {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return res.status(401).json({ error: 'Falta token Bearer en Authorization' });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (_error) {
      return res.status(401).json({ error: 'Token invalido o expirado' });
    }

    const userId = Number(decoded?.id || decoded?.sub || 0);
    if (!userId) {
      return res.status(401).json({ error: 'Token sin usuario valido' });
    }

    const userRoleExpr = getUserRoleIdExpr('usuarios');
    const userEmailExpr = getUserEmailExpr('usuarios');
    const result = await pool.query(
      `
        SELECT
          usuarios.id,
          usuarios.nombre,
          ${userEmailExpr} AS email,
          ${userEmailExpr} AS correo,
          usuarios.id_area,
          ${userRoleExpr} AS id_role,
          COALESCE(areas.nombre, '') AS area,
          COALESCE(roles.nombre, '') AS rol
        FROM usuarios
        LEFT JOIN areas ON areas.id = usuarios.id_area
        LEFT JOIN roles ON roles.id = ${userRoleExpr}
        WHERE usuarios.id = $1
        LIMIT 1
      `,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Usuario no encontrado' });
    }

    req.user = result.rows[0];
    const dbPermissions = await fetchPermissionNamesByUserId(pool, req.user.id);
    req.user.permisos = dbPermissions;
    req.auth = decoded;
    console.log('[AUTH] req.user en middleware:', req.user);
    next();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const requireRoles = (...roles) => (req, res, next) => {
  if (!hasAnyRole(req.user?.rol || '', roles)) {
    return res.status(403).json({ error: 'No autorizado' });
  }
  next();
};

const requireRoleIds = (...roleIds) => (req, res, next) => {
  const roleId = Number(req.user?.id_role || req.user?.rol_id || 0);
  if (!roleIds.includes(roleId)) {
    return res.status(403).json({ error: 'No autorizado' });
  }
  next();
};

const requireAdmin = requireRoles('ADMIN');
const requireCompras = requireRoles('ADMIN', 'COMPRAS');
const requireRoleAdminOrCompras = requireRoleIds(8, 9);

const BASE_PERMISSION_NAMES = [
  'VER_INVENTARIO',
  'CREAR_REQUERIMIENTO',
  'CREAR_SOLICITUD_COMPRA',
  'VER_AJUSTES',
];

const requirePermissions = (...permissions) => async (req, res, next) => {
  try {
    const normalizedPermissions = permissions
      .map((perm) => normalizePermissionName(perm))
      .filter(Boolean);

    if (normalizedPermissions.length === 0) {
      return next();
    }

    const directPermissions = Array.isArray(req.user?.permisos) && req.user.permisos.length > 0
      ? req.user.permisos
      : await fetchPermissionNamesByUserId(pool, req.user?.id);

    const userPermissions = new Set(directPermissions
      .map((perm) => normalizePermissionName(perm))
      .filter(Boolean));

    if (!normalizedPermissions.some((permission) => userPermissions.has(permission))) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    return next();
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

const getMaterialStockTotal = async (client, idMaterial) => {
  const result = await client.query(
    'SELECT COALESCE(SUM(cantidad), 0) AS total FROM stock WHERE id_material = $1',
    [idMaterial]
  );
  return Number(result.rows[0]?.total || 0);
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

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'OK', message: 'Backend conectado a PostgreSQL' });
  } catch (error) {
    res.status(500).json({ status: 'ERROR', error: error.message });
  }
});

app.get('/api/debug/service/:id', async (req, res) => {
  try {
    const serviceId = Number(req.params.id || 0);
    
    // Get aprobaciones for service
    const aprobResult = await pool.query(
      'SELECT id, referencia_id, rol_aprobador, estado, orden, tipo FROM aprobaciones WHERE tipo = $1 AND referencia_id = $2 ORDER BY orden',
      ['SERVICIO', serviceId]
    );
    
    // Get service details
    const servicioResult = await pool.query(
      'SELECT id, estado_aprobacion, estado_flujo, dentro_plan FROM servicios WHERE id = $1',
      [serviceId]
    );
    
    // Get roles
    const rolesResult = await pool.query(
      'SELECT id, nombre FROM roles ORDER BY id'
    );
    
    // Get all usuarios with their role IDs directly from the column
    const usuariosResult = await pool.query(
      `SELECT u.id, u.email, u.id_role, r.nombre AS rol_nombre
       FROM usuarios u
       LEFT JOIN roles r ON r.id = u.id_role
       ORDER BY u.id`
    );
    
    res.json({
      serviceId,
      servicio: servicioResult.rows[0] || null,
      aprobaciones: aprobResult.rows,
      rolesMap: rolesResult.rows,
      usuariosConRoles: usuariosResult.rows,
      message: 'This is a debug endpoint without auth - check usuariosConRoles to see id_role values'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Debug endpoint to verify approval state generation for all roles
app.get('/api/debug/approval-states', async (req, res) => {
  try {
    const rolesResult = await pool.query('SELECT id, nombre FROM roles ORDER BY id');
    const roles = rolesResult.rows;
    
    const states = roles.map(role => ({
      roleId: role.id,
      roleName: role.nombre,
      generatedState: generatePendingStateByRoleId(role.id),
      configuredState: getIntermediateApprovalStateByRoleId(role.id),
    }));
    
    res.json({
      message: 'Approval state generation for all roles',
      APPROVAL_ROLES_BY_LEVEL,
      APPROVAL_CHAIN_COMPRA,
      APPROVAL_CHAIN_SERVICIO_DENTRO_PLAN,
      APPROVAL_CHAIN_SERVICIO_FUERA_PLAN,
      roles: states,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/', (req, res) => {
  res.status(200).send(`
    <html>
      <head>
        <title>ALFOSAC API</title>
        <meta charset="utf-8" />
        <style>
          body {
            font-family: Arial, sans-serif;
            background: #f8fafc;
            color: #0f172a;
            display: grid;
            place-items: center;
            min-height: 100vh;
            margin: 0;
          }
          main {
            background: white;
            padding: 24px 28px;
            border-radius: 14px;
            box-shadow: 0 10px 30px rgba(15, 23, 42, 0.12);
            max-width: 520px;
          }
          h1 {
            margin: 0 0 12px;
            font-size: 24px;
          }
          p {
            margin: 8px 0;
            line-height: 1.5;
          }
          a {
            color: #0f766e;
            text-decoration: none;
          }
        </style>
      </head>
      <body>
        <main>
          <h1>ALFOSAC API</h1>
          <p>El backend esta en linea.</p>
          <p>Estado de salud: <a href="/api/health">/api/health</a></p>
        </main>
      </body>
    </html>
  `);
});

const loginHandler = async (req, res) => {
  try {
    const { correo, contrasena } = req.body;
    if (!correo || !contrasena) {
      return res.status(400).json({ error: 'Correo y contrasena son obligatorios' });
    }

    const userRoleExpr = getUserRoleIdExpr('usuarios');
    const userEmailExpr = getUserEmailExpr('usuarios');
    const userPasswordExpr = getUserPasswordExpr('usuarios');
    const result = await pool.query(
      `
        SELECT
          usuarios.id,
          usuarios.nombre,
          ${userEmailExpr} AS email,
          usuarios.id_area,
          ${userRoleExpr} AS id_role,
          COALESCE(${userPasswordExpr}, '') AS password_hash,
          roles.nombre AS rol
        FROM usuarios
        JOIN roles ON roles.id = ${userRoleExpr}
        WHERE lower(trim(COALESCE(${userEmailExpr}, ''))) = lower(trim($1))
        LIMIT 1
      `,
      [correo]
    );

    if (result.rows.length === 0) {
      console.log('[AUTH][LOGIN] usuario no encontrado para correo:', String(correo || '').trim().toLowerCase());
      return res.status(401).json({ error: 'Credenciales invalidas' });
    }

    const user = result.rows[0];
    console.log('[AUTH][LOGIN] usuario encontrado:', {
      id: user.id,
      email: user.email,
      rol: user.rol,
    });
    const providedPassword = String(contrasena || '').trim();
    const storedPassword = String(user.password_hash || '').trim();
    
    let validPassword = false;
    const isBcryptHash = /^\$2[aby]\$\d{2}\$/.test(storedPassword);
    
    if (isBcryptHash) {
      validPassword = await bcrypt.compare(providedPassword, storedPassword);
    } else {
      validPassword = storedPassword === providedPassword;
    }

    if (!validPassword) {
      return res.status(401).json({ error: 'Credenciales invalidas' });
    }

    const requiresPasswordChange = providedPassword.toLowerCase() === user.email.toLowerCase();

    const token = createAuthToken(user);

    res.json({
      token,
      token_type: 'Bearer',
      expires_in: JWT_EXPIRES_IN,
      requires_password_change: requiresPasswordChange,
      user: {
        id: user.id,
        nombre: user.nombre,
        correo: user.email,
        id_area: user.id_area,
        rol_id: user.id_role,
        id_role: user.id_role,
        rol: user.rol,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

app.post('/api/login', loginHandler);
app.post('/api/auth/login', loginHandler);

app.post('/api/logout', authMiddleware, async (req, res) => {
  try {
    // Logout is mostly client-side (token removal)
    // This endpoint just validates user is authenticated and returns success
    console.log('[AUTH][LOGOUT] usuario:', req.user.id);
    res.json({ success: true, message: 'Logout successful' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const canManageRoles = (user) => tienePermiso(user, 'GESTIONAR_ROLES');

const resolvePermissionIds = async (client, permissionItems = []) => {
  const items = Array.isArray(permissionItems) ? permissionItems : [];
  if (items.length === 0) {
    return { ids: [], missing: [] };
  }

  const numericIds = [...new Set(items
    .map((item) => Number(item))
    .filter((id) => Number.isInteger(id) && id > 0))];

  const names = [...new Set(items
    .map((item) => (typeof item === 'string' ? canonicalizePermissionName(item) : ''))
    .filter(Boolean))];

  const foundById = new Map();
  if (numericIds.length > 0) {
    const byIdResult = await client.query(
      `
        SELECT id, nombre
        FROM permisos
        WHERE id = ANY($1::int[])
      `,
      [numericIds]
    );
    byIdResult.rows.forEach((row) => {
      foundById.set(Number(row.id || 0), String(row.nombre || '').trim());
    });
  }

  const foundByName = new Map();
  if (names.length > 0) {
    const byNameResult = await client.query(
      `
        SELECT id, nombre
        FROM permisos
        WHERE upper(trim(nombre)) = ANY($1::text[])
      `,
      [names.map((name) => String(name || '').trim().toUpperCase())]
    );
    byNameResult.rows.forEach((row) => {
      foundByName.set(String(row.nombre || '').trim().toUpperCase(), Number(row.id || 0));
    });
  }

  const missing = [];
  numericIds.forEach((id) => {
    if (!foundById.has(id)) {
      missing.push(String(id));
    }
  });
  names.forEach((name) => {
    if (!foundByName.has(String(name || '').trim().toUpperCase())) {
      missing.push(name);
    }
  });

  const mergedIds = new Set();
  foundById.forEach((_name, id) => mergedIds.add(id));
  foundByName.forEach((id) => mergedIds.add(id));

  return {
    ids: [...mergedIds],
    missing,
  };
};


app.get('/api/roles', authMiddleware, async (req, res) => {
  if (!canManageRoles(req.user)) {
    return res.status(403).json({ error: 'No autorizado' });
  }

  try {
    const result = await pool.query('SELECT id, nombre FROM roles ORDER BY id');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/permisos', authMiddleware, async (req, res) => {
  if (!canManageRoles(req.user)) {
    return res.status(403).json({ error: 'No autorizado' });
  }

  try {
    await ensureCoreApprovalPermissions();
    const result = await pool.query(
      `
        SELECT id, nombre
        FROM permisos
        ORDER BY nombre ASC, id ASC
      `
    );
    const permissionsByName = new Map();
    result.rows.forEach((row) => {
      const nombre = canonicalizePermissionName(row.nombre);
      if (!nombre || permissionsByName.has(nombre)) return;
      permissionsByName.set(nombre, {
        ...row,
        nombre,
      });
    });

    res.json([...permissionsByName.values()]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/roles/:id/permisos', authMiddleware, async (req, res) => {
  if (!canManageRoles(req.user)) {
    return res.status(403).json({ error: 'No autorizado' });
  }

  try {
    const roleId = Number(req.params?.id || 0);
    if (!Number.isInteger(roleId) || roleId <= 0) {
      return res.status(400).json({ error: 'id_rol invalido' });
    }

    const roleResult = await pool.query('SELECT id, nombre FROM roles WHERE id = $1 LIMIT 1', [roleId]);
    if (roleResult.rows.length === 0) {
      return res.status(404).json({ error: 'Rol no encontrado' });
    }

    const permissionsResult = await pool.query(
      `
        SELECT p.id, p.nombre
        FROM rol_permiso rp
        JOIN permisos p ON p.id = rp.id_permiso
        WHERE rp.id_rol = $1
        ORDER BY p.nombre ASC, p.id ASC
      `,
      [roleId]
    );

    const permissionsByName = new Map();
    permissionsResult.rows.forEach((row) => {
      const nombre = canonicalizePermissionName(row.nombre);
      if (!nombre || permissionsByName.has(nombre)) return;
      permissionsByName.set(nombre, {
        ...row,
        nombre,
      });
    });

    res.json({
      rol: roleResult.rows[0],
      permisos: [...permissionsByName.values()],
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/roles/:id/permisos', authMiddleware, async (req, res) => {
  if (!canManageRoles(req.user)) {
    return res.status(403).json({ error: 'No autorizado' });
  }

  const client = await pool.connect();

  try {
    const roleId = Number(req.params?.id || 0);
    if (!Number.isInteger(roleId) || roleId <= 0) {
      return res.status(400).json({ error: 'id_rol invalido' });
    }

    const permissionItems = Array.isArray(req.body?.permisos) ? req.body.permisos : [];

    await client.query('BEGIN');

    const roleResult = await client.query('SELECT id, nombre FROM roles WHERE id = $1 LIMIT 1 FOR UPDATE', [roleId]);
    if (roleResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Rol no encontrado' });
    }

    const resolved = await resolvePermissionIds(client, permissionItems);
    if (resolved.missing.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Se enviaron permisos inexistentes',
        permisos_invalidos: resolved.missing,
      });
    }

    // Regla de consistencia: editar inventario siempre requiere ver inventario.
    let resolvedPermissionIds = [...resolved.ids];
    if (resolvedPermissionIds.length > 0) {
      const namesByIdResult = await client.query(
        `
          SELECT id, nombre
          FROM permisos
          WHERE id = ANY($1::int[])
        `,
        [resolvedPermissionIds]
      );

      const normalizedNames = new Set(namesByIdResult.rows.map((row) => normalizePermissionName(row.nombre)).filter(Boolean));

      if (normalizedNames.has('EDITAR_INVENTARIO') && !normalizedNames.has('VER_INVENTARIO')) {
        const viewPermissionResult = await client.query(
          `
            SELECT id
            FROM permisos
            WHERE upper(trim(nombre)) = 'VER_INVENTARIO'
            LIMIT 1
          `
        );

        if (viewPermissionResult.rows.length > 0) {
          resolvedPermissionIds.push(Number(viewPermissionResult.rows[0].id || 0));
          resolvedPermissionIds = [...new Set(resolvedPermissionIds.filter((id) => Number.isInteger(id) && id > 0))];
        }
      }
    }

    await client.query('DELETE FROM rol_permiso WHERE id_rol = $1', [roleId]);

    if (resolvedPermissionIds.length > 0) {
      const placeholders = resolvedPermissionIds.map((_, index) => `($1, $${index + 2})`).join(', ');
      await client.query(
        `
          INSERT INTO rol_permiso (id_rol, id_permiso)
          VALUES ${placeholders}
        `,
        [roleId, ...resolvedPermissionIds]
      );
    }

    await client.query('COMMIT');

    const updatedPermissions = await pool.query(
      `
        SELECT p.id, p.nombre
        FROM rol_permiso rp
        JOIN permisos p ON p.id = rp.id_permiso
        WHERE rp.id_rol = $1
        ORDER BY p.nombre ASC, p.id ASC
      `,
      [roleId]
    );

    return res.json({
      rol: roleResult.rows[0],
      permisos: updatedPermissions.rows,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

app.get('/api/aprobaciones/config', authMiddleware, async (req, res) => {
  // This config is required by approval UIs to detect first-stage dynamic flows.
  // Keep it available to any authenticated user.

  try {
    const rows = await fetchApprovalFlowConfig(pool);
    const grouped = rows.reduce((acc, row) => {
      const flujo = String(row.flujo || '').trim().toUpperCase();
      if (!flujo) return acc;
      if (!acc[flujo]) acc[flujo] = [];
      const roleId = Number(row.rol_id || 0);
      const roleName = String(row.rol_nombre || '').trim();
      const roleNameKey = normalizeRoleName(roleName)
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
      const pendingState = getIntermediateApprovalStateByRoleId(roleId) || (roleNameKey ? `PENDIENTE_${roleNameKey}` : 'PENDIENTE');
      acc[flujo].push({
        orden: Number(row.orden || 0),
        rol_id: roleId,
        rol_nombre: roleName,
        estado_pendiente: pendingState,
      });
      return acc;
    }, {});

    return res.json({
      flujos: grouped,
      metadata: {
        role_chain_compra: APPROVAL_CHAIN_COMPRA,
        role_chain_servicio_dentro_plan: APPROVAL_CHAIN_SERVICIO_DENTRO_PLAN,
        role_chain_servicio_fuera_plan: APPROVAL_CHAIN_SERVICIO_FUERA_PLAN,
      },
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.put('/api/aprobaciones/config/:flujo', authMiddleware, async (req, res) => {
  if (!canManageRoles(req.user)) {
    return res.status(403).json({ error: 'No autorizado' });
  }

  const client = await pool.connect();
  try {
    const flujo = String(req.params?.flujo || '').trim().toUpperCase();
    const roleIds = Array.isArray(req.body?.roleIds) ? req.body.roleIds : [];

    await client.query('BEGIN');
    await replaceApprovalFlowConfig(client, { flujo, roleIds });
    if (flujo.startsWith('SERVICIO_')) {
      await ensureRolesHavePermissionByName(client, roleIds, 'GESTIONAR_SOLICITUDES');
    }
    await client.query('COMMIT');

    await loadApprovalRoleIds();

    const updatedRows = await fetchApprovalFlowConfig(pool);
    const filtered = updatedRows
      .filter((row) => String(row.flujo || '').trim().toUpperCase() === flujo)
      .map((row) => ({
        orden: Number(row.orden || 0),
        rol_id: Number(row.rol_id || 0),
        rol_nombre: String(row.rol_nombre || '').trim(),
      }));

    return res.json({
      flujo,
      pasos: filtered,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    return res.status(400).json({ error: error.message });
  } finally {
    client.release();
  }
});

app.post('/api/roles', authMiddleware, async (req, res) => {
  if (!canManageRoles(req.user)) {
    return res.status(403).json({ error: 'No autorizado' });
  }

  try {
    const nombre = String(req.body?.nombre || '').trim();
    if (!nombre) {
      return res.status(400).json({ error: 'Nombre de rol es obligatorio' });
    }

    const exists = await pool.query(
      'SELECT id FROM roles WHERE upper(trim(nombre)) = upper(trim($1)) LIMIT 1',
      [nombre]
    );
    if (exists.rows.length > 0) {
      return res.status(409).json({ error: 'Ya existe un rol con ese nombre' });
    }

    const created = await pool.query(
      `
        INSERT INTO roles (nombre)
        VALUES ($1)
        RETURNING id, nombre
      `,
      [nombre]
    );

    return res.status(201).json(created.rows[0]);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.delete('/api/roles/:id', authMiddleware, async (req, res) => {
  if (!canManageRoles(req.user)) {
    return res.status(403).json({ error: 'No autorizado' });
  }

  const client = await pool.connect();

  try {
    const roleId = Number(req.params?.id || 0);
    if (!Number.isInteger(roleId) || roleId <= 0) {
      return res.status(400).json({ error: 'id_rol invalido' });
    }

    await client.query('BEGIN');

    const roleResult = await client.query('SELECT id, nombre FROM roles WHERE id = $1 LIMIT 1 FOR UPDATE', [roleId]);
    if (roleResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Rol no encontrado' });
    }

    const usersResult = await client.query(
      'SELECT COUNT(*)::int AS total FROM usuarios WHERE id_role = $1',
      [roleId]
    );
    const assignedUsers = Number(usersResult.rows[0]?.total || 0);
    if (assignedUsers > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'No se puede eliminar el rol porque todavía tiene usuarios asignados',
        usuarios_asignados: assignedUsers,
      });
    }

    await client.query('DELETE FROM rol_permiso WHERE id_rol = $1', [roleId]);
    await client.query('DELETE FROM aprobaciones_config WHERE rol_id = $1', [roleId]);
    await client.query('DELETE FROM roles WHERE id = $1', [roleId]);

    await client.query('COMMIT');

    return res.json({
      ok: true,
      rol: roleResult.rows[0],
    });
  } catch (error) {
    await client.query('ROLLBACK');

    if (String(error?.code || '') === '23503') {
      return res.status(409).json({
        error: 'No se puede eliminar el rol porque está referenciado por otros registros',
      });
    }

    return res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

app.get('/api/usuarios', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const userRoleExpr = getUserRoleIdExpr('usuarios');
    const userEmailExpr = getUserEmailExpr('usuarios');
    const userEstadoExpr = getUserEstadoExpr('usuarios');
    const result = await pool.query(
      `
        SELECT
          usuarios.id,
          usuarios.nombre,
          COALESCE(NULLIF(trim(COALESCE(to_jsonb(usuarios)->>'dni', '')), ''), '') AS dni,
          COALESCE(NULLIF(trim(COALESCE(to_jsonb(usuarios)->>'foto', to_jsonb(usuarios)->>'imagen', '')), ''), '') AS foto,
          ${userEmailExpr} AS email,
          ${userRoleExpr} AS id_role,
          usuarios.id_area,
          COALESCE(${userEstadoExpr}, 'ACTIVO') AS estado,
          roles.nombre AS rol,
          COALESCE(areas.nombre, '') AS area
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

app.post('/api/usuarios', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { nombre, email, dni, foto, id_role, id_area, estado } = req.body;
    const userRoleColumn = getUserRoleIdColumn();

    if (!nombre || !String(nombre).trim()) {
      return res.status(400).json({ error: 'Nombre es requerido' });
    }

    if (!email || !String(email).trim()) {
      return res.status(400).json({ error: 'Correo es requerido' });
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

    const cleanDni = String(dni || '').trim();
    const cleanFoto = String(foto || '').trim();

    const hashedPassword = await hashPassword(sanitizedEmail);

    const result = await pool.query(
      `
        INSERT INTO usuarios (nombre, email, password_hash, dni, foto, ${userRoleColumn}, id_area, estado)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, nombre, email, dni, foto, ${userRoleColumn} AS id_role, id_area, estado
      `,
      [
        String(nombre).trim(),
        sanitizedEmail,
        hashedPassword,
        cleanDni || null,
        cleanFoto || null,
        Number(id_role),
        id_area ? Number(id_area) : null,
        estado || 'ACTIVO'
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/usuarios/:id', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, email, dni, foto, id_role, id_area, estado } = req.body;
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

    const cleanDni = dni === undefined ? undefined : String(dni || '').trim();
    const cleanFoto = foto === undefined ? undefined : String(foto || '').trim();

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

    if (cleanDni !== undefined) {
      updates.push(`dni = $${paramCount}`);
      values.push(cleanDni || null);
      paramCount += 1;
    }

    if (cleanFoto !== undefined) {
      updates.push(`foto = $${paramCount}`);
      values.push(cleanFoto || null);
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

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No hay campos para actualizar' });
    }

    values.push(userId);

    const result = await pool.query(
      `
        UPDATE usuarios
        SET ${updates.join(', ')}
        WHERE id = $${paramCount}
        RETURNING id, nombre, email, dni, foto, ${userRoleColumn} AS id_role, id_area, estado
      `,
      values
    );

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/usuarios/:id/password', authMiddleware, requireAdmin, async (req, res) => {
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

app.put('/api/me/cambiar-contrasena', authMiddleware, async (req, res) => {
  try {
    const { password_actual, password_nueva, password_confirmacion } = req.body;
    const userId = req.user.id;

    if (!password_actual || !String(password_actual).trim()) {
      return res.status(400).json({ error: 'Contraseña actual es requerida' });
    }

    if (!password_nueva || !String(password_nueva).trim()) {
      return res.status(400).json({ error: 'Nueva contraseña es requerida' });
    }

    if (!password_confirmacion || !String(password_confirmacion).trim()) {
      return res.status(400).json({ error: 'Confirmación de contraseña es requerida' });
    }

    const cleanNew = String(password_nueva).trim();
    const cleanConfirm = String(password_confirmacion).trim();

    if (cleanNew !== cleanConfirm) {
      return res.status(400).json({ error: 'Las contraseñas no coinciden' });
    }

    if (!isStrongPassword(cleanNew)) {
      return res.status(400).json({ error: 'La nueva contraseña debe tener mas de 8 caracteres, una mayuscula y un caracter especial' });
    }

    const userPasswordExpr = getUserPasswordExpr('u');
    const userCheck = await pool.query(
      `
        SELECT
          COALESCE(NULLIF(trim(${getUserEmailExpr('u')}), ''), '') AS email,
          COALESCE(${userPasswordExpr}, '') AS password_hash
        FROM usuarios u
        WHERE u.id = $1
        LIMIT 1
      `,
      [userId]
    );
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const providedCurrent = String(password_actual || '').trim();
    const storedPassword = String(userCheck.rows[0].password_hash || '').trim();
    const isBcryptHash = /^\$2[aby]\$\d{2}\$/.test(storedPassword);
    const validCurrentPassword = isBcryptHash
      ? await bcrypt.compare(providedCurrent, storedPassword)
      : storedPassword === providedCurrent;

    if (!validCurrentPassword) {
      return res.status(400).json({ error: 'La contraseña actual no es correcta' });
    }

    const userEmail = String(userCheck.rows[0].email || '').trim().toLowerCase();
    if (cleanNew.toLowerCase() === userEmail) {
      return res.status(400).json({ error: 'La contraseña no puede ser igual al correo' });
    }

    if (cleanNew === providedCurrent) {
      return res.status(400).json({ error: 'La nueva contraseña debe ser diferente a la contraseña actual' });
    }

    const hashedPassword = await hashPassword(cleanNew);

    await pool.query(
      'UPDATE usuarios SET password_hash = $1 WHERE id = $2',
      [hashedPassword, userId]
    );

    res.json({ success: true, message: 'Contraseña actualizada correctamente' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/usuarios/:id', authMiddleware, requireAdmin, async (req, res) => {
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

app.get('/api/almacenes', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, nombre FROM almacenes ORDER BY id');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/me', authMiddleware, async (req, res) => {
  try {
    const profileResult = await pool.query(
      `
        SELECT
          u.id,
          u.nombre,
          COALESCE(NULLIF(trim(COALESCE(to_jsonb(u)->>'email', to_jsonb(u)->>'correo', '')), ''), '') AS correo,
          u.id_area,
          COALESCE(a.nombre, '') AS area,
          ${getUserRoleIdExpr('u')} AS rol_id,
          ${getUserRoleIdExpr('u')} AS id_role,
          COALESCE(r.nombre, '') AS rol,
          COALESCE(NULLIF(trim(COALESCE(to_jsonb(u)->>'dni', '')), ''), '') AS dni,
          COALESCE(NULLIF(trim(COALESCE(to_jsonb(u)->>'foto', '')), ''), '') AS foto,
          COALESCE(NULLIF(trim(COALESCE(to_jsonb(u)->>'imagen', '')), ''), '') AS imagen
        FROM usuarios u
        LEFT JOIN areas a ON a.id = u.id_area
        LEFT JOIN roles r ON r.id = ${getUserRoleIdExpr('u')}
        WHERE u.id = $1
        LIMIT 1
      `,
      [req.user.id]
    );

    const profile = profileResult.rows[0];
    if (!profile) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const dbPermissions = await fetchPermissionNamesByUserId(pool, profile.id);

    res.json({
      id: profile.id,
      nombre: profile.nombre,
      correo: profile.correo || req.user.correo || '',
      email: profile.correo || req.user.correo || '',
      id_area: profile.id_area,
      area: profile.area || req.user.area || '',
      rol_id: profile.rol_id,
      id_role: profile.id_role,
      rol: profile.rol || req.user.rol || '',
      dni: profile.dni,
      foto: profile.foto,
      imagen: profile.imagen,
      permisos: dbPermissions,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/me/foto', authMiddleware, async (req, res) => {
  try {
    const foto = String(req.body?.foto || '').trim();
    if (!foto) {
      return res.status(400).json({ error: 'La foto es obligatoria' });
    }

    if (!isValidPhotoValue(foto)) {
      return res.status(400).json({ error: 'La foto debe ser URL valida (http/https) o base64 valida' });
    }

    const photoColumn = getUserPhotoColumn();
    if (!photoColumn) {
      return res.status(400).json({ error: 'No existe una columna de foto configurable (foto/imagen) en usuarios' });
    }

    const updated = await pool.query(
      `
        UPDATE usuarios
        SET ${quoteIdentifier(photoColumn)} = $1
        WHERE id = $2
        RETURNING
          id,
          nombre,
          COALESCE(NULLIF(trim(COALESCE(to_jsonb(usuarios)->>'email', to_jsonb(usuarios)->>'correo', '')), ''), '') AS correo,
          COALESCE(NULLIF(trim(COALESCE(to_jsonb(usuarios)->>'dni', '')), ''), '') AS dni,
          COALESCE(NULLIF(trim(COALESCE(to_jsonb(usuarios)->>'foto', to_jsonb(usuarios)->>'imagen', '')), ''), '') AS foto
      `,
      [foto, req.user.id]
    );

    if (updated.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    return res.json({
      success: true,
      message: 'Foto actualizada correctamente',
      user: updated.rows[0],
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post('/api/upload/material', authMiddleware, requirePermissions('AGREGAR_INVENTARIO_MANUAL', 'EDITAR_INVENTARIO'), (req, res) => {
  uploadImage.single('image')(req, res, (error) => {
    if (error) {
      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'La imagen no debe superar 2MB' });
      }
      return res.status(400).json({ error: error.message || 'Error subiendo imagen' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Debes enviar un archivo en el campo image' });
    }

    const imageUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    return res.json({ url: imageUrl, path: `/uploads/${req.file.filename}` });
  });
});

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
            COALESCE(r.nombre, 'Sin rol') AS usuario_actual_rol,
            COALESCE(STRING_AGG(DISTINCT p.nombre, ', '), 'Sin permisos') AS usuario_actual_permisos
          FROM usuarios u
          LEFT JOIN areas a ON a.id = u.id_area
          LEFT JOIN roles r ON r.id = ${userRoleExpr}
          LEFT JOIN rol_permiso rp ON rp.id_rol = r.id
          LEFT JOIN permisos p ON p.id = rp.id_permiso
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
            COALESCE(dm.id_material, NULLIF(to_jsonb(m)->>'id_material', '')::int) AS id_material,
            COALESCE(
              SUM(
                CASE
                  WHEN upper(trim(COALESCE(to_jsonb(m)->>'tipo_movimiento', to_jsonb(m)->>'tipo', ''))) = 'ENTRADA'
                    THEN COALESCE(dm.cantidad, NULLIF(to_jsonb(m)->>'cantidad', '')::numeric, 0)
                  ELSE 0
                END
              ),
              0
            ) AS entradas,
            COALESCE(
              SUM(
                CASE
                  WHEN upper(trim(COALESCE(to_jsonb(m)->>'tipo_movimiento', to_jsonb(m)->>'tipo', ''))) = 'SALIDA'
                    THEN COALESCE(dm.cantidad, NULLIF(to_jsonb(m)->>'cantidad', '')::numeric, 0)
                  ELSE 0
                END
              ),
              0
            ) AS salidas,
            COUNT(DISTINCT m.id) AS total_movimientos
          FROM movimientos m
          LEFT JOIN movimiento_detalles dm ON dm.id_movimiento = m.id
          GROUP BY COALESCE(dm.id_material, NULLIF(to_jsonb(m)->>'id_material', '')::int)
        ),
        movimiento_detalle_resumen AS (
          SELECT
            COUNT(*) AS total_movimiento_detalles,
            COALESCE(
              SUM(
                COALESCE(
                  NULLIF(to_jsonb(md)->>'cantidad_entrada', '')::numeric,
                  NULLIF(to_jsonb(md)->>'cantidad_salida', '')::numeric,
                  NULLIF(to_jsonb(md)->>'cantidad', '')::numeric,
                  0
                )
              ),
              0
            ) AS cantidad_movimiento_detalles
          FROM movimiento_detalles md
        ),
        detalle_movimiento_resumen AS (
          SELECT
            COUNT(*) AS total_detalle_movimientos,
            COALESCE(SUM(COALESCE(dm.cantidad, 0)), 0) AS cantidad_detalle_movimientos
          FROM movimiento_detalles dm
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
          ua.usuario_actual_rol,
          ua.usuario_actual_permisos
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
        WHERE COALESCE(sr.stock_total, 0) > 0
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
  const client = await pool.connect();
  try {
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
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

app.put('/api/materiales/:id', authMiddleware, requirePermissions('EDITAR_INVENTARIO'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
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
    const descripcionNorm = String(descripcion || '').trim();
    const idUnidad = Number(id_unidad || 0);
    const idProveedor = Number(id_proveedor || 0);
    const costoValue = Number(costo_unitario);
    const stockSeguridadValue = Number(stock_seguridad);
    const idAlmacen = Number(id_almacen || 0);
    const idMoneda = id_moneda === null || id_moneda === undefined || id_moneda === ''
      ? null
      : Number(id_moneda);
    const idCategoria = id_categoria === null || id_categoria === undefined || id_categoria === ''
      ? null
      : Number(id_categoria);
    const imagenNorm = String(imagen || '').trim() || null;

    if (!nombreNorm) {
      return res.status(400).json({ error: 'nombre es obligatorio' });
    }

    if (!Number.isInteger(idUnidad) || idUnidad <= 0) {
      return res.status(400).json({ error: 'id_unidad es obligatorio y debe ser valido' });
    }

    if (!Number.isInteger(idProveedor) || idProveedor <= 0) {
      return res.status(400).json({ error: 'id_proveedor es obligatorio y debe ser valido' });
    }

    if (!Number.isFinite(costoValue) || costoValue < 0) {
      return res.status(400).json({ error: 'costo_unitario es obligatorio y debe ser un numero mayor o igual a 0' });
    }

    if (!Number.isFinite(stockSeguridadValue) || stockSeguridadValue < 0) {
      return res.status(400).json({ error: 'stock_seguridad es obligatorio y debe ser un numero mayor o igual a 0' });
    }

    if (!Number.isInteger(idAlmacen) || idAlmacen <= 0) {
      return res.status(400).json({ error: 'id_almacen es obligatorio y debe ser valido' });
    }

    if (idMoneda !== null && (!Number.isInteger(idMoneda) || idMoneda <= 0)) {
      return res.status(400).json({ error: 'id_moneda debe ser valido o NULL' });
    }

    if (idCategoria !== null && (!Number.isInteger(idCategoria) || idCategoria <= 0)) {
      return res.status(400).json({ error: 'id_categoria debe ser valido o NULL' });
    }

    if (imagenNorm && !/^https?:\/\//i.test(imagenNorm) && !/^\/uploads\//i.test(imagenNorm)) {
      return res.status(400).json({ error: 'imagen debe ser una URL valida o una ruta /uploads/' });
    }

    const unitExists = await client.query('SELECT id FROM unidades WHERE id = $1 LIMIT 1', [idUnidad]);
    if (unitExists.rows.length === 0) {
      return res.status(400).json({ error: 'id_unidad no existe en unidades' });
    }

    const providerExists = await client.query('SELECT id FROM proveedores WHERE id = $1 LIMIT 1', [idProveedor]);
    if (providerExists.rows.length === 0) {
      return res.status(400).json({ error: 'id_proveedor no existe en proveedores' });
    }

    const almacenExists = await client.query('SELECT id FROM almacenes WHERE id = $1 LIMIT 1', [idAlmacen]);
    if (almacenExists.rows.length === 0) {
      return res.status(400).json({ error: 'id_almacen no existe en almacenes' });
    }

    if (idMoneda !== null) {
      const moneda = await client.query('SELECT id FROM monedas WHERE id = $1 LIMIT 1', [idMoneda]);
      if (moneda.rows.length === 0) {
        return res.status(400).json({ error: 'id_moneda no existe en monedas' });
      }
    }

    const tableFlags = await client.query(
      `
        SELECT
          to_regclass('public.categorias') IS NOT NULL AS has_categorias,
          to_regclass('public.material_categoria') IS NOT NULL AS has_material_categoria
      `
    );
    const hasCategorias = Boolean(tableFlags.rows[0]?.has_categorias);
    const hasMaterialCategoria = Boolean(tableFlags.rows[0]?.has_material_categoria);

    if (idCategoria !== null) {
      if (!hasCategorias) {
        return res.status(400).json({ error: 'La tabla categorias no esta disponible' });
      }

      const categoria = await client.query('SELECT id FROM categorias WHERE id = $1 LIMIT 1', [idCategoria]);
      if (categoria.rows.length === 0) {
        return res.status(400).json({ error: 'id_categoria no existe en categorias' });
      }
    }

    const materialCostoColumn = pickExistingColumn(schemaMeta.materialesColumns, ['costo_unitario', 'precio_unitario', 'costo']);
    if (!materialCostoColumn) {
      return res.status(500).json({ error: 'No se encontro una columna de costo en materiales' });
    }

    const stockSafetyColumn = pickExistingColumn(schemaMeta.stockColumns, ['stock_seguridad']);
    if (!stockSafetyColumn) {
      return res.status(400).json({ error: 'La tabla stock no tiene columna stock_seguridad' });
    }

    await client.query('BEGIN');

    const result = await client.query(
      `
        UPDATE materiales
        SET nombre = $1,
            descripcion = $2,
            id_unidad = $3,
            id_proveedor = $4,
            id_moneda = $5,
            ${materialCostoColumn} = $6,
            imagen = $7,
            id_categoria = $8
        WHERE id = $9
        RETURNING id
      `,
      [nombreNorm, descripcionNorm || null, idUnidad, idProveedor, idMoneda, costoValue, imagenNorm, idCategoria, id]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Material no encontrado' });
    }

    if (hasMaterialCategoria) {
      await client.query('DELETE FROM material_categoria WHERE id_material = $1', [id]);

      if (idCategoria !== null) {
        await client.query(
          'INSERT INTO material_categoria (id_material, id_categoria) VALUES ($1, $2)',
          [id, idCategoria]
        );
      }
    }

    const updateStockResult = await client.query(
      `UPDATE stock SET ${quoteIdentifier(stockSafetyColumn)} = $3 WHERE id_material = $1 AND id_almacen = $2`,
      [id, idAlmacen, stockSeguridadValue]
    );

    if (Number(updateStockResult.rowCount || 0) === 0) {
      await client.query(
        `INSERT INTO stock (id_material, id_almacen, cantidad, ${quoteIdentifier(stockSafetyColumn)}) VALUES ($1, $2, $3, $4)`,
        [id, idAlmacen, 0, stockSeguridadValue]
      );
    }

    await client.query('COMMIT');

    res.json({
      id: Number(id),
      nombre: nombreNorm,
      descripcion: descripcionNorm || null,
      id_unidad: idUnidad,
      id_proveedor: idProveedor,
      id_moneda: idMoneda,
      id_categoria: idCategoria,
      id_almacen: idAlmacen,
      stock_seguridad: stockSeguridadValue,
      imagen: imagenNorm,
      [materialCostoColumn]: costoValue,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
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

app.get('/api/requerimientos', authMiddleware, async (req, res) => {
  try {
    const roleId = Number(req.user?.id_role || req.user?.rol_id || 0);
    const descripcionExpr = getRequerimientoDescripcionExpr('r');
    const result = await pool.query(
      `
        SELECT
          r.id,
          r.estado,
          r.estado_entrega,
          r.nombre_receptor,
          r.dni_receptor,
          r.prioridad,
          ${descripcionExpr} AS descripcion,
          r.id_usuario,
          u.id_area,
          u.nombre AS usuario,
          COALESCE(a.nombre, 'Sin area') AS area,
          r.fecha_creacion,
          dr.id_material,
          m.nombre AS material,
          dr.cantidad
        FROM requerimientos r
        JOIN usuarios u ON u.id = r.id_usuario
        LEFT JOIN areas a ON a.id = u.id_area
        LEFT JOIN detalle_requerimiento dr ON dr.id_requerimiento = r.id
        LEFT JOIN materiales m ON m.id = dr.id_material
        ORDER BY r.fecha_creacion DESC, r.id DESC
      `
    );

    const grouped = result.rows.reduce((acc, row) => {
      const key = row.id;
      if (!acc[key]) {
        const parsedDescription = parseEmbeddedCommentsFromText(row.descripcion || '');
        acc[key] = {
          id: row.id,
          estado: row.estado,
          estado_entrega: row.estado_entrega,
          nombre_receptor: row.nombre_receptor,
          dni_receptor: row.dni_receptor,
          prioridad: row.prioridad,
          descripcion: parsedDescription.text,
          comentarios_historial: [],
          id_usuario: row.id_usuario,
          id_area: row.id_area,
