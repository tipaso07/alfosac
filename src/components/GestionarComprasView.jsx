import { useMemo, useState } from 'react'
import '../styles/GestionarComprasView.css'
import { evaluateProviderRatingState } from '../services/providerRatingRules'
import { hasPermission } from '../services/permissions'

const normalize = (value) => String(value || '').trim().toUpperCase()
const isPendingFlowStage = (value) => normalize(value).startsWith('PENDIENTE')
const APPROVAL_PERMISSION_BY_STAGE = {
  PENDIENTE_JEFE_AREA: 'APROBAR_JEFE_AREA',
  PENDIENTE_GERENCIA: 'APROBAR_GERENCIA_AREA',
  PENDIENTE_FINANZAS: 'APROBAR_FINANZAS',
  PENDIENTE_ADMIN: 'APROBAR_ADMIN',
}
const getStageStatus = (compra) => {
  const userStage = normalize(compra?.gestion_estado_usuario)
  if (userStage) return userStage
  return normalize(compra?.estado)
}

const canApproveCompra = (compra, currentUserPermissions = []) => {
  const stage = getStageStatus(compra)
  const permission = APPROVAL_PERMISSION_BY_STAGE[stage]
  if (!permission) return false
  if (!hasPermission(currentUserPermissions, permission)) return false
  return Boolean(compra?.puede_aprobar)
}

export default function GestionarComprasView({ compras = [], currentUserRoleId = null, currentUserPermissions = [], onChangeEstado }) {
  const [activeStatus, setActiveStatus] = useState('PENDIENTE')
  const canSeeCriticalAlert = Number(currentUserRoleId || 0) === 9

  const pending = useMemo(() => compras
    .filter((compra) => isPendingFlowStage(getStageStatus(compra)))
    .sort((a, b) => new Date(b.fecha_creacion || 0).getTime() - new Date(a.fecha_creacion || 0).getTime()), [compras])

  const approved = useMemo(() => compras
    .filter((compra) => ['APROBADA', 'APROBADO'].includes(getStageStatus(compra)))
    .sort((a, b) => new Date(b.fecha_creacion || 0).getTime() - new Date(a.fecha_creacion || 0).getTime()), [compras])

  const rejected = useMemo(() => compras
    .filter((compra) => getStageStatus(compra) === 'RECHAZADA')
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
                <span className={`purchase-status ${normalize(compra.estado).toLowerCase()}`}>
                  {compra.estado_aprobacion_detalle || compra.estado}
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

              {view.actions && canApproveCompra(compra, currentUserPermissions) && (
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
