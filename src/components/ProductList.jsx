import { useEffect, useState } from 'react'
import '../styles/ProductList.css'
import ProductItem from './ProductItem'

export default function ProductList({
  materials,
  warehouses,
  searchTerm,
  setSearchTerm,
  filterWarehouse,
  setFilterWarehouse,
  canEditMaterials = false,
  categorias = [],
  monedas = [],
  proveedores = [],
  unidades = [],
  onSaveMaterial,
  onUploadMaterialImage,
}) {
  const [editingMaterialId, setEditingMaterialId] = useState(null)
  const [draftMaterial, setDraftMaterial] = useState(null)
  const [savingMaterialId, setSavingMaterialId] = useState(null)
  const [uploadingMaterialId, setUploadingMaterialId] = useState(null)
  const [editError, setEditError] = useState('')

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
      id_moneda: String(material.moneda_id || ''),
      id_categoria: String(material.id_categoria || ''),
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

  return (
    <div className="products-section">
      <div className="section-header">
        <h1>Materiales</h1>
        <p>Total: {materials.length} materiales</p>
        {canEditMaterials && <span className="edit-role-badge">Edición directa habilitada para Compras</span>}
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
    </div>
  )
}
