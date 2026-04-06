import { useMemo, useState } from 'react'
import '../styles/HistorialServiciosView.css'

const normalize = (value) => String(value || '').trim().toUpperCase()

const getFlow = (servicio) => normalize(servicio.estado_flujo || servicio.estado_servicio || '')

const isRealizado = (servicio) => {
  const flow = getFlow(servicio)
  return flow === 'REALIZADO' || normalize(servicio.estado_servicio) === 'REALIZADO'
}

const isAprobado = (servicio) => normalize(servicio.estado_aprobacion) === 'APROBADO'

const parseDate = (value) => {
  const parsed = new Date(value || '')
  return Number.isFinite(parsed.getTime()) ? parsed : null
}

export default function HistorialServiciosView({ servicios = [] }) {
  const [areaFilter, setAreaFilter] = useState('TODAS')
  const [prioridadFilter, setPrioridadFilter] = useState('TODAS')
  const [fromDate, setFromDate] = useState('')
  const [toDateFilter, setToDateFilter] = useState('')
  const [searchTerm, setSearchTerm] = useState('')

  const serviciosRealizados = useMemo(() => {
    return (servicios || [])
      .filter((servicio) => isAprobado(servicio) && isRealizado(servicio))
      .sort((a, b) => {
        const left = parseDate(a.fecha)?.getTime() || 0
        const right = parseDate(b.fecha)?.getTime() || 0
        return right - left
      })
  }, [servicios])

  const areas = useMemo(() => {
    const values = serviciosRealizados
      .map((servicio) => String(servicio.area || '').trim())
      .filter(Boolean)
    return ['TODAS', ...new Set(values)]
  }, [serviciosRealizados])

  const prioridades = useMemo(() => {
    const values = serviciosRealizados
      .map((servicio) => normalize(servicio.prioridad || 'SIN PRIORIDAD'))
      .filter(Boolean)
    return ['TODAS', ...new Set(values)]
  }, [serviciosRealizados])

  const filteredServices = useMemo(() => {
    const term = String(searchTerm || '').trim().toLowerCase()
    const fromTime = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : null
    const toTime = toDateFilter ? new Date(`${toDateFilter}T23:59:59`).getTime() : null

    return serviciosRealizados.filter((servicio) => {
      const area = String(servicio.area || '').trim()
      const prioridad = normalize(servicio.prioridad || 'SIN PRIORIDAD')
      const createdAt = parseDate(servicio.fecha)?.getTime() || 0
      const haystack = [
        servicio.nombre_servicio,
        servicio.descripcion_servicio,
        servicio.proveedor,
        servicio.area,
        servicio.id,
      ]
        .map((value) => String(value || '').toLowerCase())
        .join(' ')

      if (areaFilter !== 'TODAS' && area !== areaFilter) return false
      if (prioridadFilter !== 'TODAS' && prioridad !== prioridadFilter) return false
      if (Number.isFinite(fromTime) && createdAt < fromTime) return false
      if (Number.isFinite(toTime) && createdAt > toTime) return false
      if (term && !haystack.includes(term)) return false
      return true
    })
  }, [serviciosRealizados, areaFilter, prioridadFilter, fromDate, toDateFilter, searchTerm])

  return (
    <section className="hs-section">
      <header className="hs-header">
        <h1>Historial de servicios</h1>
        <p>Total realizados: {filteredServices.length} de {serviciosRealizados.length}</p>
      </header>

      <div className="hs-filters">
        <label>
          Buscar
          <input
            type="text"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Servicio, proveedor, area o ID"
          />
        </label>

        <label>
          Area
          <select value={areaFilter} onChange={(event) => setAreaFilter(event.target.value)}>
            {areas.map((area) => (
              <option key={area} value={area}>{area}</option>
            ))}
          </select>
        </label>

        <label>
          Prioridad
          <select value={prioridadFilter} onChange={(event) => setPrioridadFilter(event.target.value)}>
            {prioridades.map((prioridad) => (
              <option key={prioridad} value={prioridad}>{prioridad}</option>
            ))}
          </select>
        </label>

        <label>
          Desde
          <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
        </label>

        <label>
          Hasta
          <input type="date" value={toDateFilter} onChange={(event) => setToDateFilter(event.target.value)} />
        </label>
      </div>

      {filteredServices.length === 0 ? (
        <div className="hs-empty">No hay servicios realizados con los filtros actuales.</div>
      ) : (
        <div className="hs-list">
          {filteredServices.map((servicio) => (
            <article className="hs-card" key={servicio.id}>
              <div className="hs-head">
                <h3>Servicio #{servicio.id}</h3>
                <span className="hs-status">REALIZADO</span>
              </div>

              <p><strong>Nombre:</strong> {servicio.nombre_servicio || 'Sin nombre'}</p>
              <p><strong>Descripcion:</strong> {servicio.descripcion_servicio || 'Sin descripcion'}</p>
              <p><strong>Area:</strong> {servicio.area || 'Sin area'}</p>
              <p><strong>Prioridad:</strong> {servicio.prioridad || 'SIN PRIORIDAD'}</p>
              <p><strong>Proveedor:</strong> {servicio.proveedor || 'Sin proveedor'}</p>
              <p><strong>Fecha:</strong> {parseDate(servicio.fecha)?.toLocaleDateString() || 'Sin fecha'}</p>
              <p><strong>Total:</strong> {Number(servicio.total || servicio.costo || 0).toFixed(2)} {servicio.moneda || ''}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
