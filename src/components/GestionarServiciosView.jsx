import { useMemo, useState } from 'react'
import '../styles/GestionarServiciosView.css'

const normalize = (value) => String(value || '').trim().toUpperCase()
const getStageStatus = (servicio) => {
  const userStage = normalize(servicio?.gestion_estado_usuario)
  if (userStage) return userStage
  return normalize(servicio?.estado_aprobacion)
}
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

export default function GestionarServiciosView({ servicios = [], onChangeAprobacion }) {
  const [activeStatus, setActiveStatus] = useState('PENDIENTE')
  const [activePriority, setActivePriority] = useState('TODAS')

  const sortByPriorityAndDate = (items) => [...items].sort((a, b) => {
    const priorityDiff = priorityRank(a.prioridad) - priorityRank(b.prioridad)
    if (priorityDiff !== 0) return priorityDiff
    return new Date(b.fecha || 0).getTime() - new Date(a.fecha || 0).getTime()
  })

  const pending = useMemo(() => sortByPriorityAndDate(
    servicios.filter((servicio) => getStageStatus(servicio) === 'PENDIENTE')
  ), [servicios])

  const approved = useMemo(() => sortByPriorityAndDate(
    servicios.filter((servicio) => getStageStatus(servicio) === 'APROBADO')
  ), [servicios])

  const rejected = useMemo(() => sortByPriorityAndDate(
    servicios.filter((servicio) => getStageStatus(servicio) === 'RECHAZADO')
  ), [servicios])

  const config = {
    PENDIENTE: { label: 'Pendientes', data: pending, actions: true },
    APROBADO: { label: 'Aprobados', data: approved, actions: false },
    RECHAZADO: { label: 'Rechazados', data: rejected, actions: false },
  }

  const view = config[activeStatus]
  const filteredViewData = useMemo(() => {
    const byStatus = view.data || []
    if (activePriority === 'TODAS') return byStatus
    return byStatus.filter((servicio) => normalize(servicio.prioridad) === activePriority)
  }, [view.data, activePriority])

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
                  {servicio.estado_aprobacion_detalle || servicio.estado_aprobacion}
                </span>
              </div>

              <p><strong>Area:</strong> {servicio.area || 'Sin area'}</p>
              <p><strong>Nombre:</strong> {servicio.nombre_servicio || servicio.descripcion_servicio || 'Sin nombre'}</p>
              <p><strong>Prioridad:</strong> {servicio.prioridad || 'MEDIA'}</p>
              <p><strong>Descripcion:</strong> {servicio.descripcion_servicio || 'Sin descripcion'}</p>
              <p><strong>Estado servicio:</strong> {statusLabel(servicio.estado_servicio)}</p>
              <p><strong>Fecha:</strong> {servicio.fecha ? new Date(servicio.fecha).toLocaleString() : 'Sin fecha'}</p>

              {view.actions && (
                <div className="service-manage-actions">
                  {servicio.puede_aprobar ? (
                    <>
                      <button className="btn-approve" onClick={() => onChangeAprobacion(servicio.id, 'APROBADO')}>
                        Aprobar
                      </button>
                      <button className="btn-reject" onClick={() => onChangeAprobacion(servicio.id, 'RECHAZADO')}>
                        Rechazar
                      </button>
                    </>
                  ) : (
                    <span className="empty-state">Pendiente de otro nivel de aprobacion.</span>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
