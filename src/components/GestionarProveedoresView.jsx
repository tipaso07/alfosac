import { useEffect, useMemo, useState } from 'react'
import '../styles/GestionarProveedoresView.css'
import {
  createProveedor,
  fetchAreas,
  fetchMonedas,
  fetchProveedores,
  updateProveedor,
} from '../services/api'

const initialForm = {
  nombre: '',
  razon_social: '',
  direccion: '',
  distrito: '',
  ruc: '',
  correo: '',
  persona_responsable: '',
  telefono: '',
  condiciones_pago: '',
  banco: '',
  id_moneda: '',
  numero_cuenta: '',
  cci: '',
  id_area_destino: '',
  descripcion: '',
  retencion: 'NO',
  categoria: '',
  descuento: 0,
  tipo: 'BIEN',
  tipo_retencion: 'RETENCION',
}

const EDITABLE_INLINE_FIELDS = new Set([
  'nombre',
  'razon_social',
  'ruc',
  'correo',
  'telefono',
  'banco',
  'categoria',
  'tipo',
  'id_moneda',
  'id_area_destino',
])

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key)

const normalizeFormFromProvider = (provider = {}) => ({
  nombre: String(provider.nombre || '').trim(),
  razon_social: String(provider.razon_social || provider.nombre || '').trim(),
  direccion: String(provider.direccion || '').trim(),
  distrito: String(provider.distrito || '').trim(),
  ruc: String(provider.ruc || '').trim(),
  correo: String(provider.correo || '').trim(),
  persona_responsable: String(provider.persona_responsable || '').trim(),
  telefono: String(provider.telefono || '').trim(),
  condiciones_pago: String(provider.condiciones_pago || '').trim(),
  banco: String(provider.banco || '').trim(),
  id_moneda: String(provider.id_moneda || '').trim(),
  numero_cuenta: String(provider.numero_cuenta || '').trim(),
  cci: String(provider.cci || '').trim(),
  id_area_destino: String(provider.id_area_destino || '').trim(),
  descripcion: String(provider.descripcion || '').trim(),
  retencion: (() => {
    const value = String(provider.retencion || 'NO').toUpperCase()
    if (['TRUE', 'SI', '1'].includes(value)) return 'SI'
    return 'NO'
  })(),
  categoria: String(provider.categoria || '').trim(),
  descuento: Number(provider.descuento || 0),
  tipo: String(provider.tipo || 'BIEN').toUpperCase() || 'BIEN',
  tipo_retencion: String(provider.tipo_retencion || 'RETENCION').toUpperCase() || 'RETENCION',
})

export default function GestionarProveedoresView({ canEdit = false, onCreated }) {
  const [form, setForm] = useState(initialForm)
  const [providers, setProviders] = useState([])
  const [monedas, setMonedas] = useState([])
  const [areas, setAreas] = useState([])
  const [query, setQuery] = useState('')
  const [filterCategoria, setFilterCategoria] = useState('')
  const [filterTipo, setFilterTipo] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [showFormModal, setShowFormModal] = useState(false)
  const [editingProviderId, setEditingProviderId] = useState(null)
  const [editingCell, setEditingCell] = useState(null)
  const [drafts, setDrafts] = useState({})
  const [savingByProvider, setSavingByProvider] = useState({})

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true)
        const [monedasData, areasData] = await Promise.all([
          fetchMonedas(),
          fetchAreas(''),
        ])
        setMonedas(Array.isArray(monedasData) ? monedasData : [])
        setAreas(Array.isArray(areasData) ? areasData : [])
      } catch (err) {
        setError(err.message || 'Error al cargar datos del formulario')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  useEffect(() => {
    let cancelled = false

    const loadProviders = async () => {
      try {
        setLoading(true)
        setError('')
        const data = await fetchProveedores(String(query || '').trim())
        if (!cancelled) {
          setProviders(Array.isArray(data) ? data : [])
        }
      } catch (err) {
        if (!cancelled) {
          setProviders([])
          setError(err.message || 'Error al cargar proveedores')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    const timeoutId = setTimeout(loadProviders, 250)
    return () => {
      cancelled = true
      clearTimeout(timeoutId)
    }
  }, [query])

  const update = (patch) => {
    setForm((prev) => ({ ...prev, ...patch }))
    setFieldErrors({})
  }

  const refreshProviders = async (overrideQuery) => {
    const effectiveQuery = typeof overrideQuery === 'string'
      ? overrideQuery
      : String(query || '').trim()
    const data = await fetchProveedores(effectiveQuery)
    setProviders(Array.isArray(data) ? data : [])
  }

  const openCreateModal = () => {
    setEditingProviderId(null)
    setForm(initialForm)
    setFieldErrors({})
    setError('')
    setSuccess('')
    setShowFormModal(true)
  }

  const openEditModal = (provider) => {
    if (!canEdit) return
    setEditingProviderId(provider.id)
    setForm(normalizeFormFromProvider(provider))
    setFieldErrors({})
    setError('')
    setSuccess('')
    setShowFormModal(true)
  }

  const closeFormModal = () => {
    if (saving) return
    setShowFormModal(false)
    setEditingProviderId(null)
    setForm(initialForm)
    setFieldErrors({})
  }

  const validateForm = (currentForm) => {
    const errors = {}
    const requiredFields = {
      nombre: 'Nombre es obligatorio',
      ruc: 'RUC es obligatorio',
    }

    Object.entries(requiredFields).forEach(([key, message]) => {
      if (!String(currentForm[key] ?? '').trim()) {
        errors[key] = message
      }
    })

    const idMoneda = Number(currentForm.id_moneda || 0)
    if (!idMoneda) {
      errors.id_moneda = 'Debe seleccionar una moneda'
    } else if (!monedas.some((m) => Number(m.id) === idMoneda)) {
      errors.id_moneda = 'La moneda seleccionada no existe'
    }

    const rawAreaDestino = String(currentForm.id_area_destino ?? '').trim()
    if (rawAreaDestino) {
      const idAreaDestino = Number(rawAreaDestino)
      if (!Number.isInteger(idAreaDestino) || idAreaDestino <= 0) {
        errors.id_area_destino = 'El area destino seleccionada no es valida'
      } else if (!areas.some((a) => Number(a.id) === idAreaDestino)) {
        errors.id_area_destino = 'El area destino seleccionada no existe'
      }
    }

    const rucValue = String(currentForm.ruc || '').trim()
    if (rucValue && !/^\d{11}$/.test(rucValue)) {
      errors.ruc = 'RUC debe tener 11 digitos'
    }

    const descuentoNum = Number(currentForm.descuento)
    if (!Number.isFinite(descuentoNum) || descuentoNum < 0) {
      errors.descuento = 'Retencion (%) debe ser numerica y >= 0'
    }

    const tipoRetencion = String(currentForm.tipo_retencion || '').toUpperCase()
    if (tipoRetencion && !['RETENCION', 'DETRACCION'].includes(tipoRetencion)) {
      errors.tipo_retencion = 'Tipo retencion solo puede ser RETENCION o DETRACCION'
    }

    return errors
  }

  const isSubmitDisabled = saving

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    setSuccess('')
    const validationErrors = validateForm(form)
    setFieldErrors(validationErrors)

    if (Object.keys(validationErrors).length > 0) {
      setError('Corrige los campos marcados en el formulario')
      return
    }

    try {
      setSaving(true)
      const payload = {
        ...form,
        id_moneda: Number(form.id_moneda),
        id_area_destino: form.id_area_destino ? Number(form.id_area_destino) : null,
        descuento: Number(form.descuento || 0),
        tipo: String(form.tipo || '').toUpperCase(),
        retencion: String(form.retencion || '').toUpperCase(),
        tipo_retencion: String(form.tipo_retencion || '').toUpperCase(),
      }

      if (editingProviderId) {
        await updateProveedor(editingProviderId, payload)
        setSuccess('Proveedor actualizado correctamente')
      } else {
        await createProveedor(payload)
        setSuccess('Proveedor registrado correctamente')
      }

      if (!editingProviderId) {
        setQuery('')
        setFilterCategoria('')
        setFilterTipo('')
      }

      await refreshProviders('')
      setForm(initialForm)
      setFieldErrors({})
      setShowFormModal(false)
      setEditingProviderId(null)
      if (onCreated) onCreated()
    } catch (err) {
      setError(err.message || `Error al ${editingProviderId ? 'actualizar' : 'registrar'} proveedor`)
    } finally {
      setSaving(false)
    }
  }

  const areaName = (provider) => {
    if (String(provider.area_destino || '').trim()) return provider.area_destino
    const idArea = Number(provider.id_area_destino || 0)
    if (!idArea) return 'N/D'
    const area = areas.find((a) => Number(a.id) === idArea)
    return area?.nombre || `Area #${idArea}`
  }

  const monedaName = (provider) => provider.moneda_nombre || 'N/D'

  const categorias = useMemo(() => (
    [...new Set(providers.map((p) => String(p.categoria || '').trim()).filter(Boolean))]
  ), [providers])

  const rows = useMemo(() => {
    return providers.filter((provider) => {
      const categoriaOk = !filterCategoria || String(provider.categoria || '').trim() === filterCategoria
      const tipoOk = !filterTipo || String(provider.tipo || '').trim().toUpperCase() === filterTipo
      return categoriaOk && tipoOk
    })
  }, [providers, filterCategoria, filterTipo])

  const setDraftValue = (providerId, field, value) => {
    setDrafts((prev) => ({
      ...prev,
      [providerId]: {
        ...(prev[providerId] || {}),
        [field]: value,
      },
    }))
  }

  const getDraftValue = (provider, field) => {
    const providerDraft = drafts[provider.id] || {}
    if (hasOwn(providerDraft, field)) return providerDraft[field]
    return provider[field] ?? ''
  }

  const startEditCell = (providerId, field) => {
    if (!canEdit || !EDITABLE_INLINE_FIELDS.has(field)) return
    setEditingCell({ providerId, field })
  }

  const saveInlineEdit = async (provider) => {
    const providerDraft = drafts[provider.id] || {}
    const changedFields = Object.keys(providerDraft)
    if (changedFields.length === 0) {
      setEditingCell(null)
      return
    }

    try {
      setSavingByProvider((prev) => ({ ...prev, [provider.id]: true }))
      setError('')
      const payload = {
        ...providerDraft,
      }

      const updated = await updateProveedor(provider.id, payload)
      setProviders((prev) => prev.map((item) => (item.id === provider.id ? updated : item)))
      setDrafts((prev) => {
        const next = { ...prev }
        delete next[provider.id]
        return next
      })
      setEditingCell(null)
    } catch (err) {
      setError(err.message || 'Error al actualizar proveedor')
    } finally {
      setSavingByProvider((prev) => ({ ...prev, [provider.id]: false }))
    }
  }

  const renderInlineCell = (provider, field, fallback = 'N/D') => {
    const isEditing = canEdit
      && editingCell
      && editingCell.providerId === provider.id
      && editingCell.field === field

    if (field === 'id_moneda') {
      if (isEditing) {
        return (
          <select
            autoFocus
            value={getDraftValue(provider, field)}
            onChange={(e) => setDraftValue(provider.id, field, e.target.value)}
            onBlur={() => saveInlineEdit(provider)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveInlineEdit(provider)
              if (e.key === 'Escape') setEditingCell(null)
            }}
            disabled={Boolean(savingByProvider[provider.id])}
          >
            <option value="">Selecciona moneda</option>
            {monedas.map((m) => (
              <option key={m.id} value={m.id}>{m.nombre}</option>
            ))}
          </select>
        )
      }

      return (
        <button
          type="button"
          className={`inline-cell-btn ${canEdit ? 'editable' : ''}`}
          onClick={() => startEditCell(provider.id, field)}
          disabled={!canEdit || Boolean(savingByProvider[provider.id])}
        >
          {monedaName(provider)}
        </button>
      )
    }

    if (field === 'id_area_destino') {
      if (isEditing) {
        return (
          <select
            autoFocus
            value={getDraftValue(provider, field)}
            onChange={(e) => setDraftValue(provider.id, field, e.target.value)}
            onBlur={() => saveInlineEdit(provider)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveInlineEdit(provider)
              if (e.key === 'Escape') setEditingCell(null)
            }}
            disabled={Boolean(savingByProvider[provider.id])}
          >
            <option value="">Selecciona area</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>{a.nombre}</option>
            ))}
          </select>
        )
      }

      return (
        <button
          type="button"
          className={`inline-cell-btn ${canEdit ? 'editable' : ''}`}
          onClick={() => startEditCell(provider.id, field)}
          disabled={!canEdit || Boolean(savingByProvider[provider.id])}
        >
          {areaName(provider)}
        </button>
      )
    }

    if (field === 'tipo') {
      if (isEditing) {
        return (
          <select
            autoFocus
            value={String(getDraftValue(provider, field) || '').toUpperCase()}
            onChange={(e) => setDraftValue(provider.id, field, e.target.value)}
            onBlur={() => saveInlineEdit(provider)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveInlineEdit(provider)
              if (e.key === 'Escape') setEditingCell(null)
            }}
            disabled={Boolean(savingByProvider[provider.id])}
          >
            <option value="BIEN">BIEN</option>
            <option value="SERVICIO">SERVICIO</option>
          </select>
        )
      }

      return (
        <button
          type="button"
          className={`inline-cell-btn ${canEdit ? 'editable' : ''}`}
          onClick={() => startEditCell(provider.id, field)}
          disabled={!canEdit || Boolean(savingByProvider[provider.id])}
        >
          {String(provider.tipo || '').toUpperCase() || fallback}
        </button>
      )
    }

    if (isEditing) {
      return (
        <input
          autoFocus
          value={getDraftValue(provider, field)}
          onChange={(e) => setDraftValue(provider.id, field, e.target.value)}
          onBlur={() => saveInlineEdit(provider)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') saveInlineEdit(provider)
            if (e.key === 'Escape') setEditingCell(null)
          }}
          disabled={Boolean(savingByProvider[provider.id])}
        />
      )
    }

    return (
      <button
        type="button"
        className={`inline-cell-btn ${canEdit ? 'editable' : ''}`}
        onClick={() => startEditCell(provider.id, field)}
        disabled={!canEdit || Boolean(savingByProvider[provider.id])}
      >
        {String(provider[field] || '').trim() || fallback}
      </button>
    )
  }

  return (
    <section className="manage-providers-section">
      <div className="section-header">
        <h1>Gestionar Proveedores</h1>
        <p>Tabla tipo inventario con creacion y edicion completa</p>
        {canEdit && (
          <button type="button" className="primary-btn" onClick={openCreateModal}>
            + Agregar proveedor
          </button>
        )}
      </div>

      {!canEdit && <p className="provider-hint">Modo lectura: solo el rol Compras puede crear o editar.</p>}

      <div className="providers-toolbar">
        <input
          type="text"
          placeholder="Buscar por nombre, razon social o RUC"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select value={filterCategoria} onChange={(e) => setFilterCategoria(e.target.value)}>
          <option value="">Todas las categorias</option>
          {categorias.map((categoria) => (
            <option key={categoria} value={categoria}>{categoria}</option>
          ))}
        </select>
        <select value={filterTipo} onChange={(e) => setFilterTipo(e.target.value)}>
          <option value="">Todos los tipos</option>
          <option value="BIEN">BIEN</option>
          <option value="SERVICIO">SERVICIO</option>
        </select>
      </div>

      {loading && <p className="provider-hint">Cargando proveedores...</p>}
      {error && <p className="provider-error">{error}</p>}
      {success && <p className="provider-success">{success}</p>}

      <div className="providers-table-wrap">
        <table className="providers-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Nombre</th>
              <th>Razon Social</th>
              <th>RUC</th>
              <th>Correo</th>
              <th>Telefono</th>
              <th>Banco</th>
              <th>Moneda</th>
              <th>Area destino</th>
              <th>Categoria</th>
              <th>Tipo</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={12}>No hay proveedores para mostrar.</td>
              </tr>
            )}
            {rows.map((provider) => (
              <tr key={provider.id}>
                <td>{provider.id}</td>
                <td>{renderInlineCell(provider, 'nombre')}</td>
                <td>{renderInlineCell(provider, 'razon_social')}</td>
                <td>{renderInlineCell(provider, 'ruc')}</td>
                <td>{renderInlineCell(provider, 'correo')}</td>
                <td>{renderInlineCell(provider, 'telefono')}</td>
                <td>{renderInlineCell(provider, 'banco')}</td>
                <td>{renderInlineCell(provider, 'id_moneda')}</td>
                <td>{renderInlineCell(provider, 'id_area_destino')}</td>
                <td>{renderInlineCell(provider, 'categoria')}</td>
                <td>{renderInlineCell(provider, 'tipo')}</td>
                <td>
                  <div className="row-actions">
                    <button
                      type="button"
                      className="secondary-btn"
                      onClick={() => openEditModal(provider)}
                      disabled={!canEdit || Boolean(savingByProvider[provider.id])}
                    >
                      Editar más
                    </button>
                    {savingByProvider[provider.id]
                      ? <span className="provider-saving">Guardando...</span>
                      : <span className="provider-ready">Listo</span>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showFormModal && (
        <div className="provider-modal-backdrop" onClick={closeFormModal}>
          <div className="provider-modal" onClick={(event) => event.stopPropagation()}>
            <div className="provider-modal-header">
              <h2>{editingProviderId ? 'Editar proveedor' : 'Crear proveedor'}</h2>
              <button type="button" onClick={closeFormModal} disabled={saving}>×</button>
            </div>

            <form className="manage-providers-form" onSubmit={submit} noValidate>
              {error && <p className="provider-error">{error}</p>}
              {success && <p className="provider-success">{success}</p>}

              <fieldset>
                <legend>Datos generales</legend>
                <label>Nombre *
                  <input value={form.nombre} onChange={(e) => update({ nombre: e.target.value })} />
                  {fieldErrors.nombre && <small className="field-error">{fieldErrors.nombre}</small>}
                </label>
                <label>Razon social *
                  <input value={form.razon_social} onChange={(e) => update({ razon_social: e.target.value })} />
                  {fieldErrors.razon_social && <small className="field-error">{fieldErrors.razon_social}</small>}
                </label>
                <label>RUC *
                  <input value={form.ruc} onChange={(e) => update({ ruc: e.target.value })} />
                  {fieldErrors.ruc && <small className="field-error">{fieldErrors.ruc}</small>}
                </label>
                <label>Categoria *
                  <input value={form.categoria} onChange={(e) => update({ categoria: e.target.value })} />
                  {fieldErrors.categoria && <small className="field-error">{fieldErrors.categoria}</small>}
                </label>
                <label>Tipo
                  <select value={form.tipo} onChange={(e) => update({ tipo: e.target.value })}>
                    <option value="BIEN">BIEN</option>
                    <option value="SERVICIO">SERVICIO</option>
                  </select>
                </label>
              </fieldset>

              <fieldset>
                <legend>Ubicacion</legend>
                <label>Direccion *
                  <input value={form.direccion} onChange={(e) => update({ direccion: e.target.value })} />
                  {fieldErrors.direccion && <small className="field-error">{fieldErrors.direccion}</small>}
                </label>
                <label>Distrito *
                  <input value={form.distrito} onChange={(e) => update({ distrito: e.target.value })} />
                  {fieldErrors.distrito && <small className="field-error">{fieldErrors.distrito}</small>}
                </label>
              </fieldset>

              <fieldset>
                <legend>Contacto</legend>
                <label>Correo *
                  <input value={form.correo} onChange={(e) => update({ correo: e.target.value })} />
                  {fieldErrors.correo && <small className="field-error">{fieldErrors.correo}</small>}
                </label>
                <label>Telefono *
                  <input value={form.telefono} onChange={(e) => update({ telefono: e.target.value })} />
                  {fieldErrors.telefono && <small className="field-error">{fieldErrors.telefono}</small>}
                </label>
                <label>Persona responsable *
                  <input value={form.persona_responsable} onChange={(e) => update({ persona_responsable: e.target.value })} />
                  {fieldErrors.persona_responsable && <small className="field-error">{fieldErrors.persona_responsable}</small>}
                </label>
              </fieldset>

              <fieldset>
                <legend>Informacion financiera</legend>
                <label>Banco *
                  <input value={form.banco} onChange={(e) => update({ banco: e.target.value })} />
                  {fieldErrors.banco && <small className="field-error">{fieldErrors.banco}</small>}
                </label>
                <label>Numero de cuenta *
                  <input value={form.numero_cuenta} onChange={(e) => update({ numero_cuenta: e.target.value })} />
                  {fieldErrors.numero_cuenta && <small className="field-error">{fieldErrors.numero_cuenta}</small>}
                </label>
                <label>CCI *
                  <input value={form.cci} onChange={(e) => update({ cci: e.target.value })} />
                  {fieldErrors.cci && <small className="field-error">{fieldErrors.cci}</small>}
                </label>
                <label>Moneda *
                  <select value={form.id_moneda} onChange={(e) => update({ id_moneda: e.target.value })}>
                    <option value="">Selecciona moneda</option>
                    {monedas.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
                  </select>
                  {fieldErrors.id_moneda && <small className="field-error">{fieldErrors.id_moneda}</small>}
                </label>
                <label>Condiciones de pago *
                  <input value={form.condiciones_pago} onChange={(e) => update({ condiciones_pago: e.target.value })} />
                  {fieldErrors.condiciones_pago && <small className="field-error">{fieldErrors.condiciones_pago}</small>}
                </label>
                <label>Retencion (%) *
                  <input type="number" min="0" step="0.01" value={form.descuento} onChange={(e) => update({ descuento: e.target.value })} />
                  {fieldErrors.descuento && <small className="field-error">{fieldErrors.descuento}</small>}
                </label>
              </fieldset>

              <fieldset>
                <legend>Configuracion</legend>
                <label>Area destino *
                  <select value={form.id_area_destino} onChange={(e) => update({ id_area_destino: e.target.value })}>
                    <option value="">Selecciona area destino</option>
                    {areas.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                  </select>
                  {fieldErrors.id_area_destino && <small className="field-error">{fieldErrors.id_area_destino}</small>}
                </label>
                <label>Retencion
                  <select value={form.retencion} onChange={(e) => update({ retencion: e.target.value })}>
                    <option value="SI">SI</option>
                    <option value="NO">NO</option>
                  </select>
                </label>
                <label>Tipo retencion *
                  <select value={form.tipo_retencion} onChange={(e) => update({ tipo_retencion: e.target.value })}>
                    <option value="RETENCION">RETENCION</option>
                    <option value="DETRACCION">DETRACCION</option>
                  </select>
                  {fieldErrors.tipo_retencion && <small className="field-error">{fieldErrors.tipo_retencion}</small>}
                </label>
                <label className="span-2">Descripcion
                  <textarea value={form.descripcion} onChange={(e) => update({ descripcion: e.target.value })} rows={3} />
                </label>
              </fieldset>

              <div className="provider-form-actions">
                <button type="button" className="secondary-btn" onClick={closeFormModal} disabled={saving}>Cancelar</button>
                <button type="submit" className="primary-btn" disabled={isSubmitDisabled}>
                  {saving
                    ? 'Guardando...'
                    : editingProviderId
                      ? 'Actualizar proveedor'
                      : 'Guardar proveedor'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  )
}
