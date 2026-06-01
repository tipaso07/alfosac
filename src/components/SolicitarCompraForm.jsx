import { useEffect, useMemo, useRef, useState } from 'react'
import '../styles/SolicitarCompraForm.css'
import { fetchCategorias } from '../services/api'

export default function SolicitarCompraForm({ materials = [], currentUser, currentArea, onSubmitCompra, unidades = [] }) {
  const [item, setItem] = useState({ id_material: '', nombre: '', categoria: '', cantidad: 1, id_unidad: '' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [openSuggestions, setOpenSuggestions] = useState(false)
  const [openCategorySuggestions, setOpenCategorySuggestions] = useState(false)
  const [catalogCategories, setCatalogCategories] = useState([])
  const formRef = useRef(null)

  const sortedMaterials = useMemo(() => {
    return [...(materials || [])].sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || '')))
  }, [materials])

  const categoryOptions = useMemo(() => {
    const unique = new Set(
      [...(materials || []), ...catalogCategories]
        .map((m) => String(m.categoria || '').trim())
        .filter(Boolean)
    )

    return [...unique].sort((a, b) => a.localeCompare(b))
  }, [materials, catalogCategories])

  useEffect(() => {
    const loadCategorias = async () => {
      try {
        const data = await fetchCategorias()
        const mapped = Array.isArray(data)
          ? data.map((c) => ({ categoria: String(c.nombre || '').trim() })).filter((c) => c.categoria)
          : []
        setCatalogCategories(mapped)
      } catch {
        // Ignore category catalog failures and fallback to materials-derived categories.
      }
    }

    loadCategorias()
  }, [])

  const updateItem = (patch) => {
    setItem((prev) => ({ ...prev, ...patch }))
  }

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (!formRef.current?.contains(event.target)) {
        setOpenSuggestions(false)
        setOpenCategorySuggestions(false)
      }
    }

    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [])

  const getSuggestions = (searchValue) => {
    const term = String(searchValue || '').trim().toLowerCase()
    if (!term) return []

    return sortedMaterials
      .filter((material) => String(material.nombre || '').toLowerCase().includes(term))
      .slice(0, 8)
  }

  const getCategorySuggestions = (searchValue) => {
    const term = String(searchValue || '').trim().toLowerCase()
    if (!term) return categoryOptions.slice(0, 8)

    return categoryOptions
      .filter((category) => category.toLowerCase().includes(term))
      .slice(0, 8)
  }

  const selectMaterial = (material) => {
    updateItem({
      id_material: material.id,
      nombre: material.nombre || '',
      categoria: material.categoria || '',
      id_unidad: material.id_unidad || '',
    })
    setOpenSuggestions(false)
    setOpenCategorySuggestions(false)
  }

  const selectCategory = (categoria) => {
    updateItem({ categoria })
    setOpenCategorySuggestions(false)
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')

    const qty = Number(item.cantidad || 0)

    if (qty <= 0) {
      setError('La cantidad debe ser mayor a 0')
      return
    }

    const desc = String(item.nombre || '').trim()
    if (!desc) {
      setError('El material debe tener nombre')
      return
    }

    const categoria = String(item.categoria || '').trim()
    if (!item.id_material && !categoria) {
      setError('Debe ingresar la categoria del material cuando sea nuevo')
      return
    }

    const idMaterial = Number(item.id_material || 0)
    const idUnidad = Number(item.id_unidad || 0) || null
    if (!idUnidad) {
      setError('Debes seleccionar una unidad de medida')
      return
    }

    const payloadItem = idMaterial > 0
      ? { id_material: idMaterial, nombre: desc, categoria: categoria || null, cantidad: qty, id_unidad: idUnidad }
      : { id_material: null, nombre: desc, descripcion: desc, categoria, cantidad: qty, id_unidad: idUnidad }

    try {
      setSaving(true)
      await onSubmitCompra({ item: payloadItem })
      setItem({ id_material: '', nombre: '', categoria: '', cantidad: 1, id_unidad: '' })
    } catch (err) {
      setError(err.message || 'Error al registrar compra')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="purchase-request-section">
      <div className="section-header">
        <h1>Solicitar Compra</h1>
      </div>

      <form className="purchase-form" onSubmit={handleSubmit} ref={formRef}>
        <div className="purchase-user-info">
          <p><strong>Usuario:</strong> {currentUser || 'Usuario'}</p>
          <p><strong>Area:</strong> {currentArea || 'Sin area'}</p>
        </div>


        <div className="purchase-items">
          <article className="purchase-item-row">
            <div className="purchase-item-head">
            </div>

            <label>
              Material
              <div className="material-autocomplete">
                <input
                  type="text"
                  value={item.nombre}
                  placeholder="Escribe para buscar o crear material"
                  className="material-input"
                  onFocus={() => setOpenSuggestions(true)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      const suggestions = getSuggestions(item.nombre)
                      if (suggestions.length > 0) {
                        event.preventDefault()
                        selectMaterial(suggestions[0])
                      } else {
                        setOpenSuggestions(false)
                      }
                    }
                  }}
                  onChange={(event) => {
                    updateItem({ nombre: event.target.value, id_material: '', categoria: '' })
                    setOpenSuggestions(true)
                  }}
                />
                {openSuggestions && getSuggestions(item.nombre).length > 0 && (
                  <ul className="material-suggestions">
                    {getSuggestions(item.nombre).map((material) => (
                      <li key={`purchase-suggestion-${material.id}`}>
                        <button
                          type="button"
                          onClick={() => selectMaterial(material)}
                        >
                          {material.nombre}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {item.id_material ? <small>Material del catalogo seleccionado</small> : <small>Si no seleccionas sugerencia, se tratara como material nuevo</small>}
            </label>

            <label>
              Categoria
              <div className="category-autocomplete">
                <input
                  type="text"
                  value={item.categoria || ''}
                  readOnly={Boolean(item.id_material)}
                  className="category-input"
                  placeholder={item.id_material ? 'Categoria autocompletada' : 'Categoria del material nuevo'}
                  onFocus={() => {
                    if (!item.id_material) setOpenCategorySuggestions(true)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !item.id_material) {
                      const suggestions = getCategorySuggestions(item.categoria)
                      if (suggestions.length > 0) {
                        event.preventDefault()
                        selectCategory(suggestions[0])
                      } else {
                        setOpenCategorySuggestions(false)
                      }
                    }
                  }}
                  onChange={(event) => {
                    updateItem({ categoria: event.target.value })
                    if (!item.id_material) setOpenCategorySuggestions(true)
                  }}
                />
                {!item.id_material && openCategorySuggestions && getCategorySuggestions(item.categoria).length > 0 && (
                  <ul className="material-suggestions">
                    {getCategorySuggestions(item.categoria).map((categoria) => (
                      <li key={`purchase-category-${categoria}`}>
                        <button
                          type="button"
                          onClick={() => selectCategory(categoria)}
                        >
                          {categoria}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </label>

            <label>
              Cantidad
              <input
                type="number"
                min="1"
                step="0.01"
                value={item.cantidad}
                onChange={(event) => updateItem({ cantidad: event.target.value })}
              />
            </label>

            <label>
              Unidad
              <select value={String(item.id_unidad || '')} onChange={(e) => updateItem({ id_unidad: e.target.value })}>
                <option value="">Selecciona unidad</option>
                {unidades.map((u) => (
                  <option key={u.id} value={u.id}>{u.nombre || u.nombre_unidad || `Unidad ${u.id}`}</option>
                ))}
              </select>
            </label>
          </article>
        </div>

        <div className="purchase-actions">
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Guardando...' : 'Registrar solicitud de compra'}
          </button>
        </div>

        {error && <p className="purchase-error">{error}</p>}
      </form>
    </section>
  )
}
