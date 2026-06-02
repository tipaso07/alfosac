import { useEffect, useMemo, useRef, useState } from 'react'
import '../styles/AddProductForm.css'
import { fetchCategorias } from '../services/api'

const createItemFromMaterial = (material) => ({
  id_material: material?.id || '',
  nombre: material?.nombre_producto || material?.nombre || '',
  categoria: material?.categoria || '',
  cantidad: 1,
})

export default function AddProductForm({
  onSubmitRequirement,
  materials = [],
  currentUser = 'Usuario',
  currentArea = 'Sin area',
}) {
  const firstMaterial = materials[0] || null
  const [formData, setFormData] = useState({
    prioridad: 'MEDIA',
    descripcion: '',
    items: [createItemFromMaterial(firstMaterial)],
  })

  const [errors, setErrors] = useState({})
  const [catalogCategories, setCatalogCategories] = useState([])
  const [openMaterialSuggestions, setOpenMaterialSuggestions] = useState({})
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

  useEffect(() => {
    if (!materials.length) return

    setFormData((current) => ({
      ...current,
      items: current.items.map((item, index) => {
        const material = materials.find((entry) => Number(entry.id) === Number(item.id_material)) || (index === 0 ? firstMaterial : null)
        return material ? createItemFromMaterial(material) : item
      }),
    }))
  }, [materials, firstMaterial])

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

  const getMaterialSuggestions = (searchValue) => {
    const term = String(searchValue || '').trim().toLowerCase()
    if (!term) return materials.slice(0, 8)

    return materials
      .filter((material) => {
        const materialName = String(material.nombre_producto || material.nombre || '').toLowerCase()
        const materialCategory = String(material.categoria || '').toLowerCase()
        return materialName.includes(term) || materialCategory.includes(term)
      })
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

  const addItem = () => {
    setFormData({
      ...formData,
      items: [...formData.items, createItemFromMaterial(firstMaterial)],
    })
  }

  const setSuggestionOpen = (index, value) => {
    setOpenMaterialSuggestions((prev) => ({
      ...prev,
      [index]: value,
    }))
  }

  const selectSuggestedMaterial = (index, material) => {
    const nextItems = [...formData.items]
    const currentItem = nextItems[index]
    const stockDisponible = getMaterialStock(material.id)
    nextItems[index] = {
      ...currentItem,
      id_material: material.id,
      nombre: material.nombre_producto || material.nombre || '',
      categoria: material.categoria || '',
      cantidad: Math.max(1, Math.min(currentItem.cantidad || 1, stockDisponible)),
    }
    setFormData({ ...formData, items: nextItems })
    setSuggestionOpen(index, false)
    if (errors.items) {
      setErrors({ ...errors, items: '' })
    }
  }

  const handleItemQuantityChange = (index, value) => {
    const nextItems = [...formData.items]
    const currentItem = nextItems[index]
    const stockDisponible = getMaterialStock(currentItem.id_material)
    const rawCantidad = parseInt(value || '0', 10) || 0
    const nextCantidad = Math.max(1, Math.min(rawCantidad, stockDisponible || 9999))

    nextItems[index] = {
      ...currentItem,
      cantidad: nextCantidad,
    }
    setFormData({ ...formData, items: nextItems })
    if (errors.items) {
      setErrors({ ...errors, items: '' })
    }
  }

  const removeItem = (index) => {
    const nextItems = formData.items.filter((_, idx) => idx !== index)
    setFormData({
      ...formData,
      items: nextItems.length > 0 ? nextItems : [{
        ...createItemFromMaterial(firstMaterial),
      }],
    })
  }

  const validateForm = () => {
    const newErrors = {}
    if (!['ALTA', 'MEDIA', 'BAJA'].includes(formData.prioridad)) {
      newErrors.prioridad = 'La prioridad es requerida'
    }

    if (!formData.items || formData.items.length === 0) {
      newErrors.items = 'Debe agregar al menos un material'
    }

    if (!materials.length) {
      newErrors.items = 'No hay materiales disponibles en inventario para solicitar'
      return newErrors
    }

    const invalidItem = formData.items.find((item) => !item.id_material || Number(item.cantidad) <= 0)
    if (invalidItem) {
      newErrors.items = 'Cada item debe seleccionar un material existente y cantidad mayor a 0'
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
      items: [createItemFromMaterial(firstMaterial)],
    })
    setErrors({})
  }

  return (
    <div className="add-product-section">
      <div className="section-header">
        <h1>Solicitar Requerimiento</h1>
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
              <div className="form-group material-autocomplete">
                <input
                  type="text"
                  value={item.nombre || ''}
                  placeholder={materials.length === 0 ? 'No hay materiales en inventario' : 'Escribe para buscar material...'}
                  className={`material-input ${errors.items ? 'error' : ''}`}
                  autoComplete="off"
                  onFocus={(e) => {
                    setSuggestionOpen(index, true)
                    // Limpiar el input al hacer focus para poder escribir
                    if (item.id_material) {
                      const nextItems = [...formData.items]
                      nextItems[index] = {
                        ...nextItems[index],
                        nombre: '',
                        id_material: '',
                        categoria: '',
                      }
                      setFormData({ ...formData, items: nextItems })
                    }
                  }}
                  onBlur={() => setTimeout(() => setSuggestionOpen(index, false), 150)}
                  onChange={(e) => {
                    const nextItems = [...formData.items]
                    nextItems[index] = {
                      ...nextItems[index],
                      nombre: e.target.value,
                      id_material: '',
                      categoria: '',
                    }
                    setFormData({ ...formData, items: nextItems })
                    setSuggestionOpen(index, true)
                    if (errors.items) {
                      setErrors({ ...errors, items: '' })
                    }
                  }}
                  disabled={materials.length === 0}
                />
                {openMaterialSuggestions[index] && materials.length > 0 && getMaterialSuggestions(item.nombre).length > 0 && (
                  <ul className="material-suggestions">
                    {getMaterialSuggestions(item.nombre).map((material) => (
                      <li key={material.id}>
                        <button
                          type="button"
                          onClick={() => selectSuggestedMaterial(index, material)}
                        >
                          {(material.nombre_producto || material.nombre)} - Stock: {Number(material.stock ?? material.cantidad ?? 0)}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="form-group">
                <input
                  type="text"
                  value={item.categoria || ''}
                  readOnly
                  className="category-input"
                  placeholder="Categoria del material"
                />
              </div>
              <div className="form-group">
                <input
                  type="number"
                  min="1"
                  max={item.id_material ? Math.max(1, getMaterialStock(item.id_material)) : undefined}
                  value={item.cantidad}
                  onChange={(e) => handleItemQuantityChange(index, e.target.value)}
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
