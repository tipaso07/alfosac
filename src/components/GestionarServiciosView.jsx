import { useMemo, useState, useEffect } from 'react'
import '../styles/GestionarServiciosView.css'
import { hasPermission } from '../services/permissions'
import { fetchApprovalConfig } from '../services/api'

const normalize = (value) => String(value || '').trim().toUpperCase()
const normalizeRoleName = (value) => String(value || '')
  .trim()
  .toUpperCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^A-Z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '')
const getGestionEstado = (servicio) => normalize(servicio?.estado_aprobacion)
const isPendingApprovalStage = (value) => normalize(value).startsWith('PENDIENTE')
const statusLabel = (value) => (normalize(value) === 'PENDIENTE' ? 'PENDIENTE DE REALIZACION' : (value || 'N/A'))
const priorityRank = (value) => {
  switch (normalize(value)) {
    case 'ALTA':
      return 1
    case 'MEDIA':
      return 2
    case 'BAJA':
      return 3
    default:
      return 4
  }
}

const canApproveServicio = (servicio, showActions = false) => {
  const stage = getGestionEstado(servicio)
  return Boolean(showActions && isPendingApprovalStage(stage))
}

const getPendingStageForRoleName = (roleName) => {
  const key = normalizeRoleName(roleName)
  return key ? `PENDIENTE_${key}` : ''
}

const isDentroPlanServicio = (servicio) => {
  if (typeof servicio?.dentro_plan === 'boolean') return servicio.dentro_plan
  const raw = String(servicio?.dentro_plan ?? servicio?.en_plan ?? '').trim().toLowerCase()
  return ['true', 't', '1', 'si', 'yes', 'y'].includes(raw)
}

const getApprovalRouteLabel = (servicio, approvalConfig = {}) => {
  const dentroPlan = isDentroPlanServicio(servicio)
  const flowKey = dentroPlan ? 'SERVICIO_DENTRO_PLAN' : 'SERVICIO_FUERA_PLAN'
  const roles = Array.isArray(approvalConfig?.flujos?.[flowKey]) ? approvalConfig.flujos[flowKey] : []

  if (roles.length === 0) {
    return dentroPlan ? 'Flujo de servicios dentro del plan' : 'Flujo de servicios fuera del plan'
  }

  return roles
    .map((item) => String(item?.rol_nombre || '').trim() || `Rol ${Number(item?.rol_id || 0)}`)
    .join(' → ')
}

const getPendingStageForRoleId = (roleId) => {
  const numericRoleId = Number(roleId || 0)
  return numericRoleId > 0 ? `PENDIENTE_${numericRoleId}` : ''
}

export default function GestionarServiciosView({ servicios = [], currentUserPermissions = [], currentUserRoleId = null, onChangeAprobacion }) {
  const [activeStatus, setActiveStatus] = useState('PENDIENTE')
  const [activePriority, setActivePriority] = useState('TODAS')
  const [planChoiceByService, setPlanChoiceByService] = useState({})
  const [approvalConfig, setApprovalConfig] = useState({ flujos: {}, metadata: {} })

  useEffect(() => {
    const loadApprovalConfig = async () => {
      try {
        const config = await fetchApprovalConfig()
        setApprovalConfig(config || { flujos: {}, metadata: {} })
      } catch (error) {
        console.error(error)
        setApprovalConfig({ flujos: {}, metadata: {} })
      }
    }

    loadApprovalConfig()
  }, [])

  const serviceApprovalStages = useMemo(() => {
    const flows = approvalConfig?.flujos || {}
    const buildStages = (flowKey) => {
      if (!Array.isArray(flows[flowKey])) return []
      return flows[flowKey]
        .map((step) => {
          const explicitState = normalize(step?.estado_pendiente)
          if (explicitState.startsWith('PENDIENTE')) return explicitState
          return getPendingStageForRoleName(step?.rol_nombre)
        })
        .filter(Boolean)
    }

    return {
      dentroPlan: buildStages('SERVICIO_DENTRO_PLAN'),
      fueraPlan: buildStages('SERVICIO_FUERA_PLAN'),
    }
  }, [approvalConfig])

  const firstApproverRoleNames = useMemo(() => {
    const flows = approvalConfig?.flujos || {}
    const names = []
    const addIf = (flowKey) => {
      if (Array.isArray(flows[flowKey]) && flows[flowKey].length > 0) {
        const rn = String(flows[flowKey][0]?.rol_nombre || '').trim()
        if (rn) names.push(rn)
      }
    }
    addIf('SERVICIO_DENTRO_PLAN')
    addIf('SERVICIO_FUERA_PLAN')
    return names
  }, [approvalConfig])

  const approvalPermissionByStage = useMemo(() => {
    const map = {}
    const flows = approvalConfig?.flujos || {}
    Object.values(flows).forEach((arr) => {
      if (!Array.isArray(arr)) return
      arr.forEach((row) => {
        const roleName = normalizeRoleName(row?.rol_nombre)
        const stageKey = roleName.includes('FINANZAS')
          ? 'PENDIENTE_FINANZAS'
          : roleName.includes('GERENCIA') && roleName.includes('AREA')
            ? 'PENDIENTE_GERENCIA'
            : roleName.includes('JEFE') || roleName.includes('SUBGERENTE')
              ? 'PENDIENTE_JEFE_AREA'
              : roleName === 'ADMIN'
                ? 'PENDIENTE_ADMIN'
                : ''
        const permissionKey = roleName.includes('FINANZAS')
          ? 'APROBAR_FINANZAS'
          : roleName.includes('GERENCIA') && roleName.includes('AREA')
            ? 'APROBAR_GERENCIA_AREA'
            : roleName.includes('JEFE') || roleName.includes('SUBGERENTE')
              ? 'APROBAR_JEFE_AREA'
              : roleName === 'ADMIN'
                ? 'APROBAR_ADMIN'
                : ''

        if (stageKey && permissionKey) {
          map[stageKey] = permissionKey
        }
      })
    })
    return map
  }, [approvalConfig])

  // Para el primer aprobador, NUNCA asumir valor por defecto aunque venga como booleano
  const resolvePlanChoice = (servicio) => {
    const serviceId = Number(servicio?.id || 0)
    if (serviceId > 0 && Object.prototype.hasOwnProperty.call(planChoiceByService, serviceId)) {
      return planChoiceByService[serviceId]
    }

    if (Boolean(servicio?.es_primer_aprobador)) {
      return null // Obliga a elegir
    }
    // Para los siguientes aprobadores, usar el valor real del servicio
    if (typeof servicio?.dentro_plan === 'boolean') return servicio.dentro_plan
    const raw = String(servicio?.dentro_plan ?? servicio?.en_plan ?? '').trim().toLowerCase()
    return ['true', 't', '1', 'si', 'yes', 'y'].includes(raw)
  }

  const getServiceTypeLabel = (servicio) => {
    if (Boolean(servicio?.es_primer_aprobador) && resolvePlanChoice(servicio) === null) {
      return 'Por definir por primer aprobador'
    }
    const choice = resolvePlanChoice(servicio)
    if (choice === true) return 'Dentro del plan'
    if (choice === false) return 'Fuera del plan'
    // Para los siguientes aprobadores, mostrar el valor real
    return isDentroPlanServicio(servicio) ? 'Dentro del plan' : 'Fuera del plan'
  }

  const setPlanChoice = (servicioId, value) => {
    const id = Number(servicioId || 0)
    if (!id) return
    setPlanChoiceByService((prev) => ({
      ...prev,
      [id]: value,
    }))
  }

  const resolveFinancePlanChoice = (servicio) => {
      const serviceId = Number(servicio?.id || 0)
      if (serviceId > 0 && Object.prototype.hasOwnProperty.call(planChoiceByService, serviceId)) {
        return Boolean(planChoiceByService[serviceId])
      }
      return isDentroPlanServicio(servicio)
    }

  const setFinancePlanChoice = (servicioId, value) => {
      const id = Number(servicioId || 0)
      if (!id) return
      setPlanChoiceByService((prev) => ({
        ...prev,
        [id]: value,
      }))
  }

  const sortByPriorityAndDate = (items) => [...items].sort((a, b) => {
    const priorityDiff = priorityRank(a.prioridad) - priorityRank(b.prioridad)
    if (priorityDiff !== 0) return priorityDiff
    return new Date(b.fecha || 0).getTime() - new Date(a.fecha || 0).getTime()
  })

  const baseFilteredServicios = useMemo(() => {
    if (activePriority === 'TODAS') return servicios
    return servicios.filter((servicio) => normalize(servicio.prioridad) === activePriority)
  }, [servicios, activePriority])

  const pendientes = useMemo(() => sortByPriorityAndDate(
    baseFilteredServicios.filter((servicio) => {
      const estado = getGestionEstado(servicio)
      if (!isPendingApprovalStage(estado)) return false

      const expectedStage = getPendingStageForRoleId(currentUserRoleId)
      if (!expectedStage) return false

      return normalize(estado) === normalize(expectedStage)
    })
  ), [baseFilteredServicios, currentUserRoleId])

  const approved = useMemo(() => sortByPriorityAndDate(
    baseFilteredServicios.filter((servicio) => getGestionEstado(servicio) === 'APROBADO')
  ), [baseFilteredServicios])

  const rejected = useMemo(() => sortByPriorityAndDate(
    baseFilteredServicios.filter((servicio) => getGestionEstado(servicio) === 'RECHAZADO')
  ), [baseFilteredServicios])

  const config = {
    PENDIENTE: { label: 'Pendientes', data: pendientes, actions: true },
    APROBADO: { label: 'Aprobados', data: approved, actions: false },
    RECHAZADO: { label: 'Rechazados', data: rejected, actions: false },
  }

  const view = config[activeStatus]
  const filteredViewData = useMemo(() => view.data || [], [view.data])

  return (
    <section className="service-manage-section">
      <div className="section-header">
        <h1>Gestionar Servicios</h1>
        <p>Total: {servicios.length}</p>
      </div>

      <div className="service-status-tabs">
        {Object.entries(config).map(([key, val]) => (
          <button
            key={key}
            type="button"
            className={activeStatus === key ? 'active' : ''}
            onClick={() => setActiveStatus(key)}
          >
            {val.label} ({val.data.length})
          </button>
        ))}
      </div>

      <div className="service-priority-tabs">
        {['TODAS', 'ALTA', 'MEDIA', 'BAJA'].map((priority) => (
          <button
            key={priority}
            type="button"
            className={activePriority === priority ? 'active' : ''}
            onClick={() => setActivePriority(priority)}
          >
            {priority}
          </button>
        ))}
      </div>

      {filteredViewData.length === 0 ? (
        <div className="empty-state">No hay servicios en esta seccion.</div>
      ) : (
        <div className="service-manage-list">
          {filteredViewData.map((servicio) => (
            <article className="service-manage-card" key={servicio.id}>
              <div className="service-manage-head">
                <h3>Servicio #{servicio.id}</h3>
                <span className={`service-status ${normalize(servicio.estado_aprobacion).toLowerCase()}`}>
                  {servicio.estado_aprobacion}
                </span>
              </div>

              <p><strong>Area:</strong> {servicio.area || 'Sin area'}</p>
              <p><strong>Nombre:</strong> {servicio.nombre_servicio || servicio.descripcion_servicio || 'Sin nombre'}</p>
              <p><strong>Prioridad:</strong> {servicio.prioridad || 'MEDIA'}</p>
              <p><strong>Tipo:</strong> {getServiceTypeLabel(servicio)}</p>
              <p><strong>Descripcion:</strong> {servicio.descripcion_servicio || 'Sin descripcion'}</p>
              <p><strong>Estado servicio:</strong> {statusLabel(getGestionEstado(servicio))}</p>
              <p><strong>Fecha:</strong> {servicio.fecha ? new Date(servicio.fecha).toLocaleString() : 'Sin fecha'}</p>

              {view.actions && Boolean(servicio?.es_primer_aprobador) && (
                <label className="service-finance-plan-field">
                  <strong>¿Está dentro del plan?</strong>
                  <select
                    value={resolvePlanChoice(servicio) === null ? '' : (resolvePlanChoice(servicio) ? 'SI' : 'NO')}
                    onChange={(event) => {
                      const v = event.target.value === 'SI' ? true : (event.target.value === 'NO' ? false : null)
                      setPlanChoice(servicio.id, v)
                    }}
                  >
                    <option value="">-- Seleccione --</option>
                    <option value="SI">SI - Seguir flujo dentro del plan</option>
                    <option value="NO">NO - Seguir flujo fuera del plan</option>
                  </select>
                </label>
              )}

              {view.actions && canApproveServicio(servicio, view.actions) && (
                <div className="service-manage-actions">
                  <button
                    className="btn-approve"
                    onClick={() => onChangeAprobacion(
                      servicio.id,
                      'APROBADO',
                      Boolean(servicio?.es_primer_aprobador)
                        ? { dentro_plan: resolvePlanChoice(servicio) }
                        : {}
                    )}
                    disabled={Boolean(servicio?.es_primer_aprobador) && resolvePlanChoice(servicio) === null}
                  >
                    Aprobar
                  </button>
                  <button className="btn-reject" onClick={() => onChangeAprobacion(servicio.id, 'RECHAZADO')}>
                    Rechazar
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

