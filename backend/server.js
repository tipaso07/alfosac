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
const ESTADOS_COMPRA = ['PENDIENTE', 'APROBADA', 'POR_RECIBIR', 'RECIBIDA', 'ENTREGADO', 'RECHAZADA'];
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

const MANAGER_ROLES = new Set([
  'JEFE DE AREA/SUBGERENTE',
  'GERENCIA DEL AREA',
  'GERENCIA DE FINANZAS',
]);

const isAdminRole = (role) => normalizeRoleName(role) === 'ADMIN';
const isComprasRole = (role) => normalizeRoleName(role) === 'COMPRAS';
const isAlmaceneroRole = (role) => normalizeRoleName(role) === 'ALMACENERO';
const isWarehouseAreaName = (value) => {
  const normalizedValue = normalizeRoleName(value);
  return normalizedValue === 'GENERAL' || normalizedValue.includes('ALMACEN');
};
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

// Approval chains will be loaded from aprobaciones_config table at startup
let APPROVAL_ROLES_BY_LEVEL = [5, 6, 7, 8];
let APPROVAL_CHAIN_COMPRA = [5, 6, 7, 8];
let APPROVAL_CHAIN_SERVICIO_DENTRO_PLAN = [5, 6, 7];
let APPROVAL_CHAIN_SERVICIO_FUERA_PLAN = [5, 6, 7, 8];
let approvalsTableAvailableCache = null;
let ROLE_NAME_BY_ID = new Map(); // Cache: roleId → roleName for generating PENDIENTE_* states
let schemaMeta = {
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

const loadApprovalChainsFromConfig = async () => {
  try {
    const result = await pool.query(
      `SELECT to_regclass('public.aprobaciones_config') IS NOT NULL AS exists`
    );
    const tableExists = Boolean(result.rows[0]?.exists);
    if (!tableExists) {
      return;
    }

    // Load all role names for state generation
    try {
      const rolesResult = await pool.query(`SELECT id, nombre FROM roles`);
      ROLE_NAME_BY_ID.clear();
      rolesResult.rows.forEach((row) => {
        const roleId = Number(row.id || 0);
        const roleName = String(row.nombre || '').trim();
        if (roleId > 0 && roleName) {
          ROLE_NAME_BY_ID.set(roleId, roleName);
        }
      });
    } catch (err) {
      console.warn('[APPROVAL] Could not load role names:', err.message);
    }

    const chainResult = await pool.query(
      `
        SELECT upper(trim(flujo)) AS flujo, orden, rol_id
        FROM aprobaciones_config
        WHERE activo = TRUE
        ORDER BY flujo, orden ASC
      `
    );

    const chainByFlow = new Map();
    chainResult.rows.forEach((row) => {
      const flow = String(row.flujo || '').trim().toUpperCase();
      const roleId = Number(row.rol_id || 0);
      if (!flow || !Number.isInteger(roleId) || roleId <= 0) return;

      if (!chainByFlow.has(flow)) {
        chainByFlow.set(flow, []);
      }

      chainByFlow.get(flow).push(roleId);
    });

    if (chainByFlow.has('COMPRA')) {
      APPROVAL_CHAIN_COMPRA = chainByFlow.get('COMPRA');
      APPROVAL_ROLES_BY_LEVEL = [...new Set([...APPROVAL_ROLES_BY_LEVEL, ...APPROVAL_CHAIN_COMPRA])];
    }

    if (chainByFlow.has('SERVICIO_DENTRO_PLAN')) {
      APPROVAL_CHAIN_SERVICIO_DENTRO_PLAN = chainByFlow.get('SERVICIO_DENTRO_PLAN');
      APPROVAL_ROLES_BY_LEVEL = [...new Set([...APPROVAL_ROLES_BY_LEVEL, ...APPROVAL_CHAIN_SERVICIO_DENTRO_PLAN])];
    }

    if (chainByFlow.has('SERVICIO_FUERA_PLAN')) {
      APPROVAL_CHAIN_SERVICIO_FUERA_PLAN = chainByFlow.get('SERVICIO_FUERA_PLAN');
      APPROVAL_ROLES_BY_LEVEL = [...new Set([...APPROVAL_ROLES_BY_LEVEL, ...APPROVAL_CHAIN_SERVICIO_FUERA_PLAN])];
    }

    console.log('[APPROVAL] Chains loaded from aprobaciones_config:', {
      COMPRA: APPROVAL_CHAIN_COMPRA,
      DENTRO_PLAN: APPROVAL_CHAIN_SERVICIO_DENTRO_PLAN,
      FUERA_PLAN: APPROVAL_CHAIN_SERVICIO_FUERA_PLAN,
    });
  } catch (err) {
    console.error('[APPROVAL] Error loading approval chains from config:', err.message);
  }
};

const normalizeApprovalTipo = (value) => normalize(value).replace(/\s+/g, '_');

const getApprovalChainForEntity = ({ tipo, dentroPlan = false, creatorRoleId = 0 } = {}) => {
  const normalizedTipo = normalizeApprovalTipo(tipo);
  const creatorRole = Number(creatorRoleId || 0);

  if (normalizedTipo === 'COMPRA') {
    const purchaseChain = [...APPROVAL_CHAIN_COMPRA];
    if (purchaseChain.length === 0) {
      return [];
    }

    const creatorIndex = creatorRole > 0 ? purchaseChain.indexOf(creatorRole) : -1;
    if (creatorIndex >= 0) {
      return purchaseChain.slice(creatorIndex + 1);
    }

    return purchaseChain;
  }

  if (normalizedTipo === 'SERVICIO') {
    // Regla especial: servicios creados por rol 11 van directo a Finanzas.
    if (creatorRole === 11) {
      return dentroPlan ? [7] : [7, 8];
    }

    return dentroPlan
      ? [...APPROVAL_CHAIN_SERVICIO_DENTRO_PLAN]
      : [...APPROVAL_CHAIN_SERVICIO_FUERA_PLAN];
  }

  return [];
};

const isApprovalHierarchyRoleId = (roleId) => {
  const numericRoleId = Number(roleId || 0);
  
  // Primero verifica el array cargado dinámicamente
  if (APPROVAL_ROLES_BY_LEVEL.includes(numericRoleId)) {
    return true;
  }
  
  // Si no está en el array, verifica si tiene un permiso de aprobación basándose en ROLE_NAME_BY_ID
  const roleName = ROLE_NAME_BY_ID.get(numericRoleId);
  if (roleName) {
    const normalizedName = normalizeRoleName(roleName);
    // Si el rol tiene un nombre que sugiere que es un rol de aprobación, considerarlo como parte de la jerarquía
    if (
      normalizedName === 'ADMIN' ||
      normalizedName.includes('FINANZAS') ||
      (normalizedName.includes('GERENCIA') && normalizedName.includes('AREA')) ||
      normalizedName.includes('JEFE')
    ) {
      return true;
    }
  }
  
  return false;
};

const APPROVAL_ROLE_ID_BY_NAME = new Map([
  [normalizeRoleName('JEFE DE AREA/SUBGERENTE'), 5],
  [normalizeRoleName('JEFE DE AREA SUBGERENTE'), 5],
  [normalizeRoleName('GERENCIA DEL AREA'), 6],
  [normalizeRoleName('GERENCIA DE FINANZAS'), 7],
  [normalizeRoleName('ADMIN'), 8],
]);

const APPROVAL_PERMISSION_BY_ROLE_ID = new Map([
  [5, 'APROBAR_JEFE_AREA'],
  [6, 'APROBAR_GERENCIA_AREA'],
  [7, 'APROBAR_FINANZAS'],
  [8, 'APROBAR_ADMIN'],
]);

const APPROVAL_PERMISSION_BY_STATE = new Map([
  ['PENDIENTE_JEFE_AREA', 'APROBAR_JEFE_AREA'],
  ['PENDIENTE_GERENCIA', 'APROBAR_GERENCIA_AREA'],
  ['PENDIENTE_FINANZAS', 'APROBAR_FINANZAS'],
  ['PENDIENTE_ADMIN', 'APROBAR_ADMIN'],
]);

const APPROVAL_STATE_BY_PERMISSION = new Map([
  ['APROBAR_JEFE_AREA', 'PENDIENTE_JEFE_AREA'],
  ['APROBAR_GERENCIA_AREA', 'PENDIENTE_GERENCIA'],
  ['APROBAR_FINANZAS', 'PENDIENTE_FINANZAS'],
  ['APROBAR_ADMIN', 'PENDIENTE_ADMIN'],
]);

const APPROVAL_PENDING_STATES = new Set(['PENDIENTE']);

const getApprovalRoleLabel = (roleId, roleName = '') => {
  const numericRoleId = Number(roleId || 0);
  const explicitName = String(roleName || '').trim();
  if (explicitName) {
    return explicitName;
  }

  // Primero intenta del cache de roles cargados dinámicamente
  const cachedName = ROLE_NAME_BY_ID.get(numericRoleId);
  if (cachedName) {
    return cachedName;
  }

  // Fallback a los hardcoded para compatibilidad si no está en cache
  if (numericRoleId === 5) return 'Jefe de Area/Subgerente';
  if (numericRoleId === 6) return 'Gerencia del Area';
  if (numericRoleId === 7) return 'Gerencia de Finanzas';
  if (numericRoleId === 8) return 'Admin';
  return numericRoleId > 0 ? `Rol ${numericRoleId}` : '';
};

const getPendingStateByRoleId = (roleId) => {
  const roleName = getApprovalRoleLabel(roleId);
  const normalizedRole = normalizeRoleName(roleName);
  if (!normalizedRole) {
    return '';
  }

  return `PENDIENTE_${normalizedRole}`;
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
  const normalizedPermission = normalizePermissionName(permiso);
  if (!normalizedPermission) return false;

  const roleId = Number(usuario?.id_role || usuario?.rol_id || 0);
  const directPermissions = Array.isArray(usuario?.permisos) ? usuario.permisos : [];
  const fallbackPermissions = typeof getPermissionsByRoleId === 'function'
    ? getPermissionsByRoleId(roleId)
    : [];
  const permissions = [...new Set([...directPermissions, ...fallbackPermissions])];

  return permissions.some((item) => normalizePermissionName(item) === normalizedPermission);
};

const getRequiredApprovalPermissionByRoleId = (roleId) => {
  const numericRoleId = Number(roleId || 0);
  
  // Primero intenta el mapa hardcodeado (para compatibilidad hacia atrás)
  const hardcodedPermission = APPROVAL_PERMISSION_BY_ROLE_ID.get(numericRoleId);
  if (hardcodedPermission) {
    return String(hardcodedPermission).trim().toUpperCase();
  }
  // Si no está en el mapa hardcodeado, intentar derivar el permiso a partir
  // del nombre del rol cargado dinámicamente en `ROLE_NAME_BY_ID`.
  const roleName = ROLE_NAME_BY_ID.get(numericRoleId);
  if (roleName) {
    const normalizedName = normalizeRoleName(roleName);

    // Primero intenta encontrarlo en el mapeo canónico por nombre de rol
    if (APPROVAL_ROLE_ID_BY_NAME.has(normalizedName)) {
      const mappedRoleId = APPROVAL_ROLE_ID_BY_NAME.get(normalizedName);
      const mappedPerm = APPROVAL_PERMISSION_BY_ROLE_ID.get(mappedRoleId);
      if (mappedPerm) return String(mappedPerm).trim().toUpperCase();
    }

    // Generar variantes limpias del nombre para intentar coincidir con permisos existentes
    const stopwords = [' DEL ', ' DE ', ' LA ', ' EL ', ' LOS ', ' LAS ', "'", '/'];
    const variants = new Set();
    variants.add(normalizedName);
    // variante sin stopwords
    let cleaned = ` ${normalizedName} `;
    for (const sw of stopwords) cleaned = cleaned.replace(new RegExp(sw, 'g'), ' ');
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    variants.add(cleaned);
    // variante removiendo SUBGERENTE (muchos roles contienen 'SUBGERENTE' en paralelo)
    variants.add(cleaned.replace(/SUBGERENTE/g, '').replace(/\s+/g, ' ').trim());

    // Construir candidatos de permiso y ver si coinciden con permisos conocidos
    const knownPerms = new Set([
      ...Array.from(APPROVAL_PERMISSION_BY_ROLE_ID.values()),
      ...Array.from(APPROVAL_PERMISSION_BY_STATE.values()),
    ].map((p) => String(p || '').trim().toUpperCase()));

    for (const v of variants) {
      const candidate = `APROBAR_${normalizePermissionName(v)}`;
      if (knownPerms.has(candidate)) return candidate;
    }

    // Fallback: generar permiso basado en el nombre normalizado (menos agresivo)
    const permission = `APROBAR_${normalizePermissionName(normalizedName)}`;
    return String(permission).trim().toUpperCase();
  }

  // Fallback vacío si no se puede resolver dinámicamente
  return '';
};

const getApprovalPermissionByState = (state) => {
  const normalizedState = normalizeApprovalState(state);
  if (APPROVAL_PERMISSION_BY_STATE.has(normalizedState)) {
    return APPROVAL_PERMISSION_BY_STATE.get(normalizedState);
  }

  if (!normalizedState.startsWith('PENDIENTE_')) {
    return '';
  }

  const pendingRoleKey = normalizedState.replace(/^PENDIENTE_/, '');
  // Preferir coincidencia exacta con roles cargados dinámicamente
  for (const [roleId, roleName] of ROLE_NAME_BY_ID.entries()) {
    if (normalizePermissionName(roleName) === pendingRoleKey) {
      return getRequiredApprovalPermissionByRoleId(roleId);
    }
  }

  // Si no hay coincidencia exacta, derivar el permiso directamente del
  // sufijo de estado (ej: PENDIENTE_MI_ROL -> APROBAR_MI_ROL).
  return `APROBAR_${pendingRoleKey}`;
};

const getApprovalStateByPermission = (permission) => {
  const normalizedPermission = normalizePermissionName(permission);
  if (APPROVAL_STATE_BY_PERMISSION.has(normalizedPermission)) {
    const roleId = getApprovalRoleIdByPermission(normalizedPermission);
    return getPendingStateByRoleId(roleId) || APPROVAL_STATE_BY_PERMISSION.get(normalizedPermission);
  }

  const roleId = getApprovalRoleIdByPermission(normalizedPermission);
  if (roleId > 0) {
    return getPendingStateByRoleId(roleId);
  }

  return getPendingStateByPermission(normalizedPermission);
};

const getPendingStateByPermission = (permission) => {
  const normalizedPermission = normalizePermissionName(permission);
  const roleId = getApprovalRoleIdByPermission(normalizedPermission);
  if (roleId > 0) {
    return getPendingStateByRoleId(roleId);
  }

  if (normalizedPermission.startsWith('APROBAR_')) {
    return `PENDIENTE_${normalizedPermission.replace(/^APROBAR_/, '')}`;
  }

  if (APPROVAL_STATE_BY_PERMISSION.has(normalizedPermission)) {
    const legacyState = APPROVAL_STATE_BY_PERMISSION.get(normalizedPermission);
    return normalizeApprovalState(legacyState);
  }

  return '';
};

const getApprovalRoleIdByPermission = (permission) => {
  const normalizedPermission = normalizePermissionName(permission);
  
  // Mapeo de permiso a nombre de rol esperado para compatibilidad con estados antiguos
  let expectedRoleName = '';
  if (normalizedPermission === 'APROBAR_ADMIN') expectedRoleName = 'ADMIN';
  else if (normalizedPermission === 'APROBAR_FINANZAS') expectedRoleName = 'GERENCIA DE FINANZAS';
  else if (normalizedPermission === 'APROBAR_GERENCIA_AREA') expectedRoleName = 'GERENCIA DEL AREA';
  else if (normalizedPermission === 'APROBAR_JEFE_AREA') expectedRoleName = 'JEFE DE AREA';

  if (expectedRoleName) {
    const normalizedExpected = normalizeRoleName(expectedRoleName);
    for (const [roleId, roleName] of ROLE_NAME_BY_ID.entries()) {
      const normalizedCached = normalizeRoleName(roleName);
      if (normalizedCached === normalizedExpected) {
        return roleId;
      }
    }
  }

  // Intentar resolver dinámicamente cualquier permiso APROBAR_<ROL>
  if (normalizedPermission.startsWith('APROBAR_')) {
    const roleKey = normalizedPermission.replace(/^APROBAR_/, '');
    for (const [roleId, roleName] of ROLE_NAME_BY_ID.entries()) {
      if (normalizePermissionName(roleName) === roleKey) {
        return roleId;
      }
    }
  }

  // Fallback: retornar los IDs hardcodeados
  if (normalizedPermission === 'APROBAR_JEFE_AREA') return 5;
  if (normalizedPermission === 'APROBAR_GERENCIA_AREA') return 6;
  if (normalizedPermission === 'APROBAR_FINANZAS') return 7;
  if (normalizedPermission === 'APROBAR_ADMIN') return 8;
  return 0;
};

const normalizeApprovalState = (state) => {
  const normalizedState = normalize(state).replace(/[\s-]+/g, '_');
  if (normalizedState === 'APROBADA') return 'APROBADO';
  if (normalizedState === 'RECHAZADA') return 'RECHAZADO';
  return normalizedState;
};

const isPendingApprovalState = (state) => {
  const normalizedState = normalizeApprovalState(state);
  return normalizedState === 'PENDIENTE' || normalizedState.startsWith('PENDIENTE_');
};

const getApprovalStagePermissionForUser = (usuario) => {
  if (tienePermiso(usuario, 'APROBAR_ADMIN')) return 'APROBAR_ADMIN';
  if (tienePermiso(usuario, 'APROBAR_FINANZAS')) return 'APROBAR_FINANZAS';
  if (tienePermiso(usuario, 'APROBAR_GERENCIA_AREA')) return 'APROBAR_GERENCIA_AREA';
  if (tienePermiso(usuario, 'APROBAR_JEFE_AREA')) return 'APROBAR_JEFE_AREA';
  return '';
};

const getApprovalStageStateForUser = (usuario) => getApprovalStateByPermission(getApprovalStagePermissionForUser(usuario));

const getNextApprovalState = ({ tipo, currentState, dentroPlan }) => {
  const normalizedState = normalizeApprovalState(currentState);
  const currentPermission = getApprovalPermissionByState(normalizedState);
  const approvalFlowPermissions = ['APROBAR_JEFE_AREA', 'APROBAR_GERENCIA_AREA', 'APROBAR_FINANZAS', 'APROBAR_ADMIN'];

  if (normalizedState === 'PENDIENTE') {
    return getNextApprovalState({ tipo, currentState: getPendingStateByPermission('APROBAR_JEFE_AREA'), dentroPlan });
  }

  const currentIndex = approvalFlowPermissions.indexOf(currentPermission);
  if (currentIndex >= 0) {
    const nextPermission = approvalFlowPermissions[currentIndex + 1] || '';
    if (!nextPermission) {
      return {
        permission: currentPermission,
        state: 'APROBADO',
      };
    }

    const nextState = getPendingStateByPermission(nextPermission);
    return {
      permission: currentPermission,
      state: nextState || 'PENDIENTE',
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
  const overrideDentroPlan = Object.prototype.hasOwnProperty.call(options || {}, 'dentro_plan')
    ? options.dentro_plan
    : null;

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
        selectQuery: `SELECT id, upper(trim(COALESCE(estado, 'PENDIENTE_JEFE_AREA'))) AS estado, FALSE AS dentro_plan FROM compras WHERE id = $1 FOR UPDATE`,
        updateQuery: 'UPDATE compras SET estado = $1::text, fecha_actualizacion = NOW() WHERE id = $2',
      }
      : {
        tableName: 'servicios',
        stateColumn: getServicioApprovalColumn(),
        selectQuery: `
          SELECT
            id,
            upper(trim(COALESCE(to_jsonb(s)->>'estado_aprobacion', to_jsonb(s)->>'estado', 'PENDIENTE_JEFE_AREA'))) AS estado,
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
    let dentroPlan = Boolean(entityRow.dentro_plan);

    if (normalizedTipo === 'SERVICIO' && overrideDentroPlan !== null) {
      dentroPlan = Boolean(overrideDentroPlan);
      const servicePlanColumn = getServicioDentroPlanColumn();
      if (servicePlanColumn) {
        await client.query(
          `UPDATE servicios SET ${quoteIdentifier(servicePlanColumn)} = $1 WHERE id = $2`,
          [dentroPlan, referenceId]
        );
      }
    }

    if (estadoAnterior === 'APROBADO') {
      throw new Error('Ya esta aprobado');
    }

    if (!isPendingApprovalState(estadoAnterior)) {
      throw new Error('La entidad no se encuentra en una etapa aprobable');
    }

    const flow = getNextApprovalState({ tipo: normalizedTipo, currentState: estadoAnterior, dentroPlan });
    const requiredPermission = flow.permission;
    const estadoNuevo = normalizedDecision === 'RECHAZADO' ? 'RECHAZADO' : flow.state;

    if (!requiredPermission || !estadoNuevo) {
      throw new Error('No fue posible determinar el siguiente estado del flujo');
    }

    if (!tienePermiso(usuario, requiredPermission)) {
      throw new Error(`No tienes permiso para aprobar en la etapa ${estadoAnterior}`);
    }

    const stageRoleId = getApprovalRoleIdByPermission(requiredPermission);
    if (!stageRoleId) {
      throw new Error('No existe configuracion de aprobacion para la etapa actual');
    }

    const approvalRow = await client.query(
      `
        SELECT id, orden, rol_aprobador, upper(trim(COALESCE(estado, 'PENDIENTE'))) AS estado
        FROM aprobaciones
        WHERE upper(trim(tipo)) = $1
          AND referencia_id = $2
          AND rol_aprobador = $3
        ORDER BY orden ASC
        LIMIT 1
        FOR UPDATE
      `,
      [normalizedTipo, referenceId, stageRoleId]
    );

    if (approvalRow.rows.length === 0) {
      throw new Error('No existe una aprobacion pendiente para esta etapa');
    }

    const currentApproval = approvalRow.rows[0];
    if (normalize(currentApproval.estado) === 'APROBADO') {
      throw new Error('Esta etapa ya fue aprobada');
    }

    const normalizedEstado = normalize(currentApproval.estado);
    const isPendingState = normalizedEstado === 'PENDIENTE' || normalizedEstado.startsWith('PENDIENTE_');
    if (!isPendingState) {
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

    // Para servicios, el primer aprobador debe indicar explícitamente si está dentro del plan.
    // Si la petición no incluye la decisión (`overrideDentroPlan === null`) y la etapa es la primera, rechazar.
    if (normalizedTipo === 'SERVICIO' && currentApproval && Number(currentApproval.orden || 0) === 1 && overrideDentroPlan === null) {
      throw new Error('DECISION DE APROBACION INVALIDA: En la primera aprobacion debe especificarse si el servicio esta dentro_plan');
    }

    const actorId = Number(usuario?.id || 0) || null;
    await client.query(
      `
        UPDATE aprobaciones
        SET estado = $1::text,
            usuario_id = $2,
            fecha = NOW()
        WHERE id = $3
          AND (upper(trim(COALESCE(estado, 'PENDIENTE'))) = 'PENDIENTE'
               OR upper(trim(COALESCE(estado, 'PENDIENTE'))) LIKE 'PENDIENTE_%')
      `,
      [normalizedDecision, actorId, Number(currentApproval.id)]
    );

    if (normalizedTipo === 'COMPRA') {
      // Actualizar estado de compra
      if (normalizedDecision === 'APROBADO') {
        // Verificar si hay aprobaciones pendientes DESPUÉS de la actual
        const nextPending = await client.query(
          `
            SELECT rol_aprobador
            FROM aprobaciones
            WHERE upper(trim(tipo)) = $1
              AND referencia_id = $2
              AND orden > $3
              AND (upper(trim(COALESCE(estado, 'PENDIENTE'))) = 'PENDIENTE'
                   OR upper(trim(COALESCE(estado, 'PENDIENTE'))) LIKE 'PENDIENTE_%')
            ORDER BY orden ASC
            LIMIT 1
          `,
          [normalizedTipo, referenceId, Number(currentApproval.orden || 0)]
        );

        const nextPendingRow = nextPending.rows[0];
        const hasPendingNext = !!nextPendingRow;
        
        if (hasPendingNext) {
          // Si hay pendientes posteriores, actualizar a PENDIENTE_<NEXT_ROLE>
          const nextRoleId = nextPendingRow.rol_aprobador;
          let nextRoleName = ROLE_NAME_BY_ID.get(Number(nextRoleId)) || `ROL_${nextRoleId}`;
          nextRoleName = normalizeRoleName(nextRoleName);
          const nextEstado = `PENDIENTE_${nextRoleName}`;
          
          await client.query(
            'UPDATE compras SET estado = $1::text, fecha_actualizacion = NOW() WHERE id = $2',
            [nextEstado, referenceId]
          );
        } else {
          // Si no hay pendientes, marcar como APROBADO y registrar estado_pedido
          await client.query(
            'UPDATE compras SET estado = $1::text, fecha_actualizacion = NOW() WHERE id = $2',
            [estadoNuevo, referenceId]
          );
          
          await client.query(
            `UPDATE compras SET estado_pedido = $1::text, fecha_actualizacion = NOW() WHERE id = $2`,
            ['APROBADO', referenceId]
          );
        }
      } else {
        // Si se rechaza, actualizar directamente
        await client.query(
          'UPDATE compras SET estado = $1::text, fecha_actualizacion = NOW() WHERE id = $2',
          [estadoNuevo, referenceId]
        );
      }
    } else {
      const serviceStateColumn = getServicioApprovalColumn();
      const serviceFlowColumn = getServicioStatusColumn();
      const dentroPlanColumn = getServicioDentroPlanColumn();

      // Para servicios, si es la primera aprobación y se especifica dentro_plan, reconstruir la cadena de aprobaciones PRIMERO
      if (normalizedTipo === 'SERVICIO' && overrideDentroPlan !== null && currentApproval && Number(currentApproval.orden || 0) === 1) {
        // Actualizar el valor dentro_plan con la decisión del usuario
        if (dentroPlanColumn) {
          await client.query(
            `UPDATE servicios SET ${quoteIdentifier(dentroPlanColumn)} = $1 WHERE id = $2`,
            [overrideDentroPlan, referenceId]
          );
        }
        await rebuildServiceApprovalChain(client, referenceId, overrideDentroPlan);
      }

      // Luego, actualizar estado del servicio
      if (normalizedDecision === 'APROBADO') {
        // Verificar si aun hay aprobaciones pendientes CON ORDEN MAYOR (posteriores a la actual)
        const nextPending = await client.query(
          `
            SELECT rol_aprobador
            FROM aprobaciones
            WHERE upper(trim(tipo)) = $1
              AND referencia_id = $2
              AND orden > $3
              AND (upper(trim(COALESCE(estado, 'PENDIENTE'))) = 'PENDIENTE'
                   OR upper(trim(COALESCE(estado, 'PENDIENTE'))) LIKE 'PENDIENTE_%')
            ORDER BY orden ASC
            LIMIT 1
          `,
          [normalizedTipo, referenceId, Number(currentApproval.orden || 0)]
        );

        const nextPendingRow = nextPending.rows[0];
        const hasPendingNext = !!nextPendingRow;
        
        if (!hasPendingNext) {
          // Solo marcar como APROBADO si no hay más aprobaciones pendientes después de esta
          const newFlow = 'APROBADO';
          await client.query(
            `UPDATE servicios SET ${quoteIdentifier(serviceStateColumn)} = $1, ${quoteIdentifier(serviceFlowColumn)} = $2 WHERE id = $3`,
            [estadoNuevo, newFlow, referenceId]
          );
        } else {
          // Si hay aprobaciones pendientes posteriores, actualizar estado_aprobacion a PENDIENTE_<NEXT_ROLE>
          const nextRoleId = nextPendingRow.rol_aprobador;
          let nextRoleName = ROLE_NAME_BY_ID.get(Number(nextRoleId)) || `ROL_${nextRoleId}`;
          nextRoleName = normalizeRoleName(nextRoleName);
          const nextEstado = `PENDIENTE_${nextRoleName}`;
          
          await client.query(
            `UPDATE servicios SET ${quoteIdentifier(serviceStateColumn)} = $1 WHERE id = $2`,
            [nextEstado, referenceId]
          );
        }
      } else {
        await client.query(
          `UPDATE servicios SET ${quoteIdentifier(serviceStateColumn)} = $1 WHERE id = $2`,
          [estadoNuevo, referenceId]
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
  const roleId = Number(user?.id_role || user?.rol_id || 0);
  const hasDirectPermissions = Array.isArray(user?.permisos) && user.permisos.length > 0;
  const directPermissions = hasDirectPermissions ? user.permisos : [];
  const fallbackPermissions = typeof getPermissionsByRoleId === 'function'
    ? getPermissionsByRoleId(roleId)
    : [];
  const permissionSet = new Set((hasDirectPermissions ? directPermissions : fallbackPermissions)
    .map((perm) => String(perm || '').trim().toUpperCase())
    .filter(Boolean));

  // Mapeo de permisos a nombres de roles esperados
  const permissionToRoleName = new Map([
    ['APROBAR_ADMIN', 'ADMIN'],
    ['APROBAR_FINANZAS', 'GERENCIA DE FINANZAS'],
    ['APROBAR_GERENCIA_AREA', 'GERENCIA DEL AREA'],
    ['APROBAR_JEFE_AREA', 'JEFE DE AREA'],
  ]);

  // Buscar dinámicamente: si tiene un permiso de aprobación, encontrar el rol correspondiente en ROLE_NAME_BY_ID
  for (const [permission, expectedRoleName] of permissionToRoleName.entries()) {
    if (permissionSet.has(permission)) {
      // Buscar el rol en ROLE_NAME_BY_ID que coincida con este permiso
      for (const [roleIdFromCache, roleName] of ROLE_NAME_BY_ID.entries()) {
        const normalizedCached = normalizeRoleName(roleName);
        const normalizedExpected = normalizeRoleName(expectedRoleName);
        if (normalizedCached === normalizedExpected) {
          return roleIdFromCache;
        }
      }
      // Fallback: si no está en el cache, usar el mapa hardcodeado
      const fallbackRoleId = getApprovalRoleIdByPermission(permission);
      if (fallbackRoleId > 0) {
        return fallbackRoleId;
      }
    }
  }

  return 0;
};

const getIntermediateApprovalStateByRoleId = (roleId) => {
  return getPendingStateByRoleId(roleId);
};

const generatePendingStateByRoleId = (roleId) => {
  return getPendingStateByRoleId(roleId) || 'PENDIENTE';
};

const getInitialApprovalStateForEntity = ({ tipo, dentroPlan = false, creatorRoleId = 0 } = {}) => {
  const normalizedTipo = normalizeApprovalTipo(tipo);
  const creatorRole = Number(creatorRoleId || 0);

  if (normalizedTipo === 'COMPRA' && creatorRole > 0 && APPROVAL_CHAIN_COMPRA.includes(creatorRole)) {
    const purchaseChain = [...APPROVAL_CHAIN_COMPRA];
    const creatorIndex = purchaseChain.indexOf(creatorRole);
    const nextRoleId = creatorIndex >= 0 ? purchaseChain[creatorIndex + 1] : 0;

    if (!nextRoleId) {
      return 'APROBADA';
    }

    return generatePendingStateByRoleId(nextRoleId) || 'PENDIENTE';
  }

  const roleChain = getApprovalChainForEntity({ tipo, dentroPlan, creatorRoleId });
  const firstRole = Number(roleChain[0] || 0);
  const mapped = generatePendingStateByRoleId(firstRole);
  return mapped || 'PENDIENTE';
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

  if (creatorId > 0 && creatorLabel) {
    const creatorAlreadyIncluded = ordered.some((row) => Number(row.usuario_id || 0) === creatorId || Number(row.rol_aprobador || 0) === numericCreatorRoleId);
    if (!creatorAlreadyIncluded) {
      ordered.unshift({
        orden: 0,
        rol_aprobador: numericCreatorRoleId,
        rol: getApprovalRoleLabel(numericCreatorRoleId) || 'Solicitante',
        etapa: 'SOLICITANTE',
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
  const roleByPermission = resolveApprovalRoleIdByPermissions(user);
  if (roleByPermission > 0) {
    return roleByPermission;
  }

  const numericRoleId = Number(user?.id_role || user?.rol_id || 0);
  if (isApprovalHierarchyRoleId(numericRoleId)) {
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

  const result = await client.query(
    `
      SELECT DISTINCT a.referencia_id
      FROM aprobaciones a
      WHERE upper(trim(a.tipo)) = $1
        AND a.rol_aprobador = $2
        AND (upper(trim(COALESCE(a.estado, 'PENDIENTE'))) = 'PENDIENTE'
             OR upper(trim(COALESCE(a.estado, 'PENDIENTE'))) LIKE 'PENDIENTE_%')
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
    [normalizedTipo, role]
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
            AND (upper(trim(COALESCE(pending.estado, 'PENDIENTE'))) = 'PENDIENTE'
                 OR upper(trim(COALESCE(pending.estado, 'PENDIENTE'))) LIKE 'PENDIENTE_%')
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

// Verifica aprobacion final sin depender de un rol fijo.
// Si existen aprobaciones persistidas, se exige que no queden pendientes.
// Si no hay tabla o no hay filas de aprobacion, se cae al estado final de la entidad.
const hasEffectiveFinalApprovalByRole = async (client, {
  tipo,
  referenciaId,
} = {}) => {
  const reference = Number(referenciaId || 0);
  if (!reference) {
    return false;
  }

  const normalizedTipo = normalizeApprovalTipo(tipo);
  const tableExists = await hasAprobacionesTable(client);

  if (tableExists) {
    const approvalStateResult = await client.query(
      `
        SELECT
          COUNT(*) FILTER (
            WHERE upper(trim(COALESCE(estado, 'PENDIENTE'))) = 'APROBADO'
          ) AS aprobadas,
          COUNT(*) FILTER (
            WHERE upper(trim(COALESCE(estado, 'PENDIENTE'))) = 'RECHAZADO'
          ) AS rechazadas,
          COUNT(*) FILTER (
            WHERE upper(trim(COALESCE(estado, 'PENDIENTE'))) = 'PENDIENTE'
              OR upper(trim(COALESCE(estado, 'PENDIENTE'))) LIKE 'PENDIENTE_%'
          ) AS pendientes
        FROM aprobaciones
        WHERE upper(trim(tipo)) = $1
          AND referencia_id = $2
      `,
      [normalizedTipo, reference]
    );

    const aprobadas = Number(approvalStateResult.rows[0]?.aprobadas || 0);
    const rechazadas = Number(approvalStateResult.rows[0]?.rechazadas || 0);
    const pendientes = Number(approvalStateResult.rows[0]?.pendientes || 0);

    if (rechazadas > 0) {
      return false;
    }

    if (pendientes === 0 && aprobadas > 0) {
      return true;
    }
  }

  if (normalizedTipo === 'COMPRA') {
    const compraResult = await client.query(
      `
        SELECT upper(trim(COALESCE(to_jsonb(c)->>'estado_pedido', to_jsonb(c)->>'estado', ''))) AS estado
        FROM compras c
        WHERE c.id = $1
        LIMIT 1
      `,
      [reference]
    );

    const estado = normalize(compraResult.rows[0]?.estado || '');
    return ['APROBADA', 'APROBADO', 'POR_RECIBIR', 'RECIBIDA', 'RECIBIDO', 'ENTREGADO'].includes(estado);
  }

  if (normalizedTipo === 'SERVICIO') {
    const servicioResult = await client.query(
      `
        SELECT upper(trim(COALESCE(to_jsonb(s)->>'estado_aprobacion', to_jsonb(s)->>'estado', ''))) AS estado
        FROM servicios s
        WHERE s.id = $1
        LIMIT 1
      `,
      [reference]
    );

    const estado = normalize(servicioResult.rows[0]?.estado || '');
    return ['APROBADO', 'APROBADA', 'DATOS_COMPLETADOS', 'REALIZADO'].includes(estado);
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
        AND (upper(trim(COALESCE(a.estado, 'PENDIENTE'))) = 'PENDIENTE' 
             OR upper(trim(COALESCE(a.estado, 'PENDIENTE'))) LIKE 'PENDIENTE_%')
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
  if (isPendingApprovalState(normalizedCurrentStatus)) {
    return normalizedCurrentStatus;
  }

  const pendingRole = Number(nextPendingRole || 0);
  if (pendingRole > 0) {
    const mappedPendingState = getIntermediateApprovalStateByRoleId(pendingRole);
    if (mappedPendingState) {
      return mappedPendingState;
    }

    return 'PENDIENTE';
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
          AND upper(trim(COALESCE(to_jsonb(c)->>'estado_pedido', to_jsonb(c)->>'estado', ''))) IN ('APROBADA','APROBADO', 'POR_RECIBIR', 'RECIBIDA', 'RECIBIDO', 'ENTREGADO')
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
          AND upper(trim(COALESCE(to_jsonb(c)->>'estado_pedido', to_jsonb(c)->>'estado', 'PENDIENTE'))) <> 'RECHAZADA'
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
  const numericRoleId = Number(user?.id_role || user?.rol_id || 0);
  return isAdminRole(user?.rol) || isComprasRole(user?.rol) || numericRoleId === 9 || hasPurchaseOrdersAccess(user);
};

const canAccessPurchaseOrdersModule = (user) => (
  tienePermiso(user, 'GESTIONAR_SOLICITUDES')
  || hasPurchaseOrdersAccess(user)
  || isAdminRole(user?.rol)
  || isComprasRole(user?.rol)
);

const createApprovalRowsForEntity = async (client, {
  tipo,
  referenciaId,
  dentroPlan = false,
  creatorRoleId = 0,
}) => {
  const tableExists = await hasAprobacionesTable(client);
  if (!tableExists) {
    return { usesApprovalTable: false, autoApproved: false };
  }

  const normalizedTipo = normalizeApprovalTipo(tipo);
  const reference = Number(referenciaId || 0);
  const roleChain = getApprovalChainForEntity({ tipo: normalizedTipo, dentroPlan, creatorRoleId });

  if (!reference) {
    throw new Error('referencia_id invalido para crear aprobaciones');
  }

  if (roleChain.length === 0) {
    if (normalizedTipo === 'COMPRA' && Number(creatorRoleId || 0) > 0 && APPROVAL_CHAIN_COMPRA.includes(Number(creatorRoleId || 0))) {
      return { usesApprovalTable: true, autoApproved: true };
    }

    throw new Error(`No se pudo resolver la cadena de aprobaciones para tipo ${normalizedTipo}`);
  }

  await client.query('DELETE FROM aprobaciones WHERE upper(trim(tipo)) = $1 AND referencia_id = $2', [normalizedTipo, reference]);

  for (let idx = 0; idx < roleChain.length; idx += 1) {
    const roleId = roleChain[idx];
    const pendingState = generatePendingStateByRoleId(roleId);
    await client.query(
      `
        INSERT INTO aprobaciones (tipo, referencia_id, orden, rol_aprobador, estado)
        VALUES ($1, $2, $3, $4, $5)
      `,
      [normalizedTipo, reference, idx + 1, roleId, pendingState]
    );
  }

  return { usesApprovalTable: true, autoApproved: false };
};

const rebuildServiceApprovalChain = async (client, referenciaId, dentroPlan = false, creatorRoleId = 0) => {
  const normalizedTipo = 'SERVICIO';
  const currentOrder = 1;
  const roleChain = getApprovalChainForEntity({ tipo: normalizedTipo, dentroPlan, creatorRoleId });
  if (!Array.isArray(roleChain) || roleChain.length <= currentOrder) {
    await client.query(
      `DELETE FROM aprobaciones WHERE upper(trim(tipo)) = $1 AND referencia_id = $2 AND orden > $3`,
      [normalizedTipo, Number(referenciaId), currentOrder]
    );
    return;
  }

  await client.query(
    `DELETE FROM aprobaciones WHERE upper(trim(tipo)) = $1 AND referencia_id = $2 AND orden > $3`,
    [normalizedTipo, Number(referenciaId), currentOrder]
  );

  const pendingRoles = roleChain.slice(currentOrder);
  for (let idx = 0; idx < pendingRoles.length; idx += 1) {
    const roleId = pendingRoles[idx];
    const pendingState = generatePendingStateByRoleId(roleId);
    await client.query(
      `INSERT INTO aprobaciones (tipo, referencia_id, orden, rol_aprobador, estado)
        VALUES ($1, $2, $3, $4, $5)`,
      [normalizedTipo, Number(referenciaId), currentOrder + idx + 1, roleId, pendingState]
    );
  }
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

  const result = await client.query(
    `
      SELECT DISTINCT a.referencia_id
      FROM aprobaciones a
      WHERE upper(trim(a.tipo)) = $1
        AND a.rol_aprobador = $2
        AND (upper(trim(COALESCE(a.estado, 'PENDIENTE'))) = 'PENDIENTE'
             OR upper(trim(COALESCE(a.estado, 'PENDIENTE'))) LIKE 'PENDIENTE_%')
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
    [normalizedTipo, role, ids]
  );

  return new Set(result.rows.map((row) => Number(row.referencia_id)).filter((value) => Number.isInteger(value) && value > 0));
};

const fetchFirstApprovalReferenceIdsByRole = async (client, {
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

  const result = await client.query(
    `
      SELECT DISTINCT a.referencia_id
      FROM aprobaciones a
      WHERE upper(trim(a.tipo)) = $1
        AND a.rol_aprobador = $2
        AND a.orden = 1
        AND (upper(trim(COALESCE(a.estado, 'PENDIENTE'))) = 'PENDIENTE'
             OR upper(trim(COALESCE(a.estado, 'PENDIENTE'))) LIKE 'PENDIENTE_%')
        AND a.referencia_id = ANY($3::int[])
    `,
    [normalizedTipo, role, ids]
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
        AND (upper(trim(COALESCE(estado, 'PENDIENTE'))) = 'PENDIENTE'
             OR upper(trim(COALESCE(estado, 'PENDIENTE'))) LIKE 'PENDIENTE_%')
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
        AND (upper(trim(COALESCE(estado, 'PENDIENTE'))) = 'PENDIENTE'
             OR upper(trim(COALESCE(estado, 'PENDIENTE'))) LIKE 'PENDIENTE_%')
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
    const fallback = await client.query(
      `
        SELECT
          1 AS orden,
          ${getUserRoleIdExpr('u')} AS rol_aprobador,
          COALESCE(u.nombre, '') AS aprobador,
          COALESCE(r.nombre, 'ROL 7') AS rol,
          COALESCE(c.fecha_actualizacion, c.fecha_creacion, NOW()) AS fecha
        FROM compras c
        JOIN usuarios u ON u.id = c.id_usuario
        LEFT JOIN roles r ON r.id = ${getUserRoleIdExpr('u')}
        WHERE c.id = $1
          AND ${getUserRoleIdExpr('u')} = 7
          AND upper(trim(COALESCE(to_jsonb(c)->>'estado_pedido', to_jsonb(c)->>'estado', ''))) IN ('APROBADA', 'APROBADO', 'POR_RECIBIR', 'RECIBIDA', 'RECIBIDO', 'ENTREGADO')
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

  if (rows.rows.length === 0 && normalizedTipo === 'SERVICIO') {
    const fallback = await client.query(
      `
        SELECT
          1 AS orden,
          ${getUserRoleIdExpr('u')} AS rol_aprobador,
          COALESCE(u.nombre, '') AS aprobador,
          COALESCE(r.nombre, 'ROL 7') AS rol,
          COALESCE(NULLIF(to_jsonb(s)->>'fecha_creacion', '')::timestamp, NULLIF(to_jsonb(s)->>'created_at', '')::timestamp, NOW()) AS fecha
        FROM servicios s
        JOIN usuarios u ON u.id = NULLIF(COALESCE(to_jsonb(s)->>'id_usuario', to_jsonb(s)->>'usuario_id', ''), '')::int
        LEFT JOIN roles r ON r.id = ${getUserRoleIdExpr('u')}
        WHERE s.id = $1
          AND ${getUserRoleIdExpr('u')} = 7
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
const canRateAnyProvider = (user) => canRateCompra(user) || canRateRequerimiento(user);

const canEditUnifiedProveedorRating = (user) => {
  const roleId = Number(user?.id_role || user?.rol_id || 0);
  if (roleId === 11) return true;

  const roleName = normalize(user?.rol || '');
  return roleName === 'SERVICIOS_GENERALES' || roleName === 'SERVICIOS GENERALES';
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

  const proveedorNombreFromDb = String(providerResult.rows[0]?.proveedor_nombre || '').trim();
  if (!proveedorNombreFromDb || proveedorNombreFromDb.toLowerCase() === 'sin proveedor') {
    return null
  }

  const resolveOrigin = async () => {
    const normalizedTipo = normalizeRatingType(tipo);
    const referenceId = Number(idReferencia || 0);
    const rawTipo = String(tipo || '').trim();

    const buildDefaultOrigin = (typeLabel, fallbackName) => ({
      origen_tipo: typeLabel,
      origen_nombre: Number.isInteger(referenceId) && referenceId > 0 ? `${fallbackName} #${referenceId}` : '',
      origen_detalle: '',
    });

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
        return buildDefaultOrigin('Servicio', 'Servicio');
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
        return buildDefaultOrigin('Producto', 'Compra');
      }
    }

    if (Number.isInteger(referenceId) && referenceId > 0) {
      try {
        const servicioOrigin = await (async () => {
          const servicios = await fetchServiciosRows([referenceId], 'WHERE s.id = $1');
          if (servicios.length > 0) {
            const servicio = servicios[0];
            const servicioNombre = String(servicio?.nombre_servicio || servicio?.descripcion_servicio || '').trim();
            return {
              origen_tipo: 'Servicio',
              origen_nombre: servicioNombre || `Servicio #${referenceId}`,
              origen_detalle: String(servicio?.descripcion_servicio || '').trim(),
            };
          }
          return null;
        })();

        if (servicioOrigin) return servicioOrigin;
      } catch (_error) {
        // ignore fallback errors
      }

      try {
        const compraOrigin = await (async () => {
          const compras = await fetchComprasRows([referenceId], 'WHERE c.id = $1');
          if (compras.length > 0) {
            const compra = compras[0];
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
          }
          return null;
        })();

        if (compraOrigin) return compraOrigin;
      } catch (_error) {
        // ignore fallback errors
      }
    }

    if (rawTipo) {
      const fallbackType = normalizeRatingType(rawTipo) === 'servicio' ? 'Servicio' : 'Producto';
      return buildDefaultOrigin(fallbackType, fallbackType === 'Servicio' ? 'Servicio' : 'Compra');
    }

    return buildDefaultOrigin('Producto', 'Compra');
  };

  const origin = await resolveOrigin();

  const proveedorNombre = proveedorNombreFromDb || (Number(proveedorId || 0) > 0 ? `Proveedor #${proveedorId}` : 'Proveedor desconocido');
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
      INNER JOIN proveedores p ON p.id = cp.id_proveedor
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
    const rowGap = 4;
    const paddingY = 4;
    const titleHeight = 16;
    const labelWidth = Math.max(98, Math.floor((usableWidth / 2 - 20) * 0.38));
    const valueWidth = usableWidth / 2 - 20 - labelWidth - 8;

    const measureRowHeight = (label, value) => {
      const textLabel = `${safeText(label)}:`;
      const textValue = safeText(value);
      doc.font('Helvetica-Bold').fontSize(8.5);
      const labelHeight = doc.heightOfString(textLabel, { width: labelWidth, align: 'left' });
      doc.font('Helvetica').fontSize(8.5);
      const valueHeight = doc.heightOfString(textValue, { width: valueWidth, align: 'left' });
      return Math.max(18, Math.max(labelHeight, valueHeight));
    };

    let total = titleHeight + (paddingY * 2);
    rows.forEach(([label, value]) => {
      total += measureRowHeight(label, value) + rowGap;
    });
    return total;
  };

  const drawInfoBlock = ({ title, rows, x, y, width }) => {
    const rowGap = 6;
    const paddingX = 10;
    const paddingY = 6;
    const titleHeight = 18;
    const labelWidth = Math.max(98, Math.floor(width * 0.38));
    const valueWidth = width - (paddingX * 2) - labelWidth - 8;

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

    let contentHeight = 0;
    rows.forEach(([label, value]) => {
      const measured = measureRowHeight(label, value);
      contentHeight += measured.rowHeight + rowGap;
    });

    const blockHeight = titleHeight + (paddingY * 2) + contentHeight;

    doc.rect(x, y, width, blockHeight).fillAndStroke(PDF_BRAND_COLORS.surface, '#dbe3ec');
    doc.rect(x, y, width, titleHeight).fillAndStroke(PDF_BRAND_COLORS.sectionHeader, '#dbe3ec');
    doc.font('Helvetica-Bold').fontSize(9).fillColor(PDF_BRAND_COLORS.textPrimary).text(title, x + paddingX, y + 5, {
      width: width - (paddingX * 2),
    });

    let rowY = y + titleHeight + paddingY;
    rows.forEach(([label, value]) => {
      const { textLabel, textValue, rowHeight } = measureRowHeight(label, value);

      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(PDF_BRAND_COLORS.textSecondary).text(textLabel, x + paddingX, rowY, {
        width: labelWidth,
      });

      // Make the TOTAL FINAL value bold
      const isTotalFinal = String(label || '').toLowerCase().replace(/\s+/g, '') === 'totalfinal'
        || String(label || '').toLowerCase().includes('total final')
        || String(label || '').toLowerCase().includes('totalfinal');

      if (isTotalFinal) {
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(PDF_BRAND_COLORS.textPrimary).text(textValue, x + paddingX + labelWidth + 8, rowY, {
          width: valueWidth,
        });
      } else {
        doc.font('Helvetica').fontSize(8.5).fillColor(PDF_BRAND_COLORS.textPrimary).text(textValue, x + paddingX + labelWidth + 8, rowY, {
          width: valueWidth,
        });
      }

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
      );

      ensureSpace(estimatedPairHeight);
      cursorY = Math.max(cursorY, doc.y);

      const leftBottom = drawInfoBlock({
        title: leftBlock.title,
        rows: leftBlock.rows,
        x: left,
        y: cursorY,
        width: colWidth,
      });

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

      cursorY = pairBottom + 1;
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
    doc.y = 124;
  };

  doc.on('data', (chunk) => chunks.push(chunk));
  doc.on('error', reject);
  doc.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));

  doc.on('pageAdded', () => {
    doc.y = 124;
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
    .filter((row) => {
      const etapaLabel = String(row.etapa || '').trim().toUpperCase()
      const rolLabel = String(row.rol || '').trim().toUpperCase()
      const isRequesterRow = etapaLabel === 'SOLICITANTE' || rolLabel === 'SOLICITANTE'
      return !isRequesterRow || approverEntries.length === 1
    })
    .map((row) => {
      const etapaLabel = String(row.etapa || '').trim().toUpperCase()
      const rolLabel = String(row.rol || '').trim().toUpperCase()
      const fallbackRoleLabel = safeText(row.rol || getApprovalRoleLabel(row.rol_aprobador))
      const label = etapaLabel === 'SOLICITANTE' || rolLabel === 'SOLICITANTE'
        ? fallbackRoleLabel
        : safeText(row.etapa || row.rol || getApprovalRoleLabel(row.rol_aprobador))
      return `${label} - ${safeText(row.aprobador || 'Pendiente')}`
    })
    .join('\n');
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
  doc.y = resumenY + 2;

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
        ...(String(compra.comentarios || '').trim()
          ? [['Comentarios', compra.comentarios]]
          : []),
      ],
    },
  ]);

  const purchaseDetailText = String(compra.detalle || compra.comentarios || '').trim();
  if (entregaInfo) {
    renderTwoColumnBlocks([
      {
        title: 'Entrega al area',
        rows: [
          ['DNI receptor', entregaInfo.receptor_dni || entregaInfo.dni || 'N/D'],
          ['Nombre receptor', entregaInfo.receptor_nombre || entregaInfo.nombre || 'N/D'],
        ],
      },
      {
        title: 'Estado de entrega',
        rows: [
          ['Entregado', 'SI'],
          ['Fecha entrega', entregaInfo.fecha_entrega_area ? new Date(entregaInfo.fecha_entrega_area).toLocaleString() : 'N/D'],
        ],
      },
    ]);
  }

  if (purchaseDetailText) {
    writeSectionTitle('Detalle de la solicitud');
    ensureSpace(40);
    const detailBoxTop = doc.y;
    const detailHeight = Math.max(28, doc.heightOfString(purchaseDetailText, { width: usableWidth - 20 }) + 14);
    doc.rect(left, detailBoxTop, usableWidth, detailHeight).fillAndStroke('#ffffff', '#e2e8f0');
    doc.font('Helvetica').fontSize(9).fillColor(PDF_BRAND_COLORS.textPrimary).text(purchaseDetailText, left + 10, detailBoxTop + 7, {
      width: usableWidth - 20,
      align: 'left',
    });
    doc.y = detailBoxTop + detailHeight + 3;
  }

  const items = Array.isArray(compra.items) ? compra.items : [];
  if (items.length > 0) {
    writeSectionTitle('Items');
    const colWidths = [403, 120];
    const headers = ['Material/Servicio', 'Cantidad'];
    let x = left;

    const drawDetailHeader = (startY) => {
      let headerX = left;
      headers.forEach((header, index) => {
        doc.rect(headerX, startY, colWidths[index], 20).fillAndStroke(PDF_BRAND_COLORS.sectionHeader, '#cbd5e1');
        doc.font('Helvetica-Bold').fontSize(9).fillColor(PDF_BRAND_COLORS.textPrimary);
        doc.text(header, headerX + 6, startY + 6, {
          width: colWidths[index] - 12,
          align: index === 0 ? 'left' : 'center',
        });
        headerX += colWidths[index];
      });
      return startY + 20;
    };
    let rowY = drawDetailHeader(doc.y);

    doc.font('Helvetica').fontSize(8.5).fillColor(PDF_BRAND_COLORS.textPrimary);
    items.forEach((item) => {
      const qty = Number(item.cantidad || 0);
      const descripcion = safeText(item.material || item.descripcion || item.nombre);
      const rowHeight = Math.max(20, doc.heightOfString(descripcion, { width: colWidths[0] - 12 }) + 8);

      if (rowY + rowHeight > bottomLimit - 32) {
        doc.addPage();
        drawHeader();
        writeSectionTitle('Items (continuación)');
        rowY = drawDetailHeader(doc.y);
      }

      x = left;
      const cells = [
        descripcion,
        String(qty),
      ];
      cells.forEach((cell, cellIndex) => {
        doc.rect(x, rowY, colWidths[cellIndex], rowHeight).fillAndStroke('#ffffff', '#e2e8f0');
        doc.font('Helvetica').fontSize(8.5).fillColor(PDF_BRAND_COLORS.textPrimary);
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
      writeSectionTitle('Items (continuación)');
      rowY = doc.y;
    }
    const resumenTotalY = rowY;
    doc.rect(left, resumenTotalY, usableWidth - 130, 22)
      .fillAndStroke(PDF_BRAND_COLORS.surface, '#cbd5e1');

    doc.rect(left + usableWidth - 130, resumenTotalY, 130, 22)
      .fillAndStroke(PDF_BRAND_COLORS.surface, '#cbd5e1');

    doc.font('Helvetica-Bold').fontSize(9).fillColor(PDF_BRAND_COLORS.textPrimary)
      .text('TOTAL GENERAL', left + 8, resumenTotalY + 7, {
        width: usableWidth - 146,
        align: 'right',
      });

    doc.text(money(totalFinal || 0, compra.moneda), left + usableWidth - 124, resumenTotalY + 7, {
      width: 118,
      align: 'center',
    });

    doc.y = resumenTotalY + 2;
  } 

  doc.moveDown(1);
  doc.font('Helvetica').fontSize(8).fillColor(PDF_BRAND_COLORS.textSecondary).text(
    'Si tienes dudas sobre el servicio u orden de compra, contactar a:\ncompras@alfosac.pe\n+51 978772509',
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

    let total = 24;
    const labelWidth = 98;
    const valueWidth = 136;
    rows.forEach(([label, value]) => {
      total += measureRowHeight(label, value, labelWidth, valueWidth) + 6;
    });
    return total + 6;
  };

  const drawInfoBlock = ({ title, rows, x, y, width }) => {
    const rowGap = 5;
    const paddingX = 10;
    const paddingY = 6;
    const titleHeight = 18;
    const labelWidth = Math.max(98, Math.floor(width * 0.38));
    const valueWidth = width - (paddingX * 2) - labelWidth - 8;

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

    let contentHeight = 0;
    rows.forEach(([label, value]) => {
      const measured = measureRowHeight(label, value);
      contentHeight += measured.rowHeight + rowGap;
    });

    const blockHeight = titleHeight + (paddingY * 2) + contentHeight;

    doc.rect(x, y, width, blockHeight).fillAndStroke(PDF_BRAND_COLORS.surface, '#dbe3ec');
    doc.rect(x, y, width, titleHeight).fillAndStroke(PDF_BRAND_COLORS.sectionHeader, '#dbe3ec');
    doc.font('Helvetica-Bold').fontSize(9).fillColor(PDF_BRAND_COLORS.textPrimary).text(title, x + paddingX, y + 5, {
      width: width - (paddingX * 2),
    });

    let rowY = y + titleHeight + paddingY;
    rows.forEach(([label, value]) => {
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

      ensureSpace(estimatedPairHeight);
      cursorY = Math.max(cursorY, doc.y);

      const leftBottom = drawInfoBlock({
        title: leftBlock.title,
        rows: leftBlock.rows,
        x: left,
        y: cursorY,
        width: colWidth,
      });

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

      cursorY = pairBottom + 1;
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
  const porcentajeRetencion = Number(servicio.proveedor_retencion_pct || servicio.retencion || 0);
  const currencyNorm = normalizeRoleName(servicio.proveedor_moneda || currencyLabel || servicio.moneda || '');
  const isUsdCurrency = currencyNorm.includes('USD') || currencyNorm.includes('DOLAR');
  const isPenCurrency = currencyNorm.includes('PEN') || currencyNorm.includes('SOL');
  const totalBaseSoles = isUsdCurrency ? Number((totalBase * 3.5).toFixed(2)) : totalBase;
  const exceedsThreshold = (isPenCurrency && totalBase > 700) || (isUsdCurrency && totalBaseSoles > 700);
  const providerAllowsRetention = normalize(servicio.proveedor_retencion) === 'SI' && porcentajeRetencion > 0;
  const aplicaRetencion = Boolean(servicio.aplica_retencion) || (providerAllowsRetention && exceedsThreshold);
  const montoRetenido = aplicaRetencion ? Number((totalBase * (porcentajeRetencion / 100)).toFixed(2)) : 0;
  let totalFinal = parseAmount(servicio.total || totalBase);
  if (aplicaRetencion) {
    totalFinal = Number((totalBase - montoRetenido).toFixed(2));
  }
  const approverEntries = buildPdfApprovalEntries({
    approvals: servicio.aprobadores,
    creatorUserId: servicio.id_usuario,
    creatorRoleId: servicio.usuario_rol_id,
    creatorName: servicio.usuario,
  });
  const approversSummary = approverEntries
    .filter((row) => {
      const etapaLabel = String(row.etapa || '').trim().toUpperCase()
      const rolLabel = String(row.rol || '').trim().toUpperCase()
      const isRequesterRow = etapaLabel === 'SOLICITANTE' || rolLabel === 'SOLICITANTE'
      return !isRequesterRow || approverEntries.length === 1
    })
    .map((row) => {
      const etapaLabel = String(row.etapa || '').trim().toUpperCase()
      const rolLabel = String(row.rol || '').trim().toUpperCase()
      const fallbackRoleLabel = safeText(row.rol || getApprovalRoleLabel(row.rol_aprobador))
      const label = etapaLabel === 'SOLICITANTE' || rolLabel === 'SOLICITANTE'
        ? fallbackRoleLabel
        : safeText(row.etapa || row.rol || getApprovalRoleLabel(row.rol_aprobador))
      return `${label} - ${safeText(row.aprobador || 'Pendiente')}`;
    })
    .join('\n');

  writeSectionTitle('Resumen');
  ensureSpace(50);

  const estadoServicio = normalize(servicio.estado_flujo || servicio.estado_servicio) === 'PENDIENTE'
    ? 'PENDIENTE DE REALIZACION'
    : (servicio.estado_flujo || servicio.estado_servicio);

  const servicioEstadoBottom = drawInfoBlock({
    title: 'Servicio y estado',
    rows: [
      ['Nombre', servicio.nombre_servicio || servicio.descripcion_servicio],
      ['Descripción', servicio.descripcion_servicio],
      ['Prioridad', servicio.prioridad],
      ['Estado', estadoServicio],
      ['Estado aprobación', servicio.estado_aprobacion],
    ],
    x: left,
    y: doc.y,
    width: usableWidth,
  });
  doc.y = servicioEstadoBottom + 0;

  renderTwoColumnBlocks([
    {
      title: 'Datos de la orden',
      rows: [
        ['Número de orden', servicio.numero_orden || `OS-${servicio.id}`],
        ['Fecha', new Date(servicio.fecha || Date.now()).toLocaleDateString()],
        ['Proveedor', servicio.proveedor],
        ['Área destino', servicio.area],
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
        ['Total final', money(totalFinal)],
      ],
    },
    {
      title: 'Aprobaciones',
      rows: [
        ['Flujo', approversSummary || 'Sin aprobaciones registradas'],
      ],
    },
  ]);

  doc.moveDown(0.2);
  doc.font('Helvetica').fontSize(8).fillColor(PDF_BRAND_COLORS.textSecondary).text(
    'Si tienes dudas sobre el servicio u orden de compra, contactar a:\ncompras@alfosac.pe\n+51 978772509',
    left,
    bottomLimit - 24,
    { width: usableWidth, align: 'center' }
  );

  doc.end();
});

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

const getUserRoleIdExpr = (tableAlias) =>
  `NULLIF(COALESCE(to_jsonb(${tableAlias})->>'id_role', to_jsonb(${tableAlias})->>'id_rol', ''), '')::int`;

const getUserRoleIdColumn = () => schemaMeta.usuariosRoleIdColumn || 'id_role';
const getUserEmailExpr = (tableAlias) =>
  `NULLIF(COALESCE(to_jsonb(${tableAlias})->>'email', to_jsonb(${tableAlias})->>'correo', ''), '')`;
const getUserPhotoColumn = () => pickExistingColumn(schemaMeta.usuariosColumns, ['imagen', 'foto']);
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
  const servicioStatusColumn = getServicioStatusColumn();

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
        COALESCE(NULLIF(upper(trim(COALESCE(to_jsonb(s)->>'${servicioStatusColumn}', ''))), ''), NULL) AS estado_flujo,
        COALESCE(NULLIF(upper(trim(COALESCE(to_jsonb(s)->>'${servicioStatusColumn}', ''))), ''), NULL) AS estado_servicio,
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

  // Normalize legacy estado_flujo values: treat 'APROBADO' as 'DATOS_COMPLETADOS'
  servicios.forEach((row) => {
    if (String(row.estado_flujo || '').trim().toUpperCase() === 'APROBADO') {
      row.estado_flujo = 'DATOS_COMPLETADOS';
    }
  });

  const approvalRoleId = Number(options?.approvalRoleId || 0);
  const approvalPermissionGranted = Boolean(options?.approvalPermissionGranted);
  if (approvalRoleId > 0) {
    const referenceIds = servicios.map((row) => Number(row.id || 0));
    const actionableIds = await fetchActionableApprovalReferenceIds(pool, {
      tipo: 'SERVICIO',
      roleId: approvalRoleId,
      referenceIds,
    });

    const firstApproverIds = await fetchFirstApprovalReferenceIdsByRole(pool, {
      tipo: 'SERVICIO',
      roleId: approvalRoleId,
      referenceIds,
    });

    servicios.forEach((row) => {
      const canApprove = approvalPermissionGranted
        && actionableIds.has(Number(row.id || 0))
        && isPendingApprovalState(row.estado_aprobacion);
      row.puede_aprobar = canApprove;
      row.puede_rechazar = canApprove;
      row.es_primer_aprobador = canApprove && firstApproverIds.has(Number(row.id || 0));
    });
  }

  const nextPendingByRef = await fetchNextPendingApprovalRoleByReferences(pool, {
    tipo: 'SERVICIO',
    referenceIds: servicios.map((row) => Number(row.id || 0)),
  });

  servicios.forEach((row) => {
    const refId = Number(row.id || 0);
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
      if (field === 'descuento') {
        exprs.push(`COALESCE(NULLIF(p.${column}::numeric, NULL), 0) AS ${field}`);
      } else if (field === 'id_moneda' || field === 'id_area_destino') {
        exprs.push(`NULLIF(p.${column}::int, NULL) AS ${field}`);
      } else {
        exprs.push(`COALESCE(NULLIF(trim(p.${column}::text), ''), '') AS ${field}`);
      }
    } else {
      if (field === 'descuento') {
        exprs.push(`0::numeric AS ${field}`);
      } else if (field === 'id_moneda' || field === 'id_area_destino') {
        exprs.push(`NULL::int AS ${field}`);
      } else {
        exprs.push(`''::text AS ${field}`);
      }
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
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS detalle TEXT;`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS subtotal NUMERIC(12,2);`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS costo_envio NUMERIC(12,2);`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS otros_costos NUMERIC(12,2);`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS igv NUMERIC(12,2);`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS total NUMERIC(12,2);`,
    `ALTER TABLE compras ADD COLUMN IF NOT EXISTS numero_orden VARCHAR(50);`,
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
  const userRoleExpr = getUserRoleIdExpr('usuarios');
  const result = await pool.query(
    `
      SELECT COUNT(*) AS total
      FROM usuarios
      JOIN rol_permiso ON rol_permiso.id_rol = ${userRoleExpr}
      JOIN permisos ON permisos.id = rol_permiso.id_permiso
      WHERE usuarios.id = $1
        AND upper(trim(permisos.nombre)) = upper(trim($2))
    `,
    [userId, permission]
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

  return [...new Set(result.rows
    .map((row) => normalizePermissionName(row.nombre))
    .filter(Boolean))];
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

const hasPurchaseOrdersAccess = (user) => (
  tienePermiso(user, 'GESTIONAR_COMPRAS')
  || tienePermiso(user, 'GESTIONAR_ORDENES_COMPRA')
);

const requireRoleAdminOrCompras = (req, res, next) => {
  const roleId = Number(req.user?.id_role || req.user?.rol_id || 0);
  if (isAdminRole(req.user?.rol) || isComprasRole(req.user?.rol) || roleId === 9 || hasPurchaseOrdersAccess(req.user)) {
    return next();
  }

  return res.status(403).json({ error: 'No autorizado' });
};

const BASE_PERMISSION_NAMES = [
  'VER_INVENTARIO',
  'CREAR_REQUERIMIENTO',
  'CREAR_SOLICITUD_COMPRA',
  'VER_AJUSTES',
];

const ROLE_PERMISSION_NAMES_BY_ID = new Map([
  [4, [...BASE_PERMISSION_NAMES, 'CREAR_SOLICITUD_SERVICIO', 'CAMBIAR_ESTADO_SERVICIO']],
  [5, [...BASE_PERMISSION_NAMES, 'APROBAR_JEFE_AREA']],
  [6, [...BASE_PERMISSION_NAMES, 'APROBAR_GERENCIA_AREA', 'CALIFICAR_COMPRA', 'CALIFICAR_REQUERIMIENTO']],
  [7, [...BASE_PERMISSION_NAMES, 'APROBAR_FINANZAS']],
  [8, [
    ...BASE_PERMISSION_NAMES,
    'APROBAR_JEFE_AREA',
    'APROBAR_GERENCIA_AREA',
    'APROBAR_FINANZAS',
    'APROBAR_ADMIN',
    'GESTIONAR_ROLES',
    'CALIFICAR_COMPRA',
    'CALIFICAR_REQUERIMIENTO',
    'CALIFICAR_SERVICIO',
    'GESTIONAR_ORDENES_COMPRA',
    'GESTIONAR_PROVEEDORES',
    'EDITAR_INVENTARIO',
    'AGREGAR_INVENTARIO_MANUAL',
    'VER_NOTIFICACIONES_PROVEEDOR',
    'GESTIONAR_ENTREGAS',
    'CREAR_SOLICITUD_SERVICIO',
    'CAMBIAR_ESTADO_SERVICIO',
    'VER_HISTORIAL_SERVICIOS',
  ]],
  [9, [...BASE_PERMISSION_NAMES, 'GESTIONAR_ORDENES_COMPRA', 'GESTIONAR_PROVEEDORES', 'EDITAR_INVENTARIO', 'AGREGAR_INVENTARIO_MANUAL', 'VER_NOTIFICACIONES_PROVEEDOR', 'VER_HISTORIAL_SERVICIOS']],
  [10, [...BASE_PERMISSION_NAMES, 'GESTIONAR_ENTREGAS']],
  [11, [...BASE_PERMISSION_NAMES, 'VER_HISTORIAL_SERVICIOS', 'CALIFICAR_SERVICIO']],
]);

const getPermissionsByRoleId = (roleId) => {
  const numericRoleId = Number(roleId || 0);
  if (ROLE_PERMISSION_NAMES_BY_ID.has(numericRoleId)) {
    return [...new Set(ROLE_PERMISSION_NAMES_BY_ID.get(numericRoleId))];
  }

  return [...BASE_PERMISSION_NAMES];
};

const requirePermissions = (...permissions) => (req, res, next) => {
  const roleId = Number(req.user?.id_role || req.user?.rol_id || 0);
  const userPermissions = new Set((req.user?.permisos || getPermissionsByRoleId(roleId))
    .map((perm) => normalizePermissionName(perm))
    .filter(Boolean));
  const normalizedPermissions = permissions
    .map((perm) => normalizePermissionName(perm))
    .filter(Boolean);

  if (!normalizedPermissions.some((permission) => userPermissions.has(permission))) {
    return res.status(403).json({ error: 'No autorizado' });
  }

  next();
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
    .map((item) => (typeof item === 'string' ? String(item).trim() : ''))
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

const ensureCoreApprovalPermissions = async (client = pool) => {
  const permisosDescriptionColumn = await client.query(
    `
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'permisos'
        AND column_name = 'descripcion'
      LIMIT 1
    `
  );

  if (permisosDescriptionColumn.rows.length > 0) {
    await client.query(
      `
        INSERT INTO permisos (nombre, descripcion)
        SELECT values_to_insert.nombre, values_to_insert.descripcion
        FROM (
          VALUES
            ('APROBAR_JEFE_AREA', 'Puede aprobar en etapa jefe de area/subgerente'),
            ('AGREGAR_INVENTARIO_MANUAL', 'Puede agregar materiales manualmente al inventario'),
            ('VER_HISTORIAL_SERVICIOS', 'Puede ver el historial de servicios')
        ) AS values_to_insert(nombre, descripcion)
        WHERE NOT EXISTS (
          SELECT 1
          FROM permisos p
          WHERE upper(trim(p.nombre)) = upper(trim(values_to_insert.nombre))
        )
      `
    );
  } else {
    await client.query(
      `
        INSERT INTO permisos (nombre)
        SELECT values_to_insert.nombre
        FROM (
          VALUES
            ('APROBAR_JEFE_AREA'),
            ('AGREGAR_INVENTARIO_MANUAL'),
            ('VER_HISTORIAL_SERVICIOS')
        ) AS values_to_insert(nombre)
        WHERE NOT EXISTS (
          SELECT 1
          FROM permisos p
          WHERE upper(trim(p.nombre)) = upper(trim(values_to_insert.nombre))
        )
      `
    );
  }

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
    res.json(result.rows);
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

    res.json({
      rol: roleResult.rows[0],
      permisos: permissionsResult.rows,
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

    const roleResult = await client.query(
      'SELECT id, nombre FROM roles WHERE id = $1 LIMIT 1 FOR UPDATE',
      [roleId]
    );

    if (roleResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Rol no encontrado' });
    }

    const roleName = String(roleResult.rows[0]?.nombre || '').trim();
    if (!roleName) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No se pudo resolver el nombre del rol' });
    }

    if (normalizeRoleName(roleName) === 'ADMIN') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No se puede eliminar el rol ADMIN' });
    }

    const userRoleColumn = getUserRoleIdExpr('u');
    const usersResult = await client.query(
      `
        SELECT COUNT(*) AS total
        FROM usuarios u
        WHERE ${userRoleColumn} = $1
      `,
      [roleId]
    );

    const assignedUsers = Number(usersResult.rows[0]?.total || 0);
    if (assignedUsers > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: `No se puede eliminar el rol porque tiene ${assignedUsers} usuario${assignedUsers === 1 ? '' : 's'} asignado${assignedUsers === 1 ? '' : 's'}`,
      });
    }

    await client.query('DELETE FROM rol_permiso WHERE id_rol = $1', [roleId]);

    const approvalConfigExistsResult = await client.query(
      "SELECT to_regclass('public.aprobaciones_config') IS NOT NULL AS exists"
    );
    if (Boolean(approvalConfigExistsResult.rows[0]?.exists)) {
      await client.query('DELETE FROM aprobaciones_config WHERE rol_id = $1', [roleId]);
    }

    await client.query('DELETE FROM roles WHERE id = $1', [roleId]);
    await client.query('COMMIT');

    return res.json({
      ok: true,
      id: roleId,
      nombre: roleName,
    });
  } catch (error) {
    await client.query('ROLLBACK');

    if (error?.code === '23503') {
      return res.status(409).json({ error: 'No se puede eliminar el rol porque tiene dependencias registradas' });
    }

    return res.status(500).json({ error: error.message });
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
          ${userEmailExpr} AS email,
          COALESCE(NULLIF(trim(COALESCE(to_jsonb(usuarios)->>'dni', '')), ''), '') AS dni,
          ${userRoleExpr} AS id_role,
          usuarios.id_area,
          COALESCE(${userEstadoExpr}, 'ACTIVO') AS estado,
          roles.nombre AS rol,
          COALESCE(areas.nombre, '') AS area,
          usuarios.imagen
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
    const { nombre, email, dni, id_role, id_area, estado, password, foto } = req.body;
    const userRoleColumn = getUserRoleIdColumn();

    if (!nombre || !String(nombre).trim()) {
      return res.status(400).json({ error: 'Nombre es requerido' });
    }

    if (!email || !String(email).trim()) {
      return res.status(400).json({ error: 'Correo es requerido' });
    }

    if (!dni || !String(dni).trim()) {
      return res.status(400).json({ error: 'DNI es requerido' });
    }

    const providedPassword = password && String(password).trim();
    const rawPassword = providedPassword || 'admin';

    if (providedPassword && providedPassword.length < 8) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
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

    const cleanPassword = String(rawPassword).trim();
    if (providedPassword && cleanPassword.toLowerCase() === sanitizedEmail) {
      return res.status(400).json({ error: 'La contraseña no puede ser igual al correo' });
    }

    const hashedPassword = await hashPassword(cleanPassword);
    const fotoBase64 = foto && String(foto).trim() ? String(foto).trim() : null;

    const result = await pool.query(
      `
        INSERT INTO usuarios (nombre, email, password_hash, dni, ${userRoleColumn}, id_area, estado, imagen)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, nombre, email, dni, ${userRoleColumn} AS id_role, id_area, estado, imagen
      `,
      [
        String(nombre).trim(),
        sanitizedEmail,
        hashedPassword,
        String(dni).trim(),
        Number(id_role),
        id_area ? Number(id_area) : null,
        estado || 'ACTIVO',
        fotoBase64
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
    const { nombre, email, dni, id_role, id_area, estado, foto } = req.body;
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

    if (dni !== undefined && !String(dni).trim()) {
      return res.status(400).json({ error: 'DNI no puede estar vacio' });
    }

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

    if (dni !== undefined) {
      updates.push(`dni = $${paramCount}`);
      values.push(String(dni).trim());
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

    if (foto !== undefined) {
      const fotoBase64 = foto && String(foto).trim() ? String(foto).trim() : null;
      updates.push(`imagen = $${paramCount}`);
      values.push(fotoBase64);
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
        RETURNING id, nombre, email, dni, ${userRoleColumn} AS id_role, id_area, estado, imagen
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
    const { password_nueva, password_confirmacion } = req.body;
    const userId = req.user.id;

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

    if (cleanNew.length < 8) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
    }

    const userCheck = await pool.query('SELECT email FROM usuarios WHERE id = $1', [userId]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const userEmail = String(userCheck.rows[0].email || '').trim().toLowerCase();
    if (cleanNew.toLowerCase() === userEmail) {
      return res.status(400).json({ error: 'La contraseña no puede ser igual al correo' });
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
      // Expose only `imagen` for the current user to avoid stale `foto` shadowing.
      imagen: profile.imagen,
      permisos: dbPermissions,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/me/foto', authMiddleware, async (req, res) => {
  try {
    // Prefer `imagen` column. Accept `imagen` or `foto` in body for compatibility.
    const imagen = String(req.body?.imagen || req.body?.foto || '').trim();
    if (!imagen) {
      return res.status(400).json({ error: 'La foto (imagen) es obligatoria' });
    }

    if (!isValidPhotoValue(imagen)) {
      return res.status(400).json({ error: 'La foto debe ser URL valida (http/https) o base64 valida' });
    }

    const updated = await pool.query(
      `
        UPDATE usuarios
        SET imagen = $1
        WHERE id = $2
        RETURNING
          id,
          nombre,
          COALESCE(NULLIF(trim(COALESCE(to_jsonb(usuarios)->>'email', to_jsonb(usuarios)->>'correo', '')), ''), '') AS correo,
          COALESCE(NULLIF(trim(COALESCE(to_jsonb(usuarios)->>'dni', '')), ''), '') AS dni,
          COALESCE(NULLIF(trim(COALESCE(to_jsonb(usuarios)->>'foto', '')), ''), '') AS foto,
          COALESCE(NULLIF(trim(COALESCE(to_jsonb(usuarios)->>'imagen', '')), ''), '') AS imagen
      `,
      [imagen, req.user.id]
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
          usuario: row.usuario,
          area: row.area,
          fecha_creacion: row.fecha_creacion,
          items: [],
        };
      }

      if (row.id_material) {
        acc[key].items.push({
          id_material: row.id_material,
          material: row.material,
          cantidad: Number(row.cantidad),
        });
      }

      return acc;
    }, {});

    const list = Object.values(grouped);

    const commentsByReq = await fetchCommentsForEntities(pool, {
      tipoEntidad: 'requerimiento',
      entityIds: list.map((row) => Number(row.id || 0)),
    });

    list.forEach((row) => {
      row.comentarios_historial = commentsByReq.get(Number(row.id || 0)) || [];
    });

    if (roleId > 0) {
      list.forEach((row) => {
        row.puede_aprobar = false;
        row.puede_rechazar = false;
      });
    }

    res.json(list);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/mis-requerimientos', authMiddleware, async (req, res) => {
  try {
    const descripcionExpr = getRequerimientoDescripcionExpr('r');
    const result = await pool.query(
      `
        SELECT
          r.id,
          ${descripcionExpr} AS descripcion,
          r.estado,
          r.estado_entrega,
          r.fecha_creacion,
          r.id_usuario,
          u.nombre AS usuario,
          COALESCE(a.nombre, 'Sin area') AS area
        FROM requerimientos r
        JOIN usuarios u ON u.id = r.id_usuario
        LEFT JOIN areas a ON a.id = u.id_area
        WHERE r.id_usuario = $1
        ORDER BY r.fecha_creacion DESC, r.id DESC
      `,
      [req.user.id]
    );

    const mapped = result.rows.map((row) => {
      const parsedDescription = parseEmbeddedCommentsFromText(row.descripcion || '');
      return {
        ...row,
        descripcion: parsedDescription.text,
        comentarios_historial: [],
      };
    });

    const commentsByReq = await fetchCommentsForEntities(pool, {
      tipoEntidad: 'requerimiento',
      entityIds: mapped.map((row) => Number(row.id || 0)),
    });

    mapped.forEach((row) => {
      row.comentarios_historial = commentsByReq.get(Number(row.id || 0)) || [];
    });

    res.json(mapped);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/requerimientos/:id/comentarios', authMiddleware, async (req, res) => {
  const client = await pool.connect();

  try {
    const id = Number(req.params?.id || 0);
    const contenido = String(req.body?.contenido || '').trim();

    if (!id) {
      return res.status(400).json({ error: 'ID de requerimiento invalido' });
    }

    if (!contenido) {
      return res.status(400).json({ error: 'El contenido del comentario es obligatorio' });
    }

    await client.query('BEGIN');

    const reqResult = await client.query(
      `
        SELECT
          id,
          id_usuario
        FROM requerimientos
        WHERE id = $1
      `,
      [id]
    );

    if (reqResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Requerimiento no encontrado' });
    }

    const row = reqResult.rows[0];
    const isOwner = Number(row.id_usuario || 0) === Number(req.user?.id || 0);
    const canManage = canManageRequirementsRole(req.user?.rol) || isComprasOperatorUser(req.user) || canManageDeliveryRole(req.user?.rol);
    if (!isOwner && !canManage) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'No autorizado para comentar este requerimiento' });
    }

    const newEntry = await insertCommentForEntity(client, {
      user: req.user,
      tipoEntidad: 'requerimiento',
      idEntidad: id,
      contenido,
    });

    await client.query('COMMIT');
    return res.json({ comentario: newEntry });
  } catch (error) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error: error.message });
  } finally {
    client.release();
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

app.post('/api/areas', authMiddleware, requireAdmin, async (req, res) => {
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
      const referenceId = hasTipoFilter
        ? (queryReference > 0 ? queryReference : 0)
        : null;

      if (!Number.isInteger(proveedorId) || proveedorId <= 0) {
        return res.status(400).json({ error: 'id de proveedor invalido' });
      }

      if (hasTipoFilter && !tipo) {
        return res.status(400).json({ error: "tipo invalido. Solo se permite 'compra' o 'servicio'" });
      }

      if (hasTipoFilter && (!Number.isInteger(referenceId) || referenceId <= 0)) {
        return res.status(400).json({ error: 'id_referencia invalido para este tipo de calificacion' });
      }

      const providerExists = await pool.query('SELECT id FROM proveedores WHERE id = $1 LIMIT 1', [proveedorId]);
      if (providerExists.rows.length === 0) {
        return res.status(404).json({ error: 'Proveedor no encontrado' });
      }

      const userId = Number(req.user?.id || 0);
      const summaryMap = await fetchProveedorRatingsSummary(pool, {
        proveedorIds: [proveedorId],
        userId,
      });
      const summary = summaryMap.get(proveedorId) || {
        calificacion_promedio: 0,
        calificacion_total: 0,
        alerta_cambio_proveedor: false,
        alerta_critica: false,
        mi_calificacion: null,
        mi_comentario: '',
        mi_fecha: null,
      };

      const detailResult = hasTipoFilter
        ? await pool.query(
          `
            SELECT
              cp.id,
              cp.id_proveedor,
              cp.id_usuario,
              COALESCE(u.nombre, 'Usuario') AS usuario,
              COALESCE(NULLIF(trim(COALESCE(to_jsonb(u)->>'foto', to_jsonb(u)->>'imagen', '')), ''), '') AS foto,
              cp.tipo,
              cp.id_referencia,
              cp.puntuacion,
              cp.comentario,
              cp.fecha
            FROM calificaciones_proveedor cp
            LEFT JOIN usuarios u ON u.id = cp.id_usuario
            WHERE cp.id_proveedor = $1
              AND lower(trim(COALESCE(cp.tipo, ''))) = $2
              AND cp.id_referencia = $3
            ORDER BY cp.fecha DESC, cp.id DESC
            LIMIT 20
          `,
          [proveedorId, tipo, referenceId]
        )
        : await pool.query(
          `
            SELECT
              cp.id,
              cp.id_proveedor,
              cp.id_usuario,
              COALESCE(u.nombre, 'Usuario') AS usuario,
              COALESCE(NULLIF(trim(COALESCE(to_jsonb(u)->>'foto', to_jsonb(u)->>'imagen', '')), ''), '') AS foto,
              cp.tipo,
              cp.id_referencia,
              cp.puntuacion,
              cp.comentario,
              cp.fecha
            FROM calificaciones_proveedor cp
            LEFT JOIN usuarios u ON u.id = cp.id_usuario
            WHERE cp.id_proveedor = $1
            ORDER BY cp.fecha DESC, cp.id DESC
            LIMIT 20
          `,
          [proveedorId]
        );

      const existingMine = hasTipoFilter
        ? await pool.query(
          tipo === 'servicio'
            ? `
              SELECT id
              FROM calificaciones_proveedor
              WHERE id_proveedor = $1
                AND lower(trim(COALESCE(tipo, ''))) = $2
                AND id_referencia = $3
              LIMIT 1
            `
            : `
              SELECT id
              FROM calificaciones_proveedor
              WHERE id_proveedor = $1
                AND id_usuario = $2
                AND lower(trim(COALESCE(tipo, ''))) = $3
                AND id_referencia = $4
              LIMIT 1
            `,
          tipo === 'servicio'
            ? [proveedorId, tipo, referenceId]
            : [proveedorId, userId, tipo, referenceId]
        )
        : { rows: [] };

      res.json({
        proveedor_id: proveedorId,
        tipo: hasTipoFilter ? tipo : 'TODOS',
        id_referencia: referenceId,
        ya_calificado: existingMine.rows.length > 0,
        ...summary,
        calificaciones: detailResult.rows.map((row) => ({
          id: Number(row.id || 0) || null,
          id_proveedor: Number(row.id_proveedor || 0) || proveedorId,
          id_usuario: Number(row.id_usuario || 0) || null,
          usuario: String(row.usuario || 'Usuario').trim() || 'Usuario',
          foto: String(row.foto || '').trim(),
          tipo: normalizeRatingType(row.tipo) || String(row.tipo || '').trim().toLowerCase(),
          id_referencia: Number(row.id_referencia || 0) || proveedorId,
          puntuacion: Number(row.puntuacion || 0) || 0,
          comentario: String(row.comentario || '').trim(),
          fecha: row.fecha,
        })),
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/proveedores/:id/calificaciones', authMiddleware, async (req, res) => {
    const client = await pool.connect();

    try {
      const proveedorId = Number(req.params?.id || 0);
      const puntuacion = Number(req.body?.puntuacion || 0);
      const comentario = String(req.body?.comentario || '').trim();
      const tipo = normalizeRatingType(req.body?.tipo);
      const idReferencia = Number(req.body?.id_referencia || 0);
      const idMovimiento = Number(req.body?.id_movimiento || 0);
      const idMaterial = Number(req.body?.id_material || 0);

      if (!tipo) {
        return res.status(400).json({ error: "tipo invalido. Solo se permite 'compra' o 'servicio'" });
      }

      if (tipo === 'servicio' && !canRateAnyProvider(req.user)) {
        return res.status(403).json({ error: 'No autorizado' });
      }

      if (!Number.isInteger(proveedorId) || proveedorId <= 0) {
        return res.status(400).json({ error: 'id de proveedor invalido' });
      }

      const providerExists = await client.query('SELECT id FROM proveedores WHERE id = $1 LIMIT 1', [proveedorId]);
      if (providerExists.rows.length === 0) {
        return res.status(404).json({ error: 'Proveedor no encontrado' });
      }

      let resolvedReferenceId = idReferencia;
      if (tipo === 'servicio') {
        if (!Number.isInteger(idReferencia) || idReferencia <= 0) {
          return res.status(400).json({ error: 'id_referencia invalido para este tipo de calificacion' });
        }
      } else {
        const hasDirectReference = Number.isInteger(idReferencia) && idReferencia > 0;

        if (hasDirectReference) {
          if (!canRateCompra(req.user)) {
            return res.status(403).json({ error: 'No autorizado' });
          }
        } else {
          if (!Number.isInteger(idMovimiento) || idMovimiento <= 0) {
            return res.status(400).json({ error: 'id_movimiento invalido para calificar entrega' });
          }
          if (!Number.isInteger(idMaterial) || idMaterial <= 0) {
            return res.status(400).json({ error: 'id_material invalido para calificar entrega' });
          }

          if (!canRateAnyProvider(req.user)) {
            return res.status(403).json({ error: 'No autorizado' });
          }

          const salidaContext = await resolveSalidaRatingContext(client, {
            idMovimiento,
            idMaterial,
            idProveedor: proveedorId,
          });

          if (!salidaContext) {
            return res.status(400).json({ error: 'No existe salida valida para este material/proveedor' });
          }

          if (salidaContext.tipo_movimiento !== 'SALIDA') {
            return res.status(400).json({ error: 'Solo se permite calificar movimientos de salida' });
          }

          const areaDestino = String(salidaContext.area_destino || '').trim();
          if (!areaDestino || normalize(areaDestino) === 'SIN AREA') {
            return res.status(400).json({ error: 'El movimiento de salida no tiene area destino valida' });
          }

          const userArea = String(req.user?.area || '').trim();
          if (!userArea) {
            return res.status(400).json({ error: 'No se pudo determinar el area del usuario para la calificacion' });
          }

          if (normalize(userArea) !== normalize(areaDestino)) {
            return res.status(403).json({ error: 'Solo puedes calificar materiales entregados a tu area' });
          }

          resolvedReferenceId = Number(salidaContext.id_movimiento_detalle || 0);
          if (!Number.isInteger(resolvedReferenceId) || resolvedReferenceId <= 0) {
            return res.status(400).json({ error: 'No se pudo resolver detalle de movimiento para la calificacion' });
          }
        }
      }

      await client.query('BEGIN');
      const summary = await upsertProveedorRating(client, {
        user: req.user,
        proveedorId,
        puntuacion,
        comentario,
        tipo,
        idReferencia: resolvedReferenceId,
      });
      await client.query('COMMIT');

      try {
        await evaluarProveedor(proveedorId, {
          db: pool,
          summary,
          puntuacion,
          tipo,
          idReferencia: resolvedReferenceId,
        });
      } catch (evalError) {
        console.error('[PROVEEDOR][EVALUACION] No se pudo evaluar proveedor tras registrar calificacion:', {
          proveedorId,
          error: evalError?.message || String(evalError),
        });
      }

      return res.json({ proveedor_id: proveedorId, ...summary });
    } catch (error) {
      await client.query('ROLLBACK');
      if (error?.code === 'RATING_ALREADY_EXISTS') {
        return res.status(409).json({ error: 'Ya calificaste este proveedor' });
      }
      return res.status(500).json({ error: error.message });
    } finally {
      client.release();
    }
  });

  app.patch('/api/proveedores/:id/calificaciones/:ratingId', authMiddleware, async (req, res) => {
    const client = await pool.connect();

    try {
      if (!canEditUnifiedProveedorRating(req.user)) {
        return res.status(403).json({ error: 'No autorizado' });
      }

      const proveedorId = Number(req.params?.id || 0);
      const ratingId = Number(req.params?.ratingId || 0);
      const puntuacion = Number(req.body?.puntuacion || 0);
      const comentario = String(req.body?.comentario || '').trim();

      if (!Number.isInteger(proveedorId) || proveedorId <= 0) {
        return res.status(400).json({ error: 'id de proveedor invalido' });
      }

      if (!Number.isInteger(ratingId) || ratingId <= 0) {
        return res.status(400).json({ error: 'id de calificacion invalido' });
      }

      if (!Number.isInteger(puntuacion) || puntuacion < 1 || puntuacion > 5) {
        return res.status(400).json({ error: 'La puntuacion debe estar entre 1 y 5' });
      }

      await client.query('BEGIN');

      const ratingResult = await client.query(
        `
          SELECT id, id_referencia
          FROM calificaciones_proveedor
          WHERE id = $1
            AND id_proveedor = $2
            AND lower(trim(COALESCE(tipo, ''))) = 'compra'
          LIMIT 1
          FOR UPDATE
        `,
        [ratingId, proveedorId]
      );

      if (ratingResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Calificacion no encontrada' });
      }

      await client.query(
        `
          UPDATE calificaciones_proveedor
          SET puntuacion = $1,
              comentario = $2,
              fecha = NOW(),
              id_usuario = $3
          WHERE id = $4
        `,
        [puntuacion, comentario || null, Number(req.user?.id || 0), ratingId]
      );

      const summary = await fetchProveedorRatingsSummary(client, {
        proveedorIds: [proveedorId],
        userId: Number(req.user?.id || 0),
      }).then((map) => map.get(proveedorId) || null);

      await client.query('COMMIT');

      try {
        await evaluarProveedor(proveedorId, {
          db: pool,
          summary,
          puntuacion,
          tipo: 'compra',
          idReferencia: Number(ratingResult.rows[0]?.id_referencia || 0),
        });
      } catch (evalError) {
        console.error('[PROVEEDOR][EVALUACION] No se pudo evaluar proveedor tras editar calificacion:', {
          proveedorId,
          ratingId,
          error: evalError?.message || String(evalError),
        });
      }

      return res.json({
        proveedor_id: proveedorId,
        rating_id: ratingId,
        ...summary,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      return res.status(500).json({ error: error.message });
    } finally {
      client.release();
    }
  });

app.get('/api/monedas', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `
        SELECT id, nombre, simbolo
        FROM monedas
        ORDER BY nombre ASC, id ASC
      `
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/notificaciones/proveedores', authMiddleware, requirePermissions('VER_NOTIFICACIONES_PROVEEDOR'), async (req, res) => {
  try {
    const notificaciones = await fetchProveedorNotifications(pool);

    res.json({
      usuario_destino: {
        id: req.user?.id || null,
        nombre: req.user?.nombre || 'Usuario',
      },
      permisos: Array.isArray(req.user?.permisos) ? req.user.permisos : [],
      total: notificaciones.length,
      notificaciones,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/notificaciones/proveedores/limpiar', authMiddleware, requirePermissions('VER_NOTIFICACIONES_PROVEEDOR'), async (req, res) => {
  try {
    const cleanupTimestamp = Date.now();
    
    res.json({
      success: true,
      cleanupTimestamp,
      message: 'Notificaciones limpiadas correctamente',
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/proveedores', authMiddleware, requirePermissions('GESTIONAR_PROVEEDORES'), async (req, res) => {
  try {
    const payload = req.body || {};

    const providerColumnsMeta = await pool.query(
      `
        SELECT column_name, data_type, udt_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'proveedores'
      `
    );

    const providerMetaByColumn = providerColumnsMeta.rows.reduce((acc, row) => {
      acc[row.column_name] = row;
      return acc;
    }, {});

    const nombre = String(payload.nombre || '').trim();
    const razonSocial = String(payload.razon_social || payload.nombre || '').trim();
    const direccion = String(payload.direccion || '').trim();
    const distrito = String(payload.distrito || '').trim();
    const ruc = String(payload.ruc || '').trim();
    const correo = String(payload.correo || payload.email || '').trim();
    const personaResponsable = String(payload.persona_responsable || payload.contacto || '').trim();
    const telefono = String(payload.telefono || '').trim();
    const condicionesPago = String(payload.condiciones_pago || '').trim();
    const banco = String(payload.banco || '').trim();
    const numeroCuenta = String(payload.numero_cuenta || '').trim();
    const cci = String(payload.cci || '').trim();
    const categoria = String(payload.categoria || '').trim();
    const tipo = normalize(payload.tipo || '');
    const tipoRetencion = normalize(payload.tipo_retencion || '');
    const descuento = Number(payload.descuento || 0);
    const idMoneda = payload.id_moneda ? Number(payload.id_moneda) : null;
    const idAreaDestino = payload.id_area_destino ? Number(payload.id_area_destino) : null;

    const requiredValidations = [
      ['nombre', nombre],
      ['ruc', ruc],
      ['id_moneda', idMoneda],
    ];

    const missingRequired = requiredValidations
      .filter(([, value]) => !String(value || '').trim())
      .map(([key]) => key);

    if (missingRequired.length > 0) {
      return res.status(400).json({ error: `Faltan campos obligatorios: ${missingRequired.join(', ')}` });
    }

    if (!idMoneda || !Number.isInteger(idMoneda) || idMoneda <= 0) {
      return res.status(400).json({ error: 'id_moneda es obligatorio y debe ser valido' });
    }

    if (ruc) {
      const rucCheck = await pool.query("SELECT id FROM proveedores WHERE trim(COALESCE(ruc::text, '')) = $1 LIMIT 1", [ruc]);
      if (rucCheck.rows.length > 0) {
        return res.status(400).json({ error: 'ruc ya existe en proveedores' });
      }
    }

    if (descuento < 0) {
      return res.status(400).json({ error: 'descuento debe ser >= 0' });
    }

    if (tipo && !['BIEN', 'SERVICIO'].includes(tipo)) {
      return res.status(400).json({ error: 'tipo solo puede ser BIEN o SERVICIO' });
    }

    if (tipoRetencion && !['RETENCION', 'DETRACCION'].includes(tipoRetencion)) {
      return res.status(400).json({ error: 'tipo_retencion solo puede ser RETENCION o DETRACCION' });
    }

    const monedaExists = await pool.query('SELECT id FROM monedas WHERE id = $1 LIMIT 1', [idMoneda]);
    if (monedaExists.rows.length === 0) {
      return res.status(400).json({ error: 'id_moneda no existe en la tabla monedas' });
    }

    if (idAreaDestino && (!Number.isInteger(idAreaDestino) || idAreaDestino <= 0)) {
      return res.status(400).json({ error: 'id_area_destino debe ser valido o NULL' });
    }

    if (idAreaDestino) {
      const areaExists = await pool.query('SELECT id FROM areas WHERE id = $1 LIMIT 1', [idAreaDestino]);
      if (areaExists.rows.length === 0) {
        return res.status(400).json({ error: 'id_area_destino no existe en la tabla areas' });
      }
    }

    const retencionNorm = normalize(payload.retencion || '') || 'NO';
    const retencionType = String(providerMetaByColumn.retencion?.data_type || providerMetaByColumn.retencion?.udt_name || '').toLowerCase();
    const retencion = retencionType.includes('boolean')
      ? (retencionNorm === 'SI' || retencionNorm === 'TRUE')
      : retencionNorm;

    const result = await pool.query(
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
          id_moneda,
          id_area_destino,
          numero_cuenta,
          cci,
          descripcion,
          retencion,
          categoria,
          descuento,
          tipo,
          tipo_retencion
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20
        )
        RETURNING id
      `,
      [
        nombre,
        razonSocial,
        direccion,
        distrito,
        ruc || null,
        correo || null,
        personaResponsable || null,
        telefono || null,
        condicionesPago || null,
        banco || null,
        idMoneda,
        idAreaDestino,
        numeroCuenta || null,
        cci || null,
        payload.descripcion || null,
        retencion,
        categoria || null,
        descuento,
        tipo || 'BIEN',
        tipoRetencion || 'RETENCION',
      ]
    );

    const provider = await pool.query(
      `
        SELECT ${buildProveedorSelectExpressions().join(', ')}, COALESCE(m.nombre, '') AS moneda_nombre
        FROM proveedores p
        LEFT JOIN monedas m ON m.id = p.id_moneda
        WHERE p.id = $1
      `,
      [result.rows[0].id]
    );

    res.status(201).json(provider.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/proveedores/:id', authMiddleware, requirePermissions('GESTIONAR_PROVEEDORES'), async (req, res) => {
  try {
    const { id } = req.params;
    const providerId = Number(id || 0);
    if (!Number.isInteger(providerId) || providerId <= 0) {
      return res.status(400).json({ error: 'id de proveedor invalido' });
    }

    const payload = req.body || {};
    const providerQuery = await pool.query(
      `
        SELECT ${buildProveedorSelectExpressions().join(', ')}
        FROM proveedores p
        WHERE p.id = $1
        LIMIT 1
      `,
      [providerId]
    );

    if (providerQuery.rows.length === 0) {
      return res.status(404).json({ error: 'Proveedor no encontrado' });
    }

    const current = providerQuery.rows[0];
    const hasPayloadKey = (key) => Object.prototype.hasOwnProperty.call(payload, key);

    const pickRaw = (keys = []) => {
      for (const key of keys) {
        if (hasPayloadKey(key)) return payload[key];
      }
      return undefined;
    };

    const pickText = (keys = [], fallback = '') => {
      const incoming = pickRaw(keys);
      if (incoming === undefined) return String(fallback || '').trim();
      return String(incoming || '').trim();
    };

    const pickOptionalText = (keys = [], fallback = null) => {
      const incoming = pickRaw(keys);
      if (incoming === undefined) return fallback;
      const value = String(incoming || '').trim();
      return value || null;
    };

    const parseOptionalInt = (value) => {
      if (value === null || value === undefined || String(value).trim() === '') return null;
      const parsed = Number(value);
      return Number.isInteger(parsed) && parsed > 0 ? parsed : NaN;
    };

    const parseOptionalNumber = (value) => {
      if (value === null || value === undefined || String(value).trim() === '') return 0;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : NaN;
    };

    const nombre = pickText(['nombre'], current.nombre);
    const razonSocial = pickText(['razon_social'], current.razon_social || nombre);
    const direccion = pickOptionalText(['direccion'], current.direccion || null);
    const distrito = pickOptionalText(['distrito'], current.distrito || null);
    const ruc = pickText(['ruc'], current.ruc);
    const correo = pickOptionalText(['correo', 'email'], current.correo || null);
    const personaResponsable = pickOptionalText(['persona_responsable', 'contacto'], current.persona_responsable || null);
    const telefono = pickOptionalText(['telefono'], current.telefono || null);
    const condicionesPago = pickOptionalText(['condiciones_pago'], current.condiciones_pago || null);
    const banco = pickOptionalText(['banco'], current.banco || null);
    const numeroCuenta = pickOptionalText(['numero_cuenta'], current.numero_cuenta || null);
    const cci = pickOptionalText(['cci'], current.cci || null);
    const descripcion = pickOptionalText(['descripcion'], current.descripcion || null);
    const categoria = pickOptionalText(['categoria'], current.categoria || null);

    const tipo = String(pickRaw(['tipo']) !== undefined ? pickRaw(['tipo']) : current.tipo || '').trim().toUpperCase() || 'BIEN';
    const tipoRetencion = String(pickRaw(['tipo_retencion']) !== undefined ? pickRaw(['tipo_retencion']) : current.tipo_retencion || '').trim().toUpperCase() || 'RETENCION';

    const descuentoRaw = pickRaw(['descuento']);
    const descuento = descuentoRaw === undefined
      ? Number(current.descuento || 0)
      : parseOptionalNumber(descuentoRaw);

    const idMonedaRaw = pickRaw(['id_moneda', 'moneda_id']);
    const idMoneda = idMonedaRaw === undefined
      ? parseOptionalInt(current.id_moneda)
      : parseOptionalInt(idMonedaRaw);

    const idAreaRaw = pickRaw(['id_area_destino']);
    const idAreaDestino = idAreaRaw === undefined
      ? parseOptionalInt(current.id_area_destino)
      : parseOptionalInt(idAreaRaw);

    if (!nombre) {
      return res.status(400).json({ error: 'nombre es obligatorio' });
    }

    if (!ruc) {
      return res.status(400).json({ error: 'ruc es obligatorio' });
    }

    if (!Number.isInteger(idMoneda) || idMoneda <= 0) {
      return res.status(400).json({ error: 'id_moneda es obligatorio y debe ser valido' });
    }

    if (Number.isNaN(idAreaDestino)) {
      return res.status(400).json({ error: 'id_area_destino debe ser valido o NULL' });
    }

    if (!Number.isFinite(descuento) || descuento < 0) {
      return res.status(400).json({ error: 'descuento debe ser >= 0' });
    }

    if (tipo && !['BIEN', 'SERVICIO'].includes(tipo)) {
      return res.status(400).json({ error: 'tipo solo puede ser BIEN o SERVICIO' });
    }

    if (tipoRetencion && !['RETENCION', 'DETRACCION'].includes(tipoRetencion)) {
      return res.status(400).json({ error: 'tipo_retencion solo puede ser RETENCION o DETRACCION' });
    }

    const retencionNorm = String(
      pickRaw(['retencion']) !== undefined
        ? pickRaw(['retencion'])
        : current.retencion || 'NO'
    ).trim().toUpperCase();

    const providerColumnsMeta = await pool.query(
      `
        SELECT column_name, data_type, udt_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'proveedores'
      `
    );

    const providerMetaByColumn = providerColumnsMeta.rows.reduce((acc, row) => {
      acc[row.column_name] = row;
      return acc;
    }, {});

    const retencionType = String(providerMetaByColumn.retencion?.data_type || providerMetaByColumn.retencion?.udt_name || '').toLowerCase();
    const retencion = retencionType.includes('boolean')
      ? (retencionNorm === 'SI' || retencionNorm === 'TRUE' || retencionNorm === '1')
      : (retencionNorm || 'NO');

    const monedaExists = await pool.query('SELECT id FROM monedas WHERE id = $1 LIMIT 1', [idMoneda]);
    if (monedaExists.rows.length === 0) {
      return res.status(400).json({ error: 'id_moneda no existe en la tabla monedas' });
    }

    if (idAreaDestino) {
      const areaExists = await pool.query('SELECT id FROM areas WHERE id = $1 LIMIT 1', [idAreaDestino]);
      if (areaExists.rows.length === 0) {
        return res.status(400).json({ error: 'id_area_destino no existe en la tabla areas' });
      }
    }

    const duplicateRuc = await pool.query(
      `
        SELECT id
        FROM proveedores
        WHERE trim(COALESCE(ruc::text, '')) = $1
          AND id <> $2
        LIMIT 1
      `,
      [ruc, providerId]
    );
    if (duplicateRuc.rows.length > 0) {
      return res.status(400).json({ error: 'ruc ya existe en proveedores' });
    }

    await pool.query(
      `
        UPDATE proveedores
        SET nombre = $1,
            razon_social = $2,
            ruc = $3,
            direccion = $4,
            telefono = $5,
            correo = $6,
            id_moneda = $7,
            persona_responsable = $8,
            distrito = $9,
            condiciones_pago = $10,
            banco = $11,
            id_area_destino = $12,
            numero_cuenta = $13,
            cci = $14,
            descripcion = $15,
            retencion = $16,
            categoria = $17,
            descuento = $18,
            tipo = $19,
            tipo_retencion = $20
        WHERE id = $21
      `,
      [
        nombre,
        razonSocial,
        ruc,
        direccion,
        telefono,
        correo,
        idMoneda,
        personaResponsable,
        distrito,
        condicionesPago,
        banco,
        idAreaDestino,
        numeroCuenta,
        cci,
        descripcion,
        retencion,
        categoria,
        descuento,
        tipo,
        tipoRetencion,
        providerId,
      ]
    );

    const provider = await pool.query(
      `
        SELECT ${buildProveedorSelectExpressions().join(', ')}, COALESCE(m.nombre, '') AS moneda_nombre
        FROM proveedores p
        LEFT JOIN monedas m ON m.id = p.id_moneda
        WHERE p.id = $1
      `,
      [providerId]
    );

    res.json(provider.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/requerimientos', authMiddleware, requirePermissions('CREAR_REQUERIMIENTO'), async (req, res) => {
  const client = await pool.connect();

  try {
    const reqDescripcionColumn = getRequerimientoDescripcionColumn();
    const { descripcion, prioridad, items } = req.body;
    const prioridadNorm = normalize(prioridad || 'MEDIA');

    if (!PRIORIDADES.includes(prioridadNorm)) {
      return res.status(400).json({ error: `Prioridad invalida. Usa: ${PRIORIDADES.join(', ')}` });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Debe enviar items con id_material y cantidad' });
    }

    let idUnidadDefault = null;
    const ensureDefaultUnit = async () => {
      if (idUnidadDefault) return idUnidadDefault;

      const unidad = await client.query(
        `
          SELECT id
          FROM unidades
          ORDER BY CASE WHEN upper(trim(nombre)) = 'UNIDAD' THEN 0 ELSE 1 END, id ASC
          LIMIT 1
        `
      );

      if (unidad.rows.length === 0) {
        throw new Error('No existe una unidad configurada para crear materiales automaticamente');
      }

      idUnidadDefault = Number(unidad.rows[0].id);
      return idUnidadDefault;
    };

    const tableFlags = await client.query(
      `
        SELECT
          to_regclass('public.categorias') IS NOT NULL AS has_categorias,
          to_regclass('public.material_categoria') IS NOT NULL AS has_material_categoria
      `
    );
    const hasCategorias = Boolean(tableFlags.rows[0]?.has_categorias);
    const hasMaterialCategoria = Boolean(tableFlags.rows[0]?.has_material_categoria);

    const materialColumnsMeta = await client.query(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'materiales'
      `
    );
    const materialColumns = new Set(materialColumnsMeta.rows.map((r) => String(r.column_name || '').trim()));
    const materialCategoriaColumn = materialColumns.has('categoria') ? 'categoria' : null;

    const ensureMaterialCategoryLink = async (idMaterial, categoriaNombre) => {
      if (!categoriaNombre || !hasCategorias) return;

      let categoriaId = null;
      const existingCategoria = await client.query(
        'SELECT id FROM categorias WHERE lower(trim(nombre)) = lower(trim($1)) LIMIT 1',
        [categoriaNombre]
      );

      if (existingCategoria.rows.length > 0) {
        categoriaId = Number(existingCategoria.rows[0].id);
      } else {
        const createdCategoria = await client.query(
          'INSERT INTO categorias (nombre) VALUES ($1) RETURNING id',
          [categoriaNombre]
        );
        categoriaId = Number(createdCategoria.rows[0].id);
      }

      await client.query(
        'UPDATE materiales SET id_categoria = $1 WHERE id = $2',
        [categoriaId, idMaterial]
      );

      if (hasMaterialCategoria) {
        const hasLink = await client.query(
          'SELECT 1 FROM material_categoria WHERE id_material = $1 AND id_categoria = $2 LIMIT 1',
          [idMaterial, categoriaId]
        );

        if (hasLink.rows.length === 0) {
          await client.query(
            'INSERT INTO material_categoria (id_material, id_categoria) VALUES ($1, $2)',
            [idMaterial, categoriaId]
          );
        }
      }
    };

    const normalizedItems = [];
    const autoCreatedMaterialIds = new Set();

    for (const item of items) {
      const cantidad = Number(item.cantidad || 0);
      if (cantidad <= 0) {
        return res.status(400).json({
          error: 'Cada item debe tener cantidad mayor a 0',
        });
      }

      let idMaterial = item.id_material ? Number(item.id_material) : null;
      const nombre = String(item.nombre || item.descripcion || '').trim();
      const categoria = String(item.categoria || '').trim();

      if (!idMaterial && !nombre) {
        return res.status(400).json({ error: 'Cada item debe tener nombre' });
      }

      if (!idMaterial && !categoria) {
        return res.status(400).json({ error: 'Debe ingresar la categoria del material cuando sea nuevo' });
      }

      if (idMaterial) {
        const materialExists = await client.query('SELECT id FROM materiales WHERE id = $1 LIMIT 1', [idMaterial]);
        if (materialExists.rows.length === 0) {
          return res.status(400).json({ error: `Material no existe: ${idMaterial}` });
        }
      } else {
        const matchedMaterial = await client.query(
          'SELECT id FROM materiales WHERE lower(trim(nombre)) = lower(trim($1)) LIMIT 1',
          [nombre]
        );

        if (matchedMaterial.rows.length > 0) {
          idMaterial = Number(matchedMaterial.rows[0].id);
        } else {
          const idUnidad = await ensureDefaultUnit();

          const insertColumns = ['nombre', 'descripcion', 'id_unidad', 'id_proveedor'];
          const insertValues = [
            nombre,
            'Generado automaticamente desde requerimientos',
            idUnidad,
            null,
          ];

          if (materialCategoriaColumn && categoria) {
            insertColumns.push(materialCategoriaColumn);
            insertValues.push(categoria);
          }

          const placeholders = insertValues.map((_, idx) => `$${idx + 1}`);
          const createdMaterial = await client.query(
            `
              INSERT INTO materiales (${insertColumns.join(', ')})
              VALUES (${placeholders.join(', ')})
              RETURNING id
            `,
            insertValues
          );
          idMaterial = Number(createdMaterial.rows[0].id);
          autoCreatedMaterialIds.add(idMaterial);
        }
      }

      await ensureMaterialCategoryLink(idMaterial, categoria);

      normalizedItems.push({
        id_material: idMaterial,
        cantidad,
      });
    }

    const requestedByMaterial = normalizedItems.reduce((acc, item) => {
      const idMaterial = Number(item.id_material);
      const qty = Number(item.cantidad || 0);
      acc[idMaterial] = (acc[idMaterial] || 0) + qty;
      return acc;
    }, {});

    for (const [idMaterial, qty] of Object.entries(requestedByMaterial)) {
      if (autoCreatedMaterialIds.has(Number(idMaterial))) {
        continue;
      }

      const stock = await getMaterialStockTotal(client, Number(idMaterial));
      if (stock < Number(qty)) {
        return res.status(400).json({
          error: `Stock insuficiente para material ${idMaterial}. Solicitado: ${qty}, disponible: ${stock}`,
        });
      }
    }

    await client.query('BEGIN');

    let idRequerimiento;
    const hasCreateProc = await dbFunctionExists('sp_crear_requerimiento(integer,text,text,jsonb)');

    if (hasCreateProc) {
      const result = await client.query(
        'SELECT sp_crear_requerimiento($1, $2, $3, $4::jsonb) AS id_requerimiento',
        [req.user.id, descripcion || null, prioridadNorm, JSON.stringify(normalizedItems)]
      );
      idRequerimiento = result.rows[0].id_requerimiento;
    } else {
      const reqInsert = await client.query(
        `
          INSERT INTO requerimientos (estado, prioridad, ${quoteIdentifier(reqDescripcionColumn)}, id_usuario, fecha_creacion)
          VALUES ('PENDIENTE', $1, $2, $3, NOW())
          RETURNING id
        `,
        [prioridadNorm, descripcion || null, req.user.id]
      );

      idRequerimiento = reqInsert.rows[0].id;

      for (const item of normalizedItems) {
        if (!item.id_material || !item.cantidad || Number(item.cantidad) <= 0) {
          throw new Error('Item invalido en requerimiento');
        }

        await client.query(
          `
            INSERT INTO detalle_requerimiento (id_requerimiento, id_material, cantidad)
            VALUES ($1, $2, $3)
          `,
          [idRequerimiento, item.id_material, Number(item.cantidad)]
        );
      }
    }

    const reqApprovalColumn = getRequerimientoApprovalColumn();
    const approvalSetFragment = reqApprovalColumn ? `, ${quoteIdentifier(reqApprovalColumn)} = $3` : '';
    const approvalParams = reqApprovalColumn
      ? ['APROBADO', 'POR_RECOGER', 'APROBADO', idRequerimiento]
      : ['APROBADO', 'POR_RECOGER', idRequerimiento];

    await client.query(
      `
        UPDATE requerimientos
        SET estado = $1,
            estado_entrega = $2${approvalSetFragment}
        WHERE id = $${reqApprovalColumn ? 4 : 3}
      `,
      approvalParams
    );

    await client.query('COMMIT');

    const createdReq = await client.query(
      `
        SELECT
          r.id AS id_requerimiento,
          u.nombre AS usuario,
          COALESCE(a.nombre, 'Sin area') AS area,
          ${getRequerimientoDescripcionExpr('r')} AS descripcion,
          r.estado,
          r.estado_entrega,
          r.nombre_receptor,
          r.dni_receptor,
          r.prioridad,
          r.fecha_creacion
        FROM requerimientos r
        JOIN usuarios u ON u.id = r.id_usuario
        LEFT JOIN areas a ON a.id = u.id_area
        WHERE r.id = $1
      `,
      [idRequerimiento]
    );

    res.status(201).json(createdReq.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

app.patch('/api/requerimientos/:id/estado', authMiddleware, async (req, res) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;
    const estado = normalize(req.body.estado);

    if (!ESTADOS.includes(estado)) {
      return res.status(400).json({ error: `Estado invalido. Usa: ${ESTADOS.join(', ')}` });
    }

    await client.query('BEGIN');

    const hasCompleteProc = await dbFunctionExists('sp_completar_requerimiento(integer,integer)');

    if (estado === 'APROBADO' || estado === 'RECHAZADO') {
      throw new Error('Los requerimientos se aprueban automaticamente y no admiten aprobacion/rechazo manual');
    } else if (estado === 'COMPLETADO') {
      const canComplete = await hasPermission(req.user.id, 'COMPLETAR_REQUERIMIENTO');
      if (!canComplete && !canManageRequirementsRole(req.user?.rol)) {
        return res.status(403).json({ error: 'Sin permiso para completar requerimientos' });
      }

      if (hasCompleteProc) {
        await client.query('SELECT sp_completar_requerimiento($1, $2)', [id, req.user.id]);
        await client.query(
          'UPDATE requerimientos SET estado_entrega = NULL, nombre_receptor = NULL, dni_receptor = NULL WHERE id = $1',
          [id]
        );
      } else {
        const reqRow = await client.query('SELECT id, estado FROM requerimientos WHERE id = $1 FOR UPDATE', [id]);
        if (reqRow.rows.length === 0) throw new Error('Requerimiento no encontrado');
        if (normalize(reqRow.rows[0].estado) !== 'APROBADO') throw new Error('No se puede completar sin estar APROBADO');

        await client.query(
          `
            UPDATE requerimientos
            SET estado = $1,
                estado_entrega = NULL,
                nombre_receptor = NULL,
                dni_receptor = NULL
            WHERE id = $2
          `,
          ['COMPLETADO', id]
        );
      }
    } else {
      throw new Error('No se permite cambiar manualmente a PENDIENTE');
    }

    const result = await client.query(
      `
        SELECT id, estado, estado_entrega, nombre_receptor, dni_receptor, prioridad, ${getRequerimientoDescripcionExpr('requerimientos')} AS descripcion, id_usuario, fecha_creacion
        FROM requerimientos
        WHERE id = $1
      `,
      [id]
    );

    await client.query('COMMIT');

    res.json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

app.patch('/api/requerimientos/:id/estado-entrega', authMiddleware, async (req, res) => {
  const client = await pool.connect();

  try {
    if (!canManageDeliveryRole(req.user?.rol)) {
      return res.status(403).json({ error: 'Sin permiso para gestionar entrega' });
    }

    const { id } = req.params;
    const estadoEntrega = normalize(req.body.estado_entrega);
    const receptorUserId = Number(req.body.receptor_user_id || 0);

    if (!ESTADOS_ENTREGA.includes(estadoEntrega)) {
      return res.status(400).json({
        error: `estado_entrega invalido. Usa: ${ESTADOS_ENTREGA.join(', ')}`,
      });
    }

    if (estadoEntrega !== 'ENTREGADO') {
      return res.status(400).json({
        error: 'Este endpoint solo permite cambiar a ENTREGADO',
      });
    }

    if (!Number.isInteger(receptorUserId) || receptorUserId <= 0) {
      return res.status(400).json({ error: 'receptor_user_id es obligatorio para ENTREGADO' });
    }

    await client.query('BEGIN');

    const reqRow = await client.query(
      `
        SELECT r.id, r.estado, r.estado_entrega, u.id_area
        FROM requerimientos r
        JOIN usuarios u ON u.id = r.id_usuario
        WHERE r.id = $1
        FOR UPDATE
      `,
      [id]
    );

    if (reqRow.rows.length === 0) {
      throw new Error('Requerimiento no encontrado');
    }

    const estadoActual = normalize(reqRow.rows[0].estado);
    const entregaActual = normalize(reqRow.rows[0].estado_entrega);

    if (estadoActual !== 'APROBADO') {
      throw new Error('estado_entrega solo aplica cuando estado = APROBADO');
    }

    if (entregaActual !== 'POR_RECOGER') {
      throw new Error('No se puede marcar ENTREGADO si estado_entrega no es POR_RECOGER');
    }

    const idAreaReq = Number(reqRow.rows[0].id_area || 0);

    const receptorFields = [
      'u.id',
      'u.nombre',
      `COALESCE(NULLIF(trim(COALESCE(to_jsonb(u)->>'dni', '')), ''), '') AS dni`,
      `COALESCE(NULLIF(trim(COALESCE(to_jsonb(u)->>'imagen', to_jsonb(u)->>'foto', '')), ''), '') AS imagen`,
    ];

    const receptorRow = await client.query(
      `
        SELECT ${receptorFields.join(', ')}
        FROM usuarios u
        WHERE u.id = $1
          AND u.id_area = $2
        LIMIT 1
      `,
      [receptorUserId, idAreaReq]
    );

    if (receptorRow.rows.length === 0) {
      throw new Error('El usuario receptor no pertenece al area del requerimiento');
    }

    const receptor = receptorRow.rows[0];
    const receptorDni = String(receptor.dni || '').trim();

    if (!receptorDni) {
      throw new Error('dni_receptor es obligatorio para ENTREGADO');
    }

    const details = await client.query(
      `
        SELECT id_material, SUM(cantidad) AS cantidad_total
        FROM detalle_requerimiento
        WHERE id_requerimiento = $1
        GROUP BY id_material
      `,
      [id]
    );

    if (details.rows.length === 0) {
      throw new Error('El requerimiento no tiene detalles de materiales');
    }

    for (const row of details.rows) {
      const idMaterial = Number(row.id_material);
      const qty = Number(row.cantidad_total || 0);
      if (qty <= 0) continue;

      const stock = await getMaterialStockTotal(client, idMaterial);
      if (stock < qty) {
        throw new Error(`Stock insuficiente para material ${idMaterial}`);
      }

      await discountMaterialStockDistributed(client, idMaterial, qty);
    }

    const idMovimiento = await insertMovimiento(client, {
      tipo: 'SALIDA',
      usuarioRegistro: receptorUserId,
      idRequerimiento: id,
    });

    for (const row of details.rows) {
      await client.query(
        `
          INSERT INTO movimiento_detalles (id_movimiento, id_material, cantidad)
          VALUES ($1, $2, $3)
        `,
        [idMovimiento, Number(row.id_material), Number(row.cantidad_total)]
      );
    }

    const result = await client.query(
      `
        UPDATE requerimientos
        SET estado_entrega = $1,
            nombre_receptor = $2,
            dni_receptor = $3
        WHERE id = $4
        RETURNING id, estado, estado_entrega, nombre_receptor, dni_receptor, prioridad, ${getRequerimientoDescripcionExpr('requerimientos')} AS descripcion, id_usuario, fecha_creacion
      `,
      [estadoEntrega, receptor.nombre, receptorDni, id]
    );

    if (schemaMeta.requerimientoReceptorIdColumn) {
      await client.query(
        `
          UPDATE requerimientos
          SET ${schemaMeta.requerimientoReceptorIdColumn} = $1
          WHERE id = $2
        `,
        [receptorUserId, id]
      );
    }

    await client.query('COMMIT');

    res.json({
      ...result.rows[0],
      receptor: {
        id: receptor.id,
        nombre: receptor.nombre,
        dni: receptorDni,
        imagen: receptor.imagen || DEFAULT_USER_AVATAR,
      },
      movimientos_generados: [idMovimiento],
    });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

app.get('/api/requerimientos/:id/receptores', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const term = String(req.query.query || '').trim();

    const reqArea = await pool.query(
      `
        SELECT u.id_area
        FROM requerimientos r
        JOIN usuarios u ON u.id = r.id_usuario
        WHERE r.id = $1
        LIMIT 1
      `,
      [id]
    );

    if (reqArea.rows.length === 0) {
      return res.status(404).json({ error: 'Requerimiento no encontrado' });
    }

    const areaId = Number(reqArea.rows[0].id_area || 0);
    const fields = [
      'u.id',
      'u.nombre',
      `COALESCE(NULLIF(trim(COALESCE(to_jsonb(u)->>'dni', '')), ''), '') AS dni`,
      `COALESCE(ar.nombre, '') AS area`,
      `COALESCE(NULLIF(trim(COALESCE(to_jsonb(u)->>'imagen', to_jsonb(u)->>'foto', '')), ''), '') AS imagen`,
    ];

    const conditions = ['u.id_area = $1'];
    const params = [areaId];

    if (term) {
      params.push(`%${term}%`);
      const likePos = params.length;
      params.push(`%${term}%`);
      const likeDniPos = params.length;
      conditions.push(`(u.nombre ILIKE $${likePos} OR COALESCE(to_jsonb(u)->>'dni', '') ILIKE $${likeDniPos})`);
    }

    const result = await pool.query(
      `
        SELECT ${fields.join(', ')}
        FROM usuarios u
        LEFT JOIN areas ar ON ar.id = u.id_area
        WHERE ${conditions.join(' AND ')}
        ORDER BY u.nombre ASC
        LIMIT 20
      `,
      params
    );

    res.json(result.rows.map((row) => ({
      id: row.id,
      nombre: row.nombre,
      dni: row.dni || '',
      area: row.area || '',
      imagen: row.imagen || DEFAULT_USER_AVATAR,
    })));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/movimientos', authMiddleware, requireAdmin, async (req, res) => {
  const client = await pool.connect();

  try {
    const { tipo, id_almacen, items } = req.body;
    const tipoNorm = normalize(tipo);

    if (!['ENTRADA', 'SALIDA'].includes(tipoNorm)) {
      return res.status(400).json({ error: 'tipo debe ser ENTRADA o SALIDA' });
    }

    if (!id_almacen) {
      return res.status(400).json({ error: 'id_almacen es obligatorio' });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Debe enviar items de movimiento' });
    }

    await client.query('BEGIN');

    const idMovimiento = await insertMovimiento(client, {
      tipo: tipoNorm,
      usuarioRegistro: req.user.id,
    });

    for (const item of items) {
      if (!item.id_material || !item.cantidad || Number(item.cantidad) <= 0) {
        throw new Error('Item de movimiento invalido');
      }

      await client.query(
        `
          INSERT INTO movimiento_detalles (id_movimiento, id_material, cantidad)
          VALUES ($1, $2, $3)
        `,
        [idMovimiento, item.id_material, Number(item.cantidad)]
      );

      const qty = Number(item.cantidad);
      const stockRow = await client.query(
        'SELECT id, cantidad FROM stock WHERE id_material = $1 AND id_almacen = $2 FOR UPDATE',
        [item.id_material, id_almacen]
      );

      if (tipoNorm === 'ENTRADA') {
        if (stockRow.rows.length === 0) {
          await client.query(
            'INSERT INTO stock (id_material, id_almacen, cantidad) VALUES ($1, $2, $3)',
            [item.id_material, id_almacen, qty]
          );
        } else {
          await client.query('UPDATE stock SET cantidad = cantidad + $1 WHERE id = $2', [qty, stockRow.rows[0].id]);
        }
      } else {
        if (stockRow.rows.length === 0 || Number(stockRow.rows[0].cantidad) < qty) {
          throw new Error(`Stock insuficiente para material ${item.id_material} en almacen ${id_almacen}`);
        }
        await client.query('UPDATE stock SET cantidad = cantidad - $1 WHERE id = $2', [qty, stockRow.rows[0].id]);
      }
    }
    await client.query('COMMIT');

    res.status(201).json({ id_movimiento: idMovimiento, tipo: tipoNorm });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

app.get('/api/movimientos', authMiddleware, async (req, res) => {
  try {
    const userId = Number(req.user?.id || 0);
    const result = await pool.query(
      `
        WITH movimientos_base AS (
          SELECT
            m.id,
            COALESCE(
              NULLIF(to_jsonb(m)->>'tipo_movimiento', ''),
              NULLIF(to_jsonb(m)->>'tipo', ''),
              'N/D'
            ) AS tipo,
            COALESCE(
              NULLIF(to_jsonb(m)->>'fecha_movimiento', ''),
              NULLIF(to_jsonb(m)->>'fecha', ''),
              ''
            ) AS fecha,
            COALESCE(
              NULLIF(to_jsonb(m)->>'usuario_registro', ''),
              NULLIF(to_jsonb(m)->>'id_usuario', ''),
              NULLIF(to_jsonb(m)->>'usuario_id', ''),
              ''
            ) AS usuario_ref,
            NULLIF(
              COALESCE(
                NULLIF(to_jsonb(m)->>'id_requerimiento', ''),
                NULLIF(to_jsonb(m)->>'requerimiento_id', ''),
                ''
              ),
              ''
            )::int AS id_requerimiento
          FROM movimientos m
        )
        SELECT
          mb.id,
          mb.tipo,
          mb.fecha,
          mb.usuario_ref AS id_usuario,
          COALESCE(usuarios.nombre, mb.usuario_ref) AS usuario,
          mb.id_requerimiento,
          COALESCE(
            (
              SELECT areas.nombre
              FROM requerimientos
              JOIN usuarios ON usuarios.id = requerimientos.id_usuario
              LEFT JOIN areas ON areas.id = usuarios.id_area
              WHERE requerimientos.id = mb.id_requerimiento
              LIMIT 1
            ),
            COALESCE(areas.nombre, 'Sin area')
          ) AS area_destino,
          movimiento_detalles.id AS id_movimiento_detalle,
          movimiento_detalles.id_material,
          materiales.nombre AS material,
          movimiento_detalles.cantidad,
          NULLIF(to_jsonb(materiales)->>'id_proveedor', '')::int AS id_proveedor,
          COALESCE(proveedores.razon_social, proveedores.nombre, '') AS proveedor,
          COALESCE(mi_calificacion.id, 0) AS mi_calificacion_id,
          COALESCE(mi_calificacion.puntuacion, 0) AS mi_calificacion_puntuacion,
          COALESCE(mi_calificacion.comentario, '') AS mi_calificacion_comentario,
          mi_calificacion.fecha AS mi_calificacion_fecha
        FROM movimientos_base mb
        LEFT JOIN usuarios ON usuarios.id = CASE
          WHEN mb.usuario_ref ~ '^\\d+$' THEN mb.usuario_ref::int
          ELSE NULL
        END
        LEFT JOIN areas ON areas.id = usuarios.id_area
        LEFT JOIN movimiento_detalles ON movimiento_detalles.id_movimiento = mb.id
        LEFT JOIN materiales ON materiales.id = movimiento_detalles.id_material
        LEFT JOIN proveedores ON proveedores.id = NULLIF(to_jsonb(materiales)->>'id_proveedor', '')::int
        LEFT JOIN LATERAL (
          SELECT cp.id, cp.puntuacion, cp.comentario, cp.fecha
          FROM calificaciones_proveedor cp
          WHERE cp.id_proveedor = NULLIF(to_jsonb(materiales)->>'id_proveedor', '')::int
            AND lower(trim(COALESCE(cp.tipo, ''))) = 'compra'
            AND cp.id_referencia = movimiento_detalles.id
          ORDER BY cp.fecha DESC, cp.id DESC
          LIMIT 1
        ) AS mi_calificacion ON TRUE
        ORDER BY mb.id DESC
      `,
      []
    );

    const grouped = result.rows.reduce((acc, row) => {
      if (!acc[row.id]) {
        acc[row.id] = {
          id: row.id,
          tipo: row.tipo,
          fecha: row.fecha,
          id_usuario: row.id_usuario,
          usuario: row.usuario,
          id_requerimiento: row.id_requerimiento,
          area_destino: row.area_destino,
          detalles: [],
        };
      }

      if (row.id_material) {
        acc[row.id].detalles.push({
          id_movimiento_detalle: Number(row.id_movimiento_detalle || 0) || null,
          id_material: row.id_material,
          material: row.material,
          cantidad: Number(row.cantidad),
          id_proveedor: Number(row.id_proveedor || 0) || null,
          proveedor: String(row.proveedor || '').trim(),
          mi_calificacion_id: Number(row.mi_calificacion_id || 0) || null,
          mi_calificacion_puntuacion: Number(row.mi_calificacion_puntuacion || 0) || 0,
          mi_calificacion_comentario: String(row.mi_calificacion_comentario || '').trim(),
          mi_calificacion_fecha: row.mi_calificacion_fecha || null,
        });
      }

      return acc;
    }, {});

    res.json(Object.values(grouped));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const mapCompraRows = (rows) => {
  const grouped = rows.reduce((acc, row) => {
    if (!acc[row.id]) {
      const parsedComments = parsePurchaseComments(row.comentarios);
      const areaDestinoNorm = normalize(row.area_final || row.area_solicitante);
      const isOtherArea = Boolean(areaDestinoNorm && !isWarehouseAreaName(areaDestinoNorm));
      const entregaArea = parsedComments.entrega_area && typeof parsedComments.entrega_area === 'object'
        ? parsedComments.entrega_area
        : null;
      const estadoNorm = normalize(row.estado);
      const pendingEntregaFlag = entregaArea
        ? Boolean(entregaArea?.pendiente === true && entregaArea?.entregado !== true)
        : Boolean(isOtherArea && ['RECIBIDA', 'RECIBIDO'].includes(estadoNorm));
      acc[row.id] = {
        id: row.id,
        estado: row.estado,
        id_usuario: row.id_usuario,
        usuario_rol_id: Number(row.usuario_rol_id || 0) || null,
        usuario_rol: row.usuario_rol,
        id_proveedor: row.id_proveedor,
        usuario: row.usuario,
        id_area_solicitante: row.id_area_solicitante,
        area_solicitante: row.area_solicitante,
        id_area_final: row.id_area_final,
        area_final: row.area_final,
        proveedor: row.proveedor,
        ruc: row.ruc,
        direccion: row.direccion,
        distrito: row.distrito,
        correo: row.correo,
        persona_responsable: row.persona_responsable,
        telefono: row.telefono,
        contacto_proveedor: row.contacto_proveedor,
        banco: row.banco,
        id_moneda: row.id_moneda,
        moneda: row.moneda,
        numero_cuenta: row.numero_cuenta,
        cuenta: row.cuenta,
        cci: row.cci,
        retencion: row.retencion,
        descuento: row.descuento,
        aplica_retencion: Boolean(row.aplica_retencion),
        tipo: row.tipo,
        tipo_retencion: row.tipo_retencion,
        importe_final: Number(row.importe_final || row.total || 0),
        condiciones_pago: row.condiciones_pago,
        subtotal: Number(row.subtotal || 0),
        costo_envio: Number(row.costo_envio || 0),
        otros_costos: Number(row.otros_costos || 0),
        igv: Number(row.igv || 0),
        total: Number(row.total || 0),
        detalle: String(row.detalle || '').trim(),
        comentarios: parsedComments.comentarios,
        comentarios_historial: [],
        recibido_por: parsedComments.recibido_por,
        entrega_area: entregaArea,
        pendiente_entrega: pendingEntregaFlag,
        numero_orden: row.numero_orden,
        fecha_creacion: row.fecha_creacion,
        fecha_actualizacion: row.fecha_actualizacion,
        puede_aprobar: false,
        puede_rechazar: false,
        items: [],
        _item_categories_map: parsedComments.item_categorias || {},
      };
    }

    if (row.id_detalle) {
      const itemNameForCategory = String(row.descripcion || row.material || '').trim();
      const categoriaFromComments = itemNameForCategory
        ? String(acc[row.id]._item_categories_map?.[normalizeItemCategoryKey(itemNameForCategory)] || '').trim()
        : '';
      const categoriaFinal = String(row.categoria || '').trim() || categoriaFromComments;

      acc[row.id].items.push({
        id_detalle: row.id_detalle,
        id_material: row.id_material,
        id_categoria: row.id_categoria,
        categoria: categoriaFinal,
        material: row.material,
        descripcion: row.descripcion,
        cantidad: Number(row.cantidad || 0),
      });
    }

    return acc;
  }, {});

  return Object.values(grouped).map((row) => {
    const { _item_categories_map, ...safeRow } = row;
    return safeRow;
  });
};

const fetchComprasRows = async (params = [], whereClause = '', options = {}) => {
  const result = await pool.query(
    `
      SELECT
        c.id,
        COALESCE(upper(trim(COALESCE(to_jsonb(c)->>'estado_pedido', to_jsonb(c)->>'estado', ''))), 'PENDIENTE') AS estado,
        NULLIF(to_jsonb(c)->>'id_usuario', '')::int AS id_usuario,
        NULLIF(to_jsonb(c)->>'id_proveedor', '')::int AS id_proveedor,
        u.nombre AS usuario,
        NULLIF(to_jsonb(c)->>'id_area_solicitante', '')::int AS id_area_solicitante,
        COALESCE(a_sol.nombre, 'Sin area') AS area_solicitante,
        NULLIF(to_jsonb(c)->>'id_area_final', '')::int AS id_area_final,
        COALESCE(a_fin.nombre, COALESCE(a_sol.nombre, 'Sin area')) AS area_final,
        COALESCE(to_jsonb(c)->>'proveedor', '') AS proveedor,
        COALESCE(to_jsonb(c)->>'ruc', '') AS ruc,
        COALESCE(to_jsonb(c)->>'direccion', '') AS direccion,
        COALESCE(to_jsonb(c)->>'distrito', '') AS distrito,
        COALESCE(to_jsonb(c)->>'correo', '') AS correo,
        COALESCE(to_jsonb(c)->>'persona_responsable', '') AS persona_responsable,
        COALESCE(to_jsonb(c)->>'telefono', '') AS telefono,
        COALESCE(to_jsonb(c)->>'contacto_proveedor', '') AS contacto_proveedor,
        COALESCE(to_jsonb(c)->>'banco', '') AS banco,
        NULLIF(to_jsonb(c)->>'id_moneda', '')::int AS id_moneda,
        COALESCE(to_jsonb(c)->>'moneda', '') AS moneda,
        COALESCE(to_jsonb(c)->>'numero_cuenta', '') AS numero_cuenta,
        COALESCE(to_jsonb(c)->>'cuenta', '') AS cuenta,
        COALESCE(to_jsonb(c)->>'cci', '') AS cci,
        COALESCE(to_jsonb(c)->>'retencion', '') AS retencion,
        COALESCE(NULLIF(to_jsonb(c)->>'descuento', '')::numeric, 0) AS descuento,
        CASE WHEN upper(trim(COALESCE(to_jsonb(c)->>'aplica_retencion', to_jsonb(c)->>'retencion', ''))) IN ('TRUE', 'T', '1', 'SI', 'YES') THEN TRUE ELSE FALSE END AS aplica_retencion,
        COALESCE(to_jsonb(c)->>'tipo', '') AS tipo,
        COALESCE(to_jsonb(c)->>'tipo_retencion', '') AS tipo_retencion,
        COALESCE(NULLIF(to_jsonb(c)->>'importe_final', '')::numeric, 0) AS importe_final,
        COALESCE(to_jsonb(c)->>'condiciones_pago', '') AS condiciones_pago,
        COALESCE(NULLIF(to_jsonb(c)->>'subtotal', '')::numeric, 0) AS subtotal,
        COALESCE(NULLIF(to_jsonb(c)->>'costo_envio', '')::numeric, 0) AS costo_envio,
        COALESCE(NULLIF(to_jsonb(c)->>'otros_costos', '')::numeric, 0) AS otros_costos,
        COALESCE(NULLIF(to_jsonb(c)->>'igv', '')::numeric, 0) AS igv,
        COALESCE(NULLIF(to_jsonb(c)->>'total', '')::numeric, 0) AS total,
        COALESCE(to_jsonb(c)->>'detalle', to_jsonb(c)->>'observaciones', '') AS detalle,
        COALESCE(to_jsonb(c)->>'comentarios', '') AS comentarios,
        COALESCE(to_jsonb(c)->>'numero_orden', '') AS numero_orden,
        c.fecha_creacion,
        c.fecha_actualizacion,
        dc.id AS id_detalle,
        NULLIF(to_jsonb(dc)->>'id_material', '')::int AS id_material,
        COALESCE(
          NULLIF(to_jsonb(dc)->>'id_categoria', '')::int,
          NULLIF(to_jsonb(m)->>'id_categoria', '')::int
        ) AS id_categoria,
        COALESCE(
          NULLIF(to_jsonb(dc)->>'categoria', ''),
          cat_dc.nombre,
          cat_m.nombre,
          NULLIF(to_jsonb(m)->>'categoria', ''),
          ''
        ) AS categoria,
        m.nombre AS material,
        COALESCE(
          NULLIF(to_jsonb(dc)->>'comentarios', ''),
          NULLIF(to_jsonb(dc)->>'nombre_material', ''),
          NULLIF(to_jsonb(dc)->>'descripcion', ''),
          ''
        ) AS descripcion,
        COALESCE(NULLIF(to_jsonb(dc)->>'cantidad', '')::numeric, 0) AS cantidad
      FROM compras c
      JOIN usuarios u ON u.id = c.id_usuario
      LEFT JOIN areas a_sol ON a_sol.id = c.id_area_solicitante
      LEFT JOIN areas a_fin ON a_fin.id = c.id_area_final
      LEFT JOIN detalle_compras dc ON dc.id_compra = c.id
      LEFT JOIN categorias cat_dc ON cat_dc.id = NULLIF(to_jsonb(dc)->>'id_categoria', '')::int
      LEFT JOIN materiales m ON m.id = NULLIF(to_jsonb(dc)->>'id_material', '')::int
      LEFT JOIN categorias cat_m ON cat_m.id = NULLIF(to_jsonb(m)->>'id_categoria', '')::int
      ${whereClause}
      ORDER BY c.fecha_creacion DESC, c.id DESC, dc.id ASC
    `,
    params
  );

  const compras = mapCompraRows(result.rows);

  const commentsByCompra = await fetchCommentsForEntities(pool, {
    tipoEntidad: 'compra',
    entityIds: compras.map((row) => Number(row.id || 0)),
  });

  compras.forEach((row) => {
    row.comentarios_historial = commentsByCompra.get(Number(row.id || 0)) || [];
  });

  const providerIds = [...new Set(
    compras
      .map((row) => Number(row.id_proveedor || 0))
      .filter((id) => Number.isInteger(id) && id > 0)
  )];

  if (providerIds.length > 0) {
    const ratingsMap = await fetchProveedorRatingsSummary(pool, {
      proveedorIds: providerIds,
      userId: Number(options?.userId || 0) || null,
    });

    compras.forEach((row) => {
      const proveedorId = Number(row.id_proveedor || 0);
      const rating = ratingsMap.get(proveedorId) || {
        calificacion_promedio: 0,
        calificacion_total: 0,
        alerta_cambio_proveedor: false,
        alerta_critica: false,
      };

      row.calificacion_promedio = Number(rating.calificacion_promedio || 0) || 0;
      row.calificacion_total = Number(rating.calificacion_total || 0) || 0;
      row.alerta_cambio_proveedor = Boolean(rating.alerta_cambio_proveedor);
      row.alerta_critica = Boolean(rating.alerta_critica);
    });
  }

  const approvalRoleId = Number(options?.approvalRoleId || 0);
  const approvalPermissionGranted = Boolean(options?.approvalPermissionGranted);
  if (approvalRoleId > 0) {
    const actionableIds = await fetchActionableApprovalReferenceIds(pool, {
      tipo: 'COMPRA',
      roleId: approvalRoleId,
      referenceIds: compras.map((row) => Number(row.id || 0)),
    });

    compras.forEach((row) => {
      const canApprove = approvalPermissionGranted
        && actionableIds.has(Number(row.id || 0))
        && isPendingApprovalState(row.estado);
      row.puede_aprobar = canApprove;
      row.puede_rechazar = canApprove;
    });
  }

  const nextPendingByRef = await fetchNextPendingApprovalRoleByReferences(pool, {
    tipo: 'COMPRA',
    referenceIds: compras.map((row) => Number(row.id || 0)),
  });

  compras.forEach((row) => {
    const refId = Number(row.id || 0);
    row.estado_aprobacion_detalle = buildApprovalStatusLabel({
      currentStatus: row.estado,
      nextPendingRole: nextPendingByRef.get(refId),
    });
  });

  return compras;
};

app.get('/api/compras', authMiddleware, async (req, res) => {
  try {
    const userRole = String(req.user?.rol || '');
    const canSeeAllPurchases = canAccessPurchaseOrdersModule(req.user)
      || canManagePurchasesRole(userRole)
      || canManageDeliveryRole(userRole);
    const roleId = resolveApprovalRoleId(req.user);
    const requiredApprovalPermission = getRequiredApprovalPermissionByRoleId(roleId);
    const canApproveInCurrentStage = Boolean(requiredApprovalPermission) && tienePermiso(req.user, requiredApprovalPermission);

    const compras = canSeeAllPurchases
      ? await fetchComprasRows([], '', { approvalRoleId: roleId, approvalPermissionGranted: canApproveInCurrentStage })
      : await fetchComprasRows([req.user.id], 'WHERE c.id_usuario = $1', { approvalRoleId: roleId, approvalPermissionGranted: canApproveInCurrentStage });

    if (isApprovalHierarchyRoleId(roleId) && canApproveInCurrentStage) {
      const managedByUser = await fetchManagedApprovalStatesByUser(pool, {
        tipo: 'COMPRA',
        roleId,
        userId: Number(req.user?.id || 0),
      });

      compras.forEach((row) => {
        const managedState = managedByUser.get(Number(row.id || 0));
        if (managedState) {
          row.gestion_estado_usuario = managedState;
        }
      });
    }

    res.json(compras);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/mis-compras', authMiddleware, async (req, res) => {
  try {
    const approvalStagePermission = getApprovalStagePermissionForUser(req.user);
    const approvalStageState = getApprovalStateByPermission(approvalStagePermission);

    if (canAccessPurchaseOrdersModule(req.user)) {
      const roleId = resolveApprovalRoleId(req.user);
      const requiredApprovalPermission = getRequiredApprovalPermissionByRoleId(roleId);
      const canApproveInCurrentStage = Boolean(requiredApprovalPermission) && tienePermiso(req.user, requiredApprovalPermission);
      const compras = await fetchComprasRows(
        [],
        "WHERE upper(trim(COALESCE(to_jsonb(c)->>'estado_pedido', to_jsonb(c)->>'estado', ''))) IN ('APROBADA', 'APROBADO', 'POR_RECIBIR', 'RECIBIDA', 'RECIBIDO', 'ENTREGADO')",
        { approvalRoleId: roleId, approvalPermissionGranted: canApproveInCurrentStage }
      );

      if (isApprovalHierarchyRoleId(roleId) && canApproveInCurrentStage) {
        const managedByUser = await fetchManagedApprovalStatesByUser(pool, {
          tipo: 'COMPRA',
          roleId,
          userId: Number(req.user?.id || 0),
        });

        compras.forEach((row) => {
          const managedState = managedByUser.get(Number(row.id || 0));
          if (managedState) {
            row.gestion_estado_usuario = managedState;
          }
        });
      }

      return res.json(compras);
    }

    if (approvalStageState) {
      const approvalRoleId = resolveApprovalRoleId(req.user);
      const requiredApprovalPermission = getRequiredApprovalPermissionByRoleId(approvalRoleId);
      const canApproveInCurrentStage = Boolean(requiredApprovalPermission) && tienePermiso(req.user, requiredApprovalPermission);
      const comprasAprobacion = await fetchComprasRows(
        [req.user.id, approvalStageState],
        "WHERE c.id_usuario = $1 AND upper(trim(COALESCE(to_jsonb(c)->>'estado_pedido', to_jsonb(c)->>'estado', 'PENDIENTE_JEFE_AREA'))) = $2",
        { approvalRoleId, approvalPermissionGranted: canApproveInCurrentStage }
      );

      comprasAprobacion.forEach((row) => {
        row.gestion_estado_usuario = approvalStageState;
      });

      return res.json(comprasAprobacion);
    }

    const roleId = resolveApprovalRoleId(req.user);
    const requiredApprovalPermission = getRequiredApprovalPermissionByRoleId(roleId);
    const canApproveInCurrentStage = Boolean(requiredApprovalPermission) && tienePermiso(req.user, requiredApprovalPermission);

    // Mis ordenes para roles jerarquicos: solo solicitudes que deben gestionar o ya gestionaron.
    if (isApprovalHierarchyRoleId(roleId) && canApproveInCurrentStage) {
      const pendingReferenceIds = await fetchPendingApprovalReferenceIdsByRole(pool, {
        tipo: 'COMPRA',
        roleId,
      });
      const referenceIds = [...new Set(pendingReferenceIds)];

      if (referenceIds.length === 0) {
        return res.json([]);
      }

      const comprasJerarquicas = await fetchComprasRows(
        [referenceIds],
        'WHERE c.id = ANY($1::int[])',
        {
          approvalRoleId: roleId,
          approvalPermissionGranted: canApproveInCurrentStage,
        }
      );

      comprasJerarquicas.forEach((row) => {
        row.gestion_estado_usuario = String(row.estado_aprobacion_detalle || 'PENDIENTE').trim().toUpperCase();
      });

      return res.json(comprasJerarquicas);
    }

    if (canAccessPurchaseOrdersModule(req.user)) {
      const comprasAprobadasFinales = await fetchComprasRows(
        [],
        "WHERE upper(trim(COALESCE(to_jsonb(c)->>'estado_pedido', to_jsonb(c)->>'estado', ''))) IN ('APROBADA', 'APROBADO', 'POR_RECIBIR', 'RECIBIDA', 'RECIBIDO', 'ENTREGADO')",
        { approvalRoleId: roleId, approvalPermissionGranted: canApproveInCurrentStage }
      );

      return res.json(comprasAprobadasFinales);
    }

    const compras = await fetchComprasRows(
      [req.user.id],
      'WHERE c.id_usuario = $1',
      { approvalRoleId: roleId, approvalPermissionGranted: canApproveInCurrentStage }
    );
    res.json(compras);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/compras/:id/comentarios', authMiddleware, async (req, res) => {
  const client = await pool.connect();

  try {
    const id = Number(req.params?.id || 0);
    const contenido = String(req.body?.contenido || '').trim();

    if (!id) {
      return res.status(400).json({ error: 'ID de compra invalido' });
    }

    if (!contenido) {
      return res.status(400).json({ error: 'El contenido del comentario es obligatorio' });
    }

    await client.query('BEGIN');

    const compraResult = await client.query(
      `
        SELECT id, id_usuario
        FROM compras
        WHERE id = $1
      `,
      [id]
    );

    if (compraResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Compra no encontrada' });
    }

    const row = compraResult.rows[0];
    const isOwner = Number(row.id_usuario || 0) === Number(req.user?.id || 0);
    const canManage = isComprasOperatorUser(req.user) || canManageDeliveryRole(req.user?.rol) || canManagePurchasesRole(req.user?.rol);
    if (!isOwner && !canManage) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'No autorizado para comentar esta compra' });
    }

    const newEntry = await insertCommentForEntity(client, {
      user: req.user,
      tipoEntidad: 'compra',
      idEntidad: id,
      contenido,
    });

    await client.query('COMMIT');
    return res.json({ comentario: newEntry });
  } catch (error) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

app.post('/api/compras', authMiddleware, requirePermissions('CREAR_SOLICITUD_COMPRA'), async (req, res) => {
  const client = await pool.connect();

  try {
    const item = req.body?.item && typeof req.body.item === 'object' ? req.body.item : null;
    const providerIdRaw = req.body?.proveedor_id ?? req.body?.id_proveedor;
    const providerId = providerIdRaw == null || providerIdRaw === ''
      ? null
      : Number(providerIdRaw);

    const detailColumnsMeta = await client.query(
      `
        SELECT
          column_name,
          is_nullable,
          column_default,
          data_type,
          udt_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'detalle_compras'
      `
    );

    const detailMetaByColumn = detailColumnsMeta.rows.reduce((acc, row) => {
      acc[row.column_name] = row;
      return acc;
    }, {});

    if (!item) {
      return res.status(400).json({ error: 'Debe enviar un item para la compra' });
    }

    if (providerId !== null && (!Number.isInteger(providerId) || providerId <= 0)) {
      return res.status(400).json({ error: 'Proveedor invalido' });
    }

    let providerData = { proveedor_nombre: null, proveedor_ruc: null };
    if (providerId !== null) {
      const providerResult = await client.query(
        `
          SELECT
            p.id,
            COALESCE(
              NULLIF(trim(COALESCE(to_jsonb(p)->>'razon_social', to_jsonb(p)->>'nombre', '')), ''),
              ''
            ) AS proveedor_nombre,
            COALESCE(NULLIF(trim(COALESCE(to_jsonb(p)->>'ruc', '')), ''), '') AS proveedor_ruc
          FROM proveedores p
          WHERE p.id = $1
          LIMIT 1
        `,
        [providerId]
      );

      if (providerResult.rows.length === 0) {
        return res.status(400).json({ error: 'Proveedor seleccionado no existe' });
      }

      providerData = providerResult.rows[0];
    }

    await client.query('BEGIN');

    const compraInsert = await client.query(
      `
        INSERT INTO compras (estado, id_usuario, id_area_solicitante, id_proveedor, proveedor, ruc, fecha_creacion, fecha_actualizacion)
        VALUES ('PENDIENTE_JEFE_AREA', $1, $2, $3, $4, $5, NOW(), NOW())
        RETURNING id
      `,
      [
        req.user.id,
        req.user.id_area || null,
        providerId || null,
        providerData.proveedor_nombre || null,
        providerData.proveedor_ruc || null,
      ]
    );

    const idCompra = compraInsert.rows[0].id;
    const itemCategoriesMap = {};

    let idMaterial = item.id_material ? Number(item.id_material) : null;
    const cantidad = Number(item.cantidad || 0);
    const descripcion = String(item.descripcion || item.nombre || '').trim();
    const categoria = String(item.categoria || '').trim();
    let idCategoriaDetalle = null;

    if (descripcion && categoria) {
      itemCategoriesMap[normalizeItemCategoryKey(descripcion)] = categoria;
    }

    if (cantidad <= 0) {
      throw new Error('La cantidad debe ser mayor a 0');
    }

    if (!idMaterial && !descripcion) {
      throw new Error('El item debe tener nombre');
    }

    if (!idMaterial && !categoria) {
      throw new Error('Debe ingresar la categoria del material cuando sea nuevo');
    }

    if (categoria) {
      const hasCategoriasTable = await client.query("SELECT to_regclass('public.categorias') IS NOT NULL AS exists");
      if (Boolean(hasCategoriasTable.rows[0]?.exists)) {
        const existingCategoria = await client.query(
          'SELECT id FROM categorias WHERE lower(trim(nombre)) = lower(trim($1)) LIMIT 1',
          [categoria]
        );

        if (existingCategoria.rows.length > 0) {
          idCategoriaDetalle = Number(existingCategoria.rows[0].id || 0) || null;
        } else {
          const createdCategoria = await client.query(
            'INSERT INTO categorias (nombre) VALUES ($1) RETURNING id',
            [categoria]
          );
          idCategoriaDetalle = Number(createdCategoria.rows[0].id || 0) || null;
        }
      }
    }

    if (idMaterial) {
      const materialExists = await client.query('SELECT id FROM materiales WHERE id = $1 LIMIT 1', [idMaterial]);
      if (materialExists.rows.length === 0) {
        throw new Error(`Material no existe: ${idMaterial}`);
      }
    }

    const detailNameColumn = Object.prototype.hasOwnProperty.call(detailMetaByColumn, 'nombre_material')
      ? 'nombre_material'
      : 'descripcion';
    const columns = ['id_compra', 'id_material', detailNameColumn, 'cantidad'];
    const values = [idCompra, idMaterial, descripcion || null, cantidad];

    if (Object.prototype.hasOwnProperty.call(detailMetaByColumn, 'precio_unitario')) {
      columns.push('precio_unitario');
      values.push(Number(item.precio_unitario || 0));
    }

    if (Object.prototype.hasOwnProperty.call(detailMetaByColumn, 'subtotal')) {
      columns.push('subtotal');
      values.push(Number(item.subtotal || 0));
    }

    const hasColumn = (name) => Object.prototype.hasOwnProperty.call(detailMetaByColumn, name);
    const addIfMissing = (name, value) => {
      if (hasColumn(name) && !columns.includes(name)) {
        columns.push(name);
        values.push(value);
      }
    };

    addIfMissing('total', Number(item.total || item.subtotal || 0));
    addIfMissing('categoria', categoria || null);
    addIfMissing('id_categoria', idCategoriaDetalle || null);

    const maybeRequiredColumns = Object.keys(detailMetaByColumn)
      .filter((col) => {
        if (columns.includes(col)) return false;
        if (['id', 'id_compra', 'id_material', 'descripcion', 'cantidad'].includes(col)) return false;
        const meta = detailMetaByColumn[col];
        return meta && meta.is_nullable === 'NO' && !meta.column_default;
      });

    for (const col of maybeRequiredColumns) {
      const meta = detailMetaByColumn[col];
      const type = String(meta.data_type || meta.udt_name || '').toLowerCase();

      if (type.includes('numeric') || type.includes('integer') || type.includes('double') || type.includes('real')) {
        addIfMissing(col, 0);
      } else if (type.includes('timestamp') || type.includes('date')) {
        addIfMissing(col, new Date());
      } else if (type.includes('boolean')) {
        addIfMissing(col, false);
      } else {
        addIfMissing(col, 'N/D');
      }
    }

    const placeholders = values.map((_, idx) => `$${idx + 1}`);

    await client.query(
      `
        INSERT INTO detalle_compras (${columns.join(', ')})
        VALUES (${placeholders.join(', ')})
      `,
      values
    );

    const comentariosConCategorias = buildPurchaseComment({
      comentarios: '',
      itemCategorias: itemCategoriesMap,
    });

    if (comentariosConCategorias) {
      await client.query(
        'UPDATE compras SET comentarios = $1 WHERE id = $2',
        [comentariosConCategorias, idCompra]
      );
    }

    const approvalSetup = await createApprovalRowsForEntity(client, {
      tipo: 'COMPRA',
      referenciaId: idCompra,
      creatorRoleId: Number(req.user?.id_role || req.user?.rol_id || 0),
    });

    if (approvalSetup.autoApproved) {
      await client.query(
        `
          UPDATE compras
          SET estado = 'APROBADA',
              fecha_actualizacion = NOW()
          WHERE id = $1
        `,
        [idCompra]
      );
    }

    await client.query('COMMIT');

    const created = await fetchComprasRows([idCompra], 'WHERE c.id = $1');
    res.status(201).json(created[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

app.patch('/api/compras/:id/estado', authMiddleware, async (req, res) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;
    const estado = normalize(req.body.estado);

    if (!['APROBADA', 'RECHAZADA'].includes(estado)) {
      return res.status(400).json({ error: 'Estado invalido. Usa APROBADA o RECHAZADA' });
    }

    await client.query('BEGIN');

    const compraRow = await client.query(
      'SELECT id, estado FROM compras WHERE id = $1 FOR UPDATE',
      [id]
    );

    if (compraRow.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Compra no encontrada' });
    }

    const approvalRows = await client.query(
      `
        SELECT id
        FROM aprobaciones
        WHERE upper(trim(tipo)) = 'COMPRA'
          AND referencia_id = $1
        LIMIT 1
      `,
      [id]
    ).catch(() => ({ rows: [] }));

    const useApprovalTable = approvalRows.rows.length > 0;

    if (useApprovalTable) {
      await client.query('ROLLBACK');

      const approvalResult = await aprobarEntidad(req.user, 'compra', id, estado);
      if (!approvalResult?.ok) {
        return res.status(500).json({ error: 'No se pudo aprobar la compra' });
      }

      const refreshed = await fetchComprasRows([id], 'WHERE c.id = $1');
      if (refreshed[0]) {
        refreshed[0].aprobadores = await fetchApprovedApproversByEntity(pool, {
          tipo: 'COMPRA',
          referenciaId: refreshed[0].id,
        });
        refreshed[0].historial_aprobaciones = await fetchApprovalHistoryByEntity(pool, {
          tipo: 'COMPRA',
          referenciaId: refreshed[0].id,
        });
      }

      return res.json(refreshed[0]);
    } else {
      if (!canManagePurchasesRole(req.user?.rol)) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Sin permiso para gestionar compras' });
      }

      await client.query(
        `
          UPDATE compras
          SET estado = $1,
              fecha_actualizacion = NOW()
          WHERE id = $2
        `,
        [estado, id]
      );
    }

    await client.query('COMMIT');

    const result = await fetchComprasRows([id], 'WHERE c.id = $1');
    if (result[0]) {
      result[0].aprobadores = await fetchApprovedApproversByEntity(pool, {
        tipo: 'COMPRA',
        referenciaId: result[0].id,
      });
      result[0].historial_aprobaciones = await fetchApprovalHistoryByEntity(pool, {
        tipo: 'COMPRA',
        referenciaId: result[0].id,
      });
    }
    res.json(result[0]);
  } catch (error) {
    await client.query('ROLLBACK');

    const mapped = mapApprovalDecisionErrorToHttp(error);
    if (mapped.expose) {
      return res.status(mapped.status).json({ error: error.message });
    }

    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

app.patch('/api/compras/:id/completar-datos', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const compraRows = await fetchComprasRows([id], 'WHERE c.id = $1');
    if (compraRows.length === 0) {
      return res.status(404).json({ error: 'Compra no encontrada' });
    }

    const row = compraRows[0];
    const canOperateCompra = isComprasOperatorUser(req.user);
    const isOwner = Number(row.id_usuario) === Number(req.user.id);

    if (!isOwner && !canOperateCompra) {
      return res.status(403).json({ error: 'No autorizado para completar esta compra' });
    }

    if (!isOwner) {
      const hasFinalApproval = await hasEffectiveFinalApprovalByRole(pool, {
        tipo: 'COMPRA',
        referenciaId: id,
        roleId: 7,
      });

      if (!hasFinalApproval) {
        return res.status(400).json({ error: 'La compra aun no tiene aprobacion final de gerencia de finanzas' });
      }
    }

    if (!['APROBADA', 'APROBADO'].includes(normalize(row.estado))) {
      return res.status(400).json({ error: 'Solo se pueden completar datos en compras APROBADAS' });
    }

    const payload = req.body || {};
    const detallePersist = String(payload.detalle || '').trim();

    const parsedExistingComments = parsePurchaseComments(row.comentarios);
    const shouldReplaceVisibleComments = Object.prototype.hasOwnProperty.call(payload, 'detalle')
      || Object.prototype.hasOwnProperty.call(payload, 'comentarios');
    const visibleCommentsToPersist = shouldReplaceVisibleComments
      ? String(payload.detalle || payload.comentarios || '').trim()
      : parsedExistingComments.comentarios;
    const comentariosPersist = buildPurchaseComment({
      comentarios: visibleCommentsToPersist,
      recibidoPor: parsedExistingComments.recibido_por,
      itemCategorias: parsedExistingComments.item_categorias,
      entregaArea: parsedExistingComments.entrega_area,
      comentariosHistorial: parsedExistingComments.comentarios_historial,
    });

    const comprasRetencionMeta = await pool.query(
      `
        SELECT data_type, udt_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'compras'
          AND column_name = 'retencion'
        LIMIT 1
      `
    );

    const providerId = payload.id_proveedor ? Number(payload.id_proveedor) : null;
    if (!providerId) {
      return res.status(400).json({ error: 'Debe seleccionar un proveedor existente de la lista' });
    }

    const providerResult = await pool.query(
      `
        SELECT ${buildProveedorSelectExpressions().join(', ')}, COALESCE(mo.nombre, '') AS moneda_nombre
        FROM proveedores p
        LEFT JOIN monedas mo ON mo.id = p.id_moneda
        WHERE p.id = $1
        LIMIT 1
      `,
      [providerId]
    );

    if (providerResult.rows.length === 0) {
      return res.status(400).json({ error: 'Proveedor seleccionado no existe' });
    }

    const providerData = providerResult.rows[0];
    const subtotal = Number(payload.subtotal || 0);
    const costoEnvio = Number(payload.costo_envio || 0);
    const otrosCostos = Number(payload.otros_costos || 0);
    const igvCalc = Number((subtotal * 0.18).toFixed(2));
    const totalCalc = Number((subtotal + igvCalc + costoEnvio + otrosCostos).toFixed(2));

    const idMoneda = Number(providerData?.id_moneda || 0);
    if (!Number.isInteger(idMoneda) || idMoneda <= 0) {
      return res.status(400).json({ error: 'El proveedor seleccionado no tiene moneda configurada' });
    }

    const monedaExists = await pool.query('SELECT id, nombre FROM monedas WHERE id = $1 LIMIT 1', [idMoneda]);
    if (monedaExists.rows.length === 0) {
      return res.status(400).json({ error: 'La moneda seleccionada no existe en la tabla monedas' });
    }

    const monedaNombre = String(monedaExists.rows[0].nombre || '').trim();
    if (!monedaNombre) {
      return res.status(400).json({ error: 'La moneda seleccionada no tiene nombre valido' });
    }

    const providerRetencionFlag = String(providerData?.retencion || '').trim().toUpperCase() === 'SI';
    const descuentoNum = Number(providerData?.descuento ?? 0);
    if (!Number.isFinite(descuentoNum) || descuentoNum < 0) {
      return res.status(400).json({ error: 'retencion (%) debe ser numerica y >= 0' });
    }

    const tipoRetencionNorm = normalize(providerData?.tipo_retencion || 'RETENCION');
    if (!['RETENCION', 'DETRACCION'].includes(tipoRetencionNorm)) {
      return res.status(400).json({ error: 'tipo_retencion solo puede ser RETENCION o DETRACCION' });
    }

    if (!providerData?.id_moneda) {
      return res.status(400).json({ error: 'El proveedor no tiene moneda configurada en BD' });
    }

    const monedaNorm = String(monedaNombre || '').toUpperCase();
    const isUsd = /USD|US\$|\$|DOL|DÓLAR|DOLAR/.test(monedaNorm);
    const isPen = /PEN|SOL/.test(monedaNorm);
    const totalBase = totalCalc;
    const totalEnSoles = isUsd ? Number((totalBase * 3.5).toFixed(2)) : totalBase;
    const superaUmbral = (isPen && totalBase > 700) || (isUsd && totalEnSoles > 700);
    const aplicaRetencion = providerRetencionFlag && descuentoNum > 0 && superaUmbral;
    const montoRetencion = aplicaRetencion
      ? Number((totalBase * (descuentoNum / 100)).toFixed(2))
      : 0;
    const importeFinalCalc = aplicaRetencion
      ? Number((totalBase - montoRetencion).toFixed(2))
      : totalBase;

    if (importeFinalCalc < 0) {
      return res.status(400).json({ error: 'importe_final no puede ser negativo' });
    }

    const tipoNorm = normalize(providerData?.tipo || payload.tipo || '');
    if (tipoNorm && !['BIEN', 'SERVICIO'].includes(tipoNorm)) {
      return res.status(400).json({ error: 'tipo solo puede ser BIEN o SERVICIO' });
    }

    const retencionIndicador = providerRetencionFlag ? 'SI' : 'NO';
    const retencionType = String(comprasRetencionMeta.rows[0]?.data_type || comprasRetencionMeta.rows[0]?.udt_name || '').toLowerCase();
    const retencionPersist = retencionType.includes('boolean')
      ? (normalize(retencionIndicador) === 'SI' || normalize(retencionIndicador) === 'TRUE')
      : retencionIndicador;

    const requiredProviderValues = {
      proveedor: (providerData?.razon_social || payload.proveedor || ''),
      ruc: (providerData?.ruc || payload.ruc || ''),
      direccion: (providerData?.direccion || payload.direccion || ''),
      distrito: (providerData?.distrito || payload.distrito || ''),
      correo: (providerData?.correo || payload.correo || ''),
      persona_responsable: (providerData?.persona_responsable || payload.persona_responsable || ''),
      telefono: (providerData?.telefono || payload.telefono || ''),
      condiciones_pago: (providerData?.condiciones_pago || payload.condiciones_pago || ''),
      banco: (providerData?.banco || payload.banco || ''),
      moneda: (monedaNombre || providerData?.moneda || providerData?.moneda_nombre || ''),
      numero_cuenta: (providerData?.numero_cuenta || payload.numero_cuenta || payload.cuenta || ''),
      cci: (providerData?.cci || payload.cci || ''),
      retencion: String(retencionIndicador),
      descuento: String(descuentoNum),
      tipo: (providerData?.tipo || payload.tipo || ''),
      tipo_retencion: tipoRetencionNorm,
    };

    const missingProviderFields = Object.entries(requiredProviderValues)
      .filter(([, value]) => !String(value || '').trim())
      .map(([key]) => key);

    if (missingProviderFields.length > 0) {
      return res.status(400).json({ error: `Proveedor seleccionado con datos incompletos: ${missingProviderFields.join(', ')}` });
    }

    await pool.query(
      `
        UPDATE compras
        SET id_proveedor = $1,
            proveedor = $2,
            ruc = $3,
            direccion = $4,
            distrito = $5,
            correo = $6,
            persona_responsable = $7,
            telefono = $8,
            contacto_proveedor = $9,
            banco = $10,
            moneda = $11,
            id_moneda = $12,
            numero_cuenta = $13,
            cuenta = $14,
            cci = $15,
            retencion = $16,
            descuento = $17,
            aplica_retencion = $18,
            tipo = $19,
            tipo_retencion = $20,
            importe_final = $21,
            condiciones_pago = $22,
            subtotal = $23,
            costo_envio = $24,
            otros_costos = $25,
            igv = $26,
            total = $27,
            detalle = $28,
            comentarios = $29,
            id_area_final = $30,
            fecha_actualizacion = NOW()
          WHERE id = $31
      `,
      [
        providerId,
        (providerData?.razon_social || payload.proveedor || null),
        (providerData?.ruc || payload.ruc || null),
        (providerData?.direccion || payload.direccion || null),
        (providerData?.distrito || payload.distrito || null),
        (providerData?.correo || payload.correo || null),
        (providerData?.persona_responsable || payload.persona_responsable || null),
        (providerData?.telefono || payload.telefono || null),
        (providerData?.persona_responsable || payload.contacto_proveedor || null),
        (providerData?.banco || payload.banco || null),
        (monedaNombre || providerData?.moneda || providerData?.moneda_nombre || null),
        idMoneda,
        (providerData?.numero_cuenta || payload.numero_cuenta || payload.cuenta || null),
        (providerData?.numero_cuenta || payload.cuenta || payload.numero_cuenta || null),
        (providerData?.cci || payload.cci || null),
        retencionPersist,
        descuentoNum,
        aplicaRetencion,
        (providerData?.tipo || payload.tipo || null),
        tipoRetencionNorm,
        importeFinalCalc,
        (providerData?.condiciones_pago || payload.condiciones_pago || null),
        totalBase,
        costoEnvio,
        otrosCostos,
        igvCalc,
        importeFinalCalc,
        detallePersist,
        comentariosPersist,
        payload.id_area_final ? Number(payload.id_area_final) : null,
        id,
      ]
    );

    if (schemaMeta.comprasColumns.has('razon_social')) {
      await pool.query(
        'UPDATE compras SET razon_social = $1 WHERE id = $2',
        [(providerData?.razon_social || payload.proveedor || null), id]
      );
    }

    const result = await fetchComprasRows([id], 'WHERE c.id = $1');
    res.json(result[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/compras/:id/generar-orden', authMiddleware, async (req, res) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;
    await client.query('BEGIN');

    const compras = await fetchComprasRows([id], 'WHERE c.id = $1');
    if (compras.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Compra no encontrada' });
    }

    const compra = compras[0];

    const canOperateCompra = isComprasOperatorUser(req.user);
    const isOwner = Number(compra.id_usuario) === Number(req.user.id);

    if (!isOwner && !canOperateCompra) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'No autorizado para generar orden de esta compra' });
    }

    if (!isOwner) {
      const hasFinalApproval = await hasEffectiveFinalApprovalByRole(client, {
        tipo: 'COMPRA',
        referenciaId: id,
        roleId: 7,
      });

      if (!hasFinalApproval) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'La compra aun no tiene aprobacion final de gerencia de finanzas' });
      }
    }

    if (!['APROBADA', 'APROBADO'].includes(normalize(compra.estado))) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Solo se puede generar orden para compras APROBADAS' });
    }

    const contactoProveedor = String(compra.contacto_proveedor || compra.persona_responsable || '').trim();
    const cuentaProveedor = String(compra.cuenta || compra.numero_cuenta || '').trim();

    const missing = [];
    if (!String(compra.proveedor || '').trim()) missing.push('proveedor');
    if (!contactoProveedor) missing.push('contacto_proveedor');
    if (!String(compra.banco || '').trim()) missing.push('banco');
    if (!cuentaProveedor) missing.push('cuenta');
    if (!String(compra.cci || '').trim()) missing.push('cci');
    if (!String(compra.condiciones_pago || '').trim()) missing.push('condiciones_pago');
    if (!compra.subtotal && compra.subtotal !== 0) missing.push('subtotal');
    if (!compra.igv && compra.igv !== 0) missing.push('igv');
    if (!compra.total && compra.total !== 0) missing.push('total');
    if (!compra.id_area_final) missing.push('id_area_final');

    if (missing.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Faltan datos para generar OC: ${missing.join(', ')}` });
    }

    const orderCode = compra.numero_orden || `OC-${String(compra.id).padStart(6, '0')}`;

    const hasEstadoPedidoColumn = schemaMeta.comprasColumns.has('estado_pedido');
    const updateOrderQuery = `
      UPDATE compras
      SET ${hasEstadoPedidoColumn ? "estado_pedido = 'POR_RECIBIR'," : ''}
          numero_orden = $1,
          fecha_actualizacion = NOW()
      WHERE id = $2
    `;

    await client.query(updateOrderQuery, [orderCode, id]);

    await client.query('COMMIT');

    const updated = await fetchComprasRows([id], 'WHERE c.id = $1');
    const finalCompra = updated[0];
    finalCompra.aprobadores = await fetchApprovedApproversByEntity(pool, {
      tipo: 'COMPRA',
      referenciaId: finalCompra.id,
    });
    const pdfBase64 = await buildCompraPdfBase64(finalCompra);

    res.json({
      compra: finalCompra,
      archivo: {
        nombre: `orden_compra_${finalCompra.id}.pdf`,
        mime: 'application/pdf',
        base64: pdfBase64,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

app.patch('/api/compras/:id/marcar-recibido-almacen', authMiddleware, async (req, res) => {
  const client = await pool.connect();

  try {
    if (!canManageDeliveryRole(req.user?.rol) && !isComprasOperatorUser(req.user)) {
      return res.status(403).json({ error: 'Sin permiso para gestionar entrega' });
    }

    const { id } = req.params;
    const idCompra = Number(id || 0);

    if (!idCompra) {
      return res.status(400).json({ error: 'ID de compra invalido' });
    }

    await client.query('BEGIN');

    const compraResult = await client.query(
      `
        SELECT
          id,
          COALESCE(to_jsonb(compras)->>'estado_pedido', to_jsonb(compras)->>'estado', '') AS estado,
          NULLIF(to_jsonb(compras)->>'id_area_final', '')::int AS id_area_final,
          NULLIF(to_jsonb(compras)->>'id_area_solicitante', '')::int AS id_area_solicitante
        FROM compras
        WHERE id = $1
        FOR UPDATE
      `,
      [idCompra]
    );

    if (compraResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Compra no encontrada' });
    }

    const compra = compraResult.rows[0];
    const estadoActual = normalize(compra.estado);

    if (estadoActual !== 'POR_RECIBIR') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Solo se puede marcar como recibido compras en estado POR_RECIBIR' });
    }

    const idAreaFinal = Number(compra.id_area_final || 0);
    const idAreaSolicitante = Number(compra.id_area_solicitante || 0);
    const isGeneralDestination = idAreaFinal === 0 || idAreaFinal === idAreaSolicitante;

    // Obtener el nombre del área destino
    const areaDestinoQuery = await client.query(
      `
        SELECT COALESCE(a_fin.nombre, a_sol.nombre, '') AS area_destino_nombre
        FROM compras c
        LEFT JOIN areas a_sol ON a_sol.id = c.id_area_solicitante
        LEFT JOIN areas a_fin ON a_fin.id = c.id_area_final
        WHERE c.id = $1
      `,
      [idCompra]
    );
    const areaDestinoNorm = normalize(areaDestinoQuery.rows[0]?.area_destino_nombre || '');
    const isWarehouseDestination = isWarehouseAreaName(areaDestinoNorm);

    const detailRows = await client.query(
      `
        SELECT id_material, SUM(cantidad)::numeric AS cantidad_total
        FROM detalle_compras
        WHERE id_compra = $1
          AND id_material IS NOT NULL
        GROUP BY id_material
      `,
      [idCompra]
    );

    if (detailRows.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'La compra no tiene materiales vinculados' });
    }

    let idMovimientoEntrada = null;
    let idAlmacen = null;

    // Solo actualizar inventario si el destino es almacén
    if (isWarehouseDestination) {
      const defaultWarehouse = await client.query(
        `
          SELECT id
          FROM almacenes
          ORDER BY CASE WHEN upper(trim(nombre)) = 'GENERAL' THEN 0 ELSE 1 END, id ASC
          LIMIT 1
        `
      );

      if (defaultWarehouse.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'No existe un almacen configurado para registrar recepcion' });
      }

      idAlmacen = Number(defaultWarehouse.rows[0].id);

      idMovimientoEntrada = await insertMovimiento(client, {
        tipo: 'ENTRADA',
        usuarioRegistro: req.user.id,
      });

      for (const detail of detailRows.rows) {
        const idMaterial = Number(detail.id_material || 0);
        const qty = Number(detail.cantidad_total || 0);

        if (!idMaterial || qty <= 0) continue;

        await client.query(
          `
            INSERT INTO movimiento_detalles (id_movimiento, id_material, cantidad)
            VALUES ($1, $2, $3)
          `,
          [idMovimientoEntrada, idMaterial, qty]
        );

        const stockRow = await client.query(
          'SELECT id FROM stock WHERE id_material = $1 AND id_almacen = $2 FOR UPDATE',
          [idMaterial, idAlmacen]
        );

        if (stockRow.rows.length === 0) {
          await client.query(
            'INSERT INTO stock (id_material, id_almacen, cantidad) VALUES ($1, $2, $3)',
            [idMaterial, idAlmacen, qty]
          );
        } else {
          await client.query('UPDATE stock SET cantidad = cantidad + $1 WHERE id = $2', [qty, stockRow.rows[0].id]);
        }
      }
    }

    await client.query(
      'UPDATE compras SET estado_pedido = $1, fecha_actualizacion = NOW() WHERE id = $2',
      [isGeneralDestination ? 'RECIBIDA' : 'RECIBIDO_EN_ALMACEN', idCompra]
    );

    await client.query('COMMIT');

    const result = await fetchComprasRows([idCompra], 'WHERE c.id = $1');
    const response = { ...result[0] };
    if (isWarehouseDestination) {
      response.movimientos_generados = [idMovimientoEntrada];
      response.id_almacen_entrada = idAlmacen;
    }
    res.json(response);
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

app.patch('/api/compras/:id/recepcionar', authMiddleware, async (req, res) => {
  const client = await pool.connect();

  try {
    if (!canManageDeliveryRole(req.user?.rol)) {
      return res.status(403).json({ error: 'Sin permiso para gestionar entrega' });
    }

    const { id } = req.params;
    await client.query('BEGIN');

    const compra = await client.query(
      `
        SELECT
          id,
          COALESCE(to_jsonb(compras)->>'estado_pedido', to_jsonb(compras)->>'estado', '') AS estado,
          COALESCE(to_jsonb(compras)->>'comentarios', '') AS comentarios,
          NULLIF(to_jsonb(compras)->>'id_area_solicitante', '')::int AS id_area_solicitante,
          NULLIF(to_jsonb(compras)->>'id_area_final', '')::int AS id_area_final,
          NULLIF(to_jsonb(compras)->>'id_proveedor', '')::int AS id_proveedor,
          NULLIF(to_jsonb(compras)->>'id_moneda', '')::int AS id_moneda,
          COALESCE(to_jsonb(compras)->>'moneda', '') AS moneda,
          COALESCE(NULLIF(to_jsonb(compras)->>'subtotal', '')::numeric, 0) AS subtotal,
          COALESCE(NULLIF(to_jsonb(compras)->>'total', '')::numeric, 0) AS total,
          COALESCE(NULLIF(to_jsonb(compras)->>'igv', '')::numeric, 0) AS igv,
          COALESCE(NULLIF(to_jsonb(compras)->>'costo_envio', '')::numeric, 0) AS costo_envio,
          COALESCE(NULLIF(to_jsonb(compras)->>'otros_costos', '')::numeric, 0) AS otros_costos
        FROM compras
        WHERE id = $1
        FOR UPDATE
      `,
      [id]
    );

    if (compra.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Compra no encontrada' });
    }

    const row = compra.rows[0];
    const parsedCompraComments = parsePurchaseComments(row.comentarios);
    const itemCategoriesFromComments = parsedCompraComments.item_categorias || {};

    const areaRow = await client.query(
      `
        SELECT COALESCE(a_fin.nombre, a_sol.nombre, '') AS area_destino_nombre
        FROM compras c
        LEFT JOIN areas a_sol ON a_sol.id = c.id_area_solicitante
        LEFT JOIN areas a_fin ON a_fin.id = c.id_area_final
        WHERE c.id = $1
      `,
      [id]
    );
    const estadoActual = normalize(row.estado);
    const areaDestinoNorm = normalize(areaRow.rows[0]?.area_destino_nombre || '');
    const isWarehouseDestination = isWarehouseAreaName(areaDestinoNorm);
    const isOtherAreaDelivery = Boolean(areaDestinoNorm && !isWarehouseDestination);

    if (estadoActual === 'RECIBIDA') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'La compra ya fue recepcionada y procesada' });
    }

    if (!['PENDIENTE', 'POR_RECIBIR'].includes(estadoActual)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Solo se puede confirmar recepcion para compras pendientes o por recibir' });
    }

    const hasDetalleCategoria = schemaMeta.detalleComprasColumns.has('categoria');
    const hasDetalleSubtotal = schemaMeta.detalleComprasColumns.has('subtotal');

    const materialColumnsMeta = await client.query(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'materiales'
      `
    );

    const materialColumns = new Set(materialColumnsMeta.rows.map((r) => String(r.column_name || '').trim()));
    const materialCostoColumn = pickExistingColumn(materialColumns, ['costo_unitario', 'precio_unitario', 'costo']);
    const materialCategoriaColumn = materialColumns.has('categoria') ? 'categoria' : null;
    const materialIdMonedaColumn = ['id_moneda']
      .find((candidate) => materialColumns.has(candidate));

    const pendingLinkRows = await client.query(
      `
        SELECT
          dc.id,
          COALESCE(
            NULLIF(to_jsonb(dc)->>'descripcion', ''),
            NULLIF(to_jsonb(dc)->>'nombre_material', ''),
            ''
          ) AS descripcion,
          COALESCE(dc.cantidad, 0)::numeric AS cantidad,
          ${hasDetalleCategoria ? "COALESCE(NULLIF(to_jsonb(dc)->>'categoria', ''), '')" : "''"} AS categoria,
          ${hasDetalleSubtotal ? 'COALESCE(dc.subtotal, 0)::numeric' : '0::numeric'} AS subtotal_item,
          NULLIF(to_jsonb(dc)->>'id_categoria', '')::int AS id_categoria,
          COALESCE(cat.nombre, '') AS categoria_por_id
        FROM detalle_compras dc
        LEFT JOIN categorias cat ON cat.id = NULLIF(to_jsonb(dc)->>'id_categoria', '')::int
        WHERE dc.id_compra = $1
          AND dc.id_material IS NULL
      `,
      [id]
    );

    const currencyIdResolved = Number(row.id_moneda || 0);
    if (!currencyIdResolved) {
      throw new Error('La compra debe tener una moneda definida');
    }

    const currencyLookup = await client.query(
      `
        SELECT id, nombre
        FROM monedas
        WHERE id = $1
        LIMIT 1
      `,
      [currencyIdResolved]
    );

    if (currencyLookup.rows.length === 0) {
      throw new Error('La moneda de la compra no existe en la tabla monedas');
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

    const ensureMaterialCategoryLink = async (idMaterial, categoriaNombre) => {
      if (!categoriaNombre || !hasCategorias) return;

      let categoriaId = null;
      const existingCategoria = await client.query(
        'SELECT id FROM categorias WHERE lower(trim(nombre)) = lower(trim($1)) LIMIT 1',
        [categoriaNombre]
      );

      if (existingCategoria.rows.length > 0) {
        categoriaId = Number(existingCategoria.rows[0].id);
      } else {
        const createdCategoria = await client.query(
          'INSERT INTO categorias (nombre) VALUES ($1) RETURNING id',
          [categoriaNombre]
        );
        categoriaId = Number(createdCategoria.rows[0].id);
      }

      await client.query(
        'UPDATE materiales SET id_categoria = $1 WHERE id = $2',
        [categoriaId, idMaterial]
      );

      if (hasMaterialCategoria) {
        const hasLink = await client.query(
          'SELECT 1 FROM material_categoria WHERE id_material = $1 AND id_categoria = $2 LIMIT 1',
          [idMaterial, categoriaId]
        );

        if (hasLink.rows.length === 0) {
          await client.query(
            'INSERT INTO material_categoria (id_material, id_categoria) VALUES ($1, $2)',
            [idMaterial, categoriaId]
          );
        }
      }
    };

    const idProveedorCompra = Number(row.id_proveedor || 0);
    let idUnidadDefault = null;
    const ensureDefaultUnit = async () => {
      if (idUnidadDefault) return idUnidadDefault;

      const unidad = await client.query(
        `
          SELECT id
          FROM unidades
          ORDER BY CASE WHEN upper(trim(nombre)) = 'UNIDAD' THEN 0 ELSE 1 END, id ASC
          LIMIT 1
        `
      );

      if (unidad.rows.length === 0) {
        throw new Error('No existe una unidad configurada para crear materiales automaticamente');
      }

      idUnidadDefault = Number(unidad.rows[0].id);
      return idUnidadDefault;
    };

    const unresolvedDescriptions = [];

    const subtotalCompraPersistido = Number(row.subtotal || 0) > 0
      ? Number(row.subtotal || 0)
      : Number((
        Number(row.total || 0)
        - Number(row.igv || 0)
        - Number(row.costo_envio || 0)
        - Number(row.otros_costos || 0)
      ).toFixed(6));

    if (!Number.isFinite(subtotalCompraPersistido) || subtotalCompraPersistido <= 0) {
      throw new Error('Subtotal invalido en la orden de compra. Debe ser mayor a 0 para calcular costo unitario');
    }

    for (const pending of pendingLinkRows.rows) {
      const descripcion = String(pending.descripcion || '').trim();
      const categoriaDetalle = String(pending.categoria || '').trim();
      const categoriaPorId = String(pending.categoria_por_id || '').trim();
      const categoriaFallback = String(itemCategoriesFromComments[normalizeItemCategoryKey(descripcion)] || '').trim();
      const categoria = categoriaDetalle || categoriaPorId || categoriaFallback;

      // ===== VALIDACIÓN DESDE BD (NO DEL FRONTEND) =====
      // Usar solo datos persistidos en la orden de compra
      const cantidadItem = Number(pending.cantidad || 0);
      if (cantidadItem <= 0) {
        throw new Error(
          `Item "${descripcion}": cantidad inválida (${cantidadItem}). La cantidad debe ser mayor a 0.`
        );
      }

      // El costo unitario se calcula con datos persistidos en BD:
      // costo_unitario = compras.subtotal / detalle_compras.cantidad
      const precioUnitarioFinal = Number((subtotalCompraPersistido / cantidadItem).toFixed(6));
      if (!Number.isFinite(precioUnitarioFinal)) {
        throw new Error(`Item "${descripcion}": no fue posible calcular precio unitario desde subtotal y cantidad.`);
      }

      if (!descripcion) {
        unresolvedDescriptions.push('(sin descripcion)');
        continue;
      }

      const match = await client.query(
        `
          SELECT id
          FROM materiales
          WHERE lower(trim(nombre)) = lower(trim($1))
          ORDER BY id ASC
          LIMIT 1
        `,
        [descripcion]
      );

      if (match.rows.length === 1) {
        // Material ya existe: solo vincular categoría si es necesario
        await ensureMaterialCategoryLink(Number(match.rows[0].id), categoria);
        await client.query(
          'UPDATE detalle_compras SET id_material = $1 WHERE id = $2',
          [Number(match.rows[0].id), Number(pending.id)]
        );
      } else {
        // Material NO existe: crear nuevo con todos los datos correctos
        if (!idProveedorCompra) {
          throw new Error('La compra tiene items sin material vinculado y no tiene proveedor para crearlos automaticamente');
        }

        const idUnidad = await ensureDefaultUnit();

        // ===== INSERCIÓN: CAMPOS OBLIGATORIOS =====
        const insertColumns = ['nombre', 'descripcion', 'id_unidad', 'id_proveedor'];
        const insertValues = [
          descripcion,
          'Generado automaticamente desde recepcion de compra',
          idUnidad,
          idProveedorCompra,
        ];

        // ===== INSERCIÓN: PRECIO UNITARIO (OBLIGATORIO PARA NUEVO MATERIAL) =====
        if (materialCostoColumn) {
          insertColumns.push(materialCostoColumn);
          insertValues.push(precioUnitarioFinal);
        }

        // ===== INSERCIÓN: CATEGORÍA (SI EXISTE) =====
        if (materialCategoriaColumn && categoria) {
          insertColumns.push(materialCategoriaColumn);
          insertValues.push(categoria);
        }

        // ===== INSERCIÓN: MONEDA (OBLIGATORIA - DEL PROVEEDOR) =====
        if (materialIdMonedaColumn && currencyIdResolved > 0) {
          insertColumns.push(materialIdMonedaColumn);
          insertValues.push(currencyIdResolved);
        }

        const placeholders = insertValues.map((_, idx) => `$${idx + 1}`);
        const createdMaterial = await client.query(
          `
            INSERT INTO materiales (${insertColumns.join(', ')})
            VALUES (${placeholders.join(', ')})
            RETURNING id
          `,
          insertValues
        );

        if (createdMaterial.rows.length === 0) {
          unresolvedDescriptions.push(descripcion);
          continue;
        }

        // Vincular categoría si fue especificada
        await ensureMaterialCategoryLink(Number(createdMaterial.rows[0].id), categoria);

        // Vincular material con detalle de compra
        await client.query(
          'UPDATE detalle_compras SET id_material = $1 WHERE id = $2',
          [Number(createdMaterial.rows[0].id), Number(pending.id)]
        );
      }
    }

    if (unresolvedDescriptions.length > 0) {
      throw new Error(`La compra tiene items sin material vinculado: ${unresolvedDescriptions.join(', ')}`);
    }

    const allDetailWithMaterialRows = await client.query(
      `
        SELECT
          id_material,
          COALESCE(
            NULLIF(to_jsonb(detalle_compras)->>'descripcion', ''),
            NULLIF(to_jsonb(detalle_compras)->>'nombre_material', ''),
            ''
          ) AS descripcion,
          COALESCE(NULLIF(to_jsonb(detalle_compras)->>'categoria', ''), '') AS categoria,
          COALESCE(cat.nombre, '') AS categoria_por_id
        FROM detalle_compras
        LEFT JOIN categorias cat ON cat.id = NULLIF(to_jsonb(detalle_compras)->>'id_categoria', '')::int
        WHERE id_compra = $1
          AND id_material IS NOT NULL
      `,
      [id]
    );

    for (const detail of allDetailWithMaterialRows.rows) {
      const idMaterial = Number(detail.id_material || 0);
      if (!idMaterial) continue;

      const descripcion = String(detail.descripcion || '').trim();
      const categoriaDetalle = String(detail.categoria || '').trim();
      const categoriaPorId = String(detail.categoria_por_id || '').trim();
      const categoriaFallback = descripcion
        ? String(itemCategoriesFromComments[normalizeItemCategoryKey(descripcion)] || '').trim()
        : '';
      const categoria = categoriaDetalle || categoriaPorId || categoriaFallback;

      await ensureMaterialCategoryLink(idMaterial, categoria);
    }

    const detailRows = await client.query(
      `
        SELECT id_material, SUM(cantidad)::numeric AS cantidad_total
        FROM detalle_compras
        WHERE id_compra = $1
          AND id_material IS NOT NULL
        GROUP BY id_material
      `,
      [id]
    );

    if (detailRows.rows.length === 0) {
      throw new Error('La compra no tiene materiales vinculados para generar movimientos');
    }

    const defaultWarehouse = await client.query(
      `
        SELECT id
        FROM almacenes
        ORDER BY CASE WHEN upper(trim(nombre)) = 'GENERAL' THEN 0 ELSE 1 END, id ASC
        LIMIT 1
      `
    );

    if (defaultWarehouse.rows.length === 0) {
      throw new Error('No existe un almacen configurado para registrar recepcion');
    }

    const idAlmacen = Number(defaultWarehouse.rows[0].id);
    const movimientoIds = [];

    let idMovimientoEntrada = null;

    // Solo actualizar inventario si el destino es almacén
    if (isWarehouseDestination) {
      idMovimientoEntrada = await insertMovimiento(client, {
        tipo: 'ENTRADA',
        usuarioRegistro: req.user.id,
      });
      movimientoIds.push(idMovimientoEntrada);

      for (const detail of detailRows.rows) {
        const idMaterial = Number(detail.id_material || 0);
        const qty = Number(detail.cantidad_total || 0);

        if (!idMaterial || qty <= 0) continue;

        await client.query(
          `
            INSERT INTO movimiento_detalles (id_movimiento, id_material, cantidad)
            VALUES ($1, $2, $3)
          `,
          [idMovimientoEntrada, idMaterial, qty]
        );

        const stockRow = await client.query(
          'SELECT id FROM stock WHERE id_material = $1 AND id_almacen = $2 FOR UPDATE',
          [idMaterial, idAlmacen]
        );

        if (stockRow.rows.length === 0) {
          await client.query(
            'INSERT INTO stock (id_material, id_almacen, cantidad) VALUES ($1, $2, $3)',
            [idMaterial, idAlmacen, qty]
          );
        } else {
          await client.query('UPDATE stock SET cantidad = cantidad + $1 WHERE id = $2', [qty, stockRow.rows[0].id]);
        }
      }
    }

    const entregaAreaPayload = isOtherAreaDelivery
      ? {
          pendiente: true,
          entregado: false,
          area_destino: areaRow.rows[0]?.area_destino_nombre || '',
          fecha_recepcion_almacen: new Date().toISOString(),
        }
      : null;

    const estadoFinal = isWarehouseDestination ? 'ENTREGADO' : 'PENDIENTE_ENTREGA';

    const comentariosConRecepcion = buildPurchaseComment({
      comentarios: parsedCompraComments.comentarios,
      itemCategorias: itemCategoriesFromComments,
      recibidoPor: req.user.nombre || 'Usuario',
      entregaArea: entregaAreaPayload,
      comentariosHistorial: parsedCompraComments.comentarios_historial,
    });

    await client.query(
      'UPDATE compras SET estado_pedido = $1, comentarios = $2 WHERE id = $3',
      [estadoFinal, comentariosConRecepcion, id]
    );

    await client.query('COMMIT');

    const result = await fetchComprasRows([id], 'WHERE c.id = $1');
    const response = {
      ...result[0],
      receptor: null,
      movimientos_generados: movimientoIds,
    };
    if (isWarehouseDestination) {
      response.id_almacen_entrada = idAlmacen;
    }
    res.json(response);
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

app.patch('/api/compras/:id/entregar-area', authMiddleware, async (req, res) => {
  const client = await pool.connect();

  try {
    if (!canManageDeliveryRole(req.user?.rol) && !isComprasOperatorUser(req.user)) {
      return res.status(403).json({ error: 'Sin permiso para gestionar entrega' });
    }

    const { id } = req.params;
    const receptorUserId = Number(req.body?.receptor_user_id || 0);
    if (!receptorUserId) {
      return res.status(400).json({ error: 'Debes seleccionar un receptor valido para confirmar entrega' });
    }

    await client.query('BEGIN');

    const compra = await client.query(
      `
        SELECT
          id,
          COALESCE(to_jsonb(compras)->>'estado_pedido', to_jsonb(compras)->>'estado', '') AS estado,
          COALESCE(to_jsonb(compras)->>'comentarios', '') AS comentarios,
          NULLIF(to_jsonb(compras)->>'id_area_solicitante', '')::int AS id_area_solicitante,
          NULLIF(to_jsonb(compras)->>'id_area_final', '')::int AS id_area_final
        FROM compras
        WHERE id = $1
        FOR UPDATE
      `,
      [id]
    );

    if (compra.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Compra no encontrada' });
    }

    const row = compra.rows[0];
    const estadoActual = normalize(row.estado);
    if (estadoActual !== 'PENDIENTE_ENTREGA') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'La orden debe estar en estado PENDIENTE_ENTREGA para marcar entrega al area' });
    }

    const areaRow = await client.query(
      `
        SELECT COALESCE(a_fin.nombre, a_sol.nombre, '') AS area_destino_nombre
        FROM compras c
        LEFT JOIN areas a_sol ON a_sol.id = c.id_area_solicitante
        LEFT JOIN areas a_fin ON a_fin.id = c.id_area_final
        WHERE c.id = $1
      `,
      [id]
    );

    const areaDestinoNorm = normalize(areaRow.rows[0]?.area_destino_nombre || '');
    if (!areaDestinoNorm || isWarehouseAreaName(areaDestinoNorm)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Esta orden no requiere entrega al area porque su destino es General' });
    }

    const parsedCompraComments = parsePurchaseComments(row.comentarios);
    if (parsedCompraComments?.entrega_area?.entregado === true) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'La orden ya fue entregada al area destino' });
    }

    const areaDestinoId = Number(row.id_area_final || row.id_area_solicitante || 0);
    const receptorParams = [receptorUserId];
    let receptorQuery = `
      SELECT
        u.id,
        u.nombre,
        COALESCE(NULLIF(trim(COALESCE(to_jsonb(u)->>'dni', '')), ''), '') AS dni,
        COALESCE(NULLIF(trim(COALESCE(to_jsonb(u)->>'imagen', to_jsonb(u)->>'foto', '')), ''), '') AS imagen
      FROM usuarios u
      WHERE u.id = $1
    `;

    if (areaDestinoId > 0) {
      receptorParams.push(areaDestinoId);
      receptorQuery += ' AND u.id_area = $2';
    }

    receptorQuery += ' LIMIT 1';

    const receptorResult = await client.query(receptorQuery, receptorParams);
    if (receptorResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'El receptor seleccionado no es valido para el area destino de la orden' });
    }

    const receptor = receptorResult.rows[0];
    const receptorDni = String(receptor.dni || '').trim();
    if (!receptorDni) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'El receptor seleccionado no tiene DNI registrado' });
    }

    const detailRows = await client.query(
      `
        SELECT id_material, SUM(cantidad)::numeric AS cantidad_total
        FROM detalle_compras
        WHERE id_compra = $1
          AND id_material IS NOT NULL
        GROUP BY id_material
      `,
      [id]
    );

    let idMovimientoSalida = null;
    if (detailRows.rows.length > 0) {
      idMovimientoSalida = await insertMovimiento(client, {
        tipo: 'SALIDA',
        usuarioRegistro: req.user.id,
      });

      for (const detail of detailRows.rows) {
        const idMaterial = Number(detail.id_material || 0);
        const qty = Number(detail.cantidad_total || 0);
        if (!idMaterial || qty <= 0) continue;

        await client.query(
          `
            INSERT INTO movimiento_detalles (id_movimiento, id_material, cantidad)
            VALUES ($1, $2, $3)
          `,
          [idMovimientoSalida, idMaterial, qty]
        );
      }
    }

    const itemCategoriesFromComments = parsedCompraComments.item_categorias || {};
    const comentariosConEntrega = buildPurchaseComment({
      comentarios: parsedCompraComments.comentarios,
      itemCategorias: itemCategoriesFromComments,
      recibidoPor: `${String(receptor.nombre || '').trim()} - DNI ${receptorDni}`,
      entregaArea: {
        pendiente: false,
        entregado: true,
        receptor_user_id: receptor.id,
        receptor_nombre: receptor.nombre,
        receptor_dni: receptorDni,
        fecha_entrega_area: new Date().toISOString(),
      },
      comentariosHistorial: parsedCompraComments.comentarios_historial,
    });

    await client.query(
      'UPDATE compras SET estado_pedido = $1, comentarios = $2 WHERE id = $3',
      ['ENTREGADO', comentariosConEntrega, id]
    );

    await client.query('COMMIT');

    const result = await fetchComprasRows([id], 'WHERE c.id = $1');
    return res.json({
      ...result[0],
      receptor: {
        id: receptor.id,
        nombre: receptor.nombre,
        dni: receptorDni,
        imagen: receptor.imagen || DEFAULT_USER_AVATAR,
      },
      movimientos_generados: idMovimientoSalida ? [idMovimientoSalida] : [],
      id_almacen_salida: null,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

app.get('/api/compras/:id/receptores', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const term = String(req.query.query || '').trim();

    const compraArea = await pool.query(
      `
        SELECT
          COALESCE(c.id_area_final, c.id_area_solicitante) AS id_area,
          COALESCE(a_fin.nombre, a_sol.nombre, '') AS area_destino_nombre
        FROM compras c
        LEFT JOIN areas a_sol ON a_sol.id = c.id_area_solicitante
        LEFT JOIN areas a_fin ON a_fin.id = c.id_area_final
        WHERE c.id = $1
        LIMIT 1
      `,
      [id]
    );

    if (compraArea.rows.length === 0) {
      return res.status(404).json({ error: 'Compra no encontrada' });
    }

    const areaNameNorm = normalize(compraArea.rows[0].area_destino_nombre || '');
    if (!areaNameNorm || isWarehouseAreaName(areaNameNorm)) {
      return res.json([]);
    }

    const areaId = Number(compraArea.rows[0].id_area || 0);
    if (!areaId) {
      return res.json([]);
    }

    const fields = [
      'u.id',
      'u.nombre',
      `COALESCE(NULLIF(trim(COALESCE(to_jsonb(u)->>'dni', '')), ''), '') AS dni`,
      `COALESCE(ar.nombre, '') AS area`,
      `COALESCE(NULLIF(trim(COALESCE(to_jsonb(u)->>'imagen', to_jsonb(u)->>'foto', '')), ''), '') AS imagen`,
    ];

    const conditions = ['u.id_area = $1'];
    const params = [areaId];

    if (term) {
      params.push(`%${term}%`);
      const likePos = params.length;
      params.push(`%${term}%`);
      const likeDniPos = params.length;
      conditions.push(`(u.nombre ILIKE $${likePos} OR COALESCE(to_jsonb(u)->>'dni', '') ILIKE $${likeDniPos})`);
    }

    const result = await pool.query(
      `
        SELECT ${fields.join(', ')}
        FROM usuarios u
        LEFT JOIN areas ar ON ar.id = u.id_area
        WHERE ${conditions.join(' AND ')}
        ORDER BY u.nombre ASC
        LIMIT 20
      `,
      params
    );

    return res.json(result.rows.map((row) => ({
      id: row.id,
      nombre: row.nombre,
      dni: row.dni || '',
      area: row.area || '',
      imagen: row.imagen || DEFAULT_USER_AVATAR,
    })));
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get('/api/servicios', authMiddleware, async (req, res) => {
  try {
    if (schemaMeta.serviciosColumns.size === 0) {
      return res.json([]);
    }

    const userRole = String(req.user?.rol || '');
    const roleId = resolveApprovalRoleId(req.user);
    const requiredApprovalPermission = getRequiredApprovalPermissionByRoleId(roleId);
    const canApproveInCurrentStage = Boolean(requiredApprovalPermission) && tienePermiso(req.user, requiredApprovalPermission);


    // Devolver todos los servicios para "Mis órdenes de servicios" independientemente del rol
    const servicios = await fetchServiciosRows([], '', { approvalRoleId: roleId, approvalPermissionGranted: canApproveInCurrentStage });
    res.json(servicios);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/mis-servicios', authMiddleware, async (req, res) => {
  try {
    if (schemaMeta.serviciosColumns.size === 0) {
      return res.json([]);
    }

    const roleId = resolveApprovalRoleId(req.user);
    const requiredApprovalPermission = getRequiredApprovalPermissionByRoleId(roleId);
    const canApproveInCurrentStage = Boolean(requiredApprovalPermission) && tienePermiso(req.user, requiredApprovalPermission);

    if (isApprovalHierarchyRoleId(roleId) && canApproveInCurrentStage) {
      const pendingReferenceIds = await fetchPendingApprovalReferenceIdsByRole(pool, {
        tipo: 'SERVICIO',
        roleId,
      });
      const referenceIds = [...new Set(pendingReferenceIds)];

      if (referenceIds.length === 0) {
        return res.json([]);
      }

      const serviciosJerarquicos = await fetchServiciosRows(
        [referenceIds],
        'WHERE s.id = ANY($1::int[])',
        {
          approvalRoleId: roleId,
          approvalPermissionGranted: canApproveInCurrentStage,
        }
      );

      serviciosJerarquicos.forEach((row) => {
        row.gestion_estado_usuario = String(row.estado_aprobacion_detalle || 'PENDIENTE').trim().toUpperCase();
      });

      return res.json(serviciosJerarquicos);
    }

    if (isComprasOperatorUser(req.user)) {
      const serviciosAprobados = await fetchServiciosRows(
        [],
        "WHERE upper(trim(COALESCE(to_jsonb(s)->>'estado_aprobacion', to_jsonb(s)->>'estado', ''))) = 'APROBADO'",
        { approvalRoleId: roleId, approvalPermissionGranted: canApproveInCurrentStage }
      );

      return res.json(serviciosAprobados);
    }

    const servicios = await fetchServiciosRows(
      [req.user.id],
      "WHERE NULLIF(COALESCE(to_jsonb(s)->>'id_usuario', to_jsonb(s)->>'usuario_id', ''), '')::int = $1",
      { approvalRoleId: roleId, approvalPermissionGranted: canApproveInCurrentStage }
    );
    res.json(servicios);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/servicios/:id/comentarios', authMiddleware, async (req, res) => {
  const client = await pool.connect();

  try {
    if (schemaMeta.serviciosColumns.size === 0) {
      return res.status(400).json({ error: 'La tabla servicios no esta disponible' });
    }

    const id = Number(req.params?.id || 0);
    const contenido = String(req.body?.contenido || '').trim();

    if (!id) {
      return res.status(400).json({ error: 'ID de servicio invalido' });
    }

    if (!contenido) {
      return res.status(400).json({ error: 'El contenido del comentario es obligatorio' });
    }

    const userIdColumn = getServicioUserIdColumn();

    await client.query('BEGIN');

    const servicioResult = await client.query(
      `
        SELECT
          id,
          ${quoteIdentifier(userIdColumn)} AS id_usuario
        FROM servicios
        WHERE id = $1
      `,
      [id]
    );

    if (servicioResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Servicio no encontrado' });
    }

    const row = servicioResult.rows[0];
    const isOwner = Number(row.id_usuario || 0) === Number(req.user?.id || 0);
    const canManage = isComprasOperatorUser(req.user)
      || canManagePurchasesRole(req.user?.rol)
      || isApprovalHierarchyRoleId(resolveApprovalRoleId(req.user));

    if (!isOwner && !canManage) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'No autorizado para comentar este servicio' });
    }

    const newEntry = await insertCommentForEntity(client, {
      user: req.user,
      tipoEntidad: 'servicio',
      idEntidad: id,
      contenido,
    });

    await client.query('COMMIT');
    return res.json({ comentario: newEntry });
  } catch (error) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

app.get('/api/aprobaciones/pendientes', authMiddleware, async (req, res) => {
  try {
    const approvalStagePermission = getApprovalStagePermissionForUser(req.user);
    const approvalStageState = getApprovalStateByPermission(approvalStagePermission);
    if (!approvalStagePermission || !approvalStageState) {
      return res.json([]);
    }

    const hasTable = await hasAprobacionesTable(pool);
    if (!hasTable) {
      return res.json([]);
    }

    const result = await pool.query(
      `
        SELECT
          a.id,
          upper(trim(a.tipo)) AS tipo,
          a.referencia_id,
          a.orden,
          a.rol_aprobador,
          upper(trim(COALESCE(a.estado, 'PENDIENTE'))) AS estado,
          a.fecha
        FROM aprobaciones a
        WHERE upper(trim(a.tipo)) IN ('COMPRA', 'SERVICIO')
          AND a.rol_aprobador = $1
          AND (upper(trim(COALESCE(a.estado, 'PENDIENTE'))) = 'PENDIENTE'
               OR upper(trim(COALESCE(a.estado, 'PENDIENTE'))) LIKE 'PENDIENTE_%')
          AND NOT EXISTS (
            SELECT 1
            FROM aprobaciones prev
            WHERE upper(trim(prev.tipo)) = upper(trim(a.tipo))
              AND prev.referencia_id = a.referencia_id
              AND prev.orden < a.orden
              AND upper(trim(COALESCE(prev.estado, 'PENDIENTE'))) <> 'APROBADO'
          )
        ORDER BY upper(trim(a.tipo)), a.referencia_id, a.orden
      `,
      [getApprovalRoleIdByPermission(approvalStagePermission)]
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/aprobaciones/config', authMiddleware, async (req, res) => {
  try {
    const tableExists = await hasAprobacionesTable(pool);
    if (!tableExists) {
      return res.json({ flujos: {} });
    }

    const result = await pool.query(
      `
        SELECT upper(trim(ac.flujo)) AS flujo, ac.orden, ac.rol_id, upper(trim(r.nombre)) AS rol_nombre
        FROM aprobaciones_config ac
        JOIN roles r ON r.id = ac.rol_id
        WHERE ac.activo = TRUE
        ORDER BY ac.flujo, ac.orden ASC
      `
    );

    const flujos = {};
    result.rows.forEach((row) => {
      const flow = String(row.flujo || '').trim().toUpperCase();
      const roleId = Number(row.rol_id || 0);
      const order = Number(row.orden || 0);
      const roleName = String(row.rol_nombre || '').trim().toUpperCase();
      if (flow && Number.isInteger(roleId) && roleId > 0) {
        if (!flujos[flow]) {
          flujos[flow] = [];
        }
        flujos[flow].push({ rol_id: roleId, orden: order, rol_nombre: roleName });
      }
    });

    res.json({ flujos });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/aprobaciones/config/:flujo', authMiddleware, async (req, res) => {
  const client = await pool.connect();

  try {
    // Only ADMIN can modify approval flows
    if (!isAdminRole(req.user?.rol)) {
      return res.status(403).json({ error: 'No tienes permiso para modificar la configuración de aprobaciones' });
    }

    const flujo = String(req.params.flujo || '').trim().toUpperCase();
    const roleIds = Array.isArray(req.body?.roleIds) ? req.body.roleIds.map(id => Number(id)).filter(id => Number.isInteger(id) && id > 0) : [];

    if (!flujo || !['COMPRA', 'SERVICIO_DENTRO_PLAN', 'SERVICIO_FUERA_PLAN'].includes(flujo)) {
      return res.status(400).json({ error: 'Flujo no valido' });
    }

    if (roleIds.length === 0) {
      return res.status(400).json({ error: 'Debe proporcionar al menos un rol' });
    }

    const tableExists = await hasAprobacionesTable(client);
    if (!tableExists) {
      return res.status(500).json({ error: 'Tabla de aprobaciones no existe' });
    }

    // Delete existing roles for this flow
    await client.query(
      'DELETE FROM aprobaciones_config WHERE upper(trim(flujo)) = $1',
      [flujo]
    );

    // Insert new roles for this flow with correct order
    for (let idx = 0; idx < roleIds.length; idx += 1) {
      await client.query(
        'INSERT INTO aprobaciones_config (flujo, orden, rol_id, activo) VALUES ($1, $2, $3, TRUE)',
        [flujo, idx + 1, roleIds[idx]]
      );
    }

    // Reload chains from config
    await loadApprovalChainsFromConfig();

    res.json({ success: true, message: `Flujo ${flujo} actualizado correctamente` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

app.post('/api/servicios', authMiddleware, requirePermissions('CREAR_SOLICITUD_SERVICIO'), async (req, res) => {
  const client = await pool.connect();
  let txStarted = false;

  try {
    if (schemaMeta.serviciosColumns.size === 0) {
      return res.status(400).json({ error: 'La tabla servicios no esta disponible' });
    }

    const userIdColumn = getServicioUserIdColumn();
    const areaIdColumn = getServicioAreaIdColumn();
    const descriptionColumn = getServicioDescriptionColumn();
    const nameColumn = getServicioNameColumn();
    const priorityColumn = getServicioPriorityColumn();
    const dentroPlanColumn = getServicioDentroPlanColumn();
    const approvalColumn = getServicioApprovalColumn();
    const statusColumn = getServicioStatusColumn();

    const areaId = Number(req.body?.area_id ?? req.body?.id_area ?? req.user?.id_area ?? 0);
    const nombreServicio = String(req.body?.nombre_servicio ?? req.body?.nombre ?? '').trim();
    const prioridad = normalize(req.body?.prioridad || 'MEDIA');
    const descripcionServicio = String(req.body?.descripcion_servicio ?? req.body?.descripcion ?? '').trim();
    const dentroPlan = parseBooleanFlag(req.body?.dentro_plan ?? req.body?.dentroPlan ?? req.body?.en_plan, true);
    const creatorRoleId = Number(req.user?.id_role || req.user?.rol_id || 0);
    const initialApprovalState = getInitialApprovalStateForEntity({
      tipo: 'SERVICIO',
      dentroPlan,
      creatorRoleId,
    });
    console.log('Prioridad enviada:', prioridad);

    if (!Number.isInteger(areaId) || areaId <= 0) {
      return res.status(400).json({ error: 'area_id es obligatorio y debe ser valido' });
    }

    if (!nombreServicio) {
      return res.status(400).json({ error: 'nombre_servicio es obligatorio' });
    }

    if (!PRIORIDADES.includes(prioridad)) {
      return res.status(400).json({ error: 'prioridad invalida. Usa ALTA, MEDIA o BAJA' });
    }

    if (!descripcionServicio) {
      return res.status(400).json({ error: 'descripcion_servicio es obligatorio' });
    }

    const areaExists = await client.query('SELECT id FROM areas WHERE id = $1 LIMIT 1', [areaId]);

    if (areaExists.rows.length === 0) {
      return res.status(400).json({ error: 'area_id no existe en areas' });
    }

    await client.query('BEGIN');
    txStarted = true;

    const insertColumns = [quoteIdentifier(userIdColumn), quoteIdentifier(areaIdColumn), quoteIdentifier(descriptionColumn), quoteIdentifier(approvalColumn)];
    const insertValues = [Number(req.user.id), areaId, descripcionServicio, initialApprovalState];

    if (nameColumn) {
      insertColumns.push(quoteIdentifier(nameColumn));
      insertValues.push(nombreServicio);
    }

    if (priorityColumn) {
      insertColumns.push(quoteIdentifier(priorityColumn));
      insertValues.push(prioridad);
    }

    if (dentroPlanColumn) {
      insertColumns.push(quoteIdentifier(dentroPlanColumn));
      insertValues.push(dentroPlan);
    }

    if (statusColumn) {
      insertColumns.push(quoteIdentifier(statusColumn));
      insertValues.push(null);
    }

    const placeholders = insertValues.map((_, idx) => `$${idx + 1}`);

    const created = await client.query(
      `
        INSERT INTO servicios (${insertColumns.join(', ')})
        VALUES (${placeholders.join(', ')})
        RETURNING id
      `,
      insertValues
    );

    const servicioId = Number(created.rows[0].id || 0);

    const approvalSetup = await createApprovalRowsForEntity(client, {
      tipo: 'SERVICIO',
      referenciaId: servicioId,
      dentroPlan,
      creatorRoleId,
    });

    if (approvalSetup.autoApproved) {
      await client.query(
        `
          UPDATE servicios
          SET ${quoteIdentifier(approvalColumn)} = 'APROBADO',
              ${quoteIdentifier(statusColumn)} = NULL
          WHERE id = $1
        `,
        [servicioId]
      );
    }

    await client.query('COMMIT');
    txStarted = false;

    const servicio = await fetchServiciosRows([servicioId], 'WHERE s.id = $1');
    res.status(201).json(servicio[0]);
  } catch (error) {
    if (txStarted) {
      await client.query('ROLLBACK');
    }

    if (String(error?.code || '') === '23514') {
      return res.status(400).json({ error: 'Violacion de restriccion CHECK en servicios' });
    }

    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

app.put('/api/servicios/:id/aprobar', authMiddleware, async (req, res) => {
  const client = await pool.connect();

  try {
    if (schemaMeta.serviciosColumns.size === 0) {
      return res.status(400).json({ error: 'La tabla servicios no esta disponible' });
    }

    const { id } = req.params;
    const approvalColumn = getServicioApprovalColumn();
    const statusColumn = getServicioStatusColumn();
    const estadoAprobacion = normalize(req.body?.estado_aprobacion ?? req.body?.estado);

    if (!ESTADOS_SERVICIO_APROBACION.includes(estadoAprobacion) || estadoAprobacion === 'PENDIENTE') {
      return res.status(400).json({ error: 'estado_aprobacion invalido. Usa APROBADO o RECHAZADO' });
    }

    await client.query('BEGIN');

    const exists = await client.query('SELECT id FROM servicios WHERE id = $1 FOR UPDATE', [id]);
    if (exists.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Servicio no encontrado' });
    }

    const approvalRows = await client.query(
      `
        SELECT id
        FROM aprobaciones
        WHERE upper(trim(tipo)) = 'SERVICIO'
          AND referencia_id = $1
        LIMIT 1
      `,
      [id]
    ).catch(() => ({ rows: [] }));

    const useApprovalTable = approvalRows.rows.length > 0;

    const hasDentroPlan = Object.prototype.hasOwnProperty.call(req.body || {}, 'dentro_plan')
      || Object.prototype.hasOwnProperty.call(req.body || {}, 'dentroPlan')
      || Object.prototype.hasOwnProperty.call(req.body || {}, 'en_plan');
    const planChoice = hasDentroPlan
      ? parseBooleanFlag(req.body?.dentro_plan ?? req.body?.dentroPlan ?? req.body?.en_plan, false)
      : null;

    if (useApprovalTable) {
      await client.query('ROLLBACK');

      const approvalResult = await aprobarEntidad(req.user, 'servicio', id, estadoAprobacion, { dentro_plan: planChoice });
      if (!approvalResult?.ok) {
        return res.status(500).json({ error: 'No se pudo aprobar el servicio' });
      }

      const refreshed = await fetchServiciosRows([id], 'WHERE s.id = $1');
      if (refreshed[0]) {
        refreshed[0].aprobadores = await fetchApprovedApproversByEntity(pool, {
          tipo: 'SERVICIO',
          referenciaId: refreshed[0].id,
        });
        refreshed[0].historial_aprobaciones = await fetchApprovalHistoryByEntity(pool, {
          tipo: 'SERVICIO',
          referenciaId: refreshed[0].id,
        });
      }

      return res.json(refreshed[0]);
    } else {
      if (!canManagePurchasesRole(req.user?.rol)) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Sin permiso para gestionar servicios' });
      }

      if (planChoice !== null) {
        const planColumn = getServicioDentroPlanColumn();
        if (planColumn) {
          await client.query(
            `UPDATE servicios SET ${quoteIdentifier(planColumn)} = $1 WHERE id = $2`,
            [planChoice, id]
          );
        }
      }

      await client.query(
        `
          UPDATE servicios
          SET ${quoteIdentifier(approvalColumn)} = $1,
              ${quoteIdentifier(statusColumn)} = $2
          WHERE id = $3
        `,
        [estadoAprobacion, estadoAprobacion === 'APROBADO' ? 'APROBADO' : null, id]
      );
    }

    await client.query('COMMIT');

    const servicio = await fetchServiciosRows([id], 'WHERE s.id = $1');
    if (servicio[0]) {
      servicio[0].aprobadores = await fetchApprovedApproversByEntity(pool, {
        tipo: 'SERVICIO',
        referenciaId: servicio[0].id,
      });
      servicio[0].historial_aprobaciones = await fetchApprovalHistoryByEntity(pool, {
        tipo: 'SERVICIO',
        referenciaId: servicio[0].id,
      });
    }
    res.json(servicio[0]);
  } catch (error) {
    await client.query('ROLLBACK');

    if (String(error?.code || '') === '23514') {
      return res.status(400).json({ error: 'Violacion de restriccion CHECK en servicios' });
    }

    const mapped = mapApprovalDecisionErrorToHttp(error);
    if (mapped.expose) {
      return res.status(mapped.status).json({ error: error.message });
    }

    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

app.put('/api/servicios/:id/estado', authMiddleware, async (req, res) => {
  try {
    if (schemaMeta.serviciosColumns.size === 0) {
      return res.status(400).json({ error: 'La tabla servicios no esta disponible' });
    }

    const { id } = req.params;
    const statusColumn = getServicioStatusColumn();
    const approvalColumn = getServicioApprovalColumn();
    const userIdColumn = getServicioUserIdColumn();
    const newStatus = normalize(req.body?.estado_flujo ?? req.body?.estado_servicio ?? req.body?.estado);

    if (newStatus !== 'REALIZADO') {
      return res.status(400).json({ error: 'estado_flujo invalido. Solo se permite REALIZADO' });
    }

    const current = await pool.query(
      `
        SELECT
          id,
          ${quoteIdentifier(userIdColumn)} AS id_usuario,
          ${quoteIdentifier(approvalColumn)} AS estado_aprobacion,
          ${quoteIdentifier(statusColumn)} AS estado_flujo
        FROM servicios
        WHERE id = $1
        LIMIT 1
      `,
      [id]
    );

    if (current.rows.length === 0) {
      return res.status(404).json({ error: 'Servicio no encontrado' });
    }

    const row = current.rows[0];
    const canManage = isAdminRole(req.user?.rol) || isComprasRole(req.user?.rol) || canManagePurchasesRole(req.user?.rol);
    if (!canManage && Number(row.id_usuario || 0) !== Number(req.user.id || 0)) {
      return res.status(403).json({ error: 'No autorizado para actualizar este servicio' });
    }

    if (normalize(row.estado_aprobacion) !== 'APROBADO') {
      return res.status(400).json({ error: 'Solo se puede cambiar estado_flujo si estado_aprobacion = APROBADO' });
    }

    if (normalize(row.estado_flujo) !== 'PENDIENTE') {
      return res.status(400).json({ error: 'Solo se puede marcar REALIZADO cuando estado_flujo = PENDIENTE' });
    }

    const updated = await pool.query(
      `
        UPDATE servicios
        SET ${quoteIdentifier(statusColumn)} = $1
        WHERE id = $2
          AND upper(trim(COALESCE(${quoteIdentifier(approvalColumn)}::text, ''))) = 'APROBADO'
        RETURNING id
      `,
      ['REALIZADO', id]
    );

    if (updated.rows.length === 0) {
      return res.status(400).json({ error: 'No se pudo actualizar estado_flujo' });
    }

    const servicio = await fetchServiciosRows([id], 'WHERE s.id = $1');
    res.json(servicio[0]);
  } catch (error) {
    if (String(error?.code || '') === '23514') {
      return res.status(400).json({ error: 'Violacion de restriccion CHECK en servicios' });
    }

    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/servicios/:id/completar-datos', authMiddleware, async (req, res) => {
  try {
    if (schemaMeta.serviciosColumns.size === 0) {
      return res.status(400).json({ error: 'La tabla servicios no esta disponible' });
    }

    const { id } = req.params;
    const providerId = Number(req.body?.proveedor_id ?? req.body?.id_proveedor ?? 0);
    const subtotalInput = Number(req.body?.subtotal ?? 0);
    const costoEnvioInput = Number(req.body?.costo_envio ?? 0);
    const otrosCostosInput = Number(req.body?.otros_costos ?? 0);
    const igvInput = Number((subtotalInput * 0.18).toFixed(2));
    const totalInput = Number((subtotalInput + igvInput + costoEnvioInput + otrosCostosInput).toFixed(2));

    if (!Number.isInteger(providerId) || providerId <= 0) {
      return res.status(400).json({ error: 'proveedor_id es obligatorio y debe ser valido' });
    }

    if (!Number.isFinite(subtotalInput) || subtotalInput < 0) {
      return res.status(400).json({ error: 'subtotal debe ser un numero mayor o igual a 0' });
    }

    if (!Number.isFinite(costoEnvioInput) || costoEnvioInput < 0) {
      return res.status(400).json({ error: 'costo_envio debe ser un numero mayor o igual a 0' });
    }

    if (!Number.isFinite(otrosCostosInput) || otrosCostosInput < 0) {
      return res.status(400).json({ error: 'otros_costos debe ser un numero mayor o igual a 0' });
    }

    if (!Number.isFinite(totalInput) || totalInput < 0) {
      return res.status(400).json({ error: 'total debe ser un numero mayor o igual a 0' });
    }

    const servicios = await fetchServiciosRows([id], 'WHERE s.id = $1');
    if (servicios.length === 0) {
      return res.status(404).json({ error: 'Servicio no encontrado' });
    }

    const servicio = servicios[0];
    const canOperateServicio = isComprasOperatorUser(req.user);
    const isOwner = Number(servicio.id_usuario) === Number(req.user.id);

    if (!isOwner && !canOperateServicio) {
      return res.status(403).json({ error: 'No autorizado para completar este servicio' });
    }

    if (!isOwner) {
      const hasFinalApproval = await hasEffectiveFinalApprovalByRole(pool, {
        tipo: 'SERVICIO',
        referenciaId: id,
        roleId: 7,
      });

      if (!hasFinalApproval) {
        return res.status(400).json({ error: 'El servicio aun no tiene aprobacion final de gerencia de finanzas' });
      }
    }

    if (normalize(servicio.estado_aprobacion) !== 'APROBADO') {
      return res.status(400).json({ error: 'Solo se pueden completar datos en servicios APROBADOS' });
    }

    if (normalize(servicio.estado_flujo) === 'REALIZADO') {
      return res.status(400).json({ error: 'No se pueden editar datos cuando el servicio ya fue realizado' });
    }

    const providerExists = await pool.query(
      `
        SELECT
          p.id,
          COALESCE(upper(trim(COALESCE(to_jsonb(p)->>'retencion', 'NO'))), 'NO') AS retencion,
          COALESCE(NULLIF(upper(trim(COALESCE(to_jsonb(p)->>'tipo_retencion', ''))), ''), 'RETENCION') AS tipo_retencion,
          COALESCE(NULLIF(COALESCE(to_jsonb(p)->>'descuento', ''), '')::numeric, 0) AS retencion_pct,
          NULLIF(COALESCE(to_jsonb(p)->>'id_moneda', ''), '')::int AS id_moneda,
          COALESCE(mo.nombre, '') AS moneda_nombre
        FROM proveedores p
        LEFT JOIN monedas mo ON mo.id = NULLIF(COALESCE(to_jsonb(p)->>'id_moneda', ''), '')::int
        WHERE p.id = $1
        LIMIT 1
      `,
      [providerId]
    );

    if (providerExists.rows.length === 0) {
      return res.status(400).json({ error: 'proveedor_id no existe en proveedores' });
    }

    const providerRow = providerExists.rows[0] || {};
    const providerRetencionFlag = normalize(providerRow.retencion) === 'SI';
    const tipoRetencionInput = ['RETENCION', 'DETRACCION'].includes(normalize(providerRow.tipo_retencion || ''))
      ? normalize(providerRow.tipo_retencion)
      : 'RETENCION';
    const retencionPct = Number(providerRow.retencion_pct || 0);
    const monedaNorm = normalizeRoleName(providerRow.moneda_nombre || 'PEN');
    const isUsd = monedaNorm.includes('USD') || monedaNorm.includes('DOLAR');
    const isPen = monedaNorm.includes('PEN') || monedaNorm.includes('SOL');
    const totalBase = Number((subtotalInput + igvInput + costoEnvioInput + otrosCostosInput).toFixed(2));
    const totalBaseSoles = isUsd ? Number((totalBase * 3.5).toFixed(2)) : totalBase;
    const superaUmbral = (isPen && totalBase > 700) || (isUsd && totalBaseSoles > 700);
    const aplicaRetencion = providerRetencionFlag && retencionPct > 0 && superaUmbral;
    const montoRetencion = aplicaRetencion
      ? Number((totalBase * (retencionPct / 100)).toFixed(2))
      : 0;
    const totalFinal = aplicaRetencion
      ? Number((totalBase - montoRetencion).toFixed(2))
      : totalBase;
    const retencionInput = aplicaRetencion ? retencionPct : 0;

    const providerIdColumn = getServicioProviderIdColumn();
    const statusColumn = getServicioStatusColumn();
    const nameColumn = getServicioNameColumn();
    const descriptionColumn = getServicioDescriptionColumn();
    const subtotalColumn = getServicioSubtotalColumn();
    const igvColumn = getServicioIgvColumn();
    const costoEnvioColumn = getServicioCostoEnvioColumn();
    const otrosCostosColumn = getServicioOtrosCostosColumn();
    const totalColumn = getServicioTotalColumn();
    const aplicaRetencionColumn = getServicioAplicaRetencionColumn();
    const retencionColumn = getServicioRetencionColumn();
    const tipoRetencionColumn = getServicioTipoRetencionColumn();
    const monedaIdColumn = getServicioCurrencyIdColumn();

    const setClauses = [
      `${quoteIdentifier(providerIdColumn)} = $1`,
      `${quoteIdentifier(subtotalColumn || 'subtotal')} = $2`,
      `${quoteIdentifier(igvColumn || 'igv')} = $3`,
      `${quoteIdentifier(costoEnvioColumn || 'costo_envio')} = $4`,
      `${quoteIdentifier(otrosCostosColumn || 'otros_costos')} = $5`,
      `${quoteIdentifier(totalColumn || 'total')} = $6`,
      `${quoteIdentifier(statusColumn)} = $7`,
    ];

    if (monedaIdColumn && Number(providerRow.id_moneda || 0) > 0) {
      setClauses.push(`${quoteIdentifier(monedaIdColumn)} = $${setClauses.length + 1}`);
    }

    const nombreServicioInput = String(req.body?.nombre_servicio ?? req.body?.nombre ?? '').trim();
    const descripcionServicioInput = String(req.body?.descripcion_servicio ?? req.body?.descripcion ?? '').trim();
    const values = [providerId, subtotalInput, igvInput, costoEnvioInput, otrosCostosInput, totalFinal, 'DATOS_COMPLETADOS'];

    if (monedaIdColumn && Number(providerRow.id_moneda || 0) > 0) {
      values.push(Number(providerRow.id_moneda || 0));
    }

    if (nameColumn) {
      setClauses.push(`${quoteIdentifier(nameColumn)} = $${values.length + 1}`);
      values.push(nombreServicioInput);
    }

    if (descriptionColumn) {
      setClauses.push(`${quoteIdentifier(descriptionColumn)} = $${values.length + 1}`);
      values.push(descripcionServicioInput);
    }

    if (aplicaRetencionColumn) {
      setClauses.push(`${quoteIdentifier(aplicaRetencionColumn)} = $${values.length + 1}`);
      values.push(aplicaRetencion);
    }

    if (retencionColumn) {
      setClauses.push(`${quoteIdentifier(retencionColumn)} = $${values.length + 1}`);
      values.push(aplicaRetencion ? retencionInput : 0);
    }

    if (tipoRetencionColumn) {
      setClauses.push(`${quoteIdentifier(tipoRetencionColumn)} = $${values.length + 1}`);
      values.push(tipoRetencionInput);
    }

    values.push(id);

    await pool.query(
      `
        UPDATE servicios
        SET ${setClauses.join(', ')}
        WHERE id = $${values.length}
      `,
      values
    );

    const updated = await fetchServiciosRows([id], 'WHERE s.id = $1');
    res.json(updated[0]);
  } catch (error) {
    if (String(error?.code || '') === '23514') {
      return res.status(400).json({ error: 'Violacion de restriccion CHECK en servicios' });
    }

    res.status(500).json({ error: error.message });
  }
});

app.post('/api/servicios/:id/generar-orden', authMiddleware, async (req, res) => {
  try {
    if (schemaMeta.serviciosColumns.size === 0) {
      return res.status(400).json({ error: 'La tabla servicios no esta disponible' });
    }

    const { id } = req.params;
    const servicios = await fetchServiciosRows([id], 'WHERE s.id = $1');
    if (servicios.length === 0) {
      return res.status(404).json({ error: 'Servicio no encontrado' });
    }

    const servicio = servicios[0];
    const canOperateServicio = isComprasOperatorUser(req.user);
    const isOwner = Number(servicio.id_usuario) === Number(req.user.id);

    if (!isOwner && !canOperateServicio) {
      return res.status(403).json({ error: 'No autorizado para generar orden de este servicio' });
    }

    if (!isOwner) {
      const hasFinalApproval = await hasEffectiveFinalApprovalByRole(pool, {
        tipo: 'SERVICIO',
        referenciaId: id,
        roleId: 7,
      });

      if (!hasFinalApproval) {
        return res.status(400).json({ error: 'El servicio aun no tiene aprobacion final de gerencia de finanzas' });
      }
    }

    if (normalize(servicio.estado_aprobacion) !== 'APROBADO') {
      return res.status(400).json({ error: 'Solo se puede generar orden para servicios APROBADOS' });
    }

    const completionData = await pool.query(
      `
        SELECT
          NULLIF(COALESCE(to_jsonb(s)->>'proveedor_id', to_jsonb(s)->>'id_proveedor', ''), '')::int AS proveedor_id,
          NULLIF(COALESCE(to_jsonb(s)->>'subtotal', ''), '')::numeric AS subtotal,
          NULLIF(COALESCE(to_jsonb(s)->>'total', ''), '')::numeric AS total
        FROM servicios s
        WHERE s.id = $1
        LIMIT 1
      `,
      [id]
    );

    const completionRow = completionData.rows[0] || {};
    if (!Number(completionRow.proveedor_id || 0) || completionRow.subtotal == null || completionRow.total == null) {
      return res.status(400).json({ error: 'No se puede generar PDF. Completa proveedor, subtotal y total.' });
    }

    if (normalize(servicio.estado_flujo || servicio.estado_servicio) !== 'DATOS_COMPLETADOS') {
      return res.status(400).json({ error: 'Primero guarda los datos del servicio antes de generar la orden.' });
    }

    const statusColumn = getServicioStatusColumn();
    await pool.query(
      `
        UPDATE servicios
        SET ${quoteIdentifier(statusColumn)} = 'PENDIENTE'
        WHERE id = $1
      `,
      [id]
    );

    const refreshedServicios = await fetchServiciosRows([id], 'WHERE s.id = $1');
    const refreshedServicio = refreshedServicios[0] || servicio;
    refreshedServicio.aprobadores = await fetchApprovedApproversByEntity(pool, {
      tipo: 'SERVICIO',
      referenciaId: refreshedServicio.id,
    });
    refreshedServicio.historial_aprobaciones = await fetchApprovalHistoryByEntity(pool, {
      tipo: 'SERVICIO',
      referenciaId: refreshedServicio.id,
    });

    const pdfBase64 = await buildServicioPdfBase64(refreshedServicio);

    res.json({
      id: refreshedServicio.id,
      servicio: refreshedServicio,
      archivo: {
        nombre: `servicio_${refreshedServicio.id}.pdf`,
        mime: 'application/pdf',
        base64: pdfBase64,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/servicios/:id/pdf', authMiddleware, async (req, res) => {
  try {
    if (schemaMeta.serviciosColumns.size === 0) {
      return res.status(400).json({ error: 'La tabla servicios no esta disponible' });
    }

    const { id } = req.params;
    const servicios = await fetchServiciosRows([id], 'WHERE s.id = $1');
    if (servicios.length === 0) {
      return res.status(404).json({ error: 'Servicio no encontrado' });
    }

    const servicio = servicios[0];
    const canOperateServicio = isComprasOperatorUser(req.user);
    const isOwner = Number(servicio.id_usuario) === Number(req.user.id);

    if (!isOwner && !canOperateServicio) {
      return res.status(403).json({ error: 'No autorizado para descargar este PDF' });
    }

    if (!isOwner) {
      const hasFinalApproval = await hasEffectiveFinalApprovalByRole(pool, {
        tipo: 'SERVICIO',
        referenciaId: id,
        roleId: 7,
      });

      if (!hasFinalApproval) {
        return res.status(400).json({ error: 'El servicio aun no tiene aprobacion final de gerencia de finanzas' });
      }
    }

    const completionData = await pool.query(
      `
        SELECT
          NULLIF(COALESCE(to_jsonb(s)->>'proveedor_id', to_jsonb(s)->>'id_proveedor', ''), '')::int AS proveedor_id,
          NULLIF(COALESCE(to_jsonb(s)->>'subtotal', ''), '')::numeric AS subtotal,
          NULLIF(COALESCE(to_jsonb(s)->>'total', ''), '')::numeric AS total
        FROM servicios s
        WHERE s.id = $1
        LIMIT 1
      `,
      [id]
    );

    const completionRow = completionData.rows[0] || {};
    if (!Number(completionRow.proveedor_id || 0) || completionRow.subtotal == null || completionRow.total == null) {
      return res.status(400).json({ error: 'No se puede descargar PDF. Completa proveedor, subtotal y total.' });
    }

    servicio.aprobadores = await fetchApprovedApproversByEntity(pool, {
      tipo: 'SERVICIO',
      referenciaId: servicio.id,
    });
    servicio.historial_aprobaciones = await fetchApprovalHistoryByEntity(pool, {
      tipo: 'SERVICIO',
      referenciaId: servicio.id,
    });

    const pdfBase64 = await buildServicioPdfBase64(servicio);
    const pdfBuffer = Buffer.from(pdfBase64, 'base64');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="servicio_${servicio.id}.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/compras/:id/pdf', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const compras = await fetchComprasRows([id], 'WHERE c.id = $1');
    if (compras.length === 0) {
      return res.status(404).json({ error: 'Compra no encontrada' });
    }

    const compra = compras[0];

    const canOperateCompra = isComprasOperatorUser(req.user) || canManageDeliveryRole(req.user?.rol);
    const isOwner = Number(compra.id_usuario) === Number(req.user.id);

    if (!isOwner && !canOperateCompra) {
      return res.status(403).json({ error: 'No autorizado para descargar PDF de esta compra' });
    }

    if (!isOwner) {
      const hasFinalApproval = await hasEffectiveFinalApprovalByRole(pool, {
        tipo: 'COMPRA',
        referenciaId: id,
        roleId: 7,
      });

      if (!hasFinalApproval) {
        return res.status(400).json({ error: 'La compra aun no tiene aprobacion final de gerencia de finanzas' });
      }
    }

    compra.aprobadores = await fetchApprovedApproversByEntity(pool, {
      tipo: 'COMPRA',
      referenciaId: compra.id,
    });
    compra.historial_aprobaciones = await fetchApprovalHistoryByEntity(pool, {
      tipo: 'COMPRA',
      referenciaId: compra.id,
    });

    const pdfBase64 = await buildCompraPdfBase64(compra);
    const pdfBuffer = Buffer.from(pdfBase64, 'base64');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="orden_compra_${compra.id}.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/stats', authMiddleware, async (req, res) => {
  try {
    const [matStats, reqStats] = await Promise.all([
      pool.query(
        `
          SELECT
            COUNT(*) AS total_materiales,
            COALESCE(SUM(cantidad), 0) AS stock_total
          FROM stock
        `
      ),
      pool.query(
        `
          SELECT
            COUNT(*) AS total_requerimientos,
            COUNT(CASE WHEN estado = 'PENDIENTE' THEN 1 END) AS pendientes,
            COUNT(CASE WHEN estado = 'APROBADO' THEN 1 END) AS aprobados,
            COUNT(CASE WHEN estado = 'RECHAZADO' THEN 1 END) AS rechazados,
            COUNT(CASE WHEN estado = 'COMPLETADO' THEN 1 END) AS completados
          FROM requerimientos
        `
      ),
    ]);

    res.json({
      ...matStats.rows[0],
      ...reqStats.rows[0],
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin-dashboard', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const USD_TO_PEN_RATE = 3.4;
    const fechaInicioRaw = String(req.query?.fecha_inicio || '').trim();
    const fechaFinRaw = String(req.query?.fecha_fin || '').trim();
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

    const fechaInicio = fechaInicioRaw ? (dateRegex.test(fechaInicioRaw) ? fechaInicioRaw : null) : null;
    const fechaFin = fechaFinRaw ? (dateRegex.test(fechaFinRaw) ? fechaFinRaw : null) : null;

    if (fechaInicioRaw && !fechaInicio) {
      return res.status(400).json({ error: 'fecha_inicio invalida. Usa formato YYYY-MM-DD' });
    }
    if (fechaFinRaw && !fechaFin) {
      return res.status(400).json({ error: 'fecha_fin invalida. Usa formato YYYY-MM-DD' });
    }
    if (fechaInicio && fechaFin && fechaInicio > fechaFin) {
      return res.status(400).json({ error: 'fecha_inicio no puede ser mayor que fecha_fin' });
    }

    const hasRangeFilter = Boolean(fechaInicio || fechaFin);
    let areaIds = null;

    if (hasRangeFilter) {
      const areasResult = await pool.query(
        `
          WITH movimientos_filtrados AS (
            SELECT
              NULLIF(
                COALESCE(
                  NULLIF(to_jsonb(m)->>'id_requerimiento', ''),
                  NULLIF(to_jsonb(m)->>'requerimiento_id', ''),
                  ''
                ),
                ''
              )::int AS id_requerimiento,
              CASE
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
              END AS usuario_id,
              COALESCE(
                NULLIF(to_jsonb(m)->>'fecha_movimiento', '')::timestamp,
                NULLIF(to_jsonb(m)->>'fecha', '')::timestamp,
                NOW()
              )::date AS fecha_mov
            FROM movimientos m
          ),
          areas_activas AS (
            SELECT DISTINCT
              COALESCE(
                NULLIF(to_jsonb(r)->>'id_area', '')::int,
                ur.id_area,
                um.id_area
              ) AS area_id
            FROM movimientos_filtrados mf
            LEFT JOIN requerimientos r ON r.id = mf.id_requerimiento
            LEFT JOIN usuarios ur ON ur.id = NULLIF(to_jsonb(r)->>'id_usuario', '')::int
            LEFT JOIN usuarios um ON um.id = mf.usuario_id
            WHERE ($1::date IS NULL OR mf.fecha_mov >= $1::date)
              AND ($2::date IS NULL OR mf.fecha_mov <= $2::date)
            
            UNION
            
            SELECT DISTINCT
              NULLIF(COALESCE(to_jsonb(s)->>'id_area', to_jsonb(s)->>'area_id', ''), '')::int AS area_id
            FROM servicios s
          )
          SELECT area_id
          FROM areas_activas
          WHERE area_id IS NOT NULL
        `,
        [fechaInicio, fechaFin]
      );

      areaIds = [...new Set(areasResult.rows.map((row) => Number(row.area_id || 0)).filter((id) => id > 0))];

      if (areaIds.length === 0) {
        return res.json({
          filtro_fechas: {
            fecha_inicio: fechaInicio || '',
            fecha_fin: fechaFin || '',
          },
          resumen: {
            total_compras: 0,
            total_requerimientos: 0,
            total_servicios: 0,
            monto_total_compras: 0,
          },
          compras_por_area: [],
          requerimientos_por_area: [],
          servicios_por_area: [],
          materiales_mas_utilizados: [],
          distribucion_salida_por_area: [],
          gasto_salida_por_area: [],
          cantidad_materiales_recibidos_por_area: [],
        });
      }
    }

    const params = areaIds && areaIds.length > 0 ? [areaIds] : [];
    const comprasWhere = areaIds && areaIds.length > 0
      ? `WHERE COALESCE(NULLIF(to_jsonb(c)->>'id_area_final', '')::int, NULLIF(to_jsonb(c)->>'id_area_solicitante', '')::int) = ANY($1::int[])`
      : '';
    const reqWhere = areaIds && areaIds.length > 0
      ? `WHERE COALESCE(NULLIF(to_jsonb(r)->>'id_area', '')::int, u.id_area) = ANY($1::int[])`
      : '';
    const servWhere = areaIds && areaIds.length > 0
      ? `WHERE NULLIF(COALESCE(to_jsonb(s)->>'id_area', to_jsonb(s)->>'area_id', ''), '')::int = ANY($1::int[])`
      : '';

    const materialPrecioColumn = pickExistingColumn(schemaMeta.materialesColumns, ['costo_unitario', 'precio_unitario', 'costo']);
    const materialPrecioExpr = materialPrecioColumn
      ? `COALESCE(NULLIF(to_jsonb(mat)->>'${materialPrecioColumn}', '')::numeric, 0)`
      : '0::numeric';
    const servicioMontoColumn = pickExistingColumn(schemaMeta.serviciosColumns, ['total', 'subtotal', 'costo', 'importe', 'monto']);
    const servicioMontoExpr = servicioMontoColumn
      ? `COALESCE(NULLIF(to_jsonb(s)->>'${servicioMontoColumn}', '')::numeric, 0)`
      : '0::numeric';
    const movimientosSalidaCte = `
      WITH movimientos_salida AS (
        SELECT
          m.id AS id_movimiento,
          NULLIF(
            COALESCE(
              NULLIF(to_jsonb(m)->>'id_requerimiento', ''),
              NULLIF(to_jsonb(m)->>'requerimiento_id', ''),
              ''
            ),
            ''
          )::int AS id_requerimiento,
          CASE
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
          END AS usuario_id,
          COALESCE(
            NULLIF(to_jsonb(m)->>'fecha_movimiento', '')::timestamp,
            NULLIF(to_jsonb(m)->>'fecha', '')::timestamp,
            NOW()
          )::date AS fecha_mov
        FROM movimientos m
        WHERE upper(trim(NULLIF(to_jsonb(m)->>'tipo', ''))) = 'SALIDA'
      ),
      movimientos_enriquecidos AS (
        SELECT
          ms.id_movimiento,
          ms.fecha_mov,
          COALESCE(a_req.nombre, a_mov.nombre, 'Sin area') AS area_destino
        FROM movimientos_salida ms
        LEFT JOIN requerimientos r ON r.id = ms.id_requerimiento
        LEFT JOIN usuarios ur ON ur.id = NULLIF(to_jsonb(r)->>'id_usuario', '')::int
        LEFT JOIN areas a_req ON a_req.id = COALESCE(NULLIF(to_jsonb(r)->>'id_area', '')::int, ur.id_area)
        LEFT JOIN usuarios um ON um.id = ms.usuario_id
        LEFT JOIN areas a_mov ON a_mov.id = um.id_area
        WHERE (CAST($1 AS date) IS NULL OR ms.fecha_mov >= CAST($1 AS date))
          AND (CAST($2 AS date) IS NULL OR ms.fecha_mov <= CAST($2 AS date))
      )
    `;

    const [
      totalsRows,
      comprasAreaRows,
      reqAreaRows,
      serviciosAreaRows,
      serviciosMontoRows,
      dashboardMovimientosRows,
      topProvidersRows,
      worstProvidersRows,
    ] = await Promise.all([
      pool.query(
        `
          SELECT
            (
              SELECT COUNT(*)
              FROM compras c
              ${comprasWhere}
            ) AS total_compras,
            (
              SELECT COUNT(*)
              FROM requerimientos r
              LEFT JOIN usuarios u ON u.id = NULLIF(to_jsonb(r)->>'id_usuario', '')::int
              ${reqWhere}
            ) AS total_requerimientos,
            (
              SELECT COUNT(*)
              FROM servicios s
              ${servWhere}
            ) AS total_servicios,
            (
              SELECT COALESCE(SUM(
                CASE 
                  WHEN NULLIF(to_jsonb(c)->>'id_moneda', '')::int = 2 
                    THEN NULLIF(to_jsonb(c)->>'total_importe', '')::numeric * ${USD_TO_PEN_RATE}
                  ELSE NULLIF(to_jsonb(c)->>'total_importe', '')::numeric
                END
              ), 0)
              FROM compras c
              ${comprasWhere}
            ) AS monto_total_compras,
            COALESCE((
              SELECT SUM(
                CASE 
                  WHEN NULLIF(to_jsonb(s)->>'moneda_id', '')::int = 2 
                    THEN ${servicioMontoExpr} * ${USD_TO_PEN_RATE}
                  ELSE ${servicioMontoExpr}
                END
              )
              FROM servicios s
              ${servWhere}
            ), 0)
            +
            COALESCE((
              SELECT SUM(COALESCE(md.cantidad, 0)::numeric * 
                CASE 
                  WHEN NULLIF(to_jsonb(mat)->>'id_moneda', '')::int = 2 
                    THEN COALESCE(NULLIF(to_jsonb(mat)->>'${materialPrecioColumn}', '')::numeric, 0) * ${USD_TO_PEN_RATE}
                  ELSE COALESCE(NULLIF(to_jsonb(mat)->>'${materialPrecioColumn}', '')::numeric, 0)
                END
              )
              FROM movimientos mov
              INNER JOIN movimiento_detalles md ON mov.id = md.id_movimiento
              INNER JOIN materiales mat ON md.id_material = mat.id
              WHERE upper(trim(COALESCE(to_jsonb(mov)->>'tipo_movimiento', COALESCE(to_jsonb(mov)->>'tipo', 'N/D')))) = 'SALIDA'
                AND (${fechaInicio ? `COALESCE(NULLIF(to_jsonb(mov)->>'fecha_movimiento', '')::date, NULLIF(to_jsonb(mov)->>'fecha', '')::date) >= '${fechaInicio}'::date` : '1=1'})
                AND (${fechaFin ? `COALESCE(NULLIF(to_jsonb(mov)->>'fecha_movimiento', '')::date, NULLIF(to_jsonb(mov)->>'fecha', '')::date) <= '${fechaFin}'::date` : '1=1'})
            ), 0) AS monto_total_consumo,
            (
              SELECT COALESCE(SUM(
                COALESCE(md.cantidad, 0)::numeric
              ), 0)
              FROM movimientos mov
              INNER JOIN movimiento_detalles md ON mov.id = md.id_movimiento
              WHERE upper(trim(NULLIF(to_jsonb(mov)->>'tipo', ''))) = 'ENTRADA'
                AND (${fechaInicio ? `COALESCE(NULLIF(to_jsonb(mov)->>'fecha_movimiento', '')::date, NULLIF(to_jsonb(mov)->>'fecha', '')::date) >= '${fechaInicio}'::date` : '1=1'})
                AND (${fechaFin ? `COALESCE(NULLIF(to_jsonb(mov)->>'fecha_movimiento', '')::date, NULLIF(to_jsonb(mov)->>'fecha', '')::date) <= '${fechaFin}'::date` : '1=1'})
            ) AS total_entradas_movimientos,
            (
              SELECT COALESCE(SUM(
                COALESCE(md.cantidad, 0)::numeric
              ), 0)
              FROM movimientos mov
              INNER JOIN movimiento_detalles md ON mov.id = md.id_movimiento
              WHERE upper(trim(NULLIF(to_jsonb(mov)->>'tipo', ''))) = 'SALIDA'
                AND (${fechaInicio ? `COALESCE(NULLIF(to_jsonb(mov)->>'fecha_movimiento', '')::date, NULLIF(to_jsonb(mov)->>'fecha', '')::date) >= '${fechaInicio}'::date` : '1=1'})
                AND (${fechaFin ? `COALESCE(NULLIF(to_jsonb(mov)->>'fecha_movimiento', '')::date, NULLIF(to_jsonb(mov)->>'fecha', '')::date) <= '${fechaFin}'::date` : '1=1'})
            ) AS total_salidas_movimientos
        `,
        params
      ),
      pool.query(
        `
          SELECT
            COALESCE(a.nombre, 'Sin area') AS area,
            COUNT(*)::int AS total,
            COALESCE(SUM(
              CASE 
                WHEN NULLIF(to_jsonb(c)->>'id_moneda', '')::int = 2 
                  THEN NULLIF(to_jsonb(c)->>'total_importe', '')::numeric * ${USD_TO_PEN_RATE}
                ELSE NULLIF(to_jsonb(c)->>'total_importe', '')::numeric
              END
            ), 0) AS monto_total
          FROM compras c
          LEFT JOIN areas a ON a.id = COALESCE(
            NULLIF(to_jsonb(c)->>'id_area_final', '')::int,
            NULLIF(to_jsonb(c)->>'id_area_solicitante', '')::int
          )
          ${comprasWhere}
          GROUP BY COALESCE(a.nombre, 'Sin area')
          ORDER BY COUNT(*) DESC, monto_total DESC
          LIMIT 8
        `,
        params
      ),
      pool.query(
        `
          SELECT
            COALESCE(a.nombre, 'Sin area') AS area,
            COUNT(*)::int AS total
          FROM requerimientos r
          LEFT JOIN usuarios u ON u.id = NULLIF(to_jsonb(r)->>'id_usuario', '')::int
          LEFT JOIN areas a ON a.id = COALESCE(NULLIF(to_jsonb(r)->>'id_area', '')::int, u.id_area)
          ${reqWhere}
          GROUP BY COALESCE(a.nombre, 'Sin area')
          ORDER BY COUNT(*) DESC
          LIMIT 8
        `,
        params
      ),
      pool.query(
        `
          SELECT
            COALESCE(a.nombre, 'Sin area') AS area,
            COUNT(*)::int AS total
          FROM servicios s
          LEFT JOIN areas a ON a.id = NULLIF(COALESCE(to_jsonb(s)->>'id_area', to_jsonb(s)->>'area_id', ''), '')::int
          ${servWhere}
          GROUP BY COALESCE(a.nombre, 'Sin area')
          ORDER BY COUNT(*) DESC
          LIMIT 8
        `,
        params
      ),
      pool.query(
        `
          SELECT
            COALESCE(a.nombre, 'Sin area') AS area,
            COUNT(*)::int AS total,
            COALESCE(SUM(
              CASE 
                WHEN NULLIF(to_jsonb(s)->>'moneda_id', '')::int = 2 
                  THEN ${servicioMontoExpr} * ${USD_TO_PEN_RATE}
                ELSE ${servicioMontoExpr}
              END
            ), 0) AS monto_total
          FROM servicios s
          LEFT JOIN areas a ON a.id = NULLIF(COALESCE(to_jsonb(s)->>'id_area', to_jsonb(s)->>'area_id', ''), '')::int
          ${servWhere}
          GROUP BY COALESCE(a.nombre, 'Sin area')
          ORDER BY COUNT(*) DESC, monto_total DESC
          LIMIT 8
        `,
        params
      ),
      pool.query(
        `
          ${movimientosSalidaCte}
          , detalle_salida AS (
            SELECT
              me.area_destino AS area,
              me.fecha_mov,
              md.id_material,
              COALESCE(mat.nombre, CONCAT('Material #', md.id_material::text), 'Sin material') AS material,
              COALESCE(md.cantidad, 0)::numeric AS cantidad,
              CASE
                WHEN NULLIF(to_jsonb(mat)->>'id_moneda', '')::int = 2
                  THEN ${materialPrecioExpr} * ${USD_TO_PEN_RATE}
                ELSE ${materialPrecioExpr}
              END AS precio
            FROM movimientos_enriquecidos me
            JOIN movimiento_detalles md ON md.id_movimiento = me.id_movimiento
            LEFT JOIN materiales mat ON mat.id = md.id_material
          ),
          materiales_rank AS (
            SELECT
              material,
              SUM(cantidad) AS cantidad_total_salida
            FROM detalle_salida
            GROUP BY material
            ORDER BY SUM(cantidad) DESC
            LIMIT 8
          ),
          areas_totales AS (
            SELECT
              area,
              SUM(cantidad) AS cantidad_total_salida,
              ROUND(SUM(cantidad * precio), 2) AS total_gastado
            FROM detalle_salida
            GROUP BY area
          ),
          distribucion AS (
            SELECT
              area,
              cantidad_total_salida,
              CASE
                WHEN SUM(cantidad_total_salida) OVER () > 0
                  THEN ROUND((cantidad_total_salida * 100.0) / SUM(cantidad_total_salida) OVER (), 2)
                ELSE 0
              END AS porcentaje
            FROM areas_totales
            ORDER BY cantidad_total_salida DESC
            LIMIT 8
          ),
          gasto AS (
            SELECT
              area,
              total_gastado
            FROM areas_totales
            ORDER BY total_gastado DESC
            LIMIT 8
          ),
          cantidad AS (
            SELECT
              area,
              cantidad_total_salida AS total_materiales_recibidos
            FROM areas_totales
            ORDER BY cantidad_total_salida DESC
            LIMIT 8
          )
          SELECT
            COALESCE((
              SELECT json_agg(json_build_object(
                'material', material,
                'cantidad_total_salida', cantidad_total_salida
              ) ORDER BY cantidad_total_salida DESC)
              FROM materiales_rank
            ), '[]'::json) AS materiales_mas_utilizados,
            COALESCE((
              SELECT json_agg(json_build_object(
                'area', area,
                'cantidad_total_salida', cantidad_total_salida,
                'porcentaje', porcentaje
              ) ORDER BY cantidad_total_salida DESC)
              FROM distribucion
            ), '[]'::json) AS distribucion_salida_por_area,
            COALESCE((
              SELECT json_agg(json_build_object(
                'area', area,
                'total_gastado', total_gastado
              ) ORDER BY total_gastado DESC)
              FROM gasto
            ), '[]'::json) AS gasto_salida_por_area,
            COALESCE((
              SELECT json_agg(json_build_object(
                'area', area,
                'total_materiales_recibidos', total_materiales_recibidos
              ) ORDER BY total_materiales_recibidos DESC)
              FROM cantidad
            ), '[]'::json) AS cantidad_materiales_recibidos_por_area
        `,
        [fechaInicio, fechaFin]
      ),
      pool.query(
        `
          SELECT
            COALESCE(p.nombre, 'Proveedor desconocido') AS proveedor,
            cp.id_proveedor,
            ROUND(AVG(cp.puntuacion)::numeric, 2) AS promedio_puntuacion,
            COUNT(*)::int AS total_calificaciones
          FROM calificaciones_proveedor cp
          LEFT JOIN proveedores p ON p.id = cp.id_proveedor
          WHERE lower(trim(COALESCE(cp.tipo, ''))) IN ('compra', 'servicio')
          GROUP BY COALESCE(p.nombre, 'Proveedor desconocido'), cp.id_proveedor
          ORDER BY promedio_puntuacion DESC NULLS LAST, total_calificaciones DESC
          LIMIT 5
        `
      ),
      pool.query(
        `
          SELECT
            COALESCE(p.nombre, 'Proveedor desconocido') AS proveedor,
            cp.id_proveedor,
            ROUND(AVG(cp.puntuacion)::numeric, 2) AS promedio_puntuacion,
            COUNT(*)::int AS total_calificaciones
          FROM calificaciones_proveedor cp
          LEFT JOIN proveedores p ON p.id = cp.id_proveedor
          WHERE lower(trim(COALESCE(cp.tipo, ''))) IN ('compra', 'servicio')
          GROUP BY COALESCE(p.nombre, 'Proveedor desconocido'), cp.id_proveedor
          ORDER BY promedio_puntuacion ASC NULLS LAST, total_calificaciones DESC
          LIMIT 5
        `
      ),
    ]);

    const totals = totalsRows.rows[0] || {};
    const dashboardMovimientos = dashboardMovimientosRows.rows[0] || {};

    res.json({
      filtro_fechas: {
        fecha_inicio: fechaInicio || '',
        fecha_fin: fechaFin || '',
      },
      resumen: {
        total_compras: Number(totals.total_compras || 0),
        total_requerimientos: Number(totals.total_requerimientos || 0),
        total_servicios: Number(totals.total_servicios || 0),
        monto_total_compras: Number(totals.monto_total_compras || 0),
        monto_total_requerimientos: Number((dashboardMovimientos.gasto_salida_por_area || []).reduce((sum, row) => sum + Number(row.total_gastado || 0), 0)),
        monto_total_servicios: Number((serviciosMontoRows.rows || []).reduce((sum, row) => sum + Number(row.monto_total || 0), 0)),
        monto_total_consumo: Number(totals.monto_total_consumo || 0),
        total_entradas_movimientos: Number(totals.total_entradas_movimientos || 0),
        total_salidas_movimientos: Number(totals.total_salidas_movimientos || 0),
      },
      compras_por_area: comprasAreaRows.rows.map((row) => ({
        area: row.area,
        total: Number(row.total || 0),
        monto_total: Number(row.monto_total || 0),
      })),
      requerimientos_por_area: reqAreaRows.rows.map((row) => ({
        area: row.area,
        total: Number(row.total || 0),
      })),
      servicios_por_area: serviciosAreaRows.rows.map((row) => ({
        area: row.area,
        total: Number(row.total || 0),
        monto_total: Number((serviciosMontoRows.rows.find((item) => item.area === row.area) || {}).monto_total || 0),
      })),
      materiales_mas_utilizados: (Array.isArray(dashboardMovimientos.materiales_mas_utilizados)
        ? dashboardMovimientos.materiales_mas_utilizados
        : []).map((row) => ({
        material: row.material,
        cantidad_total_salida: Number(row.cantidad_total_salida || 0),
      })),
      distribucion_salida_por_area: (Array.isArray(dashboardMovimientos.distribucion_salida_por_area)
        ? dashboardMovimientos.distribucion_salida_por_area
        : []).map((row) => ({
        area: row.area,
        cantidad_total_salida: Number(row.cantidad_total_salida || 0),
        porcentaje: Number(row.porcentaje || 0),
      })),
      gasto_salida_por_area: (Array.isArray(dashboardMovimientos.gasto_salida_por_area)
        ? dashboardMovimientos.gasto_salida_por_area
        : []).map((row) => ({
        area: row.area,
        total_gastado: Number(row.total_gastado || 0),
      })),
      cantidad_materiales_recibidos_por_area: (Array.isArray(dashboardMovimientos.cantidad_materiales_recibidos_por_area)
        ? dashboardMovimientos.cantidad_materiales_recibidos_por_area
        : []).map((row) => ({
        area: row.area,
        total_materiales_recibidos: Number(row.total_materiales_recibidos || 0),
      })),
      proveedores_top_rated: topProvidersRows.rows.map((row) => ({
        proveedor: String(row.proveedor || 'Proveedor desconocido').trim(),
        id_proveedor: Number(row.id_proveedor || 0),
        promedio_puntuacion: Number(row.promedio_puntuacion || 0),
        total_calificaciones: Number(row.total_calificaciones || 0),
      })),
      proveedores_worst_rated: worstProvidersRows.rows.map((row) => ({
        proveedor: String(row.proveedor || 'Proveedor desconocido').trim(),
        id_proveedor: Number(row.id_proveedor || 0),
        promedio_puntuacion: Number(row.promedio_puntuacion || 0),
        total_calificaciones: Number(row.total_calificaciones || 0),
      })),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 5000;

const isPortInUse = (port) => new Promise((resolve) => {
  const socket = new net.Socket();

  socket.setTimeout(1000);
  socket.once('connect', () => {
    socket.destroy();
    resolve(true);
  });
  socket.once('timeout', () => {
    socket.destroy();
    resolve(false);
  });
  socket.once('error', () => {
    resolve(false);
  });

  socket.connect(port, '127.0.0.1');
});

const startServer = async () => {
  if (configuredDbHost !== effectiveDbHost) {
    console.warn(`DB_HOST=${configuredDbHost} no es resolvible desde Windows host. Usando ${effectiveDbHost} temporalmente.`);
  }

  await loadSchemaMeta();
  await ensureCoreApprovalPermissions();
  await loadApprovalChainsFromConfig();
  if (String(process.env.RUN_DEMO_SEED || 'false').toLowerCase() === 'true') {
    await seedInventoryDemoData();
  }

  if (await isPortInUse(PORT)) {
    console.error(`El puerto ${PORT} ya esta en uso. Si el backend ya esta corriendo, usa esa instancia o libera el puerto antes de iniciar otra.`);
    process.exit(1);
    return;
  }

  const server = app.listen(PORT, () => {
    console.log(`Servidor ejecutandose en http://localhost:${PORT}`);
    console.log(`Base de datos: ${process.env.DB_NAME}`);
    console.log(`Host BD en uso: ${effectiveDbHost}`);
    console.log('Modo empresarial: materiales+stock+requerimientos+movimientos');
  });

  if (String(process.env.RUN_SCHEMA_BOOTSTRAP || '').toLowerCase() === 'true') {
    void (async () => {
      try {
        await ensureRequerimientosColumns();
        await ensureComprasColumns();
        await ensureMovimientosColumns();
        console.log('Bootstrap de esquema completado');
      } catch (error) {
        console.error('Error en bootstrap de esquema:', error.message);
      }
    })();
  }

  server.on('error', (error) => {
    if (error && error.code === 'EADDRINUSE') {
      console.error(`El puerto ${PORT} ya esta en uso. Cierra la instancia previa del backend antes de iniciar otra.`);
      process.exit(1);
      return;
    }

    console.error('Error inesperado del servidor:', error.message);
    process.exit(1);
  });
};

startServer().catch((error) => {
  console.error('Error iniciando servidor:', error.message);
  process.exit(1);
});

