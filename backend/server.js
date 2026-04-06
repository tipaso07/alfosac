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

const APPROVAL_ROLES_BY_LEVEL = [5, 6, 7];
let approvalsTableAvailableCache = null;

const normalizeApprovalTipo = (value) => normalize(value).replace(/\s+/g, '_');

const getApprovalChainByCreatorRole = (creatorRoleId) => {
  const roleId = Number(creatorRoleId || 0);
  if (roleId === 4) return [5, 6, 7];
  if (roleId === 5) return [6, 7];
  if (roleId === 6) return [7];
  if (roleId === 7) return [];
  return [...APPROVAL_ROLES_BY_LEVEL];
};

const isApprovalHierarchyRoleId = (roleId) => APPROVAL_ROLES_BY_LEVEL.includes(Number(roleId || 0));

const APPROVAL_ROLE_ID_BY_NAME = new Map([
  [normalizeRoleName('JEFE DE AREA/SUBGERENTE'), 5],
  [normalizeRoleName('GERENCIA DEL AREA'), 6],
  [normalizeRoleName('GERENCIA DE FINANZAS'), 7],
]);

const resolveApprovalRoleId = (user) => {
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
        AND upper(trim(COALESCE(a.estado, 'PENDIENTE'))) = 'PENDIENTE'
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

  if (finalRole !== 7 || !reference) {
    return false;
  }

  if (normalizedTipo === 'COMPRA') {
    const autoApproved = await client.query(
      `
        SELECT 1
        FROM compras c
        JOIN usuarios u ON u.id = c.id_usuario
        WHERE c.id = $1
          AND ${getUserRoleIdExpr('u')} = 7
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
          AND ${getUserRoleIdExpr('u')} = 7
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
  const pendingRole = Number(nextPendingRole || 0);
  if (pendingRole > 0) {
    return `PENDIENTE APROBACION ROL ${pendingRole}`;
  }

  const statusNorm = normalize(currentStatus);
  if (['APROBADA', 'APROBADO', 'POR_RECIBIR', 'RECIBIDA', 'RECIBIDO', 'ENTREGADO', 'REALIZADO', 'DATOS_COMPLETADOS'].includes(statusNorm)) {
    return 'APROBADO DEFINITIVO';
  }

  if (['RECHAZADA', 'RECHAZADO'].includes(statusNorm)) {
    return 'RECHAZADO';
  }

  return statusNorm || 'PENDIENTE';
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
  const numericRoleId = Number(user?.id_role || user?.rol_id || 0);
  return isAdminRole(user?.rol) || isComprasRole(user?.rol) || numericRoleId === 9;
};

const createApprovalRowsForEntity = async (client, {
  tipo,
  referenciaId,
  creatorRoleId,
}) => {
  const tableExists = await hasAprobacionesTable(client);
  if (!tableExists) {
    return { usesApprovalTable: false, autoApproved: false };
  }

  const normalizedTipo = normalizeApprovalTipo(tipo);
  const reference = Number(referenciaId || 0);
  const roleChain = getApprovalChainByCreatorRole(creatorRoleId);

  if (!reference) {
    throw new Error('referencia_id invalido para crear aprobaciones');
  }

  if (roleChain.length === 0) {
    return { usesApprovalTable: true, autoApproved: true };
  }

  await client.query('DELETE FROM aprobaciones WHERE upper(trim(tipo)) = $1 AND referencia_id = $2', [normalizedTipo, reference]);

  for (let idx = 0; idx < roleChain.length; idx += 1) {
    await client.query(
      `
        INSERT INTO aprobaciones (tipo, referencia_id, orden, rol_aprobador, estado)
        VALUES ($1, $2, $3, $4, 'PENDIENTE')
      `,
      [normalizedTipo, reference, idx + 1, roleChain[idx]]
    );
  }

  return { usesApprovalTable: true, autoApproved: false };
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
        AND upper(trim(COALESCE(a.estado, 'PENDIENTE'))) = 'PENDIENTE'
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

const applyApprovalDecision = async (client, {
  tipo,
  referenciaId,
  roleId,
  userId,
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

  if (!['APROBADO', 'RECHAZADO'].includes(normalizedDecision)) {
    throw new Error('decision de aprobacion invalida');
  }

  const pendingByRole = await client.query(
    `
      SELECT id, orden
      FROM aprobaciones
      WHERE upper(trim(tipo)) = $1
        AND referencia_id = $2
        AND rol_aprobador = $3
        AND upper(trim(COALESCE(estado, 'PENDIENTE'))) = 'PENDIENTE'
      ORDER BY orden ASC
      LIMIT 1
      FOR UPDATE
    `,
    [normalizedTipo, reference, role]
  );

  if (pendingByRole.rows.length === 0) {
    throw new Error('No tienes una aprobacion pendiente para este registro');
  }

  const targetApproval = pendingByRole.rows[0];

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

  await client.query(
    `
      UPDATE aprobaciones
      SET estado = $1,
          usuario_id = $2,
          fecha = NOW()
      WHERE id = $3
    `,
    [normalizedDecision, actor || null, Number(targetApproval.id)]
  );

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

  if (!tableExists) {
    return [];
  }

  const rows = await client.query(
    `
      SELECT
        a.orden,
        a.rol_aprobador,
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
        aprobador: row.aprobador || '',
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
        aprobador: row.aprobador || '',
        fecha: row.fecha || null,
      }));
    }
  }

  return rows.rows.map((row) => ({
    orden: Number(row.orden || 0),
    rol_aprobador: Number(row.rol_aprobador || 0),
    rol: row.rol || '',
    aprobador: row.aprobador || '',
    fecha: row.fecha || null,
  }));
};

const RECEIPT_NOTE_PREFIX = '[[RECIBIDO_POR:';
const ITEM_CATEGORY_NOTE_PREFIX = '[[ITEM_CATEGORIAS:';
const AREA_DELIVERY_NOTE_PREFIX = '[[ENTREGA_AREA:';

const normalizeItemCategoryKey = (value) => String(value || '').trim().toLowerCase();

const parsePurchaseComments = (value) => {
  let text = String(value || '').trim();
  let recibidoPor = '';
  let itemCategorias = {};
  let entregaArea = null;

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
  };
};

const buildPurchaseComment = ({ comentarios = '', recibidoPor = '', itemCategorias = {}, entregaArea = null } = {}) => {
  let text = String(comentarios || '').trim();

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
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#1f4e79').text(title, left, doc.y, { width: usableWidth });
    doc.moveDown(0.2);
    doc.moveTo(left, doc.y).lineTo(pageWidth - right, doc.y).strokeColor('#d1d5db').lineWidth(0.8).stroke();
    doc.moveDown(0.5);
  };

  const writeLabelValue = (label, value, width = usableWidth) => {
    ensureSpace(24);
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#334155').text(`${label}:`, left, doc.y, { width });
    doc.font('Helvetica').fontSize(9).fillColor('#111827').text(safeText(value), {
      width,
      align: 'left',
    });
    doc.moveDown(0.25);
  };

  const drawHeader = () => {
    doc.font('Helvetica-Bold').fontSize(18).fillColor('#1f4e79').text('ALFOSAC', left, 28, { width: usableWidth, align: 'left' });
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#1f4e79').text('ORDEN DE COMPRA', left, 28, { width: usableWidth, align: 'right' });
    doc.font('Helvetica').fontSize(9).fillColor('#334155').text(`Dirección: ${companyAddress}`, left, 52, { width: usableWidth, align: 'left' });
    doc.text(`RUC: ${companyRuc}`, left, 64, { width: usableWidth, align: 'left' });
    doc.text(`Sitio Web: ${companyWeb}`, left, 76, { width: usableWidth, align: 'left' });
    doc.moveTo(left, 90).lineTo(pageWidth - right, 90).strokeColor('#cbd5e1').lineWidth(0.8).stroke();
    doc.y = 98;
  };

  doc.on('data', (chunk) => chunks.push(chunk));
  doc.on('error', reject);
  doc.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));

  doc.on('pageAdded', () => {
    doc.y = 90;
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

  writeSectionTitle('Información de la orden');
  writeLabelValue('Número de orden', compra.numero_orden || `OC-${compra.id}`);
  writeLabelValue('Fecha', new Date(compra.fecha_creacion || Date.now()).toLocaleDateString());
  writeLabelValue('Área solicitante', compra.area_solicitante);
  writeLabelValue('Área destino', compra.area_final);
  writeLabelValue('Solicitante', compra.usuario);

  writeSectionTitle('Datos del proveedor');
  writeLabelValue('Razón social', compra.proveedor || compra.razon_social);
  writeLabelValue('RUC', compra.ruc);
  writeLabelValue('Dirección', compra.direccion);
  writeLabelValue('Distrito', compra.distrito);
  writeLabelValue('Banco', compra.banco);
  writeLabelValue('Cuenta', compra.cuenta || compra.numero_cuenta);
  writeLabelValue('CCI', compra.cci);
  writeLabelValue('Condiciones de pago', compra.condiciones_pago);

  writeSectionTitle('Materiales');
  const items = Array.isArray(compra.items) ? compra.items : [];
  const tableTop = doc.y;
  const colWidths = [30, 220, 60, 100, 100];
  const headers = ['#', 'Descripción', 'Cantidad', 'Precio Unitario', 'Total'];
  let x = left;
  let rowY = tableTop;

  doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f172a');
  headers.forEach((header, index) => {
    doc.rect(x, rowY, colWidths[index], 18).strokeColor('#cbd5e1').lineWidth(0.6).stroke();
    doc.text(header, x + 4, rowY + 5, { width: colWidths[index] - 8, align: index === 0 || index === 2 || index === 3 || index === 4 ? 'center' : 'left' });
    x += colWidths[index];
  });

  rowY += 18;
  doc.font('Helvetica').fontSize(8.5).fillColor('#111827');
  items.forEach((item, index) => {
    const qty = Number(item.cantidad || 0);
    const unit = Number(item.precio_unitario || 0);
    const total = Number((qty * unit).toFixed(2));
    const rowHeight = Math.max(18, doc.heightOfString(safeText(item.material || item.descripcion || item.nombre), { width: colWidths[1] - 8 }) + 8);
    ensureSpace(rowHeight + 12);
    x = left;
    const cells = [
      String(index + 1),
      safeText(item.material || item.descripcion || item.nombre),
      String(qty),
      `S/ ${unit.toFixed(2)}`,
      `S/ ${total.toFixed(2)}`,
    ];
    cells.forEach((cell, cellIndex) => {
      doc.rect(x, rowY, colWidths[cellIndex], rowHeight).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
      doc.text(cell, x + 4, rowY + 4, {
        width: colWidths[cellIndex] - 8,
        align: cellIndex === 0 || cellIndex === 2 || cellIndex === 3 || cellIndex === 4 ? 'center' : 'left',
      });
      x += colWidths[cellIndex];
    });
    rowY += rowHeight;
  });

  doc.y = rowY + 12;
  writeSectionTitle('Detalle financiero');
  writeLabelValue('Subtotal', money(subtotal, compra.moneda));
  writeLabelValue('IGV', money(igv, compra.moneda));
  writeLabelValue('Costo envío', money(costoEnvio, compra.moneda));
  writeLabelValue('Otros costos', money(otrosCostos, compra.moneda));
  writeLabelValue('Total base', money(totalBase, compra.moneda));
  writeLabelValue('Retención aplicada', aplicaRetencion ? 'SÍ' : 'NO');
  writeLabelValue('Porcentaje', `${porcentajeRetencion.toFixed(2)}%`);
  writeLabelValue('Monto retenido', money(montoRetenido, compra.moneda));
  writeLabelValue('Total final', money(totalFinal, compra.moneda));

  writeSectionTitle('Información adicional');
  writeLabelValue('Correo', compra.correo || compra.contacto_proveedor);
  writeLabelValue('Persona responsable', compra.persona_responsable || compra.contacto_proveedor);
  writeLabelValue('Teléfono', compra.telefono);
  const approversSummary = Array.isArray(compra.aprobadores)
    ? compra.aprobadores
      .map((row) => `${row.orden}. ${safeText(row.rol || `Rol ${row.rol_aprobador || ''}`)} - ${safeText(row.aprobador || 'Pendiente')}`)
      .join(' | ')
    : '';
  writeLabelValue('Aprobaciones', approversSummary || 'Sin aprobaciones registradas');
  writeLabelValue('Comentarios', compra.comentarios);

  doc.moveDown(1);
  doc.font('Helvetica').fontSize(8).fillColor('#334155').text(
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
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#0f766e').text(title, left, doc.y, { width: usableWidth });
    doc.moveDown(0.2);
    doc.moveTo(left, doc.y).lineTo(pageWidth - right, doc.y).strokeColor('#d1d5db').lineWidth(0.8).stroke();
    doc.moveDown(0.5);
  };

  const estimateBlockHeight = (rows = []) => {
    let total = 26;
    rows.forEach(([label, value]) => {
      const labelHeight = doc.heightOfString(`${safeText(label)}:`, { width: 86, align: 'left' });
      const valueHeight = doc.heightOfString(safeText(value), { width: 136, align: 'left' });
      total += Math.max(labelHeight, valueHeight) + 6;
    });
    return total + 10;
  };

  const drawInfoBlock = ({ title, rows, x, y, width }) => {
    const rowGap = 6;
    const paddingX = 10;
    const paddingY = 8;
    const titleHeight = 18;
    const labelWidth = Math.max(72, Math.floor(width * 0.34));
    const valueWidth = width - (paddingX * 2) - labelWidth - 8;

    let contentHeight = 0;
    rows.forEach(([label, value]) => {
      const labelHeight = doc.heightOfString(`${safeText(label)}:`, { width: labelWidth, align: 'left' });
      const valueHeight = doc.heightOfString(safeText(value), { width: valueWidth, align: 'left' });
      contentHeight += Math.max(labelHeight, valueHeight) + rowGap;
    });

    const blockHeight = titleHeight + (paddingY * 2) + contentHeight;

    doc.rect(x, y, width, blockHeight).fillAndStroke('#f8fafc', '#dbe3ec');
    doc.rect(x, y, width, titleHeight).fillAndStroke('#e2e8f0', '#dbe3ec');
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f172a').text(title, x + paddingX, y + 5, {
      width: width - (paddingX * 2),
    });

    let rowY = y + titleHeight + paddingY;
    rows.forEach(([label, value]) => {
      const textLabel = `${safeText(label)}:`;
      const textValue = safeText(value);
      const labelHeight = doc.heightOfString(textLabel, { width: labelWidth, align: 'left' });
      const valueHeight = doc.heightOfString(textValue, { width: valueWidth, align: 'left' });
      const rowHeight = Math.max(labelHeight, valueHeight);

      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#334155').text(textLabel, x + paddingX, rowY, {
        width: labelWidth,
      });
      doc.font('Helvetica').fontSize(8.5).fillColor('#111827').text(textValue, x + paddingX + labelWidth + 8, rowY, {
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

      cursorY = pairBottom + 10;
      doc.y = cursorY;
    }
  };

  const drawHeader = () => {
    doc.font('Helvetica-Bold').fontSize(18).fillColor('#1f4e79').text('ALFOSAC', left, 28, { width: usableWidth, align: 'left' });
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#1f4e79').text('ORDEN DE SERVICIO', left, 28, { width: usableWidth, align: 'right' });
    doc.font('Helvetica').fontSize(9).fillColor('#334155').text(`Dirección: ${companyAddress}`, left, 52, { width: usableWidth, align: 'left' });
    doc.text(`RUC: ${companyRuc}`, left, 64, { width: usableWidth, align: 'left' });
    doc.text(`Sitio Web: ${companyWeb}`, left, 76, { width: usableWidth, align: 'left' });
    doc.moveTo(left, 90).lineTo(pageWidth - right, 90).strokeColor('#cbd5e1').lineWidth(0.8).stroke();
    doc.y = 98;
  };

  doc.on('data', (chunk) => chunks.push(chunk));
  doc.on('error', reject);
  doc.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));

  doc.on('pageAdded', () => {
    doc.y = 90;
  });

  drawHeader();

  const subtotal = Number((servicio.subtotal ?? servicio.costo) || 0);
  const igv = Number(servicio.igv || 0);
  const costoEnvio = Number(servicio.costo_envio || 0);
  const otrosCostos = Number(servicio.otros_costos || 0);
  const totalBase = Number((subtotal + igv + costoEnvio + otrosCostos).toFixed(2));
  const aplicaRetencion = Boolean(servicio.aplica_retencion);
  const porcentajeRetencion = Number(servicio.proveedor_retencion_pct || servicio.retencion || 0);
  const montoRetenido = aplicaRetencion ? Number((totalBase * (porcentajeRetencion / 100)).toFixed(2)) : 0;
  const totalFinal = Number(servicio.total || totalBase);

  writeSectionTitle('Resumen general');
  renderTwoColumnBlocks([
    {
      title: 'Información de la orden',
      rows: [
        ['Número de orden', servicio.numero_orden || `OS-${servicio.id}`],
        ['Fecha', new Date(servicio.fecha || Date.now()).toLocaleDateString()],
        ['Área destino', servicio.area],
        ['Solicitante', servicio.usuario],
        ['Prioridad', servicio.prioridad],
        ['Estado', normalize(servicio.estado_flujo || servicio.estado_servicio) === 'PENDIENTE' ? 'PENDIENTE DE REALIZACION' : (servicio.estado_flujo || servicio.estado_servicio)],
      ],
    },
    {
      title: 'Servicio',
      rows: [
        ['Nombre', servicio.nombre_servicio || servicio.descripcion_servicio],
        ['Descripcion', servicio.descripcion_servicio],
        ['Estado aprobación', servicio.estado_aprobacion],
      ],
    },
    {
      title: 'Datos del proveedor',
      rows: [
        ['Razón social', servicio.proveedor],
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
      rows: Array.isArray(servicio.aprobadores) && servicio.aprobadores.length > 0
        ? servicio.aprobadores.map((row) => ([
          `Nivel ${row.orden}`,
          `${safeText(row.rol || `Rol ${row.rol_aprobador || ''}`)} - ${safeText(row.aprobador || 'Pendiente')}`,
        ]))
        : [['Estado', 'Sin aprobaciones registradas']],
    },
  ]);

  doc.moveDown(1);
  doc.font('Helvetica').fontSize(8).fillColor('#334155').text(
    'Si tienes dudas sobre el servicio u orden de compra, contactar a:\ncompras@alfosac.pe\n+51 978772509',
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

const getUserRoleIdExpr = (tableAlias) =>
  `NULLIF(COALESCE(to_jsonb(${tableAlias})->>'id_role', to_jsonb(${tableAlias})->>'id_rol', ''), '')::int`;

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
        ${servicioProviderExpr} AS proveedor_id,
        ${servicioAreaExpr} AS area_id,
        ${servicioMonedaExpr} AS moneda_id,
        COALESCE(NULLIF(COALESCE(to_jsonb(s)->>'nombre_servicio', to_jsonb(s)->>'nombre', to_jsonb(s)->>'titulo', ''), ''), '') AS nombre_servicio,
        COALESCE(NULLIF(COALESCE(to_jsonb(s)->>'prioridad', to_jsonb(s)->>'nivel_prioridad', 'MEDIA'), ''), 'MEDIA') AS prioridad,
        COALESCE(NULLIF(COALESCE(to_jsonb(s)->>'descripcion_servicio', to_jsonb(s)->>'descripcion', to_jsonb(s)->>'comentario', ''), ''), '') AS descripcion_servicio,
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
        COALESCE(u.nombre, 'Sin usuario') AS usuario
      FROM servicios s
      LEFT JOIN proveedores p ON p.id = ${servicioProviderExpr}
      LEFT JOIN monedas pm ON pm.id = NULLIF(COALESCE(to_jsonb(p)->>'id_moneda', ''), '')::int
      LEFT JOIN areas a ON a.id = ${servicioAreaExpr}
      LEFT JOIN monedas mo ON mo.id = ${servicioMonedaExpr}
      LEFT JOIN usuarios u ON u.id = ${servicioUserExpr}
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

  const servicios = result.rows;

  const approvalRoleId = Number(options?.approvalRoleId || 0);
  if (approvalRoleId > 0) {
    const actionableIds = await fetchActionableApprovalReferenceIds(pool, {
      tipo: 'SERVICIO',
      roleId: approvalRoleId,
      referenceIds: servicios.map((row) => Number(row.id || 0)),
    });

    servicios.forEach((row) => {
      const canApprove = actionableIds.has(Number(row.id || 0)) && normalize(row.estado_aprobacion) === 'PENDIENTE';
      row.puede_aprobar = canApprove;
      row.puede_rechazar = canApprove;
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

const loadSchemaMeta = async () => {
  schemaMeta.proveedoresColumns = await getColumnSet('proveedores');
  schemaMeta.comprasColumns = await getColumnSet('compras');
  schemaMeta.detalleComprasColumns = await getColumnSet('detalle_compras');
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
          descripcion,
          retencion,
          categoria,
          descuento,
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
    let validPassword = storedPassword === providedPassword;

    if (!validPassword && /^\$2[aby]\$\d{2}\$/.test(storedPassword)) {
      console.log('[AUTH][LOGIN] password legacy detectado para usuario:', user.id);
      validPassword = await bcrypt.compare(providedPassword, storedPassword);

      if (validPassword) {
        await pool.query(`UPDATE usuarios SET ${quoteIdentifier(schemaMeta.usuariosPasswordColumn)} = $1 WHERE id = $2`, [providedPassword, user.id]);
        console.log('[AUTH][LOGIN] password migrado a texto plano para usuario:', user.id);
      }
    }

    if (!validPassword) {
      return res.status(401).json({ error: 'Credenciales invalidas' });
    }

    const token = createAuthToken(user);

    res.json({
      token,
      token_type: 'Bearer',
      expires_in: JWT_EXPIRES_IN,
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

app.get('/api/roles', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, nombre FROM roles ORDER BY id');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
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
    const { nombre, email, id_role, id_area, password, estado } = req.body;
    const userRoleColumn = getUserRoleIdColumn();

    if (!nombre || !String(nombre).trim()) {
      return res.status(400).json({ error: 'Nombre es requerido' });
    }

    if (!email || !String(email).trim()) {
      return res.status(400).json({ error: 'Email es requerido' });
    }

    if (!password || !String(password).trim()) {
      return res.status(400).json({ error: 'Contraseña es requerida' });
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

    const emailCheck = await pool.query('SELECT id FROM usuarios WHERE email = $1', [email]);
    if (emailCheck.rows.length > 0) {
      return res.status(400).json({ error: 'Email ya existe' });
    }

    const plainPassword = String(password).trim();

    const result = await pool.query(
      `
        INSERT INTO usuarios (nombre, email, password_hash, ${userRoleColumn}, id_area, estado)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, nombre, email, ${userRoleColumn} AS id_role, id_area, estado
      `,
      [
        String(nombre).trim(),
        String(email).trim().toLowerCase(),
        plainPassword,
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
    const { nombre, email, id_role, id_area, estado } = req.body;
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
        RETURNING id, nombre, email, ${userRoleColumn} AS id_role, id_area, estado
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

    const userCheck = await pool.query('SELECT id FROM usuarios WHERE id = $1', [userId]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const plainPassword = String(password).trim();

    await pool.query(
      'UPDATE usuarios SET password_hash = $1 WHERE id = $2',
      [plainPassword, userId]
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

app.post('/api/upload/material', authMiddleware, requireCompras, (req, res) => {
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

app.get('/api/materiales', authMiddleware, async (req, res) => {
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
          GREATEST(COALESCE(rr.cantidad_requerida, 0) - COALESCE(sr.stock_total, 0), 0) AS stock_seguridad,
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

app.post('/api/materiales', authMiddleware, requireAdmin, async (req, res) => {
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
    } = req.body;

    if (!nombre || !id_unidad || !id_proveedor) {
      return res.status(400).json({
        error: 'nombre, id_unidad e id_proveedor son obligatorios',
      });
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
          to_regclass('public.material_categoria') IS NOT NULL AS has_material_categoria
      `
    );
    const hasCategorias = Boolean(tableFlags.rows[0]?.has_categorias);
    const hasMaterialCategoria = Boolean(tableFlags.rows[0]?.has_material_categoria);

    const categoriaNombre = String(categoria || '').trim();
    let idCategoria = id_categoria === null || id_categoria === undefined || id_categoria === ''
      ? null
      : Number(id_categoria);

    if (idCategoria !== null && (!Number.isInteger(idCategoria) || idCategoria <= 0)) {
      return res.status(400).json({ error: 'id_categoria debe ser valido o NULL' });
    }

    if ((idCategoria !== null || categoriaNombre) && !hasCategorias) {
      return res.status(400).json({ error: 'La tabla categorias no esta disponible' });
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

    const result = await client.query(
      `
        INSERT INTO materiales (nombre, descripcion, id_unidad, id_proveedor, id_moneda, id_categoria)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, nombre, descripcion, id_unidad, id_proveedor, id_moneda, id_categoria
      `,
      [nombre, descripcion || null, idUnidad, idProveedor, idMoneda, idCategoria]
    );

    const materialId = Number(result.rows[0]?.id || 0);
    if (materialId > 0 && idCategoria && hasMaterialCategoria) {
      await client.query(
        'INSERT INTO material_categoria (id_material, id_categoria) VALUES ($1, $2) ON CONFLICT (id_material, id_categoria) DO NOTHING',
        [materialId, idCategoria]
      );
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

app.put('/api/materiales/:id', authMiddleware, requireCompras, async (req, res) => {
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
      imagen,
    } = req.body;

    const nombreNorm = String(nombre || '').trim();
    const descripcionNorm = String(descripcion || '').trim();
    const idUnidad = Number(id_unidad || 0);
    const idProveedor = Number(id_proveedor || 0);
    const costoValue = Number(costo_unitario);
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

    await client.query('COMMIT');

    res.json({
      id: Number(id),
      nombre: nombreNorm,
      descripcion: descripcionNorm || null,
      id_unidad: idUnidad,
      id_proveedor: idProveedor,
      id_moneda: idMoneda,
      id_categoria: idCategoria,
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
          s.cantidad
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
        acc[key] = {
          id: row.id,
          estado: row.estado,
          estado_entrega: row.estado_entrega,
          nombre_receptor: row.nombre_receptor,
          dni_receptor: row.dni_receptor,
          prioridad: row.prioridad,
          descripcion: row.descripcion,
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

app.get('/api/proveedores', authMiddleware, async (req, res) => {
  try {
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

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/monedas', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `
        SELECT id, nombre
        FROM monedas
        ORDER BY nombre ASC, id ASC
      `
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/proveedores', authMiddleware, requireRoleAdminOrCompras, async (req, res) => {
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

app.put('/api/proveedores/:id', authMiddleware, requireRoleAdminOrCompras, async (req, res) => {
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

app.post('/api/requerimientos', authMiddleware, async (req, res) => {
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
          movimiento_detalles.id_material,
          materiales.nombre AS material,
          movimiento_detalles.cantidad
        FROM movimientos_base mb
        LEFT JOIN usuarios ON usuarios.id = CASE
          WHEN mb.usuario_ref ~ '^\\d+$' THEN mb.usuario_ref::int
          ELSE NULL
        END
        LEFT JOIN areas ON areas.id = usuarios.id_area
        LEFT JOIN movimiento_detalles ON movimiento_detalles.id_movimiento = mb.id
        LEFT JOIN materiales ON materiales.id = movimiento_detalles.id_material
        ORDER BY mb.id DESC
      `
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
          id_material: row.id_material,
          material: row.material,
          cantidad: Number(row.cantidad),
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
      const isOtherArea = Boolean(areaDestinoNorm && areaDestinoNorm !== 'GENERAL');
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
        comentarios: parsedComments.comentarios,
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
        COALESCE(upper(trim(COALESCE(to_jsonb(c)->>'estado', ''))), 'PENDIENTE') AS estado,
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
        COALESCE(NULLIF(to_jsonb(c)->>'aplica_retencion', '')::boolean, false) AS aplica_retencion,
        COALESCE(to_jsonb(c)->>'tipo', '') AS tipo,
        COALESCE(to_jsonb(c)->>'tipo_retencion', '') AS tipo_retencion,
        COALESCE(NULLIF(to_jsonb(c)->>'importe_final', '')::numeric, 0) AS importe_final,
        COALESCE(to_jsonb(c)->>'condiciones_pago', '') AS condiciones_pago,
        COALESCE(NULLIF(to_jsonb(c)->>'subtotal', '')::numeric, 0) AS subtotal,
        COALESCE(NULLIF(to_jsonb(c)->>'costo_envio', '')::numeric, 0) AS costo_envio,
        COALESCE(NULLIF(to_jsonb(c)->>'otros_costos', '')::numeric, 0) AS otros_costos,
        COALESCE(NULLIF(to_jsonb(c)->>'igv', '')::numeric, 0) AS igv,
        COALESCE(NULLIF(to_jsonb(c)->>'total', '')::numeric, 0) AS total,
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

  const approvalRoleId = Number(options?.approvalRoleId || 0);
  if (approvalRoleId > 0) {
    const actionableIds = await fetchActionableApprovalReferenceIds(pool, {
      tipo: 'COMPRA',
      roleId: approvalRoleId,
      referenceIds: compras.map((row) => Number(row.id || 0)),
    });

    compras.forEach((row) => {
      const canApprove = actionableIds.has(Number(row.id || 0)) && normalize(row.estado) === 'PENDIENTE';
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
    const canSeeAllPurchases = isAdminRole(userRole)
      || isComprasRole(userRole)
      || canManagePurchasesRole(userRole)
      || canManageDeliveryRole(userRole);
    const roleId = resolveApprovalRoleId(req.user);

    if (isApprovalHierarchyRoleId(roleId)) {
      const pendingReferenceIds = await fetchPendingApprovalReferenceIdsByRole(pool, {
        tipo: 'COMPRA',
        roleId,
      });
      const managedByUser = await fetchManagedApprovalStatesByUser(pool, {
        tipo: 'COMPRA',
        roleId,
        userId: Number(req.user?.id || 0),
      });

      const autoApprovedOwnIds = roleId === 7
        ? await fetchAutoApprovedByCreatorRoleIds(pool, {
          tipo: 'COMPRA',
          creatorRoleId: 7,
          creatorUserId: Number(req.user?.id || 0),
        })
        : [];

      const ownCreatedApprovedIds = [5, 6].includes(roleId)
        ? await fetchOwnCreatedByRoleIds(pool, {
          tipo: 'COMPRA',
          creatorRoleId: roleId,
          creatorUserId: Number(req.user?.id || 0),
        })
        : [];

      const referenceIds = [...new Set([
        ...pendingReferenceIds,
        ...managedByUser.keys(),
        ...ownCreatedApprovedIds,
        ...autoApprovedOwnIds,
      ])];

      if (referenceIds.length === 0) {
        return res.json([]);
      }

      const compras = await fetchComprasRows(
        [referenceIds],
        'WHERE c.id = ANY($1::int[])',
        { approvalRoleId: roleId }
      );

      const pendingSet = new Set(pendingReferenceIds);
      const ownCreatedSet = new Set(ownCreatedApprovedIds);
      const autoApprovedSet = new Set(autoApprovedOwnIds);
      compras.forEach((row) => {
        const id = Number(row.id || 0);
        if (pendingSet.has(id)) {
          row.gestion_estado_usuario = 'PENDIENTE';
          return;
        }

        if (ownCreatedSet.has(id)) {
          row.gestion_estado_usuario = 'APROBADA';
          return;
        }

        if (autoApprovedSet.has(id)) {
          row.gestion_estado_usuario = 'APROBADA';
          return;
        }

        const managedState = String(managedByUser.get(id) || '');
        row.gestion_estado_usuario = managedState === 'APROBADO'
          ? 'APROBADA'
          : (managedState === 'RECHAZADO' ? 'RECHAZADA' : 'PENDIENTE');
      });

      return res.json(compras);
    }

    const compras = canSeeAllPurchases
      ? await fetchComprasRows([], '', { approvalRoleId: roleId })
      : await fetchComprasRows([req.user.id], 'WHERE c.id_usuario = $1', { approvalRoleId: roleId });

    res.json(compras);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/mis-compras', authMiddleware, async (req, res) => {
  try {
    const roleId = resolveApprovalRoleId(req.user);

    // Mis ordenes para roles jerarquicos: solo solicitudes que deben gestionar o ya gestionaron.
    if (isApprovalHierarchyRoleId(roleId)) {
      const pendingReferenceIds = await fetchPendingApprovalReferenceIdsByRole(pool, {
        tipo: 'COMPRA',
        roleId,
      });
      const managedByUser = await fetchManagedApprovalStatesByUser(pool, {
        tipo: 'COMPRA',
        roleId,
        userId: Number(req.user?.id || 0),
      });

      const referenceIds = [...new Set([
        ...pendingReferenceIds,
        ...managedByUser.keys(),
      ])];

      if (referenceIds.length === 0) {
        return res.json([]);
      }

      const comprasJerarquicas = await fetchComprasRows(
        [referenceIds],
        'WHERE c.id = ANY($1::int[])',
        { approvalRoleId: roleId }
      );

      const pendingSet = new Set(pendingReferenceIds);
      comprasJerarquicas.forEach((row) => {
        const id = Number(row.id || 0);
        if (pendingSet.has(id)) {
          row.gestion_estado_usuario = 'PENDIENTE';
          return;
        }

        const managedState = String(managedByUser.get(id) || '');
        row.gestion_estado_usuario = managedState === 'APROBADO'
          ? 'APROBADA'
          : (managedState === 'RECHAZADO' ? 'RECHAZADA' : 'PENDIENTE');
      });

      return res.json(comprasJerarquicas);
    }

    if (isComprasOperatorUser(req.user)) {
      const finalApprovedIds = await fetchFinalApprovedReferenceIdsByRole(pool, {
        tipo: 'COMPRA',
        roleId: 7,
      });

      const autoApprovedByRole7 = await fetchAutoApprovedByCreatorRoleIds(pool, {
        tipo: 'COMPRA',
        creatorRoleId: 7,
      });

      const visibleIds = [...new Set([...finalApprovedIds, ...autoApprovedByRole7])];

      if (visibleIds.length === 0) {
        return res.json([]);
      }

      const comprasAprobadasFinales = await fetchComprasRows(
        [visibleIds],
        "WHERE c.id = ANY($1::int[]) AND upper(trim(COALESCE(to_jsonb(c)->>'estado', ''))) IN ('APROBADA', 'POR_RECIBIR', 'RECIBIDA', 'RECIBIDO', 'ENTREGADO')",
        { approvalRoleId: roleId }
      );

      return res.json(comprasAprobadasFinales);
    }

    const compras = await fetchComprasRows(
      [req.user.id],
      'WHERE c.id_usuario = $1',
      { approvalRoleId: roleId }
    );
    res.json(compras);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/compras', authMiddleware, async (req, res) => {
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
        VALUES ('PENDIENTE', $1, $2, $3, $4, $5, NOW(), NOW())
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

    const creatorRoleId = resolveApprovalRoleId(req.user);
    const approvalSetup = await createApprovalRowsForEntity(client, {
      tipo: 'COMPRA',
      referenciaId: idCompra,
      creatorRoleId,
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
      const decisionResult = await applyApprovalDecision(client, {
        tipo: 'COMPRA',
        referenciaId: id,
        roleId: resolveApprovalRoleId(req.user),
        userId: Number(req.user?.id || 0),
        decision: estado === 'APROBADA' ? 'APROBADO' : 'RECHAZADO',
      });

      if (decisionResult.rejected) {
        await client.query(
          `
            UPDATE compras
            SET estado = 'RECHAZADA',
                fecha_actualizacion = NOW()
            WHERE id = $1
          `,
          [id]
        );
      } else if (decisionResult.finalApproved) {
        await client.query(
          `
            UPDATE compras
            SET estado = 'APROBADA',
                fecha_actualizacion = NOW()
            WHERE id = $1
          `,
          [id]
        );
      }
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
    res.json(result[0]);
  } catch (error) {
    await client.query('ROLLBACK');
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

    if (normalize(row.estado) !== 'APROBADA') {
      return res.status(400).json({ error: 'Solo se pueden completar datos en compras APROBADAS' });
    }

    const payload = req.body || {};

    const parsedExistingComments = parsePurchaseComments(row.comentarios);
    const shouldReplaceVisibleComments = Object.prototype.hasOwnProperty.call(payload, 'comentarios');
    const visibleCommentsToPersist = shouldReplaceVisibleComments
      ? String(payload.comentarios || '').trim()
      : parsedExistingComments.comentarios;
    const comentariosPersist = buildPurchaseComment({
      comentarios: visibleCommentsToPersist,
      recibidoPor: parsedExistingComments.recibido_por,
      itemCategorias: parsedExistingComments.item_categorias,
      entregaArea: parsedExistingComments.entrega_area,
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

    const providerRetencionFlag = normalize(providerData?.retencion || 'NO') === 'SI';
    const descuentoNum = Number(providerData?.descuento ?? 0);
    if (!Number.isFinite(descuentoNum) || descuentoNum < 0) {
      return res.status(400).json({ error: 'retencion (%) debe ser numerica y >= 0' });
    }

    const tipoRetencionNorm = normalize(providerData?.tipo_retencion || 'RETENCION');
    if (!['RETENCION', 'DETRACCION'].includes(tipoRetencionNorm)) {
      return res.status(400).json({ error: 'tipo_retencion solo puede ser RETENCION o DETRACCION' });
    }

    const monedaNorm = normalize(monedaNombre);
    const isUsd = monedaNorm.includes('USD') || monedaNorm.includes('DOLAR');
    const isPen = monedaNorm.includes('PEN') || monedaNorm.includes('SOL');
    const totalBase = totalCalc;
    const totalEnSoles = isUsd ? Number((totalBase * 3.4).toFixed(2)) : totalBase;
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
            comentarios = $28,
            id_area_final = $29,
            fecha_actualizacion = NOW()
        WHERE id = $30
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
        String(descuentoNum),
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

    if (normalize(compra.estado) !== 'APROBADA') {
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

    await client.query(
      `
        UPDATE compras
        SET estado = 'POR_RECIBIR',
            numero_orden = $1,
            fecha_actualizacion = NOW()
        WHERE id = $2
      `,
      [orderCode, id]
    );

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
        nombre: `${finalCompra.numero_orden || `OC-${finalCompra.id}`}.pdf`,
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
          COALESCE(to_jsonb(compras)->>'estado', '') AS estado,
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
    const isOtherAreaDelivery = Boolean(areaDestinoNorm && areaDestinoNorm !== 'GENERAL');

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

    const idMovimientoEntrada = await insertMovimiento(client, {
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

    const entregaAreaPayload = isOtherAreaDelivery
      ? {
          pendiente: true,
          entregado: false,
          area_destino: areaRow.rows[0]?.area_destino_nombre || '',
          fecha_recepcion_almacen: new Date().toISOString(),
        }
      : null;

    const comentariosConRecepcion = buildPurchaseComment({
      comentarios: parsedCompraComments.comentarios,
      itemCategorias: itemCategoriesFromComments,
      recibidoPor: req.user.nombre || 'Usuario',
      entregaArea: entregaAreaPayload,
    });

    await client.query(
      'UPDATE compras SET estado = $1, comentarios = $2 WHERE id = $3',
      ['RECIBIDA', comentariosConRecepcion, id]
    );

    await client.query('COMMIT');

    const result = await fetchComprasRows([id], 'WHERE c.id = $1');
    res.json({
      ...result[0],
      receptor: null,
      movimientos_generados: movimientoIds,
      id_almacen_entrada: idAlmacen,
    });
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
    if (!canManageDeliveryRole(req.user?.rol)) {
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
          COALESCE(to_jsonb(compras)->>'estado', '') AS estado,
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
    if (!['RECIBIDA', 'RECIBIDO'].includes(estadoActual)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'La orden debe estar recibida en almacen antes de entregar al area' });
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
    if (!areaDestinoNorm || areaDestinoNorm === 'GENERAL') {
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

    if (detailRows.rows.length === 0) {
      throw new Error('La compra no tiene materiales vinculados para generar salida');
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
      throw new Error('No existe un almacen configurado para registrar entrega');
    }

    const idAlmacen = Number(defaultWarehouse.rows[0].id);
    const idMovimientoSalida = await insertMovimiento(client, {
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

      const stockRow = await client.query(
        'SELECT id, cantidad FROM stock WHERE id_material = $1 AND id_almacen = $2 FOR UPDATE',
        [idMaterial, idAlmacen]
      );

      if (stockRow.rows.length === 0 || Number(stockRow.rows[0].cantidad) < qty) {
        throw new Error(`Stock insuficiente para material ${idMaterial} al generar salida`);
      }

      await client.query('UPDATE stock SET cantidad = cantidad - $1 WHERE id = $2', [qty, stockRow.rows[0].id]);
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
    });

    await client.query(
      'UPDATE compras SET estado = $1, comentarios = $2 WHERE id = $3',
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
      movimientos_generados: [idMovimientoSalida],
      id_almacen_salida: idAlmacen,
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
    if (!areaNameNorm || areaNameNorm === 'GENERAL') {
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
    const canSeeAllServices = isAdminRole(userRole) || isComprasRole(userRole) || canManagePurchasesRole(userRole);
    const roleId = resolveApprovalRoleId(req.user);

    if (isApprovalHierarchyRoleId(roleId)) {
      const pendingReferenceIds = await fetchPendingApprovalReferenceIdsByRole(pool, {
        tipo: 'SERVICIO',
        roleId,
      });
      const managedByUser = await fetchManagedApprovalStatesByUser(pool, {
        tipo: 'SERVICIO',
        roleId,
        userId: Number(req.user?.id || 0),
      });

      const autoApprovedOwnIds = roleId === 7
        ? await fetchAutoApprovedByCreatorRoleIds(pool, {
          tipo: 'SERVICIO',
          creatorRoleId: 7,
          creatorUserId: Number(req.user?.id || 0),
        })
        : [];

      const ownCreatedApprovedIds = [5, 6].includes(roleId)
        ? await fetchOwnCreatedByRoleIds(pool, {
          tipo: 'SERVICIO',
          creatorRoleId: roleId,
          creatorUserId: Number(req.user?.id || 0),
        })
        : [];

      const referenceIds = [...new Set([
        ...pendingReferenceIds,
        ...managedByUser.keys(),
        ...ownCreatedApprovedIds,
        ...autoApprovedOwnIds,
      ])];

      if (referenceIds.length === 0) {
        return res.json([]);
      }

      const servicios = await fetchServiciosRows(
        [referenceIds],
        'WHERE s.id = ANY($1::int[])',
        { approvalRoleId: roleId }
      );

      const pendingSet = new Set(pendingReferenceIds);
      const ownCreatedSet = new Set(ownCreatedApprovedIds);
      const autoApprovedSet = new Set(autoApprovedOwnIds);
      servicios.forEach((row) => {
        const id = Number(row.id || 0);
        if (pendingSet.has(id)) {
          row.gestion_estado_usuario = 'PENDIENTE';
          return;
        }

        if (ownCreatedSet.has(id)) {
          row.gestion_estado_usuario = 'APROBADO';
          return;
        }

        if (autoApprovedSet.has(id)) {
          row.gestion_estado_usuario = 'APROBADO';
          return;
        }

        const managedState = String(managedByUser.get(id) || '');
        row.gestion_estado_usuario = managedState === 'APROBADO'
          ? 'APROBADO'
          : (managedState === 'RECHAZADO' ? 'RECHAZADO' : 'PENDIENTE');
      });

      return res.json(servicios);
    }

    const servicios = canSeeAllServices
      ? await fetchServiciosRows([], '', { approvalRoleId: roleId })
      : await fetchServiciosRows(
        [req.user.id],
        "WHERE NULLIF(COALESCE(to_jsonb(s)->>'id_usuario', to_jsonb(s)->>'usuario_id', ''), '')::int = $1",
        { approvalRoleId: roleId }
      );

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

    if (isApprovalHierarchyRoleId(roleId)) {
      const pendingReferenceIds = await fetchPendingApprovalReferenceIdsByRole(pool, {
        tipo: 'SERVICIO',
        roleId,
      });
      const managedByUser = await fetchManagedApprovalStatesByUser(pool, {
        tipo: 'SERVICIO',
        roleId,
        userId: Number(req.user?.id || 0),
      });

      const referenceIds = [...new Set([
        ...pendingReferenceIds,
        ...managedByUser.keys(),
      ])];

      if (referenceIds.length === 0) {
        return res.json([]);
      }

      const serviciosJerarquicos = await fetchServiciosRows(
        [referenceIds],
        'WHERE s.id = ANY($1::int[])',
        { approvalRoleId: roleId }
      );

      const pendingSet = new Set(pendingReferenceIds);
      serviciosJerarquicos.forEach((row) => {
        const id = Number(row.id || 0);
        if (pendingSet.has(id)) {
          row.gestion_estado_usuario = 'PENDIENTE';
          return;
        }

        const managedState = String(managedByUser.get(id) || '');
        row.gestion_estado_usuario = managedState === 'APROBADO'
          ? 'APROBADO'
          : (managedState === 'RECHAZADO' ? 'RECHAZADO' : 'PENDIENTE');
      });

      return res.json(serviciosJerarquicos);
    }

    if (isComprasOperatorUser(req.user)) {
      const serviciosAprobados = await fetchServiciosRows(
        [],
        "WHERE upper(trim(COALESCE(to_jsonb(s)->>'estado_aprobacion', to_jsonb(s)->>'estado', ''))) = 'APROBADO'",
        { approvalRoleId: roleId }
      );

      return res.json(serviciosAprobados);
    }

    const servicios = await fetchServiciosRows(
      [req.user.id],
      "WHERE NULLIF(COALESCE(to_jsonb(s)->>'id_usuario', to_jsonb(s)->>'usuario_id', ''), '')::int = $1",
      { approvalRoleId: roleId }
    );
    res.json(servicios);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/aprobaciones/pendientes', authMiddleware, async (req, res) => {
  try {
    const roleId = resolveApprovalRoleId(req.user);
    if (!roleId) {
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
        WHERE a.rol_aprobador = $1
          AND upper(trim(a.tipo)) IN ('COMPRA', 'SERVICIO')
          AND upper(trim(COALESCE(a.estado, 'PENDIENTE'))) = 'PENDIENTE'
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
      [roleId]
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/servicios', authMiddleware, async (req, res) => {
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
    const approvalColumn = getServicioApprovalColumn();
    const statusColumn = getServicioStatusColumn();

    const areaId = Number(req.body?.area_id ?? req.body?.id_area ?? req.user?.id_area ?? 0);
    const nombreServicio = String(req.body?.nombre_servicio ?? req.body?.nombre ?? '').trim();
    const prioridad = normalize(req.body?.prioridad || 'MEDIA');
    const descripcionServicio = String(req.body?.descripcion_servicio ?? req.body?.descripcion ?? '').trim();
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
    const insertValues = [Number(req.user.id), areaId, descripcionServicio, 'PENDIENTE'];

    if (nameColumn) {
      insertColumns.push(quoteIdentifier(nameColumn));
      insertValues.push(nombreServicio);
    }

    if (priorityColumn) {
      insertColumns.push(quoteIdentifier(priorityColumn));
      insertValues.push(prioridad);
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

    const creatorRoleId = resolveApprovalRoleId(req.user);
    const approvalSetup = await createApprovalRowsForEntity(client, {
      tipo: 'SERVICIO',
      referenciaId: servicioId,
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

    if (useApprovalTable) {
      const decisionResult = await applyApprovalDecision(client, {
        tipo: 'SERVICIO',
        referenciaId: id,
        roleId: resolveApprovalRoleId(req.user),
        userId: Number(req.user?.id || 0),
        decision: estadoAprobacion,
      });

      if (decisionResult.rejected) {
        await client.query(
          `
            UPDATE servicios
            SET ${quoteIdentifier(approvalColumn)} = 'RECHAZADO',
                ${quoteIdentifier(statusColumn)} = NULL
            WHERE id = $1
          `,
          [id]
        );
      } else if (decisionResult.finalApproved) {
        await client.query(
          `
            UPDATE servicios
            SET ${quoteIdentifier(approvalColumn)} = 'APROBADO',
                ${quoteIdentifier(statusColumn)} = NULL
            WHERE id = $1
          `,
          [id]
        );
      }
    } else {
      if (!canManagePurchasesRole(req.user?.rol)) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Sin permiso para gestionar servicios' });
      }

      await client.query(
        `
          UPDATE servicios
          SET ${quoteIdentifier(approvalColumn)} = $1,
              ${quoteIdentifier(statusColumn)} = $2
          WHERE id = $3
        `,
        [estadoAprobacion, null, id]
      );
    }

    await client.query('COMMIT');

    const servicio = await fetchServiciosRows([id], 'WHERE s.id = $1');
    res.json(servicio[0]);
  } catch (error) {
    await client.query('ROLLBACK');

    if (String(error?.code || '') === '23514') {
      return res.status(400).json({ error: 'Violacion de restriccion CHECK en servicios' });
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
    const monedaNorm = normalize(providerRow.moneda_nombre || 'PEN');
    const isUsd = monedaNorm.includes('USD') || monedaNorm.includes('DOLAR');
    const isPen = monedaNorm.includes('PEN') || monedaNorm.includes('SOL');
    const totalBase = Number((subtotalInput + igvInput + costoEnvioInput + otrosCostosInput).toFixed(2));
    const totalBaseSoles = isUsd ? Number((totalBase * 3.4).toFixed(2)) : totalBase;
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
    const subtotalColumn = getServicioSubtotalColumn();
    const igvColumn = getServicioIgvColumn();
    const costoEnvioColumn = getServicioCostoEnvioColumn();
    const otrosCostosColumn = getServicioOtrosCostosColumn();
    const totalColumn = getServicioTotalColumn();
    const aplicaRetencionColumn = getServicioAplicaRetencionColumn();
    const retencionColumn = getServicioRetencionColumn();
    const tipoRetencionColumn = getServicioTipoRetencionColumn();

    const setClauses = [
      `${quoteIdentifier(providerIdColumn)} = $1`,
      `${quoteIdentifier(subtotalColumn || 'subtotal')} = $2`,
      `${quoteIdentifier(igvColumn || 'igv')} = $3`,
      `${quoteIdentifier(costoEnvioColumn || 'costo_envio')} = $4`,
      `${quoteIdentifier(otrosCostosColumn || 'otros_costos')} = $5`,
      `${quoteIdentifier(totalColumn || 'total')} = $6`,
      `${quoteIdentifier(statusColumn)} = $7`,
    ];

    const values = [providerId, subtotalInput, igvInput, costoEnvioInput, otrosCostosInput, totalFinal, 'DATOS_COMPLETADOS'];

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

    const pdfBase64 = await buildServicioPdfBase64(refreshedServicio);

    res.json({
      id: refreshedServicio.id,
      servicio: refreshedServicio,
      archivo: {
        nombre: `OS-${refreshedServicio.id}.pdf`,
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

    const pdfBase64 = await buildServicioPdfBase64(servicio);

    res.json({
      id: servicio.id,
      archivo: {
        nombre: `OS-${servicio.id}.pdf`,
        mime: 'application/pdf',
        base64: pdfBase64,
      },
    });
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

    const pdfBase64 = await buildCompraPdfBase64(compra);

    res.json({
      compra,
      archivo: {
        nombre: `${compra.numero_orden || `OC-${String(compra.id).padStart(6, '0')}`}.pdf`,
        mime: 'application/pdf',
        base64: pdfBase64,
      },
    });
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
    const [totalsRows, comprasAreaRows, reqAreaRows, serviciosAreaRows] = await Promise.all([
      pool.query(
        `
          SELECT
            (SELECT COUNT(*) FROM compras) AS total_compras,
            (SELECT COUNT(*) FROM requerimientos) AS total_requerimientos,
            (SELECT COUNT(*) FROM servicios) AS total_servicios,
            (SELECT COALESCE(SUM(NULLIF(to_jsonb(c)->>'total', '')::numeric), 0) FROM compras c) AS monto_total_compras
        `
      ),
      pool.query(
        `
          SELECT
            COALESCE(a.nombre, 'Sin area') AS area,
            COUNT(*)::int AS total,
            COALESCE(SUM(NULLIF(to_jsonb(c)->>'total', '')::numeric), 0) AS monto_total
          FROM compras c
          LEFT JOIN areas a ON a.id = COALESCE(
            NULLIF(to_jsonb(c)->>'id_area_final', '')::int,
            NULLIF(to_jsonb(c)->>'id_area_solicitante', '')::int
          )
          GROUP BY COALESCE(a.nombre, 'Sin area')
          ORDER BY COUNT(*) DESC, monto_total DESC
          LIMIT 8
        `
      ),
      pool.query(
        `
          SELECT
            COALESCE(a.nombre, 'Sin area') AS area,
            COUNT(*)::int AS total
          FROM requerimientos r
          LEFT JOIN usuarios u ON u.id = NULLIF(to_jsonb(r)->>'id_usuario', '')::int
          LEFT JOIN areas a ON a.id = COALESCE(NULLIF(to_jsonb(r)->>'id_area', '')::int, u.id_area)
          GROUP BY COALESCE(a.nombre, 'Sin area')
          ORDER BY COUNT(*) DESC
          LIMIT 8
        `
      ),
      pool.query(
        `
          SELECT
            COALESCE(a.nombre, 'Sin area') AS area,
            COUNT(*)::int AS total
          FROM servicios s
          LEFT JOIN areas a ON a.id = NULLIF(COALESCE(to_jsonb(s)->>'id_area', to_jsonb(s)->>'area_id', ''), '')::int
          GROUP BY COALESCE(a.nombre, 'Sin area')
          ORDER BY COUNT(*) DESC
          LIMIT 8
        `
      ),
    ]);

    const totals = totalsRows.rows[0] || {};

    res.json({
      resumen: {
        total_compras: Number(totals.total_compras || 0),
        total_requerimientos: Number(totals.total_requerimientos || 0),
        total_servicios: Number(totals.total_servicios || 0),
        monto_total_compras: Number(totals.monto_total_compras || 0),
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

