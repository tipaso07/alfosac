import { useEffect, useMemo, useState } from 'react'
import '../styles/RequerimientosManager.css'
import { fetchAreas } from '../services/api'

const PRIORITY_ORDER = { ALTA: 1, MEDIA: 2, BAJA: 3 }

export default function RequerimientosManager({
  requerimientos,
  onChangeEstado,
}) {
  const normalize = (value) => String(value || '').trim().toUpperCase()

  const formatPriority = (value) => {
    const normalized = normalize(value)
    if (normalized === 'ALTA') return 'Alta'
    if (normalized === 'MEDIA') return 'Media'
    if (normalized === 'BAJA') return 'Baja'
    return value || 'N/A'
  }

  const [activeStatus, setActiveStatus] = useState('PENDIENTE')
  const [areaQuery, setAreaQuery] = useState('')
  const [selectedArea, setSelectedArea] = useState('')
  const [areaSuggestions, setAreaSuggestions] = useState([])
  const [loadingAreas, setLoadingAreas] = useState(false)
  const [areasError, setAreasError] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)

  useEffect(() => {
    const term = areaQuery.trim()
    if (!term) {
      setAreaSuggestions([])
      setAreasError('')
      return
    }

    let cancelled = false
    setLoadingAreas(true)
    setAreasError('')

    const timer = setTimeout(async () => {
      try {
        const areas = await fetchAreas(term)
        if (!cancelled) {
          setAreaSuggestions(Array.isArray(areas) ? areas : [])
          setShowSuggestions(true)
        }
      } catch (error) {
        if (!cancelled) {
          setAreaSuggestions([])
          setAreasError(error.message || 'Error al buscar areas')
        }
      } finally {
        if (!cancelled) setLoadingAreas(false)
      }
    }, 250)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [areaQuery])

  const applyAreaFilter = (areaName) => {
    const value = String(areaName || '').trim()
    setSelectedArea(value)
    setAreaQuery(value)
    setShowSuggestions(false)
  }

  const clearAreaFilter = () => {
    setSelectedArea('')
    setAreaQuery('')
    setAreaSuggestions([])
    setShowSuggestions(false)
    setAreasError('')
  }

  const onSearchSubmit = (event) => {
    event.preventDefault()
    const term = areaQuery.trim()
    if (!term) {
      clearAreaFilter()
      return
    }

    const exact = areaSuggestions.find((area) => normalize(area.nombre) === normalize(term))
    if (exact) {
      applyAreaFilter(exact.nombre)
      return
    }

    if (areaSuggestions.length > 0) {
      applyAreaFilter(areaSuggestions[0].nombre)
      return
    }

    applyAreaFilter(term)
  }

  const filtered = useMemo(() => {
    const areaFilter = normalize(selectedArea)
    if (!areaFilter) return [...(requerimientos || [])]
    return (requerimientos || []).filter((req) => normalize(req.area) === areaFilter)
  }, [requerimientos, selectedArea])

  const pendientes = useMemo(() => {
    return filtered
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
  }, [filtered])

  const aprobados = useMemo(() => {
    return filtered
      .filter((req) => normalize(req.estado) === 'APROBADO')
      .sort((a, b) => {
        const dateA = new Date(a.fecha_creacion || 0).getTime()
        const dateB = new Date(b.fecha_creacion || 0).getTime()
        if (dateA !== dateB) return dateB - dateA
        return Number(b.id || 0) - Number(a.id || 0)
      })
  }, [filtered])

  const rechazados = useMemo(() => {
    return filtered
      .filter((req) => normalize(req.estado) === 'RECHAZADO')
      .sort((a, b) => {
        const dateA = new Date(a.fecha_creacion || 0).getTime()
        const dateB = new Date(b.fecha_creacion || 0).getTime()
        if (dateA !== dateB) return dateB - dateA
        return Number(b.id || 0) - Number(a.id || 0)
      })
  }, [filtered])

  const totalVisible = pendientes.length + aprobados.length + rechazados.length
  const hasAreaFilter = Boolean(selectedArea.trim())

  const renderCard = (req, showActions = false, showPriority = true) => (
    <article className="req-card" key={req.id}>
      <div className="req-head">
        <div>
          <h3>Requerimiento #{req.id}</h3>
          <p>Usuario solicitante: {req.usuario || `ID ${req.id_usuario}`}</p>
          <p>Area destinada: {req.area || 'Sin area'}</p>
          {showPriority && <p>Prioridad: {formatPriority(req.prioridad)}</p>}
          <p>Fecha de creacion: {req.fecha_creacion ? new Date(req.fecha_creacion).toLocaleString() : 'Sin fecha'}</p>
          {req.nombre_receptor && <p>Receptor: {req.nombre_receptor}</p>}
          {req.dni_receptor && <p>DNI receptor: {req.dni_receptor}</p>}
        </div>
        <div className="req-meta">
          <span className={`badge estado-${String(req.estado || '').toLowerCase()}`}>
            {req.estado}
          </span>
          {showPriority && <span className="badge prioridad">{formatPriority(req.prioridad)}</span>}
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
        <div className="req-actions">
          {req.puede_aprobar ? (
            <>
              <button className="btn-approve" onClick={() => onChangeEstado(req.id, 'APROBADO')}>
                Aprobar
              </button>
              <button className="btn-reject" onClick={() => onChangeEstado(req.id, 'RECHAZADO')}>
                Rechazar
              </button>
            </>
          ) : (
            <span className="area-search-hint">Pendiente de otro nivel de aprobacion.</span>
          )}
        </div>
      )}
    </article>
  )

  const statusConfig = {
    PENDIENTE: { label: 'Pendientes', data: pendientes, showActions: true },
    APROBADO: { label: 'Aprobados', data: aprobados, showActions: false },
    RECHAZADO: { label: 'Rechazados', data: rechazados, showActions: false },
  }

  const currentView = statusConfig[activeStatus]

  return (
    <section className="requirements-section">
      <div className="section-header">
        <h1>Gestionar Requerimientos</h1>
        <p>Total solicitudes{hasAreaFilter ? ` en ${selectedArea}` : ''}: {totalVisible}</p>
      </div>

      <form className="area-search" onSubmit={onSearchSubmit}>
        <label htmlFor="area-search-input">Buscar por area</label>
        <div className="area-search-row">
          <input
            id="area-search-input"
            type="text"
            value={areaQuery}
            placeholder="Escribe un area..."
            onChange={(event) => {
              setAreaQuery(event.target.value)
              setShowSuggestions(true)
            }}
            onFocus={() => {
              if (areaSuggestions.length > 0) setShowSuggestions(true)
            }}
          />
          <button type="submit" className="btn-area-search">Buscar</button>
          <button type="button" className="btn-area-clear" onClick={clearAreaFilter}>Limpiar</button>
        </div>

        {loadingAreas && <p className="area-search-hint">Buscando areas...</p>}
        {areasError && <p className="area-search-error">{areasError}</p>}

        {showSuggestions && areaSuggestions.length > 0 && (
          <ul className="area-suggestions">
            {areaSuggestions.map((area) => (
              <li key={area.id}>
                <button type="button" onClick={() => applyAreaFilter(area.nombre)}>
                  {area.nombre}
                </button>
              </li>
            ))}
          </ul>
        )}
      </form>

      <div className="status-switcher" role="tablist" aria-label="Filtro por estado de requerimientos">
        {Object.entries(statusConfig).map(([status, config]) => (
          <button
            key={status}
            type="button"
            className={`status-switcher-btn ${activeStatus === status ? 'active' : ''}`}
            onClick={() => setActiveStatus(status)}
          >
            {config.label} ({config.data.length})
          </button>
        ))}
      </div>

      <div className="requirements-group">
        <div className="group-header">
          <h2>{currentView.label}</h2>
          <span>{currentView.data.length}</span>
        </div>

        {currentView.data.length === 0 ? (
          <div className="empty-state">No hay requerimientos en esta seccion.</div>
        ) : (
          <div className="requirements-list">
            {currentView.data.map((req) => (
              renderCard(req, currentView.showActions, activeStatus === 'PENDIENTE')
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
