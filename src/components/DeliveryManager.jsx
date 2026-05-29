import { useCallback, useEffect, useMemo, useState } from 'react'
import '../styles/DeliveryManager.css'
import {
  API_BASE_URL,
  fetchAreas,
  fetchReceptoresByCompra,
  fetchReceptoresByRequerimiento,
} from '../services/api'

const normalize = (value) => String(value || '').trim().toUpperCase()
const API_PUBLIC_BASE = API_BASE_URL.replace(/\/api\/?$/, '')

const priorityRank = (priority) => {
  const p = String(priority || 'MEDIA').trim().toUpperCase()
  if (p === 'ALTA') return 1
  if (p === 'MEDIA') return 2
  if (p === 'BAJA') return 3
  return 2
}

const getPriorityBadgeClass = (priority) => {
  const p = String(priority || 'MEDIA').trim().toLowerCase()
  if (p === 'alta') return 'delivery-badge priority alta'
  if (p === 'baja') return 'delivery-badge priority baja'
  return 'delivery-badge priority media'
}

const getPriorityLabel = (priority) => String(priority || 'MEDIA').trim().toUpperCase()

const getFallbackAvatar = (name) => {
  const encoded = encodeURIComponent(String(name || 'Usuario').trim() || 'Usuario')
  return `https://ui-avatars.com/api/?name=${encoded}&background=e5e7eb&color=111827`
}

const isProbablyBase64 = (value) => /^[A-Za-z0-9+/=\s]+$/.test(value) && value.replace(/\s+/g, '').length > 80

const resolveReceptorImage = (persona) => {
  const raw = String(persona?.imagen || persona?.foto || '').trim()
  if (!raw) return getFallbackAvatar(persona?.nombre)

  if (/^https?:\/\//i.test(raw)) return raw
  if (/^data:image\//i.test(raw)) return raw
  if (/^\/uploads\//i.test(raw)) return `${API_PUBLIC_BASE}${raw}`

  if (isProbablyBase64(raw)) {
    return `data:image/png;base64,${raw.replace(/\s+/g, '')}`
  }

  return getFallbackAvatar(persona?.nombre)
}

export default function DeliveryManager({
  requerimientos = [],
  compras = [],
  onConfirmarEntregaRequerimiento,
  onConfirmarRecepcion,
  onConfirmarEntregaAreaCompra,
  onDescargarPdf,
}) {
  const [activeTab, setActiveTab] = useState('requerimientos')
  const [loadingById, setLoadingById] = useState({})
  const [error, setError] = useState('')
  const [fechaInicio, setFechaInicio] = useState('')
  const [fechaFin, setFechaFin] = useState('')
  const [areaQuery, setAreaQuery] = useState('')
  const [selectedArea, setSelectedArea] = useState(null)
  const [areas, setAreas] = useState([])
  const [estadoReq, setEstadoReq] = useState('por_entregar')
  const [estadoOc, setEstadoOc] = useState('por_recibir')
  const [receptorQueryByReq, setReceptorQueryByReq] = useState({})
  const [receptorOptionsByReq, setReceptorOptionsByReq] = useState({})
  const [receptorSelectedByReq, setReceptorSelectedByReq] = useState({})
  const [receptorLoadingByReq, setReceptorLoadingByReq] = useState({})
  const [receptorQueryByOc, setReceptorQueryByOc] = useState({})
  const [receptorOptionsByOc, setReceptorOptionsByOc] = useState({})
  const [receptorSelectedByOc, setReceptorSelectedByOc] = useState({})
  const [receptorLoadingByOc, setReceptorLoadingByOc] = useState({})

  const getCompraDeliveryState = useCallback((compra) => normalize(compra?.estado_pedido || compra?.estado), [])

  useEffect(() => {
    const loadAreas = async () => {
      try {
        const data = await fetchAreas('')
        setAreas(Array.isArray(data) ? data : [])
      } catch {
        setAreas([])
      }
    }

    loadAreas()
  }, [])

  const requerimientosPorEntregar = useMemo(() => {
    return (requerimientos || [])
      .filter((req) => normalize(req.estado) === 'APROBADO' && normalize(req.estado_entrega) === 'POR_RECOGER')
      .sort((a, b) => {
        const priorityDiff = priorityRank(a.prioridad) - priorityRank(b.prioridad)
        if (priorityDiff !== 0) return priorityDiff
        return new Date(b.fecha_creacion || 0).getTime() - new Date(a.fecha_creacion || 0).getTime()
      })
  }, [requerimientos])

  const requerimientosEntregados = useMemo(() => {
    return (requerimientos || [])
      .filter((req) => normalize(req.estado_entrega) === 'ENTREGADO')
      .sort((a, b) => {
        const priorityDiff = priorityRank(a.prioridad) - priorityRank(b.prioridad)
        if (priorityDiff !== 0) return priorityDiff
        return new Date(b.fecha_creacion || 0).getTime() - new Date(a.fecha_creacion || 0).getTime()
      })
  }, [requerimientos])

  const ordenesPorRecibir = useMemo(() => {
    return (compras || [])
      .filter((compra) => getCompraDeliveryState(compra) === 'POR_RECIBIR')
      .sort((a, b) => new Date(b.fecha_creacion || 0).getTime() - new Date(a.fecha_creacion || 0).getTime())
  }, [compras, getCompraDeliveryState])

  const ordenesPendientesEntrega = useMemo(() => {
    return (compras || [])
      .filter((compra) => {
        const estado = getCompraDeliveryState(compra)
        return estado === 'PENDIENTE_ENTREGA'
      })
      .sort((a, b) => new Date(b.fecha_creacion || 0).getTime() - new Date(a.fecha_creacion || 0).getTime())
  }, [compras, getCompraDeliveryState])

  const ordenesRecibidas = useMemo(() => {
    return (compras || [])
      .filter((compra) => {
        const estado = getCompraDeliveryState(compra)
        return estado === 'ENTREGADO'
      })
      .sort((a, b) => new Date(b.fecha_creacion || 0).getTime() - new Date(a.fecha_creacion || 0).getTime())
  }, [compras, getCompraDeliveryState])

  const inDateRange = useCallback((dateValue) => {
    if (!fechaInicio && !fechaFin) return true

    const itemDate = new Date(dateValue || 0)
    const itemTime = itemDate.getTime()
    if (Number.isNaN(itemTime)) return false

    if (fechaInicio) {
      const start = new Date(`${fechaInicio}T00:00:00`)
      if (itemTime < start.getTime()) return false
    }

    if (fechaFin) {
      const end = new Date(`${fechaFin}T23:59:59.999`)
      if (itemTime > end.getTime()) return false
    }

    return true
  }, [fechaInicio, fechaFin])

  const reqMatchesArea = useCallback((req) => {
    const term = String(areaQuery || '').trim().toLowerCase()
    if (!term) return true

    if (selectedArea) {
      const byId = Number(req.id_area || 0) === Number(selectedArea.id)
      const byName = String(req.area || '').toLowerCase().includes(String(selectedArea.nombre || '').toLowerCase())
      return byId || byName
    }

    return String(req.area || '').toLowerCase().includes(term)
  }, [areaQuery, selectedArea])

  const ocMatchesArea = useCallback((compra) => {
    const term = String(areaQuery || '').trim().toLowerCase()
    if (!term) return true

    if (selectedArea) {
      const byIdSolicitante = Number(compra.id_area_solicitante || 0) === Number(selectedArea.id)
      const byIdFinal = Number(compra.id_area_final || 0) === Number(selectedArea.id)
      const areaName = String(selectedArea.nombre || '').toLowerCase()
      const byName = String(compra.area_solicitante || '').toLowerCase().includes(areaName)
        || String(compra.area_final || '').toLowerCase().includes(areaName)
      return byIdSolicitante || byIdFinal || byName
    }

    const haystack = `${compra.area_solicitante || ''} ${compra.area_final || ''}`.toLowerCase()
    return haystack.includes(term)
  }, [areaQuery, selectedArea])

  const areaSuggestions = useMemo(() => {
    const term = String(areaQuery || '').trim().toLowerCase()
    if (!term) return []

    return areas
      .filter((area) => String(area.nombre || '').toLowerCase().includes(term))
      .slice(0, 8)
  }, [areas, areaQuery])

  const requerimientosPorEntregarFiltrados = useMemo(() => {
    return requerimientosPorEntregar.filter((req) => inDateRange(req.fecha_creacion) && reqMatchesArea(req))
  }, [requerimientosPorEntregar, inDateRange, reqMatchesArea])

  const requerimientosEntregadosFiltrados = useMemo(() => {
    return requerimientosEntregados.filter((req) => inDateRange(req.fecha_creacion) && reqMatchesArea(req))
  }, [requerimientosEntregados, inDateRange, reqMatchesArea])

  const ordenesPorRecibirFiltradas = useMemo(() => {
    return ordenesPorRecibir.filter((compra) => inDateRange(compra.fecha_creacion) && ocMatchesArea(compra))
  }, [ordenesPorRecibir, inDateRange, ocMatchesArea])

  const ordenesPendientesEntregaFiltradas = useMemo(() => {
    return ordenesPendientesEntrega.filter((compra) => inDateRange(compra.fecha_creacion) && ocMatchesArea(compra))
  }, [ordenesPendientesEntrega, inDateRange, ocMatchesArea])

  const ordenesRecibidasFiltradas = useMemo(() => {
    return ordenesRecibidas.filter((compra) => inDateRange(compra.fecha_creacion) && ocMatchesArea(compra))
  }, [ordenesRecibidas, inDateRange, ocMatchesArea])

  const mostrarReqPorEntregar = estadoReq === 'por_entregar'
  const mostrarReqEntregados = estadoReq === 'entregados'
  const mostrarOcPorRecibir = estadoOc === 'por_recibir'
  const mostrarOcPendientesEntrega = estadoOc === 'pendiente_entrega'
  const mostrarOcRecibidos = estadoOc === 'entregados'

  const setLoading = (id, value) => {
    setLoadingById((prev) => ({ ...prev, [id]: value }))
  }

  const searchReceptores = async (reqId, query) => {
    const term = String(query || '')
    setReceptorQueryByReq((prev) => ({ ...prev, [reqId]: term }))

    const selected = receptorSelectedByReq[reqId]
    if (!selected || normalize(`${selected.nombre || ''} ${selected.dni || ''}`) !== normalize(term)) {
      setReceptorSelectedByReq((prev) => ({ ...prev, [reqId]: null }))
    }

    if (!term.trim()) {
      setReceptorOptionsByReq((prev) => ({ ...prev, [reqId]: [] }))
      return
    }

    try {
      setReceptorLoadingByReq((prev) => ({ ...prev, [reqId]: true }))
      const options = await fetchReceptoresByRequerimiento(reqId, term.trim())
      setReceptorOptionsByReq((prev) => ({ ...prev, [reqId]: Array.isArray(options) ? options : [] }))
    } catch (err) {
      setError(err.message || 'Error al buscar receptores')
      setReceptorOptionsByReq((prev) => ({ ...prev, [reqId]: [] }))
    } finally {
      setReceptorLoadingByReq((prev) => ({ ...prev, [reqId]: false }))
    }
  }

  const selectReceptor = (reqId, receptor) => {
    const label = `${receptor.nombre || ''} - DNI ${receptor.dni || ''}`.trim()
    setReceptorSelectedByReq((prev) => ({ ...prev, [reqId]: receptor }))
    setReceptorQueryByReq((prev) => ({ ...prev, [reqId]: label }))
    setReceptorOptionsByReq((prev) => ({ ...prev, [reqId]: [] }))
  }

  const searchReceptoresCompra = async (compraId, query) => {
    const term = String(query || '')
    setReceptorQueryByOc((prev) => ({ ...prev, [compraId]: term }))

    const selected = receptorSelectedByOc[compraId]
    if (!selected || normalize(`${selected.nombre || ''} ${selected.dni || ''}`) !== normalize(term)) {
      setReceptorSelectedByOc((prev) => ({ ...prev, [compraId]: null }))
    }

    if (!term.trim()) {
      setReceptorOptionsByOc((prev) => ({ ...prev, [compraId]: [] }))
      return
    }

    try {
      setReceptorLoadingByOc((prev) => ({ ...prev, [compraId]: true }))
      const options = await fetchReceptoresByCompra(compraId, term.trim())
      setReceptorOptionsByOc((prev) => ({ ...prev, [compraId]: Array.isArray(options) ? options : [] }))
    } catch (err) {
      setError(err.message || 'Error al buscar receptores de la orden')
      setReceptorOptionsByOc((prev) => ({ ...prev, [compraId]: [] }))
    } finally {
      setReceptorLoadingByOc((prev) => ({ ...prev, [compraId]: false }))
    }
  }

  const selectReceptorCompra = (compraId, receptor) => {
    const label = `${receptor.nombre || ''} - DNI ${receptor.dni || ''}`.trim()
    setReceptorSelectedByOc((prev) => ({ ...prev, [compraId]: receptor }))
    setReceptorQueryByOc((prev) => ({ ...prev, [compraId]: label }))
    setReceptorOptionsByOc((prev) => ({ ...prev, [compraId]: [] }))
  }

  const handleEntregaRequerimiento = async (req) => {
    setError('')
    try {
      const selected = receptorSelectedByReq[req.id]
      const receptorUserId = Number(selected?.id || 0)
      if (!receptorUserId) {
        setError('Debes seleccionar un receptor valido antes de confirmar entrega')
        return
      }

      setLoading(req.id, true)
      if (onConfirmarEntregaRequerimiento) {
        await onConfirmarEntregaRequerimiento(req.id, receptorUserId)
      }
    } catch (err) {
      setError(err.message || 'Error al confirmar entrega del requerimiento')
    } finally {
      setLoading(req.id, false)
    }
  }

  const handleRecepcionCompra = async (compra) => {
    setError('')
    try {
      setLoading(compra.id, true)
      if (onConfirmarRecepcion) {
        await onConfirmarRecepcion(compra.id, {})
      }
    } catch (err) {
      setError(err.message || 'Error al confirmar recepcion de la orden')
    } finally {
      setLoading(compra.id, false)
    }
  }

  const handleEntregaAreaCompra = async (compra) => {
    setError('')
    try {
      const selectedReceptor = receptorSelectedByOc[compra.id]
      const receptorUserId = Number(selectedReceptor?.id || 0)

      if (!receptorUserId) {
        setError('Debes seleccionar un receptor valido antes de marcar la orden como entregada')
        return
      }

      setLoading(compra.id, true)
      if (onConfirmarEntregaAreaCompra) {
        await onConfirmarEntregaAreaCompra(compra.id, receptorUserId)
      }
    } catch (err) {
      setError(err.message || 'Error al confirmar entrega al area de la orden')
    } finally {
      setLoading(compra.id, false)
    }
  }

  const handleDownload = async (compra) => {
    setError('')
    try {
      if (onDescargarPdf) {
        await onDescargarPdf(compra.id)
      }
    } catch (err) {
      setError(err.message || 'Error al descargar PDF')
    }
  }

  const renderRequirementCard = (req) => (
    <article className="delivery-card" key={`req-${req.id}`}>
      <div className="delivery-head">
        <div>
          <h3>Requerimiento #{req.id}</h3>
          <p className="delivery-summary-line"><strong>Area:</strong> {req.area || 'Sin area'}</p>
          <p className="delivery-summary-line"><strong>Solicitante:</strong> {req.usuario || `ID ${req.id_usuario}`}</p>
          <p className="delivery-summary-line"><strong>Fecha:</strong> {req.fecha_creacion ? new Date(req.fecha_creacion).toLocaleString() : 'Sin fecha'}</p>
        </div>
        <span className={getPriorityBadgeClass(req.prioridad)}>{getPriorityLabel(req.prioridad)}</span>
      </div>

      <p className="delivery-summary-line"><strong>Descripcion:</strong> {req.descripcion || 'Sin descripcion'}</p>

      <div className="delivery-items">
        <strong>Materiales solicitados:</strong>
        <ul>
          {(req.items || []).map((item, idx) => (
            <li key={`req-${req.id}-${item.id_material}-${idx}`}>
              {item.material || `Material ${item.id_material}`} - {item.cantidad}
            </li>
          ))}
        </ul>
      </div>

      <div className="delivery-receptor-wrap">
        <label className="delivery-receptor-label">Receptor (nombre o DNI)</label>
        <div className="delivery-receptor-autocomplete">
          <input
            type="text"
            value={receptorQueryByReq[req.id] || ''}
            onChange={(event) => searchReceptores(req.id, event.target.value)}
            placeholder="Buscar receptor por nombre o DNI"
          />
          {receptorLoadingByReq[req.id] && <small>Buscando receptores...</small>}
          {(receptorOptionsByReq[req.id] || []).length > 0 && (
            <ul className="delivery-receptor-suggestions">
              {(receptorOptionsByReq[req.id] || []).map((persona) => (
                <li key={`receptor-${req.id}-${persona.id}`}>
                  <button type="button" onClick={() => selectReceptor(req.id, persona)}>
                    <span>{persona.nombre || 'Sin nombre'} - DNI {persona.dni || 'N/D'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* La foto y datos del receptor se muestran solo tras seleccionar un usuario */}
        {Number(receptorSelectedByReq[req.id]?.id || 0) > 0 && (
          <div className="delivery-selected-receptor-card compact">
            <img
              className="delivery-selected-receptor-avatar compact"
              src={resolveReceptorImage(receptorSelectedByReq[req.id])}
              alt={receptorSelectedByReq[req.id]?.nombre || 'Receptor seleccionado'}
              onError={(event) => {
                event.currentTarget.src = getFallbackAvatar(receptorSelectedByReq[req.id]?.nombre)
              }}
            />
            <div className="delivery-selected-receptor-info inline">
              <strong>{receptorSelectedByReq[req.id]?.nombre || 'Sin nombre'}</strong>
            </div>
          </div>
        )}
      </div>

      <div className="delivery-actions">
        <button
          type="button"
          className="btn-delivery-confirm"
          onClick={() => handleEntregaRequerimiento(req)}
          disabled={loadingById[req.id] || !Number(receptorSelectedByReq[req.id]?.id || 0)}
        >
          Confirmar entrega
        </button>
      </div>
    </article>
  )

  const renderRequirementDelivered = (req) => (
    <article className="delivery-card" key={`req-delivered-${req.id}`}>
      <div className="delivery-head">
        <div>
          <h3>Requerimiento #{req.id}</h3>
          <p className="delivery-summary-line"><strong>Area:</strong> {req.area || 'Sin area'}</p>
          <p className="delivery-summary-line"><strong>Solicitante:</strong> {req.usuario || `ID ${req.id_usuario}`}</p>
          <p className="delivery-summary-line"><strong>Fecha:</strong> {req.fecha_creacion ? new Date(req.fecha_creacion).toLocaleString() : 'Sin fecha'}</p>
        </div>
        <span className={getPriorityBadgeClass(req.prioridad)}>{getPriorityLabel(req.prioridad)}</span>
      </div>

      <p className="delivery-summary-line"><strong>Recibido por:</strong> {req.nombre_receptor || 'N/D'}</p>
      <p className="delivery-summary-line"><strong>Descripcion:</strong> {req.descripcion || 'Sin descripcion'}</p>
    </article>
  )

  const renderOrderCard = (compra) => {
    const areaDestinoNorm = normalize(compra.area_final || '')
    const isAlmacenDestino = areaDestinoNorm === 'ALMACÉN'
    const buttonLabel = isAlmacenDestino ? 'Confirmar recepción (a Almacén)' : 'Confirmar recepción (en tránsito)'

    return (
      <article className="delivery-card" key={`oc-${compra.id}`}>
        <div className="delivery-head">
          <div>
            <h3>OC #{compra.numero_orden || compra.id}</h3>
            <p className="delivery-summary-line"><strong>Proveedor:</strong> {compra.proveedor || 'N/D'}</p>
            <p className="delivery-summary-line"><strong>Solicitante:</strong> {compra.usuario || 'Sin solicitante'}</p>
            <p className="delivery-summary-line"><strong>Area destino:</strong> {compra.area_final || 'Sin area'}</p>
            <p className="delivery-summary-line"><strong>Fecha:</strong> {compra.fecha_creacion ? new Date(compra.fecha_creacion).toLocaleString() : 'Sin fecha'}</p>
          </div>
          <span className="delivery-badge pendiente">POR RECIBIR</span>
        </div>

        <div className="delivery-items">
          <strong>Materiales:</strong>
          <ul>
            {(compra.items || []).map((item, idx) => (
              <li key={`oc-item-${compra.id}-${item.id_detalle || idx}`}>
                {item.material || item.descripcion || 'Material'} | Categoria: {item.categoria || 'Sin categoria'} | Cantidad: {item.cantidad}
              </li>
            ))}
          </ul>
        </div>

        <div className="delivery-actions">
          <button
            type="button"
            className="btn-delivery-confirm"
            onClick={() => handleRecepcionCompra(compra)}
            disabled={loadingById[compra.id]}
          >
            {buttonLabel}
          </button>
          <button
            type="button"
            className="btn-delivery-download"
            onClick={() => handleDownload(compra)}
          >
            Descargar PDF
          </button>
        </div>
      </article>
    )
  }

  const renderPendingAreaOrder = (compra) => {
    const receptorSeleccionado = receptorSelectedByOc[compra.id]

    return (
      <article className="delivery-card" key={`oc-pending-area-${compra.id}`}>
        <div className="delivery-head">
          <div>
            <h3>OC #{compra.numero_orden || compra.id}</h3>
            <p className="delivery-summary-line"><strong>Proveedor:</strong> {compra.proveedor || 'N/D'}</p>
            <p className="delivery-summary-line"><strong>Solicitante:</strong> {compra.usuario || 'Sin solicitante'}</p>
            <p className="delivery-summary-line"><strong>Area destino:</strong> {compra.area_final || 'Sin area'}</p>
            <p className="delivery-summary-line"><strong>Fecha:</strong> {compra.fecha_creacion ? new Date(compra.fecha_creacion).toLocaleString() : 'Sin fecha'}</p>
          </div>
          <span className="delivery-badge pendiente">PENDIENTE DE ENTREGA AL AREA</span>
        </div>

        <div className="delivery-items">
          <strong>Materiales:</strong>
          <ul>
            {(compra.items || []).map((item, idx) => (
              <li key={`oc-pa-item-${compra.id}-${item.id_detalle || idx}`}>
                {item.material || item.descripcion || 'Material'} | Categoria: {item.categoria || 'Sin categoria'} | Cantidad: {item.cantidad}
              </li>
            ))}
          </ul>
        </div>

        <div className="delivery-receptor-wrap">
          <label className="delivery-receptor-label">Receptor (nombre o DNI)</label>
          <div className="delivery-receptor-autocomplete">
            <input
              type="text"
              value={receptorQueryByOc[compra.id] || ''}
              onChange={(event) => searchReceptoresCompra(compra.id, event.target.value)}
              placeholder="Buscar receptor por nombre o DNI"
            />
            {receptorLoadingByOc[compra.id] && <small>Buscando receptores...</small>}
            {(receptorOptionsByOc[compra.id] || []).length > 0 && (
              <ul className="delivery-receptor-suggestions">
                {(receptorOptionsByOc[compra.id] || []).map((persona) => (
                  <li key={`oc-receptor-${compra.id}-${persona.id}`}>
                    <button type="button" onClick={() => selectReceptorCompra(compra.id, persona)}>
                      <span>{persona.nombre || 'Sin nombre'} - DNI {persona.dni || 'N/D'}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {Number(receptorSeleccionado?.id || 0) > 0 && (
            <div className="delivery-selected-receptor-card compact">
              <img
                className="delivery-selected-receptor-avatar compact"
                src={resolveReceptorImage(receptorSeleccionado)}
                alt={receptorSeleccionado?.nombre || 'Receptor seleccionado'}
                onError={(event) => {
                  event.currentTarget.src = getFallbackAvatar(receptorSeleccionado?.nombre)
                }}
              />
              <div className="delivery-selected-receptor-info inline">
                <strong>{receptorSeleccionado?.nombre || 'Sin nombre'}</strong>
              </div>
            </div>
          )}
        </div>

        <div className="delivery-actions">
          <button
            type="button"
            className="btn-delivery-confirm"
            onClick={() => handleEntregaAreaCompra(compra)}
            disabled={loadingById[compra.id] || !Number(receptorSeleccionado?.id || 0)}
          >
            Marcar como entregado
          </button>
          <button
            type="button"
            className="btn-delivery-download"
            onClick={() => handleDownload(compra)}
          >
            Descargar PDF
          </button>
        </div>
      </article>
    )
  }

  const renderReceivedOrder = (compra) => (
    <article className="delivery-card" key={`oc-received-${compra.id}`}>
      <div className="delivery-head">
        <div>
          <h3>OC #{compra.numero_orden || compra.id}</h3>
          <p className="delivery-summary-line"><strong>Proveedor:</strong> {compra.proveedor || 'N/D'}</p>
          <p className="delivery-summary-line"><strong>Solicitante:</strong> {compra.usuario || 'Sin solicitante'}</p>
          <p className="delivery-summary-line"><strong>Fecha:</strong> {compra.fecha_creacion ? new Date(compra.fecha_creacion).toLocaleString() : 'Sin fecha'}</p>
        </div>
        <span className="delivery-badge entregado">ENTREGADO</span>
      </div>

      <p className="delivery-summary-line"><strong>Recibido por:</strong> {compra.recibido_por || 'N/D'}</p>

      <div className="delivery-items">
        <strong>Materiales:</strong>
        <ul>
          {(compra.items || []).map((item, idx) => (
            <li key={`oc-received-item-${compra.id}-${item.id_detalle || idx}`}>
              {item.material || item.descripcion || 'Material'} | Categoria: {item.categoria || 'Sin categoria'} | Cantidad: {item.cantidad}
            </li>
          ))}
        </ul>
      </div>

      <div className="delivery-actions">
        <button
          type="button"
          className="btn-delivery-download"
          onClick={() => handleDownload(compra)}
        >
          Descargar PDF
        </button>
      </div>
    </article>
  )

  return (
    <section className="delivery-section">
      <div className="section-header">
        <h1>Gestionar Entrega</h1>
      </div>

      {error && <p className="area-search-error">{error}</p>}
      <div className='delivery-group'>
        <div className="delivery-switcher">
          <button
            type="button"
            className={`delivery-switcher-btn ${activeTab === 'requerimientos' ? 'active' : ''}`}
            onClick={() => setActiveTab('requerimientos')}
          >
            Requerimientos ({requerimientosPorEntregar.length + requerimientosEntregados.length})
          </button>
          <button
            type="button"
            className={`delivery-switcher-btn ${activeTab === 'ordenes' ? 'active' : ''}`}
            onClick={() => setActiveTab('ordenes')}
          >
            Ordenes de compra ({ordenesPorRecibir.length + ordenesPendientesEntrega.length + ordenesRecibidas.length})
          </button>
        </div>

      <div className="delivery-filters">
        <label>
          Desde
          <input type="date" value={fechaInicio} onChange={(e) => setFechaInicio(e.target.value)} />
        </label>
        <label>
          Hasta
          <input type="date" value={fechaFin} onChange={(e) => setFechaFin(e.target.value)} />
        </label>
        <label className="delivery-filter-location">
          Área
          <div className="delivery-area-autocomplete">
            <input
              type="text"
              value={areaQuery}
              onChange={(e) => {
                const next = e.target.value
                setAreaQuery(next)
                const matchesSelected = selectedArea && String(selectedArea.nombre || '').toLowerCase() === String(next || '').trim().toLowerCase()
                if (!matchesSelected) {
                  setSelectedArea(null)
                }
              }}
              placeholder="Buscar area"
            />
            {areaSuggestions.length > 0 && (
              <ul className="delivery-area-suggestions">
                {areaSuggestions.map((area) => (
                  <li key={`area-${area.id}`}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedArea(area)
                        setAreaQuery(area.nombre)
                      }}
                    >
                      {area.nombre}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </label>
      </div>
      </div>
      

      <div className="delivery-status-switcher">
        {activeTab === 'requerimientos' ? (
          <>
            <button type="button" className={`delivery-status-btn ${estadoReq === 'por_entregar' ? 'active' : ''}`} onClick={() => setEstadoReq('por_entregar')}>Por entregar ({requerimientosPorEntregarFiltrados.length})</button>
            <button type="button" className={`delivery-status-btn ${estadoReq === 'entregados' ? 'active' : ''}`} onClick={() => setEstadoReq('entregados')}>Entregados ({requerimientosEntregadosFiltrados.length})</button>
          </>
        ) : (
          <>
            <button type="button" className={`delivery-status-btn ${estadoOc === 'por_recibir' ? 'active' : ''}`} onClick={() => setEstadoOc('por_recibir')}>Por recibir</button>
            <button type="button" className={`delivery-status-btn ${estadoOc === 'pendiente_entrega' ? 'active' : ''}`} onClick={() => setEstadoOc('pendiente_entrega')}>Pendiente de entrega</button>
            <button type="button" className={`delivery-status-btn ${estadoOc === 'entregados' ? 'active' : ''}`} onClick={() => setEstadoOc('entregados')}>Entregados</button>
          </>
        )}
      </div>

      <div className="delivery-blocks">
        {activeTab === 'requerimientos' && (
          <section className="delivery-block">
            {mostrarReqPorEntregar && (
              <>
                {requerimientosPorEntregarFiltrados.length === 0 ? (
                  <div className="empty-state">No hay requerimientos pendientes de entrega.</div>
                ) : (
                  <div className="delivery-list">{requerimientosPorEntregarFiltrados.map(renderRequirementCard)}</div>
                )}
              </>
            )}

            {mostrarReqEntregados && (
              <>
                {requerimientosEntregadosFiltrados.length === 0 ? (
                  <div className="empty-state">No hay requerimientos entregados.</div>
                ) : (
                  <div className="delivery-list">{requerimientosEntregadosFiltrados.map(renderRequirementDelivered)}</div>
                )}
              </>
            )}
          </section>
        )}

        {activeTab === 'ordenes' && (
          <section className="delivery-block">
            {mostrarOcPorRecibir && (
              <>
                <div className="delivery-block-header">
                  <h2>Órdenes de compra por recibir</h2>
                  <span>{ordenesPorRecibirFiltradas.length}</span>
                </div>

                {ordenesPorRecibirFiltradas.length === 0 ? (
                  <div className="empty-state">No hay ordenes pendientes de recepcion.</div>
                ) : (
                  <div className="delivery-list">{ordenesPorRecibirFiltradas.map(renderOrderCard)}</div>
                )}
              </>
            )}

            {mostrarOcPendientesEntrega && (
              <>
                <div className="delivery-block-subheader">
                  <h3>Órdenes pendientes de entrega al area</h3>
                  <span>{ordenesPendientesEntregaFiltradas.length}</span>
                </div>

                {ordenesPendientesEntregaFiltradas.length === 0 ? (
                  <div className="empty-state">No hay ordenes pendientes de entrega al area.</div>
                ) : (
                  <div className="delivery-list">{ordenesPendientesEntregaFiltradas.map(renderPendingAreaOrder)}</div>
                )}
              </>
            )}

            {mostrarOcRecibidos && (
              <>
                <div className="delivery-block-subheader">
                  <h3>Órdenes de compra entregadas</h3>
                  <span>{ordenesRecibidasFiltradas.length}</span>
                </div>

                {ordenesRecibidasFiltradas.length === 0 ? (
                  <div className="empty-state">No hay ordenes entregadas.</div>
                ) : (
                  <div className="delivery-list">{ordenesRecibidasFiltradas.map(renderReceivedOrder)}</div>
                )}
              </>
            )}
          </section>
        )}
      </div>
    </section>
  )
}
