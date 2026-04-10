import { useMemo, useState } from 'react'
import '../styles/MisOrdenesServiciosView.css'
import { fetchMiCalificacionProveedor, guardarCalificacionProveedor } from '../services/api'
import { hasPermission } from '../services/permissions'

const normalize = (value) => String(value || '').trim().toUpperCase()
const sortCommentsByDateAsc = (comments = []) => {
  return [...(comments || [])].sort((a, b) => {
    const left = new Date(a?.fecha || 0).getTime()
    const right = new Date(b?.fecha || 0).getTime()
    return left - right
  })
}
const toNumber = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}
const formatMoney = (value) => Number(toNumber(value)).toFixed(2)
const getFlow = (service) => normalize(service.estado_flujo || service.estado_servicio)

const buildDraft = (base = {}) => {
  const subtotal = toNumber(base.subtotal)
  const igv = Number((subtotal * 0.18).toFixed(2))

  return {
    ...base,
    subtotal: base.subtotal ?? '',
    costo_envio: base.costo_envio ?? '',
    otros_costos: base.otros_costos ?? '',
    igv,
  }
}

const computeRetentionData = ({ subtotal, igv, costoEnvio, otrosCostos, moneda, retencionFlag, retencionPct }) => {
  const totalBase = Number((subtotal + igv + costoEnvio + otrosCostos).toFixed(2))
  const monedaNorm = String(moneda || '').trim().toUpperCase()
  const isUsd = monedaNorm.includes('USD') || monedaNorm.includes('DOLAR')
  const isPen = monedaNorm.includes('PEN') || monedaNorm.includes('SOL')
  const totalSoles = isUsd ? Number((totalBase * 3.4).toFixed(2)) : totalBase
  const superaUmbral = (isPen && totalBase > 700) || (isUsd && totalSoles > 700)
  const providerAllowsRetention = retencionFlag && Number.isFinite(retencionPct) && retencionPct > 0
  const aplicaRetencion = providerAllowsRetention && superaUmbral
  const montoRetencion = aplicaRetencion
    ? Number((totalBase * (retencionPct / 100)).toFixed(2))
    : 0
  const totalFinal = aplicaRetencion
    ? Number((totalBase - montoRetencion).toFixed(2))
    : totalBase

  return {
    totalBase,
    aplicaRetencion,
    montoRetencion,
    totalFinal,
  }
}

export default function MisOrdenesServiciosView({
  servicios = [],
  proveedores = [],
  currentUserRoleId,
  currentUserPermissions = [],
  onCompletarDatos,
  onGenerarOrden,
  onDescargarPdf,
  onMarcarRealizado,
  onAgregarComentario,
}) {
  const [activeSection, setActiveSection] = useState('completar')
  const [expandedId, setExpandedId] = useState(null)
  const [queryByService, setQueryByService] = useState({})
  const [draftByService, setDraftByService] = useState({})
  const [error, setError] = useState('')
  const [realizadosAreaFilter, setRealizadosAreaFilter] = useState('TODAS')
  const [realizadosPrioridadFilter, setRealizadosPrioridadFilter] = useState('TODAS')
  const [realizadosFromDate, setRealizadosFromDate] = useState('')
  const [realizadosToDate, setRealizadosToDate] = useState('')
  const [commentDraftByService, setCommentDraftByService] = useState({})
  const [commentStatusByService, setCommentStatusByService] = useState({})
  const [ratingService, setRatingService] = useState(null)
  const [ratingForm, setRatingForm] = useState({ puntuacion: 5, comentario: '' })
  const [ratingSaving, setRatingSaving] = useState(false)
  const [ratingError, setRatingError] = useState('')
  const [ratingNotice, setRatingNotice] = useState('')
  const currentUserId = useMemo(() => Number(localStorage.getItem('userId') || 0), [])
  const canRateProviders = hasPermission(currentUserPermissions, 'CALIFICAR_COMPRA')
    || hasPermission(currentUserPermissions, 'CALIFICAR_REQUERIMIENTO')

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

  const getVisibleComments = (servicio) => {
    const rows = Array.isArray(servicio?.comentarios_historial) ? servicio.comentarios_historial : []
    const filtered = rows.filter((item) => {
      const entityId = Number(item?.id_entidad || 0)
      return !entityId || entityId === Number(servicio?.id || 0)
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

  const serviceProviders = useMemo(() => {
    return [...(proveedores || [])].sort((a, b) => {
      const left = String(a.razon_social || a.nombre || '')
      const right = String(b.razon_social || b.nombre || '')
      return left.localeCompare(right)
    })
  }, [proveedores])

  const serviciosAprobados = useMemo(() => {
    return (servicios || [])
      .filter((servicio) => normalize(servicio.estado_aprobacion) === 'APROBADO')
      .sort((a, b) => new Date(b.fecha || 0).getTime() - new Date(a.fecha || 0).getTime())
  }, [servicios])

  const serviciosParaCompletar = useMemo(() => {
    return serviciosAprobados.filter((servicio) => {
      const flow = getFlow(servicio)
      return flow !== 'PENDIENTE' && flow !== 'REALIZADO'
    })
  }, [serviciosAprobados])

  const serviciosPendientes = useMemo(() => {
    return serviciosAprobados.filter((servicio) => getFlow(servicio) === 'PENDIENTE')
  }, [serviciosAprobados])

  const serviciosRealizados = useMemo(() => {
    return serviciosAprobados.filter((servicio) => getFlow(servicio) === 'REALIZADO')
  }, [serviciosAprobados])

  const realizadoAreas = useMemo(() => {
    return ['TODAS', ...new Set(serviciosRealizados.map((servicio) => String(servicio.area || '').trim()).filter(Boolean))]
  }, [serviciosRealizados])

  const realizadoPrioridades = useMemo(() => {
    return ['TODAS', ...new Set(serviciosRealizados.map((servicio) => normalize(servicio.prioridad || 'SIN PRIORIDAD')).filter(Boolean))]
  }, [serviciosRealizados])

  const serviciosRealizadosFiltrados = useMemo(() => {
    const fromTime = realizadosFromDate ? new Date(`${realizadosFromDate}T00:00:00`).getTime() : null
    const toTime = realizadosToDate ? new Date(`${realizadosToDate}T23:59:59`).getTime() : null

    return serviciosRealizados.filter((servicio) => {
      const area = String(servicio.area || '').trim()
      const prioridad = normalize(servicio.prioridad || 'SIN PRIORIDAD')
      const createdAt = new Date(servicio.fecha || 0).getTime()

      if (realizadosAreaFilter !== 'TODAS' && area !== realizadosAreaFilter) return false
      if (realizadosPrioridadFilter !== 'TODAS' && prioridad !== realizadosPrioridadFilter) return false
      if (Number.isFinite(fromTime) && createdAt < fromTime) return false
      if (Number.isFinite(toTime) && createdAt > toTime) return false
      return true
    })
  }, [serviciosRealizados, realizadosAreaFilter, realizadosPrioridadFilter, realizadosFromDate, realizadosToDate])

  const getDraft = (servicio) => {
    const existingDraft = draftByService[servicio.id]
    if (existingDraft) return existingDraft

    return buildDraft({
      proveedor_id: Number(servicio.proveedor_id || 0) || '',
      subtotal: servicio.subtotal ?? '',
      costo_envio: servicio.costo_envio ?? '',
      otros_costos: servicio.otros_costos ?? '',
    })
  }

  const setDraft = (serviceId, patch) => {
    setDraftByService((prev) => ({
      ...prev,
      [serviceId]: buildDraft({
        ...(prev[serviceId] || {}),
        ...patch,
      }),
    }))
  }

  const getProviderOptions = (serviceId) => {
    const term = String(queryByService[serviceId] || '').trim().toLowerCase()
    if (!term) return serviceProviders

    return serviceProviders.filter((provider) => {
      const razonSocial = String(provider.razon_social || provider.nombre || '').toLowerCase()
      const ruc = String(provider.ruc || '').toLowerCase()
      return razonSocial.includes(term) || ruc.includes(term)
    })
  }

  const getSelectedProvider = (servicio) => {
    const draft = getDraft(servicio)
    return serviceProviders.find((provider) => Number(provider.id) === Number(draft.proveedor_id || 0)) || null
  }

  const renderProviderDetails = (provider) => {
    if (!provider) {
      return (
        <div className="provider-details">
          <p><strong>Proveedor:</strong> Selecciona un proveedor para ver su resumen.</p>
        </div>
      )
    }

    const tipoRetencion = ['RETENCION', 'DETRACCION'].includes(normalize(provider.tipo_retencion || ''))
      ? normalize(provider.tipo_retencion)
      : 'RETENCION'
    const retencionFlag = normalize(provider.retencion) === 'SI'

    const fields = [
      ['Razón social', provider.razon_social || provider.nombre || 'N/D'],
      ['Moneda', provider.moneda_nombre || provider.moneda || 'N/D'],
      ['RUC', provider.ruc || 'N/D'],
      ['Dirección', provider.direccion || 'N/D'],
      ['Distrito', provider.distrito || 'N/D'],
      ['Correo', provider.correo || 'N/D'],
      ['Responsable', provider.persona_responsable || provider.contacto || 'N/D'],
      ['Teléfono', provider.telefono || 'N/D'],
      ['Banco', provider.banco || 'N/D'],
      ['Cuenta', provider.numero_cuenta || provider.cuenta || 'N/D'],
      ['CCI', provider.cci || 'N/D'],
      ['Retención', retencionFlag ? 'SI' : 'NO'],
      ['Tipo', retencionFlag ? tipoRetencion : '-'],
    ]

    return (
      <div className="provider-details">
        {fields.map(([label, value]) => (
          <p key={`${label}-${value}`}><strong>{label}:</strong> {value}</p>
        ))}
      </div>
    )
  }

  const handleSubmit = async (servicio) => {
    try {
      setError('')
      const draft = getDraft(servicio)
      const proveedorId = Number(draft.proveedor_id || 0)
      const subtotal = toNumber(draft.subtotal)
      const igv = Number((subtotal * 0.18).toFixed(2))
      const costoEnvio = toNumber(draft.costo_envio)
      const otrosCostos = toNumber(draft.otros_costos)
      const selectedProvider = getSelectedProvider(servicio)
      const retencionFlag = normalize(selectedProvider?.retencion) === 'SI'
      const retencionPct = Number(selectedProvider?.descuento || 0)
      const moneda = selectedProvider?.moneda_nombre || selectedProvider?.moneda || servicio.moneda || ''
      const retentionData = computeRetentionData({
        subtotal,
        igv,
        costoEnvio,
        otrosCostos,
        moneda,
        retencionFlag,
        retencionPct,
      })

      if (!proveedorId) {
        setError('Debes seleccionar un proveedor valido para el servicio')
        return
      }

      if (subtotal <= 0) {
        setError('El subtotal es obligatorio')
        return
      }

      if (retentionData.totalFinal <= 0) {
        setError('El total es obligatorio')
        return
      }

      await onCompletarDatos(servicio.id, {
        proveedor_id: proveedorId,
        subtotal,
        igv,
        costo_envio: costoEnvio,
        otros_costos: otrosCostos,
        total: retentionData.totalFinal,
      })
    } catch (err) {
      setError(err?.message || 'Error al completar datos del servicio')
    }
  }

  const handleAgregarComentario = async (servicio) => {
    const contenido = String(commentDraftByService[servicio.id] || '').trim()
    if (!contenido) {
      setCommentStatusByService((prev) => ({ ...prev, [servicio.id]: { type: 'error', message: 'Escribe un comentario antes de enviarlo' } }))
      return
    }

    try {
      setCommentStatusByService((prev) => ({ ...prev, [servicio.id]: { type: 'info', message: 'Enviando comentario...' } }))
      if (onAgregarComentario) {
        await onAgregarComentario(servicio.id, contenido)
      }
      setCommentDraftByService((prev) => ({ ...prev, [servicio.id]: '' }))
      setCommentStatusByService((prev) => ({ ...prev, [servicio.id]: { type: 'success', message: 'Comentario enviado' } }))
    } catch (err) {
      setCommentStatusByService((prev) => ({
        ...prev,
        [servicio.id]: { type: 'error', message: err?.message || 'Error al agregar comentario del servicio' },
      }))
    }
  }

  const closeRatingModal = () => {
    if (ratingSaving) return
    setRatingService(null)
    setRatingError('')
    setRatingForm({ puntuacion: 5, comentario: '' })
  }

  const openRatingAfterFinalize = (servicio) => {
    if (!canRateProviders) return
    setRatingNotice('')
    const providerId = Number(servicio.proveedor_id || 0)
    if (!providerId) return
    return fetchMiCalificacionProveedor(providerId, {
      tipo: 'servicio',
      id_referencia: Number(servicio.id || 0),
    })
      .then((existing) => {
        if (existing?.ya_calificado) {
          setRatingNotice('Ya calificaste este proveedor')
          return
        }
        setRatingService(servicio)
        setRatingError('')
        setRatingForm({ puntuacion: 5, comentario: '' })
      })
      .catch((err) => {
        setError(err?.message || 'Error al verificar calificacion del proveedor')
      })
  }

  const submitServiceRating = async (event) => {
    event.preventDefault()
    if (!ratingService) return
    if (!canRateProviders) {
      setRatingError('No autorizado para calificar proveedores')
      return
    }

    const providerId = Number(ratingService.proveedor_id || 0)
    const score = Number(ratingForm.puntuacion || 0)
    if (!providerId) {
      setRatingError('No se pudo resolver el proveedor de este servicio')
      return
    }
    if (!Number.isInteger(score) || score < 1 || score > 5) {
      setRatingError('Selecciona una puntuacion entre 1 y 5')
      return
    }

    try {
      setRatingSaving(true)
      setRatingError('')
      await guardarCalificacionProveedor(providerId, {
        tipo: 'servicio',
        id_referencia: Number(ratingService.id || 0),
        puntuacion: score,
        comentario: String(ratingForm.comentario || '').trim(),
      })
      setRatingNotice('Calificacion guardada correctamente')
      closeRatingModal()
    } catch (err) {
      const message = err.message || 'Error al guardar la calificacion'
      if (String(message).toLowerCase().includes('ya calificaste')) {
        closeRatingModal()
        setRatingNotice('Ya calificaste este proveedor')
      } else {
        setRatingError(message)
      }
    } finally {
      setRatingSaving(false)
    }
  }

  const renderServicioCard = (servicio, mode = 'completar') => {
    const draft = getDraft(servicio)
    const providerOptions = getProviderOptions(servicio.id)
    const selectedProvider = getSelectedProvider(servicio)
    const isExpanded = expandedId === servicio.id
    const flow = getFlow(servicio)
    const tipoRetencion = ['RETENCION', 'DETRACCION'].includes(normalize(selectedProvider?.tipo_retencion || ''))
      ? normalize(selectedProvider?.tipo_retencion)
      : 'RETENCION'
    const retencionFlag = normalize(selectedProvider?.retencion) === 'SI'
    const retencionPct = Number(selectedProvider?.descuento || 0)
    const moneda = selectedProvider?.moneda_nombre || selectedProvider?.moneda || servicio.moneda || ''
    const retentionData = computeRetentionData({
      subtotal: toNumber(draft.subtotal),
      igv: toNumber(draft.igv),
      costoEnvio: toNumber(draft.costo_envio),
      otrosCostos: toNumber(draft.otros_costos),
      moneda,
      retencionFlag,
      retencionPct,
    })
    const canSave = flow !== 'DATOS_COMPLETADOS' && flow !== 'PENDIENTE' && flow !== 'REALIZADO'
    const canGenerate = flow === 'DATOS_COMPLETADOS'

    return (
      <article className="my-so-card" key={servicio.id}>
        <div className="my-so-head">
          <h3>Servicio #{servicio.id}</h3>
          <span className="my-so-status">{flow === 'PENDIENTE' ? 'PENDIENTE DE REALIZACION' : (flow || 'N/A')}</span>
        </div>

        <p className="my-so-summary-line"><strong>Nombre:</strong> {servicio.nombre_servicio || servicio.descripcion_servicio || 'Sin nombre'}</p>
        <p className="my-so-summary-line"><strong>Prioridad:</strong> {servicio.prioridad || 'MEDIA'}</p>
        <p className="my-so-summary-line"><strong>Descripcion:</strong> {servicio.descripcion_servicio || 'Sin descripcion'}</p>
        <p className="my-so-summary-line"><strong>Area:</strong> {servicio.area || 'Sin area'}</p>
        <p className="my-so-summary-line"><strong>Fecha:</strong> {servicio.fecha ? new Date(servicio.fecha).toLocaleDateString() : 'Sin fecha'}</p>
        <p className="my-so-summary-line"><strong>Proveedor:</strong> {servicio.proveedor || 'Pendiente de asignacion'}</p>
        <p className="my-so-summary-line"><strong>Aprobación:</strong> {servicio.estado_aprobacion_detalle || servicio.estado_aprobacion || 'N/A'}</p>
        <p className="my-so-summary-line"><strong>Total:</strong> {formatMoney(servicio.total ?? servicio.costo)} {servicio.moneda || ''}</p>

        {mode === 'completar' ? (
          <div className="my-so-actions">
            {canSave && (
              <button type="button" className="btn-detail" onClick={() => setExpandedId(isExpanded ? null : servicio.id)}>
                {isExpanded ? 'Ocultar datos' : 'Completar datos'}
              </button>
            )}
            {canGenerate && (
              <button
                type="button"
                className="btn-generate"
                onClick={() => onGenerarOrden(servicio.id).catch((err) => setError(err?.message || 'Error al generar orden de servicio'))}
              >
                Generar Orden de Servicio
              </button>
            )}
          </div>
        ) : mode === 'pendientes' ? (
          <div className="my-so-actions">
            <button
              type="button"
              className="btn-download"
              onClick={() => onDescargarPdf(servicio.id).catch((err) => setError(err?.message || 'Error al descargar PDF'))}
            >
              Descargar PDF
            </button>
            <button
              type="button"
              className="btn-receive"
              onClick={() =>
                onMarcarRealizado(servicio.id)
                  .catch((err) => setError(err?.message || 'Error al marcar realizado'))
              }
            >
              Marcar como REALIZADO
            </button>
          </div>
        ) : (
          <div className="my-so-actions">
            <button
              type="button"
              className="btn-download"
              onClick={() => onDescargarPdf(servicio.id).catch((err) => setError(err?.message || 'Error al descargar PDF'))}
            >
              Descargar PDF
            </button>
          </div>
        )}

        {mode === 'completar' && isExpanded && canSave && (
          <div className="my-so-edit-grid">
            <label className="full-row supplier-field">
              Proveedor
              <input
                type="text"
                value={queryByService[servicio.id] || ''}
                onChange={(event) => setQueryByService((prev) => ({ ...prev, [servicio.id]: event.target.value }))}
                placeholder="Busca por razon social o RUC"
              />
              <ul className="supplier-options">
                {providerOptions.map((provider) => (
                  <li key={`service-provider-${servicio.id}-${provider.id}`}>
                    <button
                      type="button"
                      onClick={() => {
                        setDraft(servicio.id, {
                          proveedor_id: Number(provider.id),
                        })
                        setQueryByService((prev) => ({ ...prev, [servicio.id]: String(provider.razon_social || provider.nombre || '') }))
                      }}
                    >
                      <span>{provider.razon_social || provider.nombre}</span>
                      <small>{provider.ruc ? `RUC ${provider.ruc}` : ''}</small>
                    </button>
                  </li>
                ))}
              </ul>
            </label>

            {renderProviderDetails(selectedProvider)}

            <label>
              Subtotal
              <input
                type="number"
                min="0"
                step="0.01"
                value={draft.subtotal}
                onChange={(event) => setDraft(servicio.id, { subtotal: event.target.value })}
              />
            </label>

            <label>
              IGV
              <input type="number" min="0" step="0.01" value={formatMoney(draft.igv)} readOnly />
            </label>

            <label>
              Costo de envio
              <input
                type="number"
                min="0"
                step="0.01"
                value={draft.costo_envio}
                onChange={(event) => setDraft(servicio.id, { costo_envio: event.target.value })}
              />
            </label>

            <label>
              Otros costos
              <input
                type="number"
                min="0"
                step="0.01"
                value={draft.otros_costos}
                onChange={(event) => setDraft(servicio.id, { otros_costos: event.target.value })}
              />
            </label>

            <label>
              Total
              <input type="number" min="0" step="0.01" value={formatMoney(retentionData.totalFinal)} readOnly />
            </label>

            <div className="provider-details full-row">
              <p><strong>Subtotal:</strong> {formatMoney(draft.subtotal)}</p>
              <p><strong>IGV:</strong> {formatMoney(draft.igv)}</p>
              <p><strong>Costo envío:</strong> {formatMoney(draft.costo_envio)}</p>
              <p><strong>Otros costos:</strong> {formatMoney(draft.otros_costos)}</p>
              <p><strong>Total base:</strong> {formatMoney(retentionData.totalBase)}</p>
              <p><strong>Retención aplicada:</strong> {retentionData.aplicaRetencion ? 'SI' : 'NO'}</p>
              {retentionData.aplicaRetencion && <p><strong>Porcentaje:</strong> {retencionPct.toFixed(2)}%</p>}
              {retentionData.aplicaRetencion && <p><strong>Monto retenido:</strong> {retentionData.montoRetencion.toFixed(2)}</p>}
              <p><strong>TOTAL FINAL:</strong> {retentionData.totalFinal.toFixed(2)}</p>
              {!retencionFlag && <p><strong>Tipo retención:</strong> -</p>}
              {retencionFlag && <p><strong>Tipo retención:</strong> {tipoRetencion}</p>}
            </div>

            <div className="my-so-actions full-row">
              <button type="button" className="btn-generate" onClick={() => handleSubmit(servicio)}>
                Guardar datos
              </button>
            </div>
          </div>
        )}

        <div className="my-so-comments-box">
          <strong>Comentarios</strong>
          {getVisibleComments(servicio).length === 0 ? (
            <p className="my-so-summary-line">Sin comentarios registrados.</p>
          ) : (
            <ul className="my-so-comments-list">
              {getVisibleComments(servicio).map((item, idx) => (
                <li key={`${servicio.id}-comment-${idx}`} className={`my-so-chat-item ${isOwnComment(item) ? 'is-own' : 'is-other'}`}>
                  <div className="my-so-chat-meta">
                    <div className="my-so-chat-user">
                      {getCommentPhotoSrc(item) ? (
                        <img className="my-so-chat-avatar" src={getCommentPhotoSrc(item)} alt={item.usuario || 'Usuario'} />
                      ) : (
                        <span className="my-so-chat-avatar my-so-chat-avatar-placeholder">{String(item.usuario || 'U').trim().charAt(0).toUpperCase() || 'U'}</span>
                      )}
                      <strong>{item.usuario || 'Usuario'}</strong>
                    </div>
                    <span>{item.fecha ? new Date(item.fecha).toLocaleString() : 'Sin fecha'}</span>
                  </div>
                  <p className="my-so-chat-message">{item.contenido}</p>
                </li>
              ))}
            </ul>
          )}

          <div className="my-so-comments-form">
            <textarea
              value={commentDraftByService[servicio.id] || ''}
              onChange={(event) => {
                const value = event.target.value
                setCommentDraftByService((prev) => ({ ...prev, [servicio.id]: value }))
                if (String(value || '').trim()) {
                  setCommentStatusByService((prev) => ({ ...prev, [servicio.id]: null }))
                }
              }}
              placeholder="Escribe un comentario"
            />
            <button
              type="button"
              className="btn-generate"
              onClick={() => handleAgregarComentario(servicio)}
              disabled={!String(commentDraftByService[servicio.id] || '').trim()}
            >
              Enviar
            </button>
            {commentStatusByService[servicio.id]?.message ? (
              <p className={`my-so-comment-feedback ${commentStatusByService[servicio.id]?.type || 'info'}`}>
                {commentStatusByService[servicio.id].message}
              </p>
            ) : null}
          </div>
        </div>
      </article>
    )
  }

  return (
    <section className="my-so-section">
      <div className="section-header">
        <h1>Mis ordenes de servicios</h1>
        <p>Aprobados: {serviciosAprobados.length}</p>
      </div>

      <div className="my-so-filters">
        <button type="button" className={activeSection === 'completar' ? 'active' : ''} onClick={() => setActiveSection('completar')}>
          Completar datos ({serviciosParaCompletar.length})
        </button>
        <button type="button" className={activeSection === 'pendientes' ? 'active' : ''} onClick={() => setActiveSection('pendientes')}>
          Pendientes ({serviciosPendientes.length})
        </button>
        <button type="button" className={activeSection === 'realizados' ? 'active' : ''} onClick={() => setActiveSection('realizados')}>
          Servicios realizados ({serviciosRealizados.length})
        </button>
      </div>

      {activeSection === 'realizados' && (
        <div className="my-so-filter-grid">
          <label>
            Area
            <select value={realizadosAreaFilter} onChange={(event) => setRealizadosAreaFilter(event.target.value)}>
              {realizadoAreas.map((area) => (
                <option key={area} value={area}>{area}</option>
              ))}
            </select>
          </label>

          <label>
            Prioridad
            <select value={realizadosPrioridadFilter} onChange={(event) => setRealizadosPrioridadFilter(event.target.value)}>
              {realizadoPrioridades.map((prioridad) => (
                <option key={prioridad} value={prioridad}>{prioridad}</option>
              ))}
            </select>
          </label>

          <label>
            Desde
            <input type="date" value={realizadosFromDate} onChange={(event) => setRealizadosFromDate(event.target.value)} />
          </label>

          <label>
            Hasta
            <input type="date" value={realizadosToDate} onChange={(event) => setRealizadosToDate(event.target.value)} />
          </label>
        </div>
      )}

      {error && <p className="my-so-error">{error}</p>}
      {ratingNotice ? <p className="my-so-comment-feedback success">{ratingNotice}</p> : null}

      {serviciosAprobados.length === 0 ? (
        <div className="empty-state">No tienes servicios aprobados para gestionar.</div>
      ) : (
        <div className="my-so-list">
          {activeSection === 'completar'
            ? serviciosParaCompletar.map((servicio) => renderServicioCard(servicio, 'completar'))
            : activeSection === 'pendientes'
              ? serviciosPendientes.map((servicio) => renderServicioCard(servicio, 'pendientes'))
              : serviciosRealizadosFiltrados.map((servicio) => renderServicioCard(servicio, 'realizados'))}
        </div>
      )}

      {ratingService && (
        <div className="provider-modal-backdrop" onClick={closeRatingModal}>
          <div className="provider-modal provider-rating-modal" onClick={(event) => event.stopPropagation()}>
            <div className="provider-modal-head">
              <h2>Calificar servicio</h2>
              <button type="button" onClick={closeRatingModal} disabled={ratingSaving}>×</button>
            </div>
            <div className="provider-rating-header">
              <h3>{ratingService.nombre_servicio || ratingService.descripcion_servicio || `Servicio #${ratingService.id || ''}`}</h3>
              <p><strong>Proveedor:</strong> {ratingService.proveedor_nombre || ratingService.proveedor || 'Proveedor'}</p>
              <p>Completa una calificación breve después de finalizar el servicio.</p>
            </div>

            {ratingError ? <p className="providers-error">{ratingError}</p> : null}

            <form className="provider-rating-form" onSubmit={submitServiceRating}>
              <div className="provider-rating-stars-picker" aria-label="Selecciona puntuacion">
                {[1, 2, 3, 4, 5].map((score) => (
                  <button
                    key={score}
                    type="button"
                    className={`rating-star-btn ${Number(ratingForm.puntuacion || 0) >= score ? 'active' : ''}`}
                    onClick={() => setRatingForm((prev) => ({ ...prev, puntuacion: score }))}
                    disabled={ratingSaving}
                  >
                    ★
                  </button>
                ))}
              </div>

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
                  placeholder="Comentario opcional"
                  rows={4}
                  disabled={ratingSaving}
                />
              </label>

              <div className="provider-modal-actions">
                <button type="button" onClick={closeRatingModal} disabled={ratingSaving}>Omitir</button>
                <button type="submit" disabled={ratingSaving}>{ratingSaving ? 'Guardando...' : 'Guardar calificacion'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  )
}
