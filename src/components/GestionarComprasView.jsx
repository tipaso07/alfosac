import { useMemo, useState, useEffect } from 'react'
import '../styles/GestionarComprasView.css'
import { evaluateProviderRatingState } from '../services/providerRatingRules'
import { hasPermission } from '../services/permissions'
import { fetchApprovalConfig } from '../services/api'

const normalize = (value) => String(value || '').trim().toUpperCase()
// Only matches PENDIENTE_* format (with underscore and role name), not bare 'PENDIENTE'
const isPendingFlowStage = (value) => normalize(value).startsWith('PENDIENTE_')
const getStageStatus = (compra) => {
  const userStage = normalize(compra?.gestion_estado_usuario)
  if (userStage) return userStage
  const detailStage = normalize(compra?.estado_aprobacion_detalle)
  if (detailStage) return detailStage
  return normalize(compra?.estado_pedido || compra?.estado)
}

export default function GestionarComprasView({ compras = [], currentUserRoleId = null, currentUserPermissions = [], onChangeEstado }) {
  const [activeStatus, setActiveStatus] = useState('PENDIENTE')
  const [approvalConfig, setApprovalConfig] = useState([])
  const canSeeCriticalAlert = hasPermission(currentUserPermissions, 'GESTIONAR_COMPRAS')

  useEffect(() => {
    fetchApprovalConfig().then(setApprovalConfig).catch(console.error)
  }, [])

  const approvalPermissionByStage = useMemo(() => {
    const map = {}
    const config = Array.isArray(approvalConfig) ? approvalConfig : []
    config.forEach(role => {
      map[`PENDIENTE_${role.id}`] = `APROBAR_${role.id}`
    })
    return map
  }, [approvalConfig])

  const canApproveCompra = (compra) => {
    // Si está en estado PENDIENTE y puede_aprobar es true, mostrar botón
    const stage = getStageStatus(compra)
    if (!isPendingFlowStage(stage)) return false
    return Boolean(compra?.puede_aprobar)
  }

  const pending = useMemo(() => compras
    .filter((compra) => isPendingFlowStage(getStageStatus(compra)))
    .sort((a, b) => new Date(b.fecha_creacion || 0).getTime() - new Date(a.fecha_creacion || 0).getTime()), [compras])

  const approved = useMemo(() => compras
    .filter((compra) => getStageStatus(compra) === 'APROBADO')
    .sort((a, b) => new Date(b.fecha_creacion || 0).getTime() - new Date(a.fecha_creacion || 0).getTime()), [compras])

  const rejected = useMemo(() => compras
    .filter((compra) => getStageStatus(compra) === 'RECHAZADO')
    .sort((a, b) => new Date(b.fecha_creacion || 0).getTime() - new Date(a.fecha_creacion || 0).getTime()), [compras])

  const config = {
    PENDIENTE: { label: 'Pendientes', data: pending, actions: true },
    APROBADA: { label: 'Aprobadas', data: approved, actions: false },
    RECHAZADA: { label: 'Rechazadas', data: rejected, actions: false },
  }

  const view = config[activeStatus]

  return (
    <section className="purchase-manage-section">
      <div className="section-header">
        <h1>Gestionar Compras</h1>
        <p>Total: {compras.length}</p>
      </div>

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
                <span className={`purchase-status ${normalize(compra.estado_pedido || compra.estado).toLowerCase()}`}>
                  {compra.estado_aprobacion_detalle || (compra.estado_pedido || compra.estado)}
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
