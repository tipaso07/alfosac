import { useMemo, useState } from 'react'
import '../styles/GestionarComprasView.css'
import '../styles/RequerimientosManager.css'

const PRIORITY_ORDER = { ALTA: 1, MEDIA: 2, BAJA: 3 }

const normalize = (value) => String(value || '').trim().toUpperCase()
const normalizeSearch = (value) => String(value || '')
  .trim()
  .toUpperCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')

export default function RequerimientosManager({
  requerimientos,
  onChangeEstado,
  currentUserRoleId = null,
}) {
  const formatPriority = (value) => {
    const normalized = normalize(value)
    if (normalized === 'ALTA') return 'Alta'
    if (normalized === 'MEDIA') return 'Media'
    if (normalized === 'BAJA') return 'Baja'
    return value || 'N/A'
  }

  const [activeStatus, setActiveStatus] = useState('PENDIENTE')
  const [activePriority, setActivePriority] = useState('TODAS')
  const [userQuery, setUserQuery] = useState('')
  const [materialQuery, setMaterialQuery] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const baseFiltered = useMemo(() => {
    const userTerm = normalizeSearch(userQuery)
    const materialTerm = normalizeSearch(materialQuery)
    const fromTime = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : null
    const toTime = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : null

    return (requerimientos || []).filter((req) => {
      const userText = normalizeSearch([req.usuario, req.id_usuario ? `ID ${req.id_usuario}` : ''].filter(Boolean).join(' '))
      if (userTerm && !userText.includes(userTerm)) return false

      const reqTime = new Date(req.fecha_creacion || 0).getTime()
      if (fromTime && (!Number.isFinite(reqTime) || reqTime < fromTime)) return false
      if (toTime && (!Number.isFinite(reqTime) || reqTime > toTime)) return false

      if (materialTerm) {
        const materialText = normalizeSearch((req.items || [])
          .map((item) => [item.material, item.descripcion, item.id_material].filter(Boolean).join(' '))
          .join(' | '))
        if (!materialText.includes(materialTerm)) return false
      }

      if (activePriority !== 'TODAS' && normalize(req.prioridad) !== activePriority) return false

      return true
    })
  }, [requerimientos, userQuery, materialQuery, dateFrom, dateTo, activePriority])

  const pendientes = useMemo(() => {
    return baseFiltered
      .filter((req) => normalize(req.estado) === 'PENDIENTE')
      .sort((a, b) => {
        const priorityA = PRIORITY_ORDER[normalize(a.prioridad)] || 99
        const priorityB = PRIORITY_ORDER[normalize(b.prioridad)] || 99
        if (priorityA !== priorityB) return priorityA - priorityB

        const dateA = new Date(a.fecha_creacion || 0).getTime()
        const dateB = new Date(b.fecha_creacion || 0).getTime()
        if (dateA !== dateB) return dateA - dateB
        return Number(a.id || 0) - Number(b.id || 0)
      })
  }, [baseFiltered])

  const aprobados = useMemo(() => {
    return baseFiltered
      .filter((req) => normalize(req.estado) === 'APROBADO')
      .sort((a, b) => {
        const dateA = new Date(a.fecha_creacion || 0).getTime()
        const dateB = new Date(b.fecha_creacion || 0).getTime()
        if (dateA !== dateB) return dateB - dateA
        return Number(b.id || 0) - Number(a.id || 0)
      })
  }, [baseFiltered])

  const rechazados = useMemo(() => {
    return baseFiltered
      .filter((req) => normalize(req.estado) === 'RECHAZADO')
      .sort((a, b) => {
        const dateA = new Date(a.fecha_creacion || 0).getTime()
        const dateB = new Date(b.fecha_creacion || 0).getTime()
        if (dateA !== dateB) return dateB - dateA
        return Number(b.id || 0) - Number(a.id || 0)
      })
  }, [baseFiltered])

  const totalVisible = pendientes.length + aprobados.length + rechazados.length

  const renderCard = (req, showActions = false, showPriority = true) => (
    <article className="purchase-manage-card" key={req.id}>
      <div className="purchase-manage-head">
        <div>
          <h3>Requerimiento #{req.id}</h3>
          <p>Usuario solicitante: {req.usuario || `ID ${req.id_usuario}`}</p>
          <p>Area destinada: {req.area || 'Sin area'}</p>
          {showPriority && <p>Prioridad: {formatPriority(req.prioridad)}</p>}
          <p>Fecha de creacion: {req.fecha_creacion ? new Date(req.fecha_creacion).toLocaleString() : 'Sin fecha'}</p>
          {req.nombre_receptor && <p>Receptor: {req.nombre_receptor}</p>}
          {req.dni_receptor && <p>DNI receptor: {req.dni_receptor}</p>}
        </div>
        <div className="purchase-meta">
          <span className={`purchase-status ${String(req.estado || '').toLowerCase()}`}>
            {req.estado}
          </span>
          {showPriority && <span className="purchase-priority">{formatPriority(req.prioridad)}</span>}
        </div>
      </div>

      <p className="req-description">{req.descripcion || 'Sin descripcion'}</p>

      <div className="req-items">
        <strong>Materiales solicitados:</strong>
        <ul>
          {(req.items || []).map((item, idx) => (
            <li key={`${req.id}-${item.id_material}-${idx}`}>
              {item.material || `Material ${item.id_material}`} - Cantidad: {item.cantidad}
            </li>
          ))}
        </ul>
      </div>

      {showActions && (
        <div className="purchase-actions">
          {req.puede_aprobar ? (
            <>
              <button className="btn-approve" onClick={() => onChangeEstado(req.id, 'APROBADO')}>
                Aprobar
              </button>
              <button className="btn-reject" onClick={() => onChangeEstado(req.id, 'RECHAZADO')}>
                Rechazar
              </button>
            </>
          ) : null}
        </div>
      )}
    </article>
  )

  const isSolicitante = Number(currentUserRoleId || 0) === 4

  const config = {
    PENDIENTE: { label: 'Pendientes', data: pendientes, actions: !isSolicitante },
    APROBADO: { label: 'Aprobados', data: aprobados, actions: false },
    RECHAZADO: { label: 'Rechazados', data: rechazados, actions: false },
  }

  const view = config[activeStatus]

  return (
    <section className="purchase-manage-section">
      <div className="section-header">
        <h1>Gestionar Requerimientos</h1>
        <p>Total: {totalVisible}</p>
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
        <div className="empty-state">No hay requerimientos en esta seccion.</div>
      ) : (
        <div className="purchase-manage-list">
          {view.data.map((req) => (
            renderCard(req, view.actions, activeStatus === 'PENDIENTE')
          ))}
        </div>
      )}
    </section>
  )
}
