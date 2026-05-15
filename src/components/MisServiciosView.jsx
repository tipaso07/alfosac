import { useMemo, useState } from 'react'
import '../styles/MisServiciosView.css'

const normalize = (value) => String(value || '').trim().toUpperCase()

const toStatusLabel = (value) => (normalize(value) === 'PENDIENTE' ? 'PENDIENTE DE REALIZACION' : (value || 'N/A'))
const toWorkflowStatus = (servicio) => {
  const aprobacion = normalize(servicio.estado_aprobacion)
  const estadoFlujo = normalize(servicio.estado_flujo)

  if (aprobacion === 'PENDIENTE') return 'PENDIENTE'
  if (aprobacion === 'APROBADO' && estadoFlujo === 'PENDIENTE') return 'PENDIENTE DE REALIZACION'
  if (aprobacion === 'APROBADO' && estadoFlujo === 'REALIZADO') return 'REALIZADO'
  if (aprobacion === 'APROBADO' && estadoFlujo === 'DATOS_COMPLETADOS') return 'DATOS_COMPLETADOS'
  if (aprobacion === 'APROBADO') return 'APROBADO'
  return aprobacion || 'N/A'
}

export default function MisServiciosView({ servicios = [] }) {
  const [areaFilter, setAreaFilter] = useState('TODAS')
  const [statusFilter, setStatusFilter] = useState('TODOS')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  const areas = useMemo(() => {
    return ['TODAS', ...new Set(servicios.map((s) => String(s.area || '').trim()).filter(Boolean))]
  }, [servicios])

  const filteredServicios = useMemo(() => {
    const fromTime = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : null
    const toTime = toDate ? new Date(`${toDate}T23:59:59`).getTime() : null

    return servicios.filter((servicio) => {
      const areaMatch = areaFilter === 'TODAS' || String(servicio.area || '').trim() === areaFilter
      if (!areaMatch) return false

      const status = toWorkflowStatus(servicio)
      const statusMatch = statusFilter === 'TODOS' || status === statusFilter
      if (!statusMatch) return false

      const createdAt = new Date(servicio.fecha || 0).getTime()
      if (Number.isFinite(fromTime) && createdAt < fromTime) return false
      if (Number.isFinite(toTime) && createdAt > toTime) return false
      return true
    })
  }, [servicios, areaFilter, statusFilter, fromDate, toDate])

  return (
    <section className="my-services-section">
      <div className="section-header">
        <h1>Historial de Servicios</h1>
        <p>Total filtrado: {filteredServicios.length}</p>
      </div>

      <div className="my-services-filters">
        <label>
          Area
          <select value={areaFilter} onChange={(event) => setAreaFilter(event.target.value)}>
            {areas.map((area) => (
              <option key={area} value={area}>{area}</option>
            ))}
          </select>
        </label>

        <label>
          Estado
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="TODOS">TODOS</option>
            <option value="PENDIENTE">PENDIENTE</option>
            <option value="APROBADO">APROBADO</option>
            <option value="DATOS_COMPLETADOS">DATOS_COMPLETADOS</option>
            <option value="PENDIENTE DE REALIZACION">PENDIENTE DE REALIZACION</option>
            <option value="REALIZADO">REALIZADO</option>
          </select>
        </label>

        <label>
          Desde
          <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
        </label>

        <label>
          Hasta
          <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
        </label>
      </div>

      {filteredServicios.length === 0 ? (
        <div className="empty-state">Aun no tienes servicios registrados.</div>
      ) : (
        <div className="my-services-list">
          {filteredServicios.map((servicio) => {
            return (
              <article className="my-service-card" key={servicio.id}>
                <h3>Servicio #{servicio.id}</h3>
                <p><strong>Area:</strong> {servicio.area || 'Sin area'}</p>
                <p><strong>Nombre:</strong> {servicio.nombre_servicio || servicio.descripcion_servicio || 'Sin nombre'}</p>
                <p><strong>Prioridad:</strong> {servicio.prioridad || 'MEDIA'}</p>
                <p><strong>Proveedor:</strong> {servicio.proveedor || 'Sin proveedor'}</p>
                <p><strong>Servicio:</strong> {servicio.descripcion_servicio || 'Sin descripcion'}</p>
                <p><strong>Costo:</strong> {Number(servicio.costo || 0).toFixed(2)} {servicio.moneda || ''}</p>
                <p><strong>Estado aprobacion:</strong> {servicio.estado_aprobacion || 'N/A'}</p>
                <p><strong>Estado flujo:</strong> {toStatusLabel(servicio.estado_flujo)}</p>
                <p><strong>Estado flujo:</strong> {toWorkflowStatus(servicio)}</p>
                <p><strong>Fecha:</strong> {servicio.fecha ? new Date(servicio.fecha).toLocaleString() : 'Sin fecha'}</p>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
