import { useEffect, useState, useRef } from 'react'
import '../styles/ProductList.css'
import ProductItem from './ProductItem'
import { fetchProveedores } from '../services/api'

export default function ProductList({
  materials,
  warehouses,
  almacenes = [],
  searchTerm,
  setSearchTerm,
  filterWarehouse,
  setFilterWarehouse,
  canEditMaterials = false,
  canAddManualInventory = false,
  categorias = [],
  monedas = [],
  proveedores = [],
  unidades = [],
  onSaveMaterial,
  onUploadMaterialImage,
  onCreateMaterial,
}) {
  const [editingMaterialId, setEditingMaterialId] = useState(null)
  const [draftMaterial, setDraftMaterial] = useState(null)
  const [savingMaterialId, setSavingMaterialId] = useState(null)
  const [uploadingMaterialId, setUploadingMaterialId] = useState(null)
  const [editError, setEditError] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createSaving, setCreateSaving] = useState(false)
  const [createUploadingImage, setCreateUploadingImage] = useState(false)
  const [createError, setCreateError] = useState('')
  const [proveedorSearch, setProveedorSearch] = useState('')
  const [proveedorResults, setProveedorResults] = useState([])
  const [proveedorSearchOpen, setProveedorSearchOpen] = useState(false)
  const [proveedorSearchLoading, setProveedorSearchLoading] = useState(false)
  const debounceRef = useRef(null)
  const [createForm, setCreateForm] = useState({
    nombre: '',
    descripcion: '',
    categoria_text: '',
    id_unidad: '',
    id_proveedor: '',
    stock: '',
    stock_seguridad: '',
    id_almacen: '',
    costo_unitario: '',
    id_moneda: '',
    imagen: '',
  })

  useEffect(() => {
    if (editingMaterialId === null) {
      return
    }

    const stillExists = materials.some((material) => Number(material.id) === Number(editingMaterialId))
    if (!stillExists) {
      setEditingMaterialId(null)
      setDraftMaterial(null)
      setEditError('')
    }
  }, [editingMaterialId, materials])

  const startEdit = (material) => {
    if (!canEditMaterials) {
      return
    }

    setEditingMaterialId(Number(material.id))
    setDraftMaterial({
      nombre: material.nombre_producto || material.nombre || '',
      descripcion: material.descripcion || '',
      id_unidad: String(material.id_unidad || ''),
      id_proveedor: String(material.id_proveedor || ''),
      id_almacen: String(material.id_almacen || ''),
      id_moneda: String(material.moneda_id || ''),
      id_categoria: String(material.id_categoria || ''),
      stock_seguridad: String(material.stock_seguridad ?? ''),
      costo_unitario: String(material.costo_unitario ?? ''),
      imagen: String(material.imagen || ''),
    })
    setEditError('')
  }

  const cancelEdit = () => {
    setEditingMaterialId(null)
    setDraftMaterial(null)
    setSavingMaterialId(null)
    setUploadingMaterialId(null)
    setEditError('')
  }

  const updateDraft = (field, value) => {
    setDraftMaterial((current) => ({
      ...(current || {}),
      [field]: value,
    }))
    setEditError('')
  }

  const saveMaterial = async (materialId) => {
    if (!draftMaterial) {
      return
    }

    const nombre = String(draftMaterial.nombre || '').trim()
    const idUnidad = Number(draftMaterial.id_unidad || 0)
    const idProveedor = Number(draftMaterial.id_proveedor || 0)
    const idAlmacen = Number(draftMaterial.id_almacen || 0)
    const stockSeguridad = Number(draftMaterial.stock_seguridad)
    const costoUnitario = Number(draftMaterial.costo_unitario)
    const idMoneda = draftMaterial.id_moneda ? Number(draftMaterial.id_moneda) : null
    const idCategoria = draftMaterial.id_categoria ? Number(draftMaterial.id_categoria) : null

    if (!nombre) {
      setEditError('El nombre es obligatorio')
      return
    }

    if (!Number.isInteger(idUnidad) || idUnidad <= 0) {
      setEditError('Selecciona una unidad válida')
      return
    }

    if (!Number.isInteger(idProveedor) || idProveedor <= 0) {
      setEditError('Selecciona un proveedor válido')
      return
    }

    if (!Number.isInteger(idAlmacen) || idAlmacen <= 0) {
      setEditError('Selecciona un almacen válido')
      return
    }

    if (!Number.isFinite(stockSeguridad) || stockSeguridad < 0) {
      setEditError('El stock de seguridad debe ser un número mayor o igual a 0')
      return
    }

    if (!Number.isFinite(costoUnitario) || costoUnitario < 0) {
      setEditError('El costo unitario debe ser un número mayor o igual a 0')
      return
    }

    if (draftMaterial.id_moneda && (!Number.isInteger(idMoneda) || idMoneda <= 0)) {
      setEditError('Selecciona una moneda válida')
      return
    }

    if (draftMaterial.id_categoria && (!Number.isInteger(idCategoria) || idCategoria <= 0)) {
      setEditError('Selecciona una categoría válida')
      return
    }

    try {
      setSavingMaterialId(Number(materialId))
      setEditError('')
      await onSaveMaterial?.(materialId, {
        nombre,
        descripcion: String(draftMaterial.descripcion || '').trim(),
        id_unidad: idUnidad,
        id_proveedor: idProveedor,
        id_almacen: idAlmacen,
        stock_seguridad: stockSeguridad,
        id_moneda: idMoneda,
        id_categoria: idCategoria,
        costo_unitario: costoUnitario,
        imagen: String(draftMaterial.imagen || '').trim() || null,
      })
      cancelEdit()
    } catch (err) {
      setEditError(err.message || 'Error al guardar el material')
    } finally {
      setSavingMaterialId(null)
    }
  }

  const handleUploadImage = async (materialId, file) => {
    if (!file) {
      return
    }

    if (!['image/jpeg', 'image/png'].includes(String(file.type || '').toLowerCase())) {
      setEditError('Solo se permiten imagenes JPG, JPEG o PNG')
      return
    }

    if (file.size > 2 * 1024 * 1024) {
      setEditError('La imagen no debe superar 2MB')
      return
    }

    try {
      setUploadingMaterialId(Number(materialId))
      setEditError('')
      const result = await onUploadMaterialImage?.(file)
      const imageUrl = typeof result === 'string' ? result : result?.url

      if (!imageUrl) {
        throw new Error('No se recibio URL de imagen desde el servidor')
      }

      setDraftMaterial((current) => ({
        ...(current || {}),
        imagen: imageUrl,
      }))
    } catch (err) {
      setEditError(err.message || 'Error al subir imagen')
    } finally {
      setUploadingMaterialId(null)
    }
  }

  const columnCount = canEditMaterials ? 14 : 13

  const openCreateModal = () => {
    if (!canAddManualInventory) return
    setCreateError('')
    setCreateForm({
      nombre: '',
      descripcion: '',
      categoria_text: '',
      id_unidad: '',
      id_proveedor: '',
      stock: '',
      stock_seguridad: '',
      id_almacen: '',
      costo_unitario: '',
      id_moneda: '',
      imagen: '',
    })
    setShowCreateModal(true)
    setProveedorSearch('')
    setProveedorResults([])
    setProveedorSearchOpen(false)
  }

  const closeCreateModal = () => {
    if (createSaving) return
    setShowCreateModal(false)
    setCreateError('')
    setCreateUploadingImage(false)
  }

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!proveedorSearch.trim()) {
      setProveedorResults([])
      return
    }
    debounceRef.current = setTimeout(async () => {
      try {
        setProveedorSearchLoading(true)
        const data = await fetchProveedores(proveedorSearch)
        setProveedorResults(Array.isArray(data) ? data : [])
      } catch {
        setProveedorResults([])
      } finally {
        setProveedorSearchLoading(false)
      }
    }, 300)
  }, [proveedorSearch])

  const handleCreateImageUpload = async (file) => {
    if (!file) return

    if (!['image/jpeg', 'image/png'].includes(String(file.type || '').toLowerCase())) {
      setCreateError('Solo se permiten imagenes JPG, JPEG o PNG')
      return
    }

    if (file.size > 2 * 1024 * 1024) {
      setCreateError('La imagen no debe superar 2MB')
      return
    }

    try {
      setCreateUploadingImage(true)
      setCreateError('')
      const result = await onUploadMaterialImage?.(file)
      const imageUrl = typeof result === 'string' ? result : result?.url

      if (!imageUrl) {
        throw new Error('No se recibio URL de imagen desde el servidor')
      }

      setCreateForm((prev) => ({ ...prev, imagen: imageUrl }))
    } catch (err) {
      setCreateError(err.message || 'Error al subir imagen')
    } finally {
      setCreateUploadingImage(false)
    }
  }

  const submitCreateMaterial = async (event) => {
    event.preventDefault()
    const nombre = String(createForm.nombre || '').trim()
    const categoriaText = String(createForm.categoria_text || '').trim()
    const idUnidad = Number(createForm.id_unidad || 0)
    const idProveedor = Number(createForm.id_proveedor || 0)
    const stock = Number(createForm.stock)
    const stockSeguridad = Number(createForm.stock_seguridad)
    const idAlmacen = Number(createForm.id_almacen || 0)
    const costoUnitario = Number(createForm.costo_unitario)
    const idMoneda = createForm.id_moneda ? Number(createForm.id_moneda) : null
    const categoriaMatch = categorias.find(
      (categoria) => String(categoria?.nombre || '').trim().toLowerCase() === categoriaText.toLowerCase()
    )
    const idCategoria = categoriaMatch ? Number(categoriaMatch.id || 0) : null

    if (!nombre) {
      setCreateError('El nombre es obligatorio')
      return
    }
    if (!Number.isInteger(idUnidad) || idUnidad <= 0) {
      setCreateError('Selecciona una unidad válida')
      return
    }
    if (!Number.isInteger(idProveedor) || idProveedor <= 0) {
      setCreateError('Selecciona un proveedor válido')
      return
    }
    if (!categoriaText) {
      setCreateError('La categoría es obligatoria')
      return
    }
    if (!Number.isFinite(stock) || stock < 0) {
      setCreateError('El stock debe ser numérico y mayor o igual a 0')
      return
    }
    if (!Number.isFinite(stockSeguridad) || stockSeguridad < 0) {
      setCreateError('El stock de seguridad debe ser numérico y mayor o igual a 0')
      return
    }
    if (!Number.isInteger(idAlmacen) || idAlmacen <= 0) {
      setCreateError('Selecciona un almacén válido')
      return
    }
    if (!Number.isFinite(costoUnitario) || costoUnitario < 0) {
      setCreateError('El costo unitario debe ser numérico y mayor o igual a 0')
      return
    }
    if (createForm.id_moneda && (!Number.isInteger(idMoneda) || idMoneda <= 0)) {
      setCreateError('Selecciona una moneda válida')
      return
    }

    try {
      setCreateSaving(true)
      setCreateError('')
      await onCreateMaterial?.({
        nombre,
        descripcion: String(createForm.descripcion || '').trim(),
        categoria: categoriaText,
        id_categoria: idCategoria || null,
        id_unidad: idUnidad,
        id_proveedor: idProveedor,
        id_almacen: idAlmacen,
        stock,
        stock_seguridad: stockSeguridad,
        costo_unitario: costoUnitario,
        id_moneda: idMoneda,
        imagen: String(createForm.imagen || '').trim() || null,
      })
      closeCreateModal()
    } catch (err) {
      setCreateError(err.message || 'Error al crear material')
    } finally {
      setCreateSaving(false)
    }
  }

  return (
    <div className="products-section">
      <div className="section-header">
        <h1>Materiales</h1>
        <p>Total: {materials.length} materiales</p>
        {canEditMaterials && <span className="edit-role-badge">Edición directa habilitada para Compras</span>}
        {canAddManualInventory && (
          <button type="button" className="primary-btn" onClick={openCreateModal}>
            Agregar material manual
          </button>
        )}
      </div>

      {editError && <div className="table-inline-error">{editError}</div>}

      <div className="filters-container">
        <div className="search-box">
          <input
            type="text"
            placeholder="Buscar por nombre"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
        </div>

        <div className="filter-group">
          <select
            value={filterWarehouse}
            onChange={(e) => setFilterWarehouse(e.target.value)}
            className="filter-select"
            aria-label="Filtro por almacen"
          >
            {(warehouses || ['Todos']).map((warehouse) => (
              <option key={warehouse} value={warehouse}>
                {warehouse}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="products-table-container">
        <table className="products-table">
          <thead>
            <tr>
              <th>ID Material</th>
              <th>Nombre del Producto</th>
              <th>Descripción</th>
              <th className="table-center">Categoria</th>
              <th>Unidad de Medida</th>
              <th>Proveedor</th>
              <th>Stock</th>
              <th>Stock Seguridad</th>
              <th>Ubicacion</th>
              <th>Costo Unitario</th>
              <th>Costo + IGV</th>
              <th className="table-center">Moneda</th>
              <th>Imagen</th>
              {canEditMaterials && <th className="table-center">Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {materials.length > 0 ? (
              materials.map((material) => (
                <ProductItem
                  key={material.id}
                  material={material}
                  canEdit={canEditMaterials}
                  isEditing={Number(editingMaterialId) === Number(material.id)}
                  draft={Number(editingMaterialId) === Number(material.id) ? draftMaterial : null}
                  categorias={categorias}
                  monedas={monedas}
                  proveedores={proveedores}
                  unidades={unidades}
                  almacenes={almacenes}
                  saving={Number(savingMaterialId) === Number(material.id)}
                  onEdit={() => startEdit(material)}
                  onCancel={cancelEdit}
                  onSave={() => saveMaterial(material.id)}
                  onDraftChange={updateDraft}
                  uploading={Number(uploadingMaterialId) === Number(material.id)}
                  onImageUpload={(file) => handleUploadImage(material.id, file)}
                />
              ))
            ) : (
              <tr className="no-results">
                <td colSpan={columnCount}>No hay materiales que coincidan con tu búsqueda</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showCreateModal && (
        <div className="material-create-backdrop" onClick={closeCreateModal}>
          <div className="material-create-modal" onClick={(event) => event.stopPropagation()}>
            <div className="material-create-head">
              <h3>Agregar material manual</h3>
              <button type="button" onClick={closeCreateModal} disabled={createSaving}>×</button>
            </div>
            {createError && <div className="table-inline-error">{createError}</div>}
            <form className="material-create-form" onSubmit={submitCreateMaterial}>
              <label>
                Nombre *
                <input
                  type="text"
                  value={createForm.nombre}
                  onChange={(event) => setCreateForm((prev) => ({ ...prev, nombre: event.target.value }))}
                  disabled={createSaving}
                />
              </label>
              <label>
                Descripción
                <input
                  type="text"
                  value={createForm.descripcion}
                  onChange={(event) => setCreateForm((prev) => ({ ...prev, descripcion: event.target.value }))}
                  disabled={createSaving}
                />
              </label>
              <label>
                Categoría *
                <input
                  type="text"
                  list="category-suggestions"
                  value={createForm.categoria_text}
                  onChange={(event) => setCreateForm((prev) => ({ ...prev, categoria_text: event.target.value }))}
                  placeholder="Escribe para sugerencias o crear nueva"
                  disabled={createSaving}
                />
                <datalist id="category-suggestions">
                  {categorias.map((categoria) => (
                    <option key={categoria.id} value={categoria.nombre || ''} />
                  ))}
                </datalist>
              </label>
              <label>
                Unidad *
                <select
                  value={createForm.id_unidad}
                  onChange={(event) => setCreateForm((prev) => ({ ...prev, id_unidad: event.target.value }))}
                  disabled={createSaving}
                >
                  <option value="">Selecciona unidad</option>
                  {unidades.map((unidad) => (
                    <option key={unidad.id} value={unidad.id}>
                      {unidad.nombre || `Unidad ${unidad.id}`}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Proveedor *
                <div className="proveedor-autocomplete">
                  <input
                    type="text"
                    value={proveedorSearch}
                    onChange={(e) => {
                      setProveedorSearch(e.target.value)
                      setProveedorSearchOpen(true)
                    }}
                    onFocus={() => proveedorSearch.trim() && setProveedorSearchOpen(true)}
                    onBlur={() => setTimeout(() => setProveedorSearchOpen(false), 200)}
                    placeholder="Escribe para buscar proveedor..."
                    disabled={createSaving}
                  />
                  {proveedorSearchLoading && <span className="autocomplete-loading">Buscando...</span>}
                  {proveedorSearchOpen && proveedorResults.length > 0 && (
                    <ul className="autocomplete-results">
                      {proveedorResults.map((p) => (
                        <li
                          key={p.id}
                          className={Number(createForm.id_proveedor) === Number(p.id) ? 'selected' : ''}
                          onMouseDown={() => {
                            setCreateForm((prev) => ({ ...prev, id_proveedor: p.id }))
                            setProveedorSearch(p.razon_social || p.nombre || `Proveedor ${p.id}`)
                            setProveedorSearchOpen(false)
                          }}
                        >
                          {p.razon_social || p.nombre || `Proveedor ${p.id}`}
                          {p.ruc ? ` - ${p.ruc}` : ''}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </label>
              <label>
                Stock *
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={createForm.stock}
                  onChange={(event) => setCreateForm((prev) => ({ ...prev, stock: event.target.value }))}
                  disabled={createSaving}
                />
              </label>
              <label>
                Stock de seguridad *
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={createForm.stock_seguridad}
                  onChange={(event) => setCreateForm((prev) => ({ ...prev, stock_seguridad: event.target.value }))}
                  disabled={createSaving}
                />
              </label>
              <label>
                Almacén *
                <select
                  value={createForm.id_almacen}
                  onChange={(event) => setCreateForm((prev) => ({ ...prev, id_almacen: event.target.value }))}
                  disabled={createSaving}
                >
                  <option value="">Selecciona almacén</option>
                  {almacenes.map((almacen) => (
                    <option key={almacen.id} value={almacen.id}>
                      {almacen.nombre || `Almacen ${almacen.id}`}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Costo unitario *
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={createForm.costo_unitario}
                  onChange={(event) => setCreateForm((prev) => ({ ...prev, costo_unitario: event.target.value }))}
                  disabled={createSaving}
                />
              </label>
              <label>
                Moneda
                <select
                  value={createForm.id_moneda}
                  onChange={(event) => setCreateForm((prev) => ({ ...prev, id_moneda: event.target.value }))}
                  disabled={createSaving}
                >
                  <option value="">Sin moneda</option>
                  {monedas.map((moneda) => (
                    <option key={moneda.id} value={moneda.id}>
                      {moneda.nombre || `Moneda ${moneda.id}`}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Imagen (opcional)
                <div className="product-image-editor">
                  {createForm.imagen ? (
                    <img className="material-image-preview" src={createForm.imagen} alt="Vista previa" />
                  ) : (
                    <span className="product-image-empty">Sin imagen</span>
                  )}
                  <input
                    className="edit-file-input"
                    type="file"
                    accept=".jpg,.jpeg,.png,image/jpeg,image/png"
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      handleCreateImageUpload(file)
                      event.target.value = ''
                    }}
                    disabled={createSaving || createUploadingImage}
                  />
                  {createUploadingImage && <span className="product-image-uploading">Subiendo...</span>}
                </div>
              </label>
              <div className="material-create-actions">
                <button type="button" className="btn-cancel" onClick={closeCreateModal} disabled={createSaving}>
                  Cancelar
                </button>
                <button type="submit" className="btn-save" disabled={createSaving}>
                  {createSaving ? 'Guardando...' : 'Crear material'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
