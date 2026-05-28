import { useMemo, useState, useEffect } from 'react'
import '../styles/GestionarComprasView.css'
import { evaluateProviderRatingState } from '../services/providerRatingRules'
import { hasPermission } from '../services/permissions'
import { fetchApprovalConfig } from '../services/api'

const normalize = (value) => String(value || '').trim().toUpperCase()
const normalizeSearch = (value) => String(value || '')
  .trim()
  .toUpperCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
const normalizeRoleName = (value) => String(value || '')
  .trim()
  .toUpperCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^A-Z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '')
const normalizeStage = (value) => normalizeRoleName(value)
// Only matches PENDIENTE_* format (with underscore and role name), not bare 'PENDIENTE'
const isPendingFlowStage = (value) => normalizeStage(value).startsWith('PENDIENTE_')
const getStageStatus = (compra) => {
  const userStage = normalizeStage(compra?.gestion_estado_usuario)
  if (userStage) return userStage
  const detailStage = normalizeStage(compra?.estado_aprobacion_detalle)
  if (detailStage) return detailStage
  return normalizeStage(compra?.estado_pedido || compra?.estado)
}

export default function GestionarComprasView({ compras = [], currentUserRoleId = null, currentUserRoleName = '', currentUserPermissions = [], currentUserArea = '', onChangeEstado }) {
  const [activeStatus, setActiveStatus] = useState('PENDIENTE')
  const [approvalConfig, setApprovalConfig] = useState([])
  const [userQuery, setUserQuery] = useState('')
  const [materialQuery, setMaterialQuery] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const canSeeCriticalAlert = hasPermission(currentUserPermissions, 'GESTIONAR_COMPRAS')

  useEffect(() => {
    fetchApprovalConfig().then(setApprovalConfig).catch(console.error)
  }, [])

  const purchaseFlowConfig = useMemo(() => {
    const flows = approvalConfig?.flujos && typeof approvalConfig.flujos === 'object'
      ? approvalConfig.flujos
      : {}
    return Array.isArray(flows.COMPRA) ? flows.COMPRA : []
  }, [approvalConfig])

  const currentUserApprovalStage = useMemo(() => {
    const roleName = normalizeRoleName(currentUserRoleName)
    const matchedByName = purchaseFlowConfig.find((role) => normalizeRoleName(role?.rol_nombre) === roleName)
    if (matchedByName?.rol_nombre) {
      return `PENDIENTE_${normalizeRoleName(matchedByName.rol_nombre)}`
    }

    const roleId = Number(currentUserRoleId || 0)
    const matchedById = purchaseFlowConfig.find((role) => Number(role?.rol_id || 0) === roleId)
    if (matchedById?.rol_nombre) {
      return `PENDIENTE_${normalizeRoleName(matchedById.rol_nombre)}`
    }

    return ''
  }, [currentUserRoleId, currentUserRoleName, purchaseFlowConfig])

  const currentUserIsAreaRole = useMemo(() => {
    const roleName = normalizeRoleName(currentUserRoleName)
    return roleName.includes('AREA')
  }, [currentUserRoleName])

  const currentUserPendingStages = useMemo(() => {
    const stages = new Set()
    const addStage = (value) => {
      const normalizedStage = normalize(value)
      if (normalizedStage.startsWith('PENDIENTE')) {
        stages.add(normalizedStage)
      }
    }

    addStage(currentUserApprovalStage)
    purchaseFlowConfig.forEach((role) => {
      const roleName = normalizeRoleName(role?.rol_nombre)
      const stageKey = roleName ? `PENDIENTE_${roleName}` : ''
      const roleId = Number(role?.rol_id || 0)
      const matchesRoleName = roleName && roleName === normalizeRoleName(currentUserRoleName)
      const matchesRoleId = roleId > 0 && roleId === Number(currentUserRoleId || 0)

      if (stageKey && (matchesRoleName || matchesRoleId)) {
        addStage(stageKey)
        // Also add numeric variant (PENDIENTE_<roleId>) to match backend numeric states
        if (roleId > 0) stages.add(`PENDIENTE_${roleId}`)
      }
    })

    return stages
  }, [currentUserApprovalStage, currentUserRoleId, currentUserRoleName, purchaseFlowConfig])

  const normalizePurchasePendingLabel = (value) => {
    const normalizedValue = normalizeStage(value)
    if (!normalizedValue.startsWith('PENDIENTE_')) return normalizedValue
    if (/^PENDIENTE_\d+$/.test(normalizedValue)) return normalizedValue

    const pendingKey = normalizedValue.replace(/^PENDIENTE_/, '')
    const matchedRole = purchaseFlowConfig.find((role) => normalizeRoleName(role?.rol_nombre) === pendingKey)
    if (matchedRole?.rol_id) {
      return `PENDIENTE_${Number(matchedRole.rol_id || 0)}`
    }

    return normalizedValue
  }

  const isCurrentUserPendingStage = (stage) => {
    const normalizedStage = normalizeStage(stage)
    if (!normalizedStage) return false
    if (!isPendingFlowStage(normalizedStage) && normalizedStage !== 'PENDIENTE') return false
    if (currentUserPendingStages.size === 0) {
      return normalizedStage === currentUserApprovalStage || normalizedStage === 'PENDIENTE'
    }
    return currentUserPendingStages.has(normalizedStage)
  }

  const canApproveCompra = (compra) => {
    const stage = getStageStatus(compra)
    return Boolean(view.actions && isCurrentUserPendingStage(stage))
  }

  const filteredCompras = useMemo(() => {
    const userTerm = normalizeSearch(userQuery)
    const materialTerm = normalizeSearch(materialQuery)
    const currentAreaTerm = normalizeSearch(currentUserArea)
    const fromTime = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : null
    const toTime = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : null

    return compras.filter((compra) => {
      const stage = getStageStatus(compra)
      if (activeStatus === 'PENDIENTE' && !isCurrentUserPendingStage(stage)) return false

      if (activeStatus === 'PENDIENTE' && currentUserIsAreaRole && currentAreaTerm) {
        const areaText = normalizeSearch([compra.area_solicitante, compra.area_final].filter(Boolean).join(' '))
        if (!areaText.includes(currentAreaTerm)) return false
      }

      const userText = normalizeSearch([compra.usuario, compra.id_usuario ? `ID ${compra.id_usuario}` : ''].filter(Boolean).join(' '))
      if (userTerm && !userText.includes(userTerm)) return false

      const purchaseTime = new Date(compra.fecha_creacion || compra.fecha || 0).getTime()
      if (fromTime && (!Number.isFinite(purchaseTime) || purchaseTime < fromTime)) return false
      if (toTime && (!Number.isFinite(purchaseTime) || purchaseTime > toTime)) return false

      if (materialTerm) {
        const materialText = normalizeSearch((compra.items || [])
          .map((item) => [item.material, item.descripcion, item.id_material].filter(Boolean).join(' '))
          .join(' | '))
        if (!materialText.includes(materialTerm)) return false
      }

      return true
    })
  }, [compras, userQuery, materialQuery, dateFrom, dateTo, activeStatus, currentUserIsAreaRole, currentUserArea, currentUserPendingStages])

  const pending = useMemo(() => filteredCompras
    .filter((compra) => isPendingFlowStage(getStageStatus(compra)))
    .sort((a, b) => new Date(b.fecha_creacion || 0).getTime() - new Date(a.fecha_creacion || 0).getTime()), [filteredCompras])

  const approved = useMemo(() => filteredCompras
    .filter((compra) => getStageStatus(compra) === 'APROBADO')
    .sort((a, b) => new Date(b.fecha_creacion || 0).getTime() - new Date(a.fecha_creacion || 0).getTime()), [filteredCompras])

  const rejected = useMemo(() => filteredCompras
    .filter((compra) => getStageStatus(compra) === 'RECHAZADO')
    .sort((a, b) => new Date(b.fecha_creacion || 0).getTime() - new Date(a.fecha_creacion || 0).getTime()), [filteredCompras])

  const config = {
    PENDIENTE: { label: 'Pendientes', data: pending, actions: true },
    APROBADA: { label: 'Aprobadas', data: approved, actions: false },
    RECHAZADA: { label: 'Rechazadas', data: rejected, actions: false },
  }

  const view = config[activeStatus]
  const badgeStateForPurchase = (compra) => {
    if (activeStatus === 'APROBADA') {
      return normalizePurchasePendingLabel(compra.estado_pedido || compra.estado || 'Sin estado pedido')
    }

    return normalizePurchasePendingLabel(compra.estado || compra.estado_pedido || 'Sin estado')
  }

  return (
    <section className="purchase-manage-section">
      <div className="section-header">
        <h1>Gestionar Compras</h1>
        <p>Total: {compras.length}</p>
      </div>

      <form className="purchase-filters" onSubmit={(event) => event.preventDefault()}>
        <div className="purchase-filters-grid">
          <label className="purchase-filter-field">
            <span>Usuario</span>
            <input
              type="text"
              value={userQuery}
              onChange={(event) => setUserQuery(event.target.value)}
              placeholder="Usuario"
            />
          </label>

          <label className="purchase-filter-field">
            <span>Material</span>
            <input
              type="text"
              value={materialQuery}
              onChange={(event) => setMaterialQuery(event.target.value)}
              placeholder="Material"
            />
          </label>

          <label className="purchase-filter-field">
            <span>Desde</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
            />
          </label>

          <label className="purchase-filter-field">
            <span>Hasta</span>
            <input
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
            />
          </label>
        </div>
      </form>

      <div className="purchase-status-tabs">
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

      {view.data.length === 0 ? (
        <div className="empty-state">No hay compras en esta seccion.</div>
      ) : (
        <div className="purchase-manage-list">
          {view.data.map((compra) => (
            (() => {
              const ratingState = evaluateProviderRatingState({
                promedio: compra.calificacion_promedio,
                total: compra.calificacion_total,
                alertaCritica: compra.alerta_critica,
              })

              return (
            <article className="purchase-manage-card" key={compra.id}>
              <div className="purchase-manage-head">
                <h3>Compra #{compra.id}</h3>
                <span className={`purchase-status ${normalize(badgeStateForPurchase(compra)).toLowerCase()}`}>
                  {badgeStateForPurchase(compra)}
                </span>
              </div>

              <p><strong>Usuario:</strong> {compra.usuario || `ID ${compra.id_usuario}`}</p>
              <p><strong>Area solicitante:</strong> {compra.area_solicitante || 'Sin area'}</p>
              <p><strong>Fecha:</strong> {compra.fecha_creacion ? new Date(compra.fecha_creacion).toLocaleString() : 'Sin fecha'}</p>
              <div className="purchase-rating-state">
                <p><strong>Estado proveedor:</strong> {ratingState.averageLabel}</p>
                <span className={`purchase-state-chip ${ratingState.colorClass}`}>{ratingState.label}</span>
              </div>
              {ratingState.showLowAlert && (
                <p className="purchase-alert-warning">Se recomienda evaluar cambio de proveedor</p>
              )}
              {canSeeCriticalAlert && ratingState.showCriticalAlert && (
                <p className="purchase-alert-critical">Proveedor con calificacion critica, se recomienda contactar</p>
              )}

              <div>
                <strong>Materiales solicitados:</strong>
                <ul>
                  {(compra.items || []).map((item) => (
                    <li key={`${compra.id}-${item.id_detalle}`}>
                      {item.material || item.descripcion || 'Material'} - {item.cantidad}
                    </li>
                  ))}
                </ul>
              </div>

              {view.actions && canApproveCompra(compra) && (
                <div className="purchase-manage-actions">
                  <button className="btn-approve" onClick={() => onChangeEstado(compra.id, 'APROBADA')}>Aprobar</button>
                  <button className="btn-reject" onClick={() => onChangeEstado(compra.id, 'RECHAZADA')}>Rechazar</button>
                </div>
              )}
            </article>
              )
            })()
          ))}
        </div>
      )}
    </section>
  )
}
