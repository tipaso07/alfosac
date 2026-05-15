import { useMemo, useState } from 'react'
import { guardarCalificacionProveedor, marcarServicioRealizado } from '../services/api'
import { hasPermission } from '../services/permissions'
import '../styles/HistorialServiciosView.css'

const normalize = (value) => String(value || '').trim().toUpperCase()

const getFlow = (servicio) => normalize(servicio.estado_flujo || '')

const isRealizado = (servicio) => {
  const flow = getFlow(servicio)
  return ['REALIZADO', 'COMPLETADO', 'FINALIZADO'].includes(flow)
}

const isPendienteOAprobado = (servicio) => {
  const flow = getFlow(servicio)
  return ['PENDIENTE', 'REALIZADO'].includes(flow)
}

const isAprobado = (servicio) => ['APROBADO', 'APROBADA'].includes(normalize(servicio.estado_aprobacion))

const isRated = (servicio, ratedById = {}) => Boolean(ratedById[servicio?.id]) || Boolean(servicio?.calificacion_servicio_existe)

const canRateProvider = (servicio, ratedById = {}) => {
  const providerId = Number(servicio?.proveedor_id || 0)
  return Boolean(providerId) && isRealizado(servicio) && !isRated(servicio, ratedById)
}

const parseDate = (value) => {
  const parsed = new Date(value || '')
  return Number.isFinite(parsed.getTime()) ? parsed : null
}

export default function HistorialServiciosView({ servicios = [], currentUserRoleId = null, currentUserPermissions = [] }) {
  const [areaFilter, setAreaFilter] = useState('TODAS')
  const [prioridadFilter, setPrioridadFilter] = useState('TODAS')
  const [fromDate, setFromDate] = useState('')
  const [toDateFilter, setToDateFilter] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [ratingService, setRatingService] = useState(null)
  const [ratingForm, setRatingForm] = useState({ puntuacion: 5, comentario: '' })
  const [ratingSaving, setRatingSaving] = useState(false)
  const [ratingError, setRatingError] = useState('')
  const [ratingNotice, setRatingNotice] = useState('')
  const [ratedByServiceId, setRatedByServiceId] = useState({})
  const [ratingSnapshotByServiceId, setRatingSnapshotByServiceId] = useState({})
  const canCurrentUserRate = useMemo(() => {
    return hasPermission(currentUserPermissions, 'CALIFICAR_COMPRA')
      || hasPermission(currentUserPermissions, 'CALIFICAR_REQUERIMIENTO')
        || hasPermission(currentUserPermissions, 'CALIFICAR_SERVICIO')
        || hasPermission(currentUserPermissions, 'VER_HISTORIAL_SERVICIOS')
      || [2, 3, 5, 7, 8, 9].includes(Number(currentUserRoleId || 0))
  }, [currentUserPermissions, currentUserRoleId])

  const serviciosRealizados = useMemo(() => {
    return (servicios || [])
      .filter((servicio) => isAprobado(servicio) && isPendienteOAprobado(servicio))
      .sort((a, b) => {
        const left = parseDate(a.fecha)?.getTime() || 0
        const right = parseDate(b.fecha)?.getTime() || 0
        return right - left
      })
  }, [servicios])

  const areas = useMemo(() => {
    const values = (servicios || [])
      .map((servicio) => String(servicio.area || '').trim())
      .filter(Boolean)
    return ['TODAS', ...new Set(values)]
  }, [servicios])

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

  const openRatingModal = (servicio) => {
    if (!canCurrentUserRate || isRated(servicio, ratedByServiceId)) return
    setRatingService(servicio)
    setRatingError('')
    setRatingForm({ puntuacion: 5, comentario: '' })
  }

  const closeRatingModal = () => {
    if (ratingSaving) return
    setRatingService(null)
    setRatingError('')
    setRatingForm({ puntuacion: 5, comentario: '' })
  }

  const submitRating = async (event) => {
    event.preventDefault()
    if (!ratingService) return

    if (!canCurrentUserRate) {
      setRatingError('No autorizado')
      return
    }

    const providerId = Number(ratingService.proveedor_id || 0)
    const puntuacion = Number(ratingForm.puntuacion || 0)

    if (!Number.isInteger(providerId) || providerId <= 0) {
      setRatingError('No se pudo resolver el proveedor de este servicio')
      return
    }

    if (!Number.isInteger(puntuacion) || puntuacion < 1 || puntuacion > 5) {
      setRatingError('Selecciona una puntuacion entre 1 y 5')
      return
    }

    try {
      setRatingSaving(true)
      setRatingError('')
      await guardarCalificacionProveedor(providerId, {
        tipo: 'servicio',
        id_referencia: Number(ratingService.id || 0),
        puntuacion,
        comentario: String(ratingForm.comentario || '').trim(),
      })
      
      // Marcar servicio como realizado
      await marcarServicioRealizado(Number(ratingService.id || 0))
      
      setRatedByServiceId((prev) => ({ ...prev, [ratingService.id]: true }))
      setRatingSnapshotByServiceId((prev) => ({
        ...prev,
        [ratingService.id]: {
          puntuacion,
          comentario: String(ratingForm.comentario || '').trim(),
        },
      }))
      setRatingNotice('Servicio finalizado y proveedor calificado')
      closeRatingModal()
    } catch (error) {
      const message = String(error?.message || 'Error al guardar la calificacion')
      if (message.toLowerCase().includes('ya calificaste')) {
        setRatedByServiceId((prev) => ({ ...prev, [ratingService.id]: true }))
        setRatingNotice('Proveedor ya calificado')
        closeRatingModal()
      } else {
        setRatingError(message)
      }
    } finally {
      setRatingSaving(false)
    }
  }

  return (
    <section className="hs-section">
      <header className="hs-header">
        <h1>Historial de servicios</h1>
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
                <span className="hs-status">{getFlow(servicio)}</span>
              </div>

              <p><strong>Nombre:</strong> {servicio.nombre_servicio || 'Sin nombre'}</p>
              <p><strong>Descripcion:</strong> {servicio.descripcion_servicio || 'Sin descripcion'}</p>
              <p><strong>Area:</strong> {servicio.area || 'Sin area'}</p>
              <p><strong>Prioridad:</strong> {servicio.prioridad || 'SIN PRIORIDAD'}</p>
              <p><strong>Proveedor:</strong> {servicio.proveedor || 'Sin proveedor'}</p>
              {(() => {
                const snapshot = ratingSnapshotByServiceId[servicio.id] || null
                const score = Number(snapshot?.puntuacion ?? servicio.calificacion_servicio_puntuacion ?? 0)
                const comment = String(snapshot?.comentario ?? servicio.calificacion_servicio_comentario ?? '').trim()
                const hasRating = score > 0 || isRated(servicio, ratedByServiceId)

                if (!hasRating) {
                  return <p><strong>Calificación proveedor:</strong> Sin calificación</p>
                }

                return (
                  <>
                    <p><strong>Calificación proveedor:</strong> ⭐ {score.toFixed(0)} / 5</p>
                    {comment ? <p><strong>Comentario:</strong> {comment}</p> : null}
                  </>
                )
              })()}
              <p><strong>Fecha:</strong> {parseDate(servicio.fecha)?.toLocaleDateString() || 'Sin fecha'}</p>
              <p><strong>Total:</strong> {Number(servicio.total || servicio.costo || 0).toFixed(2)} {servicio.moneda || ''}</p>

              {canCurrentUserRate && getFlow(servicio) === 'PENDIENTE' && (
                <div className="hs-rating-box">
                  {isRated(servicio, ratedByServiceId) ? (
                    <span className="hs-rated-text">Servicio finalizado</span>
                  ) : (
                    <button
                      type="button"
                      className="hs-rating-button"
                      onClick={() => openRatingModal(servicio)}
                    >
                      Marcar finalizado
                    </button>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {ratingService && (
        <div className="hs-modal-backdrop" onClick={closeRatingModal}>
          <div className="hs-modal" onClick={(event) => event.stopPropagation()}>
            <div className="hs-modal-head">
              <h2>Marcar servicio como finalizado</h2>
              <button type="button" onClick={closeRatingModal} disabled={ratingSaving}>×</button>
            </div>

            <p className="hs-modal-description">
              Servicio #{ratingService.id} con proveedor: {ratingService.proveedor || 'proveedor'}.
            </p>

            {ratingError ? <p className="hs-modal-error">{ratingError}</p> : null}

            <form className="hs-modal-form" onSubmit={submitRating}>
              <label>
                Puntuacion
                <select
                  value={ratingForm.puntuacion}
                  onChange={(event) => setRatingForm((prev) => ({ ...prev, puntuacion: Number(event.target.value) }))}
                  disabled={ratingSaving}
                >
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                  <option value={3}>3</option>
                  <option value={4}>4</option>
                  <option value={5}>5</option>
                </select>
              </label>

              <label>
                Comentario
                <textarea
                  rows={4}
                  value={ratingForm.comentario}
                  onChange={(event) => setRatingForm((prev) => ({ ...prev, comentario: event.target.value }))}
                  placeholder="Comentario opcional"
                  disabled={ratingSaving}
                />
              </label>

              <div className="hs-modal-actions">
                <button type="button" className="hs-modal-secondary" onClick={closeRatingModal} disabled={ratingSaving}>
                  Cancelar
                </button>
                <button type="submit" className="hs-modal-primary" disabled={ratingSaving}>
                  {ratingSaving ? 'Finalizando...' : 'Finalizar servicio'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {ratingNotice ? <p className="hs-notice">{ratingNotice}</p> : null}
    </section>
  )
}
