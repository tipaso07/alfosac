import { useMemo, useState } from 'react'
import '../styles/MisRequerimientosView.css'

const normalize = (value) => String(value || '').trim().toUpperCase()
const sortCommentsByDateAsc = (comments = []) => {
  return [...(comments || [])].sort((a, b) => {
    const left = new Date(a?.fecha || 0).getTime()
    const right = new Date(b?.fecha || 0).getTime()
    return left - right
  })
}

export default function MisRequerimientosView({ requerimientos = [], onAgregarComentario }) {
  const [statusFilter, setStatusFilter] = useState('TODOS')
  const [fechaInicio, setFechaInicio] = useState('')
  const [fechaFin, setFechaFin] = useState('')
  const [commentDraftByReq, setCommentDraftByReq] = useState({})
  const [commentStatusByReq, setCommentStatusByReq] = useState({})
  const currentUserId = useMemo(() => Number(localStorage.getItem('userId') || 0), [])

  const getCommentPhotoSrc = (comment) => {
    const raw = String(comment?.foto || '').trim()
    if (!raw) return ''
    if (raw.startsWith('data:image/')) return raw
    if (raw.startsWith('http://') || raw.startsWith('https://')) return raw
    return `data:image/png;base64,${raw}`
  }

  const isOwnComment = (comment) => {
    const authorId = Number(comment?.usuario_id || 0)
    return authorId > 0 && authorId === currentUserId
  }

  const getVisibleComments = (req) => {
    const rows = Array.isArray(req?.comentarios_historial) ? req.comentarios_historial : []
    const filtered = rows.filter((item) => {
      const entityId = Number(item?.id_entidad || 0)
      return !entityId || entityId === Number(req?.id || 0)
    })

    const seen = new Set()
    const deduped = filtered.filter((item) => {
      const idKey = Number(item?.id || 0)
      const fingerprint = idKey > 0
        ? `id:${idKey}`
        : `fp:${Number(item?.usuario_id || 0)}|${String(item?.fecha || '')}|${String(item?.contenido || '').trim()}`
      if (seen.has(fingerprint)) return false
      seen.add(fingerprint)
      return true
    })

    return sortCommentsByDateAsc(deduped)
  }

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

  const handleAgregarComentario = async (req) => {
    const contenido = String(commentDraftByReq[req.id] || '').trim()
    if (!contenido) {
      setCommentStatusByReq((prev) => ({ ...prev, [req.id]: { type: 'error', message: 'Escribe un comentario antes de enviarlo' } }))
      return
    }

    try {
      setCommentStatusByReq((prev) => ({ ...prev, [req.id]: { type: 'info', message: 'Enviando comentario...' } }))
      if (onAgregarComentario) {
        await onAgregarComentario(req.id, contenido)
      }
      setCommentDraftByReq((prev) => ({ ...prev, [req.id]: '' }))
      setCommentStatusByReq((prev) => ({ ...prev, [req.id]: { type: 'success', message: 'Comentario enviado' } }))
    } catch (error) {
      setCommentStatusByReq((prev) => ({
        ...prev,
        [req.id]: { type: 'error', message: error.message || 'Error al agregar comentario' },
      }))
    }
  }

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

              <div className="my-req-comments-box">
                <strong>Comentarios</strong>
                {getVisibleComments(req).length === 0 ? (
                  <p className="my-req-comments-empty">Sin comentarios registrados.</p>
                ) : (
                  <ul className="my-req-comments-list">
                    {getVisibleComments(req).map((item, idx) => (
                      <li key={`${req.id}-comment-${idx}`} className={`my-req-chat-item ${isOwnComment(item) ? 'is-own' : 'is-other'}`}>
                        <div className="my-req-chat-meta">
                          <div className="my-req-chat-user">
                            {getCommentPhotoSrc(item) ? (
                              <img className="my-req-chat-avatar" src={getCommentPhotoSrc(item)} alt={item.usuario || 'Usuario'} />
                            ) : (
                              <span className="my-req-chat-avatar my-req-chat-avatar-placeholder">{String(item.usuario || 'U').trim().charAt(0).toUpperCase() || 'U'}</span>
                            )}
                            <strong>{item.usuario || 'Usuario'}</strong>
                          </div>
                          <span>{item.fecha ? new Date(item.fecha).toLocaleString() : 'Sin fecha'}</span>
                        </div>
                        <p className="my-req-chat-message">{item.contenido}</p>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="my-req-comments-form">
                  <textarea
                    value={commentDraftByReq[req.id] || ''}
                    onChange={(event) => {
                      const value = event.target.value
                      setCommentDraftByReq((prev) => ({ ...prev, [req.id]: value }))
                      if (String(value || '').trim()) {
                        setCommentStatusByReq((prev) => ({ ...prev, [req.id]: null }))
                      }
                    }}
                    placeholder="Escribe un comentario"
                  />
                  <button type="button" onClick={() => handleAgregarComentario(req)} disabled={!String(commentDraftByReq[req.id] || '').trim()}>
                    Enviar
                  </button>
                  {commentStatusByReq[req.id]?.message ? (
                    <p className={`my-req-comment-feedback ${commentStatusByReq[req.id]?.type || 'info'}`}>
                      {commentStatusByReq[req.id].message}
                    </p>
                  ) : null}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
