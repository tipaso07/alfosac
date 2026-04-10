import { useMemo, useState } from 'react'
import { guardarCalificacionProveedor } from '../services/api'
import { hasPermission } from '../services/permissions'
import '../styles/CalificarProductosView.css'

const normalize = (value) => String(value || '').trim().toUpperCase()

export default function CalificarProductosView({ movimientos = [], currentUserPermissions = [], currentUserRoleId = null, currentUserArea = '' }) {
  const [searchTerm, setSearchTerm] = useState('')
  const [fechaInicio, setFechaInicio] = useState('')
  const [fechaFin, setFechaFin] = useState('')
  const [ratingTarget, setRatingTarget] = useState(null)
  const [ratingForm, setRatingForm] = useState({ puntuacion: 5, comentario: '' })
  const [ratingSaving, setRatingSaving] = useState(false)
  const [ratingError, setRatingError] = useState('')
  const [ratingNotice, setRatingNotice] = useState('')
  const [ratingByDetailId, setRatingByDetailId] = useState({})

  const canRate = hasPermission(currentUserPermissions, 'CALIFICAR_COMPRA')
    || hasPermission(currentUserPermissions, 'CALIFICAR_REQUERIMIENTO')
  const normalizedCurrentArea = normalize(currentUserArea)

  const salidaRows = useMemo(() => {
    const rows = []
    ;(movimientos || []).forEach((mov) => {
      if (normalize(mov?.tipo) !== 'SALIDA') return

      ;(mov.detalles || []).forEach((detail) => {
        rows.push({
          id_movimiento: Number(mov?.id || 0) || null,
          fecha: mov?.fecha || null,
          area_destino: String(mov?.area_destino || 'Sin area').trim() || 'Sin area',
          id_movimiento_detalle: Number(detail?.id_movimiento_detalle || 0) || null,
          id_material: Number(detail?.id_material || 0) || null,
          material: String(detail?.material || '').trim(),
          cantidad: Number(detail?.cantidad || 0) || 0,
          id_proveedor: Number(detail?.id_proveedor || 0) || null,
          proveedor: String(detail?.proveedor || '').trim(),
          mi_calificacion_id: Number(detail?.mi_calificacion_id || 0) || null,
          mi_calificacion_puntuacion: Number(detail?.mi_calificacion_puntuacion || 0) || 0,
          mi_calificacion_comentario: String(detail?.mi_calificacion_comentario || '').trim(),
          mi_calificacion_fecha: detail?.mi_calificacion_fecha || null,
        })
      })
    })

    const areaFiltered = normalizedCurrentArea
      ? rows.filter((row) => normalize(row.area_destino) === normalizedCurrentArea)
      : rows

    return areaFiltered.sort((a, b) => {
      const left = a.fecha ? new Date(a.fecha).getTime() : 0
      const right = b.fecha ? new Date(b.fecha).getTime() : 0
      return right - left
    })
  }, [movimientos, normalizedCurrentArea])

  const getEffectiveRating = (row) => {
    const detailId = Number(row?.id_movimiento_detalle || 0)
    if (!detailId) return null

    if (ratingByDetailId[detailId]) return ratingByDetailId[detailId]

    const existingId = Number(row?.mi_calificacion_id || 0)
    if (!existingId) return null

    return {
      id: existingId,
      puntuacion: Number(row?.mi_calificacion_puntuacion || 0) || 0,
      comentario: String(row?.mi_calificacion_comentario || '').trim(),
      fecha: row?.mi_calificacion_fecha || null,
    }
  }

  const filtered = useMemo(() => {
    const term = String(searchTerm || '').trim().toLowerCase()
    const startDate = fechaInicio ? new Date(`${fechaInicio}T00:00:00`) : null
    const endDate = fechaFin ? new Date(`${fechaFin}T23:59:59.999`) : null

    return salidaRows.filter((row) => {
      if (startDate || endDate) {
        const rowDate = row.fecha ? new Date(row.fecha) : null
        if (!rowDate || Number.isNaN(rowDate.getTime())) return false
        if (startDate && rowDate < startDate) return false
        if (endDate && rowDate > endDate) return false
      }

      if (term) {
        const haystack = [
          row.id_movimiento,
          row.material,
          row.proveedor,
          row.area_destino,
        ]
          .map((item) => String(item || '').toLowerCase())
          .join(' ')

        if (!haystack.includes(term)) return false
      }

      return true
    })
  }, [fechaFin, fechaInicio, salidaRows, searchTerm])

  const openRatingModal = (row) => {
    const existing = getEffectiveRating(row)
    if (existing) return
    if (!existing && !canRate) return

    setRatingTarget({ ...row, existing })
    setRatingForm({
      puntuacion: Number(existing?.puntuacion || 5) || 5,
      comentario: String(existing?.comentario || '').trim(),
    })
    setRatingError('')
  }

  const closeRatingModal = () => {
    if (ratingSaving) return
    setRatingTarget(null)
    setRatingError('')
  }

  const submitRating = async (event) => {
    event.preventDefault()
    if (!ratingTarget) return

    const movimientoId = Number(ratingTarget.id_movimiento || 0)
    const detailId = Number(ratingTarget.id_movimiento_detalle || 0)
    const materialId = Number(ratingTarget.id_material || 0)
    const providerId = Number(ratingTarget.id_proveedor || 0)
    const puntuacion = Number(ratingForm.puntuacion || 0)
    const comentario = String(ratingForm.comentario || '').trim()

    if (!movimientoId || !detailId || !materialId || !providerId) {
      setRatingError('No se pudo resolver el movimiento de salida para calificar')
      return
    }

    if (!Number.isInteger(puntuacion) || puntuacion < 1 || puntuacion > 5) {
      setRatingError('Selecciona una puntuacion entre 1 y 5')
      return
    }

    try {
      setRatingSaving(true)
      setRatingError('')

      if (!canRate) {
        setRatingError('No autorizado para calificar productos entregados')
        return
      }

      await guardarCalificacionProveedor(providerId, {
        tipo: 'salida',
        id_movimiento: movimientoId,
        id_material: materialId,
        id_referencia: detailId,
        puntuacion,
        comentario,
      })

      setRatingByDetailId((prev) => ({
        ...prev,
        [detailId]: {
          id: Number(ratingTarget.existing?.id || ratingTarget.mi_calificacion_id || 0) || null,
          puntuacion,
          comentario,
          fecha: new Date().toISOString(),
        },
      }))

      setRatingNotice('Calificacion guardada correctamente')
      closeRatingModal()
    } catch (error) {
      setRatingError(error?.message || 'Error al guardar calificacion')
    } finally {
      setRatingSaving(false)
    }
  }

  return (
    <section className="rate-products-section">
      <header className="rate-products-header">
        <h1>Calificar materiales</h1>
        <p>Evalua cada material de forma individual en base a las salidas de almacen entregadas a areas.</p>
      </header>

      {ratingNotice ? <p className="rate-products-notice">{ratingNotice}</p> : null}

      <div className="rate-products-filters">
        <label>
          Buscar
          <input
            type="text"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Movimiento, material, proveedor o area"
          />
        </label>
        <label>
          Fecha inicio
          <input type="date" value={fechaInicio} onChange={(event) => setFechaInicio(event.target.value)} />
        </label>
        <label>
          Fecha fin
          <input type="date" value={fechaFin} onChange={(event) => setFechaFin(event.target.value)} />
        </label>
      </div>

      {filtered.length === 0 ? (
        <div className="rate-products-empty">No hay materiales de salida para calificar con los filtros actuales.</div>
      ) : (
        <div className="rate-products-list">
          {filtered.map((row, index) => {
            const rating = getEffectiveRating(row)
            const hasProvider = Number(row.id_proveedor || 0) > 0
            const hasArea = normalize(row.area_destino) !== 'SIN AREA'
            const canCreate = hasProvider && hasArea && !rating && canRate

            return (
              <article className="rate-products-card" key={`${row.id_movimiento}-${row.id_movimiento_detalle}-${index}`}>
                <div className="rate-products-card-head">
                  <h3>Material #{row.id_material}</h3>
                  <span>{row.fecha ? new Date(row.fecha).toLocaleString() : 'Sin fecha'}</span>
                </div>
                <p><strong>Producto a calificar:</strong> {row.material || `Material ${row.id_material}`}</p>
                <p><strong>Cantidad:</strong> {row.cantidad}</p>
                <p><strong>Proveedor:</strong> {row.proveedor || (hasProvider ? `ID ${row.id_proveedor}` : 'Sin proveedor')}</p>
                <p><strong>Area destino:</strong> {row.area_destino || 'Sin area'}</p>

                {rating ? (
                  <p><strong>Calificacion:</strong> {rating.puntuacion}/5 {rating.comentario ? `- ${rating.comentario}` : ''}</p>
                ) : (
                  <p>Sin calificar</p>
                )}

                {canCreate ? (
                  <button type="button" className="rate-products-btn" onClick={() => openRatingModal(row)}>
                    Calificar
                  </button>
                ) : null}
              </article>
            )
          })}
        </div>
      )}

      {ratingTarget && (
        <div className="rate-products-backdrop" onClick={closeRatingModal}>
          <div className="rate-products-modal" onClick={(event) => event.stopPropagation()}>
            <div className="rate-products-modal-head">
              <h3>{ratingTarget.existing?.id ? 'Editar calificacion' : 'Calificar material'}</h3>
              <button type="button" onClick={closeRatingModal} disabled={ratingSaving}>×</button>
            </div>

            <p>
              Producto a calificar: {ratingTarget.material || `Material ${ratingTarget.id_material}`}
            </p>
            <p>
              Proveedor: {ratingTarget.proveedor || `ID ${ratingTarget.id_proveedor}`}
            </p>
            <p>
              Area destino: {ratingTarget.area_destino || 'Sin area'}
            </p>

            {ratingError ? <p className="rate-products-error">{ratingError}</p> : null}

            <form className="rate-products-form" onSubmit={submitRating}>
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
                  value={ratingForm.comentario}
                  onChange={(event) => setRatingForm((prev) => ({ ...prev, comentario: event.target.value }))}
                  rows={4}
                  placeholder="Comentario opcional"
                  disabled={ratingSaving}
                />
              </label>

              <div className="rate-products-actions">
                <button type="button" onClick={closeRatingModal} disabled={ratingSaving}>Cancelar</button>
                <button type="submit" disabled={ratingSaving}>{ratingSaving ? 'Guardando...' : 'Guardar'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  )
}
