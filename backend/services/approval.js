const { pool } = require('../db/pool');
const { normalize, normalizeRoleName, normalizePermissionName } = require('../utils/normalize');
const { formatPetDateTime, currentPetDateTime, PET_SQL_NOW } = require('../utils/datetime');
const { ROLE_PERMISSION_NAMES_BY_ID, getPermissionsByRoleId, getNormalizedRoles, isGerentesRole, isComprasRole } = require('../config/constants');
const { getUserRoleIdExpr, getServicioApprovalColumn, getServicioStatusColumn, getServicioDentroPlanColumn, quoteIdentifier } = require('../utils/schema');

const APPROVAL_ROLES_BY_LEVEL = [1];
let approvalsTableAvailableCache = null;
const ROLE_NAME_BY_ID = new Map();

const loadRoleNamesCache = async () => {
  try {
    const result = await pool.query(`SELECT id, nombre FROM roles`);
    ROLE_NAME_BY_ID.clear();
    result.rows.forEach((row) => {
      const roleId = Number(row.id || 0);
      const roleName = String(row.nombre || '').trim();
      if (roleId > 0 && roleName) {
        ROLE_NAME_BY_ID.set(roleId, roleName);
      }
    });
    console.log('[ROLES] Role names cache loaded:', Object.fromEntries(ROLE_NAME_BY_ID));
  } catch (err) {
    console.warn('[ROLES] Could not load role names:', err.message);
  }
};

const findGerenteByArea = async (client, areaId) => {
  const numericAreaId = Number(areaId || 0);
  if (!numericAreaId) return 0;

  const result = await client.query(
    `SELECT u.id FROM usuarios u
     INNER JOIN roles r ON u.id_role = r.id
     WHERE u.id_area = $1
       AND upper(trim(r.nombre)) = 'GERENTES'
       AND upper(trim(COALESCE(u.sub_area, ''))) = 'GERENTE'
     LIMIT 1`,
    [numericAreaId]
  );
  return Number(result.rows[0]?.id || 0);
};

const findAreaByNamePattern = async (client, pattern) => {
  const result = await client.query(
    `SELECT id FROM areas WHERE unaccent(upper(trim(nombre))) LIKE unaccent($1) LIMIT 1`,
    [`%${String(pattern).trim().toUpperCase()}%`]
  );
  return Number(result.rows[0]?.id || 0);
};

const normalizeApprovalTipo = (value) => normalize(value).replace(/\s+/g, '_');

const isApprovalHierarchyRoleId = (roleId) => {
  const numericRoleId = Number(roleId || 0);
  return APPROVAL_ROLES_BY_LEVEL.includes(numericRoleId);
};

const APPROVAL_PENDING_STATES = new Set(['PENDIENTE']);

const getApprovalRoleLabel = (roleId, roleName = '') => {
  const numericRoleId = Number(roleId || 0);
  const explicitName = String(roleName || '').trim();
  if (explicitName) {
    return explicitName;
  }

  const cachedName = ROLE_NAME_BY_ID.get(numericRoleId);
  if (cachedName) {
    return cachedName;
  }

  return numericRoleId > 0 ? `Rol ${numericRoleId}` : '';
};

const getPendingStateByRoleId = (roleId) => {
  const numericRoleId = Number(roleId || 0);
  return numericRoleId > 0 ? `PENDIENTE_${numericRoleId}` : '';
};

const getApprovalRoleIdFromState = (state) => {
  const normalizedState = normalizeApprovalState(state);
  
  const usuarioMatch = normalizedState.match(/^PENDIENTE_USUARIO_(\d+)$/);
  if (usuarioMatch) {
    return Number(usuarioMatch[1] || 0);
  }

  const pendingMatch = normalizedState.match(/^PENDIENTE_(\d+)$/);
  if (pendingMatch) {
    return Number(pendingMatch[1] || 0);
  }

  for (const [roleId, roleName] of ROLE_NAME_BY_ID.entries()) {
    const normalizedRole = normalizePermissionName(roleName);
    if (normalizedState === `PENDIENTE_${normalizedRole}`) {
      return roleId;
    }
  }

  const legacyStateToRoleId = new Map([
    ['PENDIENTE_JEFE_AREA', 1],
    ['PENDIENTE_GERENCIA', 1],
    ['PENDIENTE_FINANZAS', 1],
    ['PENDIENTE_ADMIN', 1],
  ]);

  return Number(legacyStateToRoleId.get(normalizedState) || 0);
};

const getApprovalPendingStatesForRoleId = (roleId) => {
  const numericRoleId = Number(roleId || 0);
  if (numericRoleId <= 0) {
    return [];
  }

  const states = new Set([`PENDIENTE_${numericRoleId}`]);
  const roleName = ROLE_NAME_BY_ID.get(numericRoleId);
  if (roleName) {
    const normalizedRole = normalizePermissionName(roleName);
    if (normalizedRole) {
      states.add(`PENDIENTE_${normalizedRole}`);
    }
  }

  const legacyStatesByRoleId = new Map([
    [1, ['PENDIENTE_JEFE_AREA', 'PENDIENTE_GERENCIA', 'PENDIENTE_FINANZAS', 'PENDIENTE_ADMIN']],
  ]);

  (legacyStatesByRoleId.get(numericRoleId) || []).forEach((value) => states.add(value));

  return [...states];
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
  const roleName = ROLE_NAME_BY_ID.get(numericRoleId);
  if (roleName) {
    const normalizedName = normalizeRoleName(roleName);
    return `APROBAR_${normalizedName}`;
  }

  return '';
};

const getApprovalPermissionByState = (state) => {
  const normalizedState = normalizeApprovalState(state);
  const roleId = getApprovalRoleIdFromState(normalizedState);
  if (roleId > 0) {
    return getRequiredApprovalPermissionByRoleId(roleId);
  }

  if (!normalizedState.startsWith('PENDIENTE_')) {
    return '';
  }

  const pendingRoleKey = normalizedState.replace(/^PENDIENTE_/, '');
  for (const [roleId, roleName] of ROLE_NAME_BY_ID.entries()) {
    if (normalizePermissionName(roleName) === pendingRoleKey) {
      return getRequiredApprovalPermissionByRoleId(roleId);
    }
  }

  return `APROBAR_${pendingRoleKey}`;
};

const getApprovalStateByPermission = (permission) => {
  const normalizedPermission = normalizePermissionName(permission);
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

  return '';
};

const getApprovalRoleIdByPermission = (permission) => {
  const normalizedPermission = normalizePermissionName(permission);

  if (normalizedPermission.startsWith('APROBAR_')) {
    const roleKey = normalizedPermission.replace(/^APROBAR_/, '');
    for (const [roleId, roleName] of ROLE_NAME_BY_ID.entries()) {
      if (normalizePermissionName(roleName) === roleKey) {
        return roleId;
      }
    }
  }

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

const getApprovalStageRoleIdForUser = (usuario) => {
  const roleId = resolveApprovalRoleId(usuario);
  return isApprovalHierarchyRoleId(roleId) ? roleId : 0;
};

const getApprovalStageStateForUser = (usuario) => {
  const userId = Number(usuario?.id || 0);
  if (userId > 0) {
    return `PENDIENTE_USUARIO_${userId}`;
  }
  const roleId = getApprovalStageRoleIdForUser(usuario);
  return roleId > 0 ? getPendingStateByRoleId(roleId) : '';
};

const getNextApprovalState = ({ tipo, currentState, dentroPlan }) => {
  const normalizedState = normalizeApprovalState(currentState);
  const currentRoleId = getApprovalRoleIdFromState(normalizedState);

  if (normalizedState === 'PENDIENTE' || normalizedState.startsWith('PENDIENTE_USUARIO_') || normalizedState.startsWith('PENDIENTE_')) {
    if (normalizedState === 'PENDIENTE') {
      return {
        roleId: currentRoleId,
        state: normalizedState,
        pendingNext: true,
      };
    }

    return {
      roleId: currentRoleId,
      state: normalizedState,
      pendingNext: true,
    };
  }

  return {
    roleId: currentRoleId,
    state: normalizedState,
  };
};

const aprobarEntidad = async (usuario, tipo, id, decision = 'APROBADO', options = {}) => {
  const normalizedTipo = normalize(tipo);
  const referenceId = Number(id || 0);
  const normalizedDecision = normalize(decision).startsWith('RECHAZ') ? 'RECHAZADO' : 'APROBADO';
  const overrideDentroPlan = Object.prototype.hasOwnProperty.call(options || {}, 'dentro_plan')
    ? options.dentro_plan
    : null;

  if (!['COMPRA', 'SERVICIO', 'REQUERIMIENTO'].includes(normalizedTipo)) {
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
        selectQuery: `SELECT id, upper(trim(COALESCE(estado, 'PENDIENTE_5'))) AS estado, FALSE AS dentro_plan FROM compras WHERE id = $1 FOR UPDATE`,
        updateQuery: `UPDATE compras SET estado = $1::text, fecha_actualizacion = ${PET_SQL_NOW} WHERE id = $2`,
      }
      : normalizedTipo === 'REQUERIMIENTO'
      ? {
        tableName: 'requerimientos',
        stateColumn: 'estado',
        selectQuery: `SELECT id, upper(trim(COALESCE(estado, 'PENDIENTE'))) AS estado, FALSE AS dentro_plan FROM requerimientos WHERE id = $1 FOR UPDATE`,
        updateQuery: `UPDATE requerimientos SET estado = $1::text, estado_entrega = CASE WHEN $1 = 'APROBADO' THEN 'POR_RECOGER' ELSE estado_entrega END WHERE id = $2`,
      }
      : {
        tableName: 'servicios',
        stateColumn: getServicioApprovalColumn(),
        selectQuery: `
          SELECT
            id,
            upper(trim(COALESCE(to_jsonb(s)->>'estado_aprobacion', to_jsonb(s)->>'estado', 'PENDIENTE_5'))) AS estado,
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
    const stageRoleId = Number(flow.roleId || getApprovalRoleIdFromState(estadoAnterior) || 0);
    const estadoNuevo = normalizedDecision === 'RECHAZADO'
      ? 'RECHAZADO'
      : normalizedTipo === 'REQUERIMIENTO'
        ? 'APROBADO'
        : flow.state;

    if (!estadoNuevo) {
      throw new Error('No fue posible determinar el siguiente estado del flujo');
    }

    const currentUserId = Number(usuario?.id || 0);
    const PENDING_APPROVAL_QUERY = `
        SELECT id, orden, rol_aprobador, usuario_id, upper(trim(COALESCE(estado, 'PENDIENTE'))) AS estado
        FROM aprobaciones
        WHERE upper(trim(tipo)) = $1
          AND referencia_id = $2
          AND (upper(trim(COALESCE(estado, 'PENDIENTE'))) = 'PENDIENTE'
               OR upper(trim(COALESCE(estado, 'PENDIENTE'))) LIKE 'PENDIENTE_%')
        ORDER BY orden ASC
        LIMIT 1
        FOR UPDATE
      `;
    let pendingApproval = await client.query(PENDING_APPROVAL_QUERY, [normalizedTipo, referenceId]);

    if (pendingApproval.rows.length === 0 && normalizedTipo === 'REQUERIMIENTO') {
      const creatorRes = await client.query('SELECT id_usuario, id_area FROM requerimientos r JOIN usuarios u ON u.id = r.id_usuario WHERE r.id = $1', [referenceId]);
      if (creatorRes.rows.length > 0) {
        const creatorUserId = Number(creatorRes.rows[0].id_usuario || 0);
        const creatorAreaId = Number(creatorRes.rows[0].id_area || 0);
        if (creatorUserId && creatorAreaId) {
          const gerenteId = await findGerenteByArea(client, creatorAreaId);
          if (gerenteId && gerenteId !== creatorUserId) {
            const gerentesRoleId = Number((await client.query("SELECT id FROM roles WHERE upper(trim(nombre)) = 'GERENTES' LIMIT 1")).rows[0]?.id || 1);
            await client.query(
              `INSERT INTO aprobaciones (tipo, referencia_id, orden, rol_aprobador, usuario_id, estado)
               VALUES ($1, $2, 1, $3, $4, $5)
               ON CONFLICT (tipo, referencia_id, orden) DO UPDATE SET usuario_id = $4, estado = $5`,
              [normalizedTipo, referenceId, gerentesRoleId, gerenteId, `PENDIENTE_USUARIO_${gerenteId}`]
            );
            pendingApproval = await client.query(PENDING_APPROVAL_QUERY, [normalizedTipo, referenceId]);
          } else if (gerenteId && gerenteId === creatorUserId) {
            await client.query(
              `UPDATE requerimientos SET estado = 'APROBADO', estado_entrega = 'POR_RECOGER' WHERE id = $1 AND upper(trim(estado)) = 'PENDIENTE'`,
              [referenceId]
            );
            return { estado: 'APROBADO', message: 'Requerimiento auto-aprobado (creador es gerente)' };
          }
        }
      }
    }

    if (pendingApproval.rows.length === 0) {
      throw new Error('No existe una aprobacion pendiente para esta etapa');
    }

    const currentApproval = pendingApproval.rows[0];
    const approvalUserId = Number(currentApproval.usuario_id || 0);

    if (approvalUserId > 0 && approvalUserId !== currentUserId) {
      throw new Error('No tienes permiso para aprobar en esta etapa');
    }

    if (approvalUserId === 0 && resolveApprovalRoleId(usuario) !== Number(currentApproval.rol_aprobador || 0)) {
      throw new Error('No tienes permiso para aprobar en esta etapa');
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

    if (normalizedTipo === 'SERVICIO' && currentApproval && Number(currentApproval.orden || 0) === 1 && overrideDentroPlan === null) {
      throw new Error('DECISION DE APROBACION INVALIDA: En la primera aprobacion debe especificarse si el servicio esta dentro_plan');
    }

    const actorId = Number(usuario?.id || 0) || null;
    await client.query(
      `
        UPDATE aprobaciones
        SET estado = $1::text,
            usuario_id = $2,
            fecha = ${PET_SQL_NOW}
        WHERE id = $3
          AND (upper(trim(COALESCE(estado, 'PENDIENTE'))) = 'PENDIENTE'
               OR upper(trim(COALESCE(estado, 'PENDIENTE'))) LIKE 'PENDIENTE_%')
      `,
      [normalizedDecision, actorId, Number(currentApproval.id)]
    );

    if (normalizedTipo === 'COMPRA') {
      if (normalizedDecision === 'APROBADO') {
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
          const nextUserId = Number(nextPendingRow.usuario_id || 0);
          const nextRoleId = Number(nextPendingRow.rol_aprobador || 0);
          const nextEstado = nextUserId > 0 ? `PENDIENTE_USUARIO_${nextUserId}` : getPendingStateByRoleId(nextRoleId);
          
          await client.query(
            `UPDATE compras SET estado = $1::text, fecha_actualizacion = ${PET_SQL_NOW} WHERE id = $2`,
            [nextEstado, referenceId]
          );
        } else {
          await client.query(
            `UPDATE compras SET estado = $1::text, fecha_actualizacion = ${PET_SQL_NOW} WHERE id = $2`,
            ['APROBADO', referenceId]
          );
          
          await client.query(
            `UPDATE compras SET estado_pedido = $1::text, fecha_actualizacion = ${PET_SQL_NOW} WHERE id = $2`,
            ['APROBADO', referenceId]
          );
        }
      } else {
        await client.query(
          `UPDATE compras SET estado = $1::text, estado_pedido = $1::text, fecha_actualizacion = ${PET_SQL_NOW} WHERE id = $2`,
          ['RECHAZADO', referenceId]
        );
      }
    } else if (normalizedTipo === 'REQUERIMIENTO') {
      const reqEstado = normalizedDecision === 'APROBADO' ? 'APROBADO' : 'RECHAZADO';
      await client.query(entityConfig.updateQuery, [reqEstado, referenceId]);
    } else {
      const serviceStateColumn = getServicioApprovalColumn();
      const serviceFlowColumn = getServicioStatusColumn();
      const dentroPlanColumn = getServicioDentroPlanColumn();

      if (normalizedTipo === 'SERVICIO' && overrideDentroPlan !== null && currentApproval && Number(currentApproval.orden || 0) === 1) {
        if (dentroPlanColumn) {
          await client.query(
            `UPDATE servicios SET ${quoteIdentifier(dentroPlanColumn)} = $1 WHERE id = $2`,
            [overrideDentroPlan, referenceId]
          );
        }
        await rebuildServiceApprovalChain(client, referenceId, overrideDentroPlan);
      }

      if (normalizedDecision === 'APROBADO') {
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
          const newFlow = 'APROBADO';
          await client.query(
            `UPDATE servicios SET ${quoteIdentifier(serviceStateColumn)} = $1, ${quoteIdentifier(serviceFlowColumn)} = $2 WHERE id = $3`,
            [estadoNuevo, newFlow, referenceId]
          );
        } else {
          const nextUserId = Number(nextPendingRow.usuario_id || 0);
          const nextRoleId = Number(nextPendingRow.rol_aprobador || 0);
          const nextEstado = nextUserId > 0 ? `PENDIENTE_USUARIO_${nextUserId}` : getPendingStateByRoleId(nextRoleId);
          
          await client.query(
            `UPDATE servicios SET ${quoteIdentifier(serviceStateColumn)} = $1 WHERE id = $2`,
            [nextEstado, referenceId]
          );
        }
      } else {
        await client.query(
          `UPDATE servicios SET ${quoteIdentifier(serviceStateColumn)} = $1 WHERE id = $2`,
          ['RECHAZADO', referenceId]
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

const getIntermediateApprovalStateByRoleId = (roleId) => {
  return getPendingStateByRoleId(roleId);
};

const generatePendingStateByRoleId = (roleId) => {
  return getPendingStateByRoleId(roleId) || 'PENDIENTE';
};

const getInitialApprovalStateForEntity = ({ tipo, dentroPlan = false, creatorRoleId = 0 } = {}) => {
  return 'PENDIENTE';
};

const getApprovalStageKeyByRoleId = (roleId) => {
  const fallback = normalizePermissionName(getApprovalRoleLabel(roleId));
  if (!fallback) return '';

  return fallback
    .replace(/\s+/g, '_')
    .replace(/[^A-Z0-9_]/g, '');
};

const resolveApprovalRoleId = (user) => {
  const numericRoleId = Number(user?.id_role || user?.rol_id || 0);
  if (isApprovalHierarchyRoleId(numericRoleId)) {
    return numericRoleId;
  }

  const normalizedRoles = getNormalizedRoles(user?.rol);
  for (const roleName of normalizedRoles) {
    for (const [roleIdFromCache, cachedRoleName] of ROLE_NAME_BY_ID.entries()) {
      if (normalizeRoleName(cachedRoleName) === roleName && isApprovalHierarchyRoleId(roleIdFromCache)) {
        return roleIdFromCache;
      }
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
  userId,
}) => {
  const tableExists = await hasAprobacionesTable(client);
  if (!tableExists) {
    return [];
  }

  const normalizedTipo = normalizeApprovalTipo(tipo);
  const role = Number(roleId || 0);
  const actor = Number(userId || 0);
  if (!role && !actor) {
    return [];
  }

  let query = `
    SELECT DISTINCT a.referencia_id
    FROM aprobaciones a
    WHERE upper(trim(a.tipo)) = $1
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
  `;
  const params = [normalizedTipo];
  let paramIndex = 2;

  if (actor > 0) {
    query += ` AND a.usuario_id = $${paramIndex}`;
    params.push(actor);
    paramIndex += 1;
  } else if (role > 0) {
    query += ` AND a.rol_aprobador = $${paramIndex}`;
    params.push(role);
    paramIndex += 1;
  }

  query += ` ORDER BY a.referencia_id DESC`;

  const result = await client.query(query, params);

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
    const currentRoleId = getApprovalRoleIdFromState(normalizedCurrentStatus);
    if (currentRoleId > 0) {
      return `PENDIENTE_${currentRoleId}`;
    }

    return normalizedCurrentStatus;
  }

  const pendingRole = Number(nextPendingRole || 0);
  if (pendingRole > 0) {
    return `PENDIENTE_${pendingRole}`;
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

const hasPurchaseOrdersAccess = (user) => (
  tienePermiso(user, 'GESTIONAR_COMPRAS')
  || tienePermiso(user, 'GESTIONAR_ORDENES_COMPRA')
);

const isComprasOperatorUser = (user) => {
  const numericRoleId = Number(user?.id_role || user?.rol_id || 0);
  return isGerentesRole(user?.rol) || isComprasRole(user?.rol) || hasPurchaseOrdersAccess(user);
};

const canAccessPurchaseOrdersModule = (user) => (
  tienePermiso(user, 'GESTIONAR_COMPRAS')
  || hasPurchaseOrdersAccess(user)
  || isGerentesRole(user?.rol)
  || isComprasRole(user?.rol)
);

const isApprovalRoleIdConfigured = async (roleId) => {
  const numericRoleId = Number(roleId || 0);
  if (!Number.isInteger(numericRoleId) || numericRoleId <= 0) {
    return false;
  }
  return APPROVAL_ROLES_BY_LEVEL.includes(numericRoleId);
};

const canAccessManageRequestsModule = async (user) => {
  const roleId = resolveApprovalRoleId(user);
  if (!Number.isInteger(roleId) || roleId <= 0) {
    return false;
  }

  return await isApprovalRoleIdConfigured(roleId);
};

const canAccessServicesHistoryModule = (user) => tienePermiso(user, 'VER_HISTORIAL_SERVICIOS');

const filterUserPermissions = async (permissions, user) => {
  const normalizedPermissions = [...new Set((permissions || [])
    .map((perm) => normalizePermissionName(perm))
    .filter(Boolean))];

  if (!await canAccessManageRequestsModule(user)) {
    const isSolicitante = Number(user?.id_role || user?.rol_id || 0) === 4;
    const isSsgg = Number(user?.id_role || user?.rol_id || 0) === 8;
    return normalizedPermissions.filter((perm) => {
      if (perm === 'GESTIONAR_SOLICITUDES' && (isSolicitante || isSsgg)) return true;
      return perm !== 'GESTIONAR_SOLICITUDES';
    });
  }

  return normalizedPermissions;
};

const canApproveApprovalRole = (user, roleId) => {
  const approvalRoleId = resolveApprovalRoleId(user);
  return Number(roleId || 0) > 0 && approvalRoleId === Number(roleId || 0);
};

const createApprovalRowsForEntity = async (client, {
  tipo,
  referenciaId,
  dentroPlan = false,
  creatorRoleId = 0,
  creatorUserId = 0,
  creatorAreaId = 0,
}) => {
  const tableExists = await hasAprobacionesTable(client);
  if (!tableExists) {
    return { usesApprovalTable: false, autoApproved: false };
  }

  const normalizedTipo = normalizeApprovalTipo(tipo);
  const reference = Number(referenciaId || 0);
  const gerentesRoleId = Number((await client.query("SELECT id FROM roles WHERE upper(trim(nombre)) = 'GERENTES' LIMIT 1")).rows[0]?.id || 1);

  if (!reference) {
    throw new Error('referencia_id invalido para crear aprobaciones');
  }

  await client.query('DELETE FROM aprobaciones WHERE upper(trim(tipo)) = $1 AND referencia_id = $2', [normalizedTipo, reference]);

  if (normalizedTipo === 'COMPRA') {
    const requesterAreaId = Number(creatorAreaId || 0);
    if (!requesterAreaId) {
      throw new Error('No se pudo determinar el area del solicitante para la aprobacion');
    }

    const gerenteId = await findGerenteByArea(client, requesterAreaId);

    if (!gerenteId) {
      throw new Error('No se encontro un gerente de area para aprobar esta compra');
    }

    if (Number(creatorUserId || 0) === gerenteId) {
      return { usesApprovalTable: true, autoApproved: true };
    }

    const pendingState = `PENDIENTE_USUARIO_${gerenteId}`;
    await client.query(
      `INSERT INTO aprobaciones (tipo, referencia_id, orden, rol_aprobador, usuario_id, estado)
       VALUES ($1, $2, 1, $3, $4, $5)`,
      [normalizedTipo, reference, gerentesRoleId, gerenteId, pendingState]
    );

    return { usesApprovalTable: true, autoApproved: false };
  }

  if (normalizedTipo === 'SERVICIO') {
    const finanzasAreaId = await findAreaByNamePattern(client, 'ADMINISTRACION Y FINANZAS');
    if (!finanzasAreaId) {
      throw new Error('No se encontro el area de Administracion y Finanzas');
    }

    const gerenteFinanzasId = await findGerenteByArea(client, finanzasAreaId);
    if (!gerenteFinanzasId) {
      throw new Error('No se encontro un gerente en el area de Administracion y Finanzas');
    }

    const pendingStateFinanzas = `PENDIENTE_USUARIO_${gerenteFinanzasId}`;
    await client.query(
      `INSERT INTO aprobaciones (tipo, referencia_id, orden, rol_aprobador, usuario_id, estado)
       VALUES ($1, $2, 1, $3, $4, $5)`,
      [normalizedTipo, reference, gerentesRoleId, gerenteFinanzasId, pendingStateFinanzas]
    );

    if (!dentroPlan) {
      const gerenciaAreaId = await findAreaByNamePattern(client, 'GERENCIA GENERAL');
      if (gerenciaAreaId) {
        const gerenteGerenciaId = await findGerenteByArea(client, gerenciaAreaId);
        if (gerenteGerenciaId) {
          const pendingStateGerencia = `PENDIENTE_USUARIO_${gerenteGerenciaId}`;
          await client.query(
            `INSERT INTO aprobaciones (tipo, referencia_id, orden, rol_aprobador, usuario_id, estado)
             VALUES ($1, $2, 2, $3, $4, $5)`,
            [normalizedTipo, reference, gerentesRoleId, gerenteGerenciaId, pendingStateGerencia]
          );
        }
      }
    }

    return { usesApprovalTable: true, autoApproved: false };
  }

  if (normalizedTipo === 'REQUERIMIENTO') {
    const requesterAreaId = Number(creatorAreaId || 0);
    if (!requesterAreaId) {
      throw new Error('No se pudo determinar el area del solicitante para la aprobacion del requerimiento');
    }

    const gerenteId = await findGerenteByArea(client, requesterAreaId);

    if (!gerenteId) {
      throw new Error('No se encontro un gerente de area para aprobar este requerimiento');
    }

    if (Number(creatorUserId || 0) === gerenteId) {
      return { usesApprovalTable: true, autoApproved: true };
    }

    const pendingState = `PENDIENTE_USUARIO_${gerenteId}`;
    await client.query(
      `INSERT INTO aprobaciones (tipo, referencia_id, orden, rol_aprobador, usuario_id, estado)
       VALUES ($1, $2, 1, $3, $4, $5)`,
      [normalizedTipo, reference, gerentesRoleId, gerenteId, pendingState]
    );

    return { usesApprovalTable: true, autoApproved: false };
  }

  throw new Error(`Tipo de entidad no soportado para aprobaciones: ${normalizedTipo}`);
};

const rebuildServiceApprovalChain = async (client, referenciaId, dentroPlan = false, creatorRoleId = 0) => {
  const normalizedTipo = 'SERVICIO';
  const currentOrder = 1;
  const gerentesRoleId = Number((await client.query("SELECT id FROM roles WHERE upper(trim(nombre)) = 'GERENTES' LIMIT 1")).rows[0]?.id || 1);

  await client.query(
    `DELETE FROM aprobaciones WHERE upper(trim(tipo)) = $1 AND referencia_id = $2 AND orden > $3`,
    [normalizedTipo, Number(referenciaId), currentOrder]
  );

  if (!dentroPlan) {
    const gerenciaAreaId = await findAreaByNamePattern(client, 'GERENCIA GENERAL');
    if (gerenciaAreaId) {
      const gerenteGerenciaId = await findGerenteByArea(client, gerenciaAreaId);
      if (gerenteGerenciaId) {
        const pendingStateGerencia = `PENDIENTE_USUARIO_${gerenteGerenciaId}`;
        await client.query(
          `INSERT INTO aprobaciones (tipo, referencia_id, orden, rol_aprobador, usuario_id, estado)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [normalizedTipo, Number(referenciaId), currentOrder + 1, gerentesRoleId, gerenteGerenciaId, pendingStateGerencia]
        );
      }
    }
  }
};

const fetchActionableApprovalReferenceIds = async (client, {
  tipo,
  roleId,
  userId,
  referenceIds,
}) => {
  const tableExists = await hasAprobacionesTable(client);
  if (!tableExists) {
    return new Set();
  }

  const normalizedTipo = normalizeApprovalTipo(tipo);
  const role = Number(roleId || 0);
  const actor = Number(userId || 0);
  const ids = Array.isArray(referenceIds)
    ? referenceIds.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0)
    : [];

  if ((!role && !actor) || ids.length === 0) {
    return new Set();
  }

  const params = [normalizedTipo];
  let paramIndex = 2;

  if (actor > 0) {
    params.push(actor);
    paramIndex += 1;
  } else {
    params.push(role);
    paramIndex += 1;
  }

  params.push(ids);

  const result = await client.query(
    `
      SELECT DISTINCT a.referencia_id
      FROM aprobaciones a
      WHERE upper(trim(a.tipo)) = $1
        AND ${actor > 0 ? `a.usuario_id = $2` : `a.rol_aprobador = $2`}
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
    params
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
          fecha = ${PET_SQL_NOW}
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

const getApprovalStageLabelFromState = (state) => {
  const normalizedState = normalizeApprovalState(state);
  const roleId = getApprovalRoleIdFromState(normalizedState);
  if (roleId > 0) {
    return normalizePermissionName(getApprovalRoleLabel(roleId));
  }
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
  const dateLabel = String(fecha || currentPetDateTime()).trim();
  return `APROBACION | ${stageLabel} | usuario: ${userLabel} | fecha: ${dateLabel}`;
};

const registrarAprobacion = async (db, usuario, tipo, id, estadoActual) => {
  const normalizedType = String(tipo || '').trim().toLowerCase();
  const entityId = Number(id || 0);
  const userId = Number(usuario?.id || 0);
  const stageLabel = getApprovalStageLabelFromState(estadoActual);

  if (!normalizedType || !entityId || !userId || !stageLabel) {
    return null;
  }

  const userLabel = String(usuario?.nombre || usuario?.username || usuario?.email || 'Usuario').trim() || 'Usuario';
  const approvalDate = currentPetDateTime();
  const content = buildApprovalCommentContent({ etapa: stageLabel, usuario: userLabel, fecha: approvalDate });

  return insertCommentForEntity(db, {
    user: usuario,
    tipoEntidad: normalizedType,
    idEntidad: entityId,
    contenido: content,
  });
};

const insertCommentForEntity = async (db, { user, tipoEntidad, idEntidad, contenido }) => {
  const normalizedType = String(tipoEntidad || '').trim().toLowerCase();
  const entityId = Number(idEntidad || 0);
  const userId = Number(user?.id || 0);
  const text = String(contenido || '').trim();

  if (!normalizedType || !entityId || !userId || !text) {
    throw new Error('Datos invalidos para registrar comentario');
  }

  const inserted = await db.query(
    `
      INSERT INTO comentarios (id_usuario, tipo_entidad, id_entidad, contenido, fecha)
      VALUES ($1, $2, $3, $4, timezone('America/Lima', now()))
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
    fecha: row.fecha || new Date().toLocaleString('sv-SE', { timeZone: 'America/Lima', hour12: false }),
    contenido: String(row.contenido || text).trim(),
  };
};

const fetchApprovalCommentsByEntity = async (db, { tipo, referenciaId }) => {
  const normalizedType = String(tipo || '').trim().toLowerCase();
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
      rol_aprobador: getApprovalRoleIdFromState(`PENDIENTE_${String(row.etapa || '').toUpperCase()}`) || 0,
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
          COALESCE(c.fecha_actualizacion, c.fecha_creacion, timezone('America/Lima', now())) AS fecha
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
          COALESCE(NULLIF(to_jsonb(s)->>'fecha_creacion', '')::timestamp, NULLIF(to_jsonb(s)->>'created_at', '')::timestamp, timezone('America/Lima', now())) AS fecha
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

const ensureCoreApprovalPermissions = async (_client) => {};

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

module.exports = {
  ROLE_NAME_BY_ID,
  APPROVAL_PENDING_STATES,
  APPROVAL_ROLES_BY_LEVEL,
  loadRoleNamesCache,
  findGerenteByArea,
  findAreaByNamePattern,
  normalizeApprovalTipo,
  isApprovalHierarchyRoleId,
  getApprovalRoleLabel,
  getPendingStateByRoleId,
  getApprovalRoleIdFromState,
  getApprovalPendingStatesForRoleId,
  tienePermiso,
  getRequiredApprovalPermissionByRoleId,
  getApprovalPermissionByState,
  getApprovalStateByPermission,
  getPendingStateByPermission,
  getApprovalRoleIdByPermission,
  normalizeApprovalState,
  isPendingApprovalState,
  getApprovalStagePermissionForUser,
  getApprovalStageRoleIdForUser,
  getApprovalStageStateForUser,
  getNextApprovalState,
  aprobarEntidad,
  getIntermediateApprovalStateByRoleId,
  generatePendingStateByRoleId,
  getInitialApprovalStateForEntity,
  getApprovalStageKeyByRoleId,
  resolveApprovalRoleId,
  hasAprobacionesTable,
  fetchPendingApprovalReferenceIdsByRole,
  fetchManagedApprovalStatesByUser,
  fetchFinalApprovedReferenceIdsByRole,
  hasFinalApprovalByRole,
  hasEffectiveFinalApprovalByRole,
  fetchNextPendingApprovalRoleByReferences,
  buildApprovalStatusLabel,
  fetchAutoApprovedByCreatorRoleIds,
  fetchOwnCreatedByRoleIds,
  hasPurchaseOrdersAccess,
  isComprasOperatorUser,
  canAccessPurchaseOrdersModule,
  isApprovalRoleIdConfigured,
  canAccessManageRequestsModule,
  canAccessServicesHistoryModule,
  filterUserPermissions,
  canApproveApprovalRole,
  createApprovalRowsForEntity,
  rebuildServiceApprovalChain,
  fetchActionableApprovalReferenceIds,
  fetchFirstApprovalReferenceIdsByRole,
  applyApprovalDecision,
  getApprovalStageLabelFromState,
  parseApprovalCommentContent,
  buildApprovalCommentContent,
  registrarAprobacion,
  insertCommentForEntity,
  fetchApprovalCommentsByEntity,
  fetchApprovedApproversByEntity,
  fetchApprovalHistoryByEntity,
  mapApprovalDecisionErrorToHttp,
  ensureCoreApprovalPermissions,
};
