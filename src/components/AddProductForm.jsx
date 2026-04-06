import { useEffect, useMemo, useRef, useState } from 'react'
import '../styles/AddProductForm.css'
import { fetchCategorias } from '../services/api'

export default function AddProductForm({
  onSubmitRequirement,
  materials = [],
  currentUser = 'Usuario',
  currentArea = 'Sin area',
}) {
  const [formData, setFormData] = useState({
    prioridad: 'MEDIA',
    descripcion: '',
    items: [
      {
        id_material: materials[0]?.id || '',
        nombre: materials[0]?.nombre_producto || materials[0]?.nombre || '',
        categoria: materials[0]?.categoria || '',
        cantidad: 1,
      },
    ],
  })

  const [errors, setErrors] = useState({})
  const [openSuggestionsFor, setOpenSuggestionsFor] = useState(null)
  const [openCategorySuggestionsFor, setOpenCategorySuggestionsFor] = useState(null)
  const [catalogCategories, setCatalogCategories] = useState([])
  const formRef = useRef(null)

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

  const getMaterialStock = (idMaterial) => {
    const material = materials.find((m) => Number(m.id) === Number(idMaterial))
    return Number(material?.stock ?? material?.cantidad ?? 0)
  }

  const getMaterialName = (idMaterial) => {
    const material = materials.find((m) => Number(m.id) === Number(idMaterial))
    return material?.nombre_producto || material?.nombre || ''
  }

  const getMaterialCategoria = (idMaterial) => {
    const material = materials.find((m) => Number(m.id) === Number(idMaterial))
    return material?.categoria || ''
  }

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (!formRef.current?.contains(event.target)) {
        setOpenSuggestionsFor(null)
        setOpenCategorySuggestionsFor(null)
      }
    }

    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [])

  const getSuggestions = (searchValue) => {
    const term = String(searchValue || '').trim().toLowerCase()
    if (!term) return []

    return materials
      .filter((material) => String(material.nombre_producto || material.nombre || '').toLowerCase().includes(term))
      .slice(0, 8)
  }

  const getCategorySuggestions = (searchValue) => {
    const term = String(searchValue || '').trim().toLowerCase()
    if (!term) return categoryOptions.slice(0, 8)

    return categoryOptions
      .filter((category) => category.toLowerCase().includes(term))
      .slice(0, 8)
  }

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData({
      ...formData,
      [name]: value,
    })
    if (errors[name]) {
      setErrors({ ...errors, [name]: '' })
    }
  }

  const handleItemChange = (index, field, value) => {
    const nextItems = [...formData.items]
    const currentItem = nextItems[index]

    if (field === 'categoria') {
      nextItems[index] = {
        ...currentItem,
        categoria: value,
      }
      setFormData({ ...formData, items: nextItems })
      if (errors.items) {
        setErrors({ ...errors, items: '' })
      }
      return
    }

    const nextMaterialId = field === 'id_material'
      ? parseInt(value || '0', 10) || ''
      : currentItem.id_material
    const stockDisponible = getMaterialStock(nextMaterialId)
    const rawCantidad = field === 'cantidad'
      ? parseInt(value || '0', 10) || 0
      : parseInt(currentItem.cantidad || '0', 10) || 0
    const cantidadAjustada = stockDisponible > 0
      ? Math.min(rawCantidad, stockDisponible)
      : 0

    nextItems[index] = {
      ...currentItem,
      id_material: nextMaterialId,
      nombre: field === 'id_material' ? getMaterialName(nextMaterialId) : currentItem.nombre,
      categoria: field === 'id_material' ? getMaterialCategoria(nextMaterialId) : currentItem.categoria,
      cantidad: nextMaterialId ? cantidadAjustada : Math.max(1, rawCantidad),
    }
    setFormData({ ...formData, items: nextItems })
    if (field === 'id_material') {
      setOpenCategorySuggestionsFor(null)
    }
    if (errors.items) {
      setErrors({ ...errors, items: '' })
    }
  }

  const addItem = () => {
    setFormData({
      ...formData,
      items: [...formData.items, {
        id_material: materials[0]?.id || '',
        nombre: materials[0]?.nombre_producto || materials[0]?.nombre || '',
        categoria: materials[0]?.categoria || '',
        cantidad: 1,
      }],
    })
  }

  const removeItem = (index) => {
    const nextItems = formData.items.filter((_, idx) => idx !== index)
    setFormData({
      ...formData,
      items: nextItems.length > 0 ? nextItems : [{
        id_material: materials[0]?.id || '',
        nombre: materials[0]?.nombre_producto || materials[0]?.nombre || '',
        categoria: materials[0]?.categoria || '',
        cantidad: 1,
      }],
    })
  }

  const handleItemNameChange = (index, value) => {
    const nextItems = [...formData.items]
    nextItems[index] = {
      ...nextItems[index],
      nombre: value,
      categoria: '',
      id_material: '',
    }
    setFormData({ ...formData, items: nextItems })
    if (errors.items) {
      setErrors({ ...errors, items: '' })
    }
  }

  const validateForm = () => {
    const newErrors = {}
    if (!['ALTA', 'MEDIA', 'BAJA'].includes(formData.prioridad)) {
      newErrors.prioridad = 'La prioridad es requerida'
    }

    if (!formData.items || formData.items.length === 0) {
      newErrors.items = 'Debe agregar al menos un material'
    }

    const invalidItem = formData.items.find((item) => !String(item.nombre || '').trim() || Number(item.cantidad) <= 0)
    if (invalidItem) {
      newErrors.items = 'Cada item debe tener nombre y cantidad mayor a 0'
      return newErrors
    }

    const missingCategory = formData.items.find((item) => !item.id_material && !String(item.categoria || '').trim())
    if (missingCategory) {
      newErrors.items = 'Debe ingresar la categoria del material cuando sea nuevo'
      return newErrors
    }

    const requestedByMaterial = formData.items.reduce((acc, item) => {
      if (!item.id_material) return acc
      const idMaterial = Number(item.id_material)
      const qty = Number(item.cantidad || 0)
      acc[idMaterial] = (acc[idMaterial] || 0) + qty
      return acc
    }, {})

    for (const [idMaterial, requestedQty] of Object.entries(requestedByMaterial)) {
      const stockDisponible = getMaterialStock(Number(idMaterial))
      if (requestedQty > stockDisponible) {
        const material = materials.find((m) => Number(m.id) === Number(idMaterial))
        const materialNombre = material?.nombre_producto || material?.nombre || `Material ${idMaterial}`
        newErrors.items = `La cantidad solicitada de ${materialNombre} (${requestedQty}) supera el stock disponible (${stockDisponible})`
        break
      }
    }

    return newErrors
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    const newErrors = validateForm()
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    onSubmitRequirement({
      prioridad: formData.prioridad,
      descripcion: formData.descripcion,
      items: formData.items.map((item) => ({
        id_material: item.id_material ? Number(item.id_material) : null,
        nombre: String(item.nombre || '').trim(),
        descripcion: String(item.nombre || '').trim(),
        categoria: String(item.categoria || '').trim(),
        cantidad: Number(item.cantidad),
      })),
    })

    setFormData({
      prioridad: 'MEDIA',
      descripcion: '',
      items: [{
        id_material: materials[0]?.id || '',
        nombre: materials[0]?.nombre_producto || materials[0]?.nombre || '',
        categoria: materials[0]?.categoria || '',
        cantidad: 1,
      }],
    })
    setErrors({})
  }

  return (
    <div className="add-product-section">
      <div className="section-header">
        <h1>Solicitar Requerimiento</h1>
        <p>Registra una nueva solicitud con multiples materiales</p>
      </div>

      <form className="product-form" onSubmit={handleSubmit} ref={formRef}>
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="usuario">Usuario</label>
            <input
              type="text"
              id="usuario"
              value={currentUser}
              disabled
            />
          </div>

          <div className="form-group">
            <label htmlFor="area">Area</label>
            <input
              type="text"
              id="area"
              value={currentArea}
              disabled
            />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="prioridad">Prioridad *</label>
            <select
              id="prioridad"
              name="prioridad"
              value={formData.prioridad}
              onChange={handleChange}
              className={errors.prioridad ? 'error' : ''}
            >
              <option value="ALTA">ALTA</option>
              <option value="MEDIA">MEDIA</option>
              <option value="BAJA">BAJA</option>
            </select>
            {errors.prioridad && <span className="error-message">{errors.prioridad}</span>}
          </div>

          <div className="form-group">
            <label htmlFor="descripcion">Descripcion</label>
            <input
              type="text"
              id="descripcion"
              name="descripcion"
              value={formData.descripcion}
              onChange={handleChange}
              placeholder="Descripcion del requerimiento"
            />
          </div>
        </div>

        <div className="form-group">
          <label>Materiales solicitados *</label>
          {formData.items.map((item, index) => (
            <div key={`${index}-${item.id_material}`} className="form-row" style={{ marginBottom: '8px' }}>
              <div className="form-group">
                <div className="material-autocomplete">
                  <input
                    type="text"
                    value={item.nombre || ''}
                    className="material-input"
                    onFocus={() => setOpenSuggestionsFor(index)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        const suggestions = getSuggestions(item.nombre)
                        if (suggestions.length > 0) {
                          event.preventDefault()
                          handleItemChange(index, 'id_material', suggestions[0].id)
                          setOpenSuggestionsFor(null)
                        } else {
                          setOpenSuggestionsFor(null)
                        }
                      }
                    }}
                    onChange={(e) => {
                      handleItemNameChange(index, e.target.value)
                      setOpenSuggestionsFor(index)
                    }}
                    placeholder="Buscar material"
                  />
                  {openSuggestionsFor === index && getSuggestions(item.nombre).length > 0 && (
                    <ul className="material-suggestions">
                      {getSuggestions(item.nombre).map((material) => (
                          <li key={`requirement-suggestion-${index}-${material.id}`}>
                            <button
                              type="button"
                              onClick={() => {
                                handleItemChange(index, 'id_material', material.id)
                                setOpenSuggestionsFor(null)
                              }}
                            >
                              {(material.nombre_producto || material.nombre)} (Stock: {Number(material.stock ?? material.cantidad ?? 0)})
                            </button>
                          </li>
                        ))}
                    </ul>
                  )}
                </div>
              </div>
              <div className="form-group">
                <div className="category-autocomplete">
                  <input
                    type="text"
                    value={item.categoria || ''}
                    readOnly={Boolean(item.id_material)}
                    className="category-input"
                    onFocus={() => {
                      if (!item.id_material) setOpenCategorySuggestionsFor(index)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !item.id_material) {
                        const suggestions = getCategorySuggestions(item.categoria)
                        if (suggestions.length > 0) {
                          event.preventDefault()
                          handleItemChange(index, 'categoria', suggestions[0])
                          setOpenCategorySuggestionsFor(null)
                        } else {
                          setOpenCategorySuggestionsFor(null)
                        }
                      }
                    }}
                    onChange={(e) => {
                      handleItemChange(index, 'categoria', e.target.value)
                      if (!item.id_material) setOpenCategorySuggestionsFor(index)
                    }}
                    placeholder={item.id_material ? 'Categoria autocompletada' : 'Categoria del material nuevo'}
                  />
                  {!item.id_material && openCategorySuggestionsFor === index && getCategorySuggestions(item.categoria).length > 0 && (
                    <ul className="material-suggestions">
                      {getCategorySuggestions(item.categoria).map((categoria) => (
                        <li key={`requirement-category-${index}-${categoria}`}>
                          <button
                            type="button"
                            onClick={() => {
                              handleItemChange(index, 'categoria', categoria)
                              setOpenCategorySuggestionsFor(null)
                            }}
                          >
                            {categoria}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              <div className="form-group">
                <input
                  type="number"
                  min="1"
                  max={item.id_material ? Math.max(1, getMaterialStock(item.id_material)) : undefined}
                  value={item.cantidad}
                  onChange={(e) => handleItemChange(index, 'cantidad', e.target.value)}
                  placeholder="Cantidad"
                />
              </div>
              <div className="form-group" style={{ display: 'flex', alignItems: 'flex-end' }}>
                <button type="button" className="btn-secondary" onClick={() => removeItem(index)}>
                  Quitar
                </button>
              </div>
            </div>
          ))}
          <button type="button" className="btn-secondary" onClick={addItem}>
            Agregar material
          </button>
          {errors.items && <span className="error-message">{errors.items}</span>}
        </div>

        <div className="form-actions">
          <button type="submit" className="btn-primary">
            Registrar requerimiento
          </button>
        </div>
      </form>
    </div>
  )
}
