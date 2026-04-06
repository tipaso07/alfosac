import { useMemo, useState } from 'react'
import '../styles/MisRequerimientosView.css'

const normalize = (value) => String(value || '').trim().toUpperCase()

export default function MisRequerimientosView({ requerimientos = [] }) {
  const [statusFilter, setStatusFilter] = useState('TODOS')
  const [fechaInicio, setFechaInicio] = useState('')
  const [fechaFin, setFechaFin] = useState('')

  const statusOptions = [
    { id: 'TODOS', label: 'Todos' },
    { id: 'PENDIENTE', label: 'Pendiente' },
    { id: 'APROBADO', label: 'Aprobado' },
    { id: 'DESAPROBADO', label: 'Desaprobado' },
    { id: 'POR_RECOGER', label: 'Por recoger' },
    { id: 'ENTREGADO', label: 'Entregado' },
  ]

  const filtered = useMemo(() => {
    const startDate = fechaInicio ? new Date(`${fechaInicio}T00:00:00`) : null
    const endDate = fechaFin ? new Date(`${fechaFin}T23:59:59.999`) : null

    const byStatus = (req) => {
      const estado = normalize(req.estado)
      const estadoEntrega = normalize(req.estado_entrega)

      if (statusFilter === 'PENDIENTE') return estado === 'PENDIENTE'
      if (statusFilter === 'APROBADO') return estado === 'APROBADO' && estadoEntrega === 'POR_RECOGER'
      if (statusFilter === 'DESAPROBADO') return estado === 'RECHAZADO'
      if (statusFilter === 'POR_RECOGER') return estadoEntrega === 'POR_RECOGER'
      if (statusFilter === 'ENTREGADO') return estadoEntrega === 'ENTREGADO'
      return true
    }

    return (requerimientos || [])
      .filter(byStatus)
      .filter((req) => {
        if (!startDate && !endDate) return true
        const reqDate = req.fecha_creacion ? new Date(req.fecha_creacion) : null
        if (!reqDate || Number.isNaN(reqDate.getTime())) return false
        if (startDate && reqDate < startDate) return false
        if (endDate && reqDate > endDate) return false
        return true
      })
      .sort((a, b) => {
        const dateA = new Date(a.fecha_creacion || 0).getTime()
        const dateB = new Date(b.fecha_creacion || 0).getTime()
        if (dateA !== dateB) return dateB - dateA
        return Number(b.id || 0) - Number(a.id || 0)
      })
  }, [requerimientos, statusFilter, fechaInicio, fechaFin])

  return (
    <section className="my-req-section">
      <div className="section-header">
        <h1>Mis Requerimientos</h1>
        <p>Total: {filtered.length}</p>
      </div>

      <div className="my-req-status-filters" role="tablist" aria-label="Filtros por estado">
        {statusOptions.map((option) => (
          <button
            key={option.id}
            type="button"
            className={`my-req-status-btn ${statusFilter === option.id ? 'active' : ''}`}
            onClick={() => setStatusFilter(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="my-req-date-grid">
        <label htmlFor="my-req-fecha-inicio" className="my-req-date-field">
          <span>Fecha inicio</span>
          <input
            id="my-req-fecha-inicio"
            type="date"
            value={fechaInicio}
            onChange={(event) => setFechaInicio(event.target.value)}
          />
        </label>

        <label htmlFor="my-req-fecha-fin" className="my-req-date-field">
          <span>Fecha fin</span>
          <input
            id="my-req-fecha-fin"
            type="date"
            value={fechaFin}
            onChange={(event) => setFechaFin(event.target.value)}
          />
        </label>

        <button
          type="button"
          className="my-req-clear-dates"
          onClick={() => {
            setFechaInicio('')
            setFechaFin('')
          }}
        >
          Limpiar fechas
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">No hay requerimientos para los filtros seleccionados.</div>
      ) : (
        <div className="my-req-list">
          {filtered.map((req) => (
            <article className="my-req-card" key={req.id}>
              <div className="my-req-head">
                <h3>Requerimiento #{req.id}</h3>
                <div className="my-req-badges">
                  <span className={`my-req-badge estado-${normalize(req.estado).toLowerCase()}`}>
                    {req.estado || 'N/A'}
                  </span>
                  <span className={`my-req-badge entrega-${normalize(req.estado_entrega).toLowerCase()}`}>
                    {req.estado_entrega || 'N/A'}
                  </span>
                </div>
              </div>

              <p><strong>Descripcion:</strong> {req.descripcion || 'Sin descripcion'}</p>
              <p><strong>Estado:</strong> {req.estado || 'N/A'}</p>
              <p><strong>Estado de entrega:</strong> {req.estado_entrega || 'N/A'}</p>
              <p><strong>Fecha de creacion:</strong> {req.fecha_creacion ? new Date(req.fecha_creacion).toLocaleString() : 'Sin fecha'}</p>
              <p><strong>Area destinada:</strong> {req.area || 'Sin area'}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
