import { useState, useEffect, useRef } from 'react'
import { fetchProveedores } from '../services/api'
import '../styles/ProductItem.css'

export default function ProductItem({
  material,
  canEdit = false,
  isEditing = false,
  draft = null,
  categorias = [],
  monedas = [],
  proveedores = [],
  unidades = [],
  almacenes = [],
  saving = false,
  onEdit,
  onCancel,
  onSave,
  onDraftChange,
  uploading = false,
  onImageUpload,
}) {
  const stockValue = Number(material.stock) || 0
  const stockSeguridadValue = Number(material.stock_seguridad) || 0
  const isBelowSafetyStock = stockValue <= stockSeguridadValue
  const costoUnitarioValue = isEditing ? Number(draft?.costo_unitario) || 0 : Number(material.costo_unitario) || 0
  const costoConIgvValue = isEditing ? Number((costoUnitarioValue * 1.18).toFixed(2)) : Number(material.costo_con_igv) || 0
  const monedaLabel = material.moneda || material.moneda_nombre || material.moneda_codigo || '-'
  const categoriaId = isEditing ? String(draft?.id_categoria || '') : String(material.id_categoria || '')
  const proveedorId = isEditing ? String(draft?.id_proveedor || '') : String(material.id_proveedor || '')
  const unidadId = isEditing ? String(draft?.id_unidad || '') : String(material.id_unidad || '')
  const monedaId = isEditing ? String(draft?.id_moneda || '') : String(material.moneda_id || '')
   const [editProveedorSearch, setEditProveedorSearch] = useState('')
  const [editProveedorResults, setEditProveedorResults] = useState([])
  const [editProveedorSearchOpen, setEditProveedorSearchOpen] = useState(false)
  const [editProveedorSearchLoading, setEditProveedorSearchLoading] = useState(false)
  const editDebounceRef = useRef(null)
  const proveedorInputRef = useRef(null)
  const [dropdownFixedStyle, setDropdownFixedStyle] = useState({})
  const almacenId = isEditing ? String(draft?.id_almacen || '') : String(material.id_almacen || '')
  const imagePreview = isEditing ? String(draft?.imagen || '').trim() : String(material.imagen || '').trim()
  const monedaIdValue = String(material.moneda_id || material.id_moneda || monedaId || '').trim()

  const normalizeCurrencySymbol = (value) => {
    const symbol = String(value || '').trim()
    if (!symbol) return ''
    // Normalize common representations of Soles to `S/.` per UI requirement
    if (symbol === 'S' || symbol === 'S/' || symbol === 'S/.' || symbol === 'S/.') return 'S/.'
    return symbol
  }

  const resolveMonedaSymbol = () => {
    const directSymbol = normalizeCurrencySymbol(material.moneda_simbolo || material.simbolo || material.moneda_symbol)
    if (directSymbol) return directSymbol

    const byId = monedas.find((moneda) => String(moneda?.id || '') === monedaIdValue)
    const lookupSymbol = normalizeCurrencySymbol(byId?.simbolo)
    if (lookupSymbol) return lookupSymbol

    const monedaName = String(material.moneda || material.moneda_nombre || material.moneda_codigo || '').trim().toUpperCase()

    if (monedaName.includes('SOLES') || monedaName === 'PEN' || monedaName === 'S/' || monedaName === 'SOL') return 'S/.'
    if (monedaName.includes('DOLAR') || monedaName.includes('DÓL') || monedaName === 'USD' || monedaName === 'US$') return '$'
    if (monedaName.includes('EURO') || monedaName === 'EUR') return '€'

    return '$'
  }

  const currencySymbol = resolveMonedaSymbol()
  const currencyPrefix = currencySymbol ? `${currencySymbol} ` : ''
  const formatCurrency = (value) => `${currencyPrefix}${Number(value || 0).toFixed(2)}`

  const categoryLabel = material.categoria || 'Sin categoria'
  const providerLabel = material.proveedor || material.nombre_proveedor || '-'
  const unitLabel = material.unidad_medida || material.unidad || '-'

  const resolveProveedorLabel = (item) => String(item?.razon_social || item?.nombre || item?.proveedor || '').trim() || `Proveedor ${item?.id || ''}`
  const resolveUnitLabel = (item) => String(item?.nombre || item?.unidad || '').trim() || `Unidad ${item?.id || ''}`
  const resolveCategoryLabel = (item) => String(item?.nombre || item?.categoria || '').trim() || `Categoria ${item?.id || ''}`
  const resolveMonedaLabel = (item) => String(item?.nombre || item?.moneda || '').trim() || `Moneda ${item?.id || ''}`
  const resolveAlmacenLabel = (item) => String(item?.nombre || item?.almacen || '').trim() || `Almacen ${item?.id || ''}`

   const prevIsEditing = useRef(isEditing)

  useEffect(() => {
    if (isEditing && !prevIsEditing.current) {
      if (draft?.id_proveedor) {
        const provider = proveedores.find(p => String(p.id) === String(draft.id_proveedor))
        if (provider) {
          setEditProveedorSearch(provider.razon_social || provider.nombre || '')
        }
      }
    }
    if (!isEditing) {
      setEditProveedorSearch('')
      setEditProveedorResults([])
      setEditProveedorSearchOpen(false)
      setDropdownFixedStyle({})
    }
    prevIsEditing.current = isEditing
  }, [isEditing])

  useEffect(() => {
    if (editDebounceRef.current) clearTimeout(editDebounceRef.current)
    if (!editProveedorSearch.trim()) {
      setEditProveedorResults([])
      return
    }
    editDebounceRef.current = setTimeout(async () => {
      try {
        setEditProveedorSearchLoading(true)
        const data = await fetchProveedores(editProveedorSearch)
        setEditProveedorResults(Array.isArray(data) ? data : [])
      } catch {
        setEditProveedorResults([])
      } finally {
        setEditProveedorSearchLoading(false)
      }
    }, 300)
  }, [editProveedorSearch])

  useEffect(() => {
    if (editProveedorSearchOpen && editProveedorResults.length > 0 && proveedorInputRef.current) {
      const rect = proveedorInputRef.current.getBoundingClientRect()
      setDropdownFixedStyle({
        position: 'fixed',
        top: `${rect.bottom}px`,
        left: `${rect.left}px`,
        width: `${rect.width}px`,
        zIndex: 9999,
      })
    }
  }, [editProveedorSearchOpen, editProveedorResults])

  return (
    <tr className={`product-item ${isEditing ? 'editing' : ''} ${saving ? 'saving' : ''}`}>
      <td className="product-name">{material.id_material}</td>
      <td className={`${isEditing ? 'editing-name-cell' : ''} product-name ${isBelowSafetyStock ? 'product-name-critical' : ''}`}>
          {isEditing ? (
          <input
            className="edit-input"
            type="text"
            value={draft?.nombre || ''}
            onChange={(event) => onDraftChange?.('nombre', event.target.value)}
          />
        ) : (
          material.nombre_producto || material.nombre || '-'
        )}
      </td>
       <td className={`product-description-cell ${isEditing ? 'editing-description-cell' : ''}`}>
        {isEditing ? (
          <input
            className="edit-input"
            type="text"
            value={draft?.descripcion || ''}
            onChange={(event) => onDraftChange?.('descripcion', event.target.value)}
          />
        ) : (
          <span className="product-description-text" title={material.descripcion || ''}>
            {material.descripcion || '-'}
          </span>
        )}
      </td>
      <td className="product-category-cell">
        {isEditing ? (
          <select
            className="edit-select"
            value={categoriaId}
            onChange={(event) => onDraftChange?.('id_categoria', event.target.value)}
          >
            <option value="">Sin categoria</option>
            {categorias.map((categoria) => (
              <option key={categoria.id} value={categoria.id}>
                {resolveCategoryLabel(categoria)}
              </option>
            ))}
          </select>
        ) : (
          <span className="product-category">{categoryLabel}</span>
        )}
      </td>
      <td>
        {isEditing ? (
          <select
            className="edit-select"
            value={unidadId}
            onChange={(event) => onDraftChange?.('id_unidad', event.target.value)}
          >
            <option value="">Selecciona unidad</option>
            {unidades.map((unidad) => (
              <option key={unidad.id} value={unidad.id}>
                {resolveUnitLabel(unidad)}
              </option>
            ))}
          </select>
        ) : (
          unitLabel
        )}
      </td>
         <td className={isEditing ? 'editing-provider-cell' : ''}>
        {isEditing ? (
          <div className="proveedor-autocomplete">
            <input
              ref={proveedorInputRef}
              type="text"
              value={editProveedorSearch}
              onChange={(e) => {
                setEditProveedorSearch(e.target.value)
                setEditProveedorSearchOpen(true)
              }}
              onFocus={() => {
                if (editProveedorSearch.trim() && editProveedorResults.length > 0) {
                  if (proveedorInputRef.current) {
                    const rect = proveedorInputRef.current.getBoundingClientRect()
                    setDropdownFixedStyle({
                      position: 'fixed',
                      top: `${rect.bottom}px`,
                      left: `${rect.left}px`,
                      width: `${rect.width}px`,
                      zIndex: 9999,
                    })
                  }
                  setEditProveedorSearchOpen(true)
                }
              }}
              onBlur={() => setTimeout(() => setEditProveedorSearchOpen(false), 200)}
              placeholder="Escribe para buscar proveedor..."
            />
            {editProveedorSearchLoading && <span className="autocomplete-loading">Buscando...</span>}
            {editProveedorSearchOpen && editProveedorResults.length > 0 && (
              <ul className="autocomplete-results" style={dropdownFixedStyle}>
                {editProveedorResults.map((p) => (
                  <li
                    key={p.id}
                    className={Number(draft?.id_proveedor) === Number(p.id) ? 'selected' : ''}
                    onMouseDown={() => {
                      onDraftChange?.('id_proveedor', p.id)
                      setEditProveedorSearch(p.razon_social || p.nombre || `Proveedor ${p.id}`)
                      setEditProveedorSearchOpen(false)
                    }}
                  >
                    {p.razon_social || p.nombre || `Proveedor ${p.id}`}
                    {p.ruc ? ` - ${p.ruc}` : ''}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <span className="product-provider-text" title={providerLabel}>{providerLabel}</span>
        )}
      </td>
      <td className="product-quantity"><span className="quantity-badge">{stockValue}</span></td>
      <td>
        {isEditing ? (
          <input
            className="edit-input"
            type="number"
            min="0"
            step="0.01"
            value={draft?.stock_seguridad || ''}
            onChange={(event) => onDraftChange?.('stock_seguridad', event.target.value)}
          />
        ) : (
          stockSeguridadValue
        )}
      </td>
      <td>
        {isEditing ? (
          <select
            className="edit-select"
            value={almacenId}
            onChange={(event) => onDraftChange?.('id_almacen', event.target.value)}
          >
            <option value="">Selecciona almacen</option>
            {almacenes.map((almacen) => (
              <option key={almacen.id} value={almacen.id}>
                {resolveAlmacenLabel(almacen)}
              </option>
            ))}
          </select>
        ) : (
          material.ubicacion
        )}
      </td>
      <td>
        {isEditing ? (
          <input
            className="edit-input"
            type="number"
            min="0"
            step="0.01"
            value={draft?.costo_unitario || ''}
            onChange={(event) => onDraftChange?.('costo_unitario', event.target.value)}
          />
        ) : (
          formatCurrency(costoUnitarioValue)
        )}
      </td>
      <td>{formatCurrency(costoConIgvValue)}</td>
      <td className="product-currency-cell">
        {isEditing ? (
          <select
            className="edit-select"
            value={monedaId}
            onChange={(event) => onDraftChange?.('id_moneda', event.target.value)}
          >
            <option value="">Sin moneda</option>
            {monedas.map((moneda) => (
              <option key={moneda.id} value={moneda.id}>
                {resolveMonedaLabel(moneda)}
              </option>
            ))}
          </select>
        ) : (
          <span className="product-currency">{currencySymbol}</span>
        )}
      </td>
      <td className="product-image-cell">
        {isEditing ? (
          <div className="product-image-editor">
            {imagePreview ? (
              <img className="material-image-preview" src={imagePreview} alt={material.nombre || 'Material'} />
            ) : (
              <span className="product-image-empty">Sin imagen</span>
            )}
            <input
              className="edit-file-input"
              type="file"
              accept=".jpg,.jpeg,.png,image/jpeg,image/png"
              onChange={(event) => {
                const file = event.target.files?.[0]
                onImageUpload?.(file)
                event.target.value = ''
              }}
              disabled={uploading || saving}
            />
            {uploading && <span className="product-image-uploading">Subiendo...</span>}
          </div>
        ) : imagePreview ? (
          <img className="material-image-thumb" src={imagePreview} alt={material.nombre || 'Material'} />
        ) : (
          <span className="product-image-empty">Sin imagen</span>
        )}
      </td>
      {canEdit && (
        <td className="product-actions-cell">
          {isEditing ? (
            <div className="action-buttons">
              <button
                type="button"
                className="btn-save"
                onClick={onSave}
                disabled={saving}
              >
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
              <button
                type="button"
                className="btn-cancel"
                onClick={onCancel}
                disabled={saving}
              >
                Cancelar
              </button>
            </div>
          ) : (
            <div className="action-buttons">
              <button
                type="button"
                className="btn-edit"
                onClick={onEdit}
              >
                Editar
              </button>
            </div>
          )}
        </td>
      )}
    </tr>
  )
}
