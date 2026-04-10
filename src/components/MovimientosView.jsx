import { useEffect, useMemo, useState } from 'react'
import '../styles/MovimientosView.css'
import { fetchAreas } from '../services/api'

export default function MovimientosView({ movimientos = [] }) {
  const normalize = (value) => String(value || '').trim().toUpperCase()

  const [tipo, setTipo] = useState('SALIDA')
  const [areaQuery, setAreaQuery] = useState('')
  const [selectedArea, setSelectedArea] = useState('')
  const [areaSuggestions, setAreaSuggestions] = useState([])
  const [loadingAreas, setLoadingAreas] = useState(false)
  const [areasError, setAreasError] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [fechaInicio, setFechaInicio] = useState('')
  const [fechaFin, setFechaFin] = useState('')

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
    const startDate = fechaInicio ? new Date(`${fechaInicio}T00:00:00`) : null
    const endDate = fechaFin ? new Date(`${fechaFin}T23:59:59.999`) : null
    const areaFilter = normalize(selectedArea)

    return movimientos.filter((mov) => {
      if (normalize(mov.tipo) !== tipo) return false

      if (areaFilter && normalize(mov.area_destino) !== areaFilter) return false

      if (startDate || endDate) {
        const movDate = mov.fecha ? new Date(mov.fecha) : null
        if (!movDate || Number.isNaN(movDate.getTime())) return false
        if (startDate && movDate < startDate) return false
        if (endDate && movDate > endDate) return false
      }

      return true
    })
  }, [movimientos, tipo, selectedArea, fechaInicio, fechaFin])

  const hasAreaFilter = Boolean(selectedArea.trim())
  const hasDateFilter = Boolean(fechaInicio || fechaFin)

  return (
    <section className="movs-section">
      <div className="section-header">
        <h1>Movimientos</h1>
        <p>Total{hasAreaFilter ? ` en ${selectedArea}` : ''}: {filtered.length}</p>
      </div>

      <div className="movs-filters">
        <button type="button" className={tipo === 'ENTRADA' ? 'active' : ''} onClick={() => setTipo('ENTRADA')}>
          Entradas
        </button>
        <button type="button" className={tipo === 'SALIDA' ? 'active' : ''} onClick={() => setTipo('SALIDA')}>
          Salidas
        </button>
      </div>

      <form className="area-search" onSubmit={onSearchSubmit}>
        <label htmlFor="mov-area-search-input">Buscar por area</label>
        <div className="area-search-row">
          <input
            id="mov-area-search-input"
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

      <div className="date-filter-grid">
        <label htmlFor="fecha-inicio" className="date-filter-field">
          <span>Fecha inicio</span>
          <input
            id="fecha-inicio"
            type="date"
            value={fechaInicio}
            onChange={(event) => setFechaInicio(event.target.value)}
          />
        </label>

        <label htmlFor="fecha-fin" className="date-filter-field">
          <span>Fecha fin</span>
          <input
            id="fecha-fin"
            type="date"
            value={fechaFin}
            onChange={(event) => setFechaFin(event.target.value)}
          />
        </label>

        <button
          type="button"
          className="btn-date-clear"
          onClick={() => {
            setFechaInicio('')
            setFechaFin('')
          }}
        >
          Limpiar fechas
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          No hay movimientos de tipo {tipo}{hasDateFilter ? ' en el rango seleccionado' : ''}.
        </div>
      ) : (
        <div className="movs-list">
          {filtered.map((mov) => (
            <article className="mov-card" key={mov.id}>
              <div className="mov-head">
                <h3>Movimiento #{mov.id}</h3>
                <span className={`mov-badge ${String(mov.tipo || '').toLowerCase()}`}>{mov.tipo}</span>
              </div>
              <p><strong>Fecha:</strong> {mov.fecha ? new Date(mov.fecha).toLocaleString() : 'Sin fecha'}</p>
              <p><strong>Usuario:</strong> {mov.usuario || `ID ${mov.id_usuario}`}</p>
              {normalize(mov.tipo) === 'SALIDA' && (
                <p><strong>Area de destino:</strong> {mov.area_destino || 'Sin area'}</p>
              )}
              {normalize(mov.tipo) === 'ENTRADA' && (
                <p><strong>Area asociada:</strong> {mov.area_destino || 'Sin area'}</p>
              )}

              <div className="mov-details">
                <strong>Detalles:</strong>
                <ul>
                  {(mov.detalles || []).map((det, idx) => (
                    <li key={`${mov.id}-${idx}-${det.id_material}`} className="mov-detail-item">
                      <p>{det.material || `Material ${det.id_material}`} - {det.cantidad}</p>
                    </li>
                  ))}
                </ul>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
