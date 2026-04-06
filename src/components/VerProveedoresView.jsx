import { useEffect, useMemo, useState } from 'react'
import '../styles/VerProveedoresView.css'
import { createProveedor, fetchMonedas, fetchProveedores, updateProveedor } from '../services/api'

const initialCreateForm = {
  nombre: '',
  ruc: '',
  contacto: '',
  telefono: '',
  email: '',
  moneda_id: '',
}

export default function VerProveedoresView({ canEdit = false }) {
  const [query, setQuery] = useState('')
  const [providers, setProviders] = useState([])
  const [monedas, setMonedas] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [savingByProvider, setSavingByProvider] = useState({})
  const [editingCell, setEditingCell] = useState(null)
  const [drafts, setDrafts] = useState({})
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createForm, setCreateForm] = useState(initialCreateForm)
  const [creating, setCreating] = useState(false)
  const [createErrors, setCreateErrors] = useState({})

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      try {
        setLoading(true)
        setError('')
        const data = await fetchProveedores(query.trim())
        if (!cancelled) setProviders(Array.isArray(data) ? data : [])
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Error al cargar proveedores')
          setProviders([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    const t = setTimeout(run, 250)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [query])

  useEffect(() => {
    let cancelled = false

    const loadMonedas = async () => {
      try {
        const data = await fetchMonedas()
        if (!cancelled) setMonedas(Array.isArray(data) ? data : [])
      } catch {
        if (!cancelled) setMonedas([])
      }
    }

    loadMonedas()
    return () => {
      cancelled = true
    }
  }, [])

  const rows = useMemo(() => providers, [providers])

  const validateCreateForm = (form) => {
    const next = {}
    if (!String(form.nombre || '').trim()) next.nombre = 'Nombre es obligatorio'
    if (!String(form.ruc || '').trim()) next.ruc = 'RUC es obligatorio'
    if (!Number(form.moneda_id || 0)) next.moneda_id = 'Moneda es obligatoria'
    return next
  }

  const updateCreateForm = (patch) => {
    setCreateForm((prev) => ({ ...prev, ...patch }))
    setCreateErrors({})
    setError('')
  }

  const openCreateModal = () => {
    setCreateForm(initialCreateForm)
    setCreateErrors({})
    setError('')
    setShowCreateModal(true)
  }

  const closeCreateModal = (force = false) => {
    if (creating && !force) return
    setShowCreateModal(false)
    setCreateForm(initialCreateForm)
    setCreateErrors({})
  }

  const submitCreateProvider = async (event) => {
    event.preventDefault()
    const errors = validateCreateForm(createForm)
    setCreateErrors(errors)
    if (Object.keys(errors).length > 0) return

    try {
      setCreating(true)
      setError('')
      await createProveedor({
        nombre: String(createForm.nombre || '').trim(),
        ruc: String(createForm.ruc || '').trim(),
        contacto: String(createForm.contacto || '').trim(),
        telefono: String(createForm.telefono || '').trim(),
        email: String(createForm.email || '').trim(),
        id_moneda: Number(createForm.moneda_id),
      })

      const refreshed = await fetchProveedores(String(query || '').trim())
      setProviders(Array.isArray(refreshed) ? refreshed : [])
      closeCreateModal(true)
    } catch (err) {
      setError(err.message || 'Error al crear proveedor')
    } finally {
      setCreating(false)
    }
  }

  const getDraftValue = (provider, field) => {
    const providerDraft = drafts[provider.id] || {}
    if (field in providerDraft) return providerDraft[field]

    if (field === 'contacto') return provider.persona_responsable || ''
    if (field === 'email') return provider.correo || ''
    if (field === 'moneda_id') return Number(provider.id_moneda || 0) || ''
    return provider[field] || ''
  }

  const setDraftValue = (providerId, field, value) => {
    setDrafts((prev) => ({
      ...prev,
      [providerId]: {
        ...(prev[providerId] || {}),
        [field]: value,
      },
    }))
  }

  const persistProvider = async (provider) => {
    const draft = drafts[provider.id] || {}
    const payload = {
      nombre: String(draft.nombre ?? provider.nombre ?? '').trim(),
      ruc: String(draft.ruc ?? provider.ruc ?? '').trim(),
      contacto: String(draft.contacto ?? provider.persona_responsable ?? '').trim(),
      telefono: String(draft.telefono ?? provider.telefono ?? '').trim(),
      email: String(draft.email ?? provider.correo ?? '').trim(),
      moneda_id: Number(draft.moneda_id ?? provider.id_moneda ?? 0),
    }

    setError('')
    try {
      setSavingByProvider((prev) => ({ ...prev, [provider.id]: true }))
      const updated = await updateProveedor(provider.id, payload)

      setProviders((prev) => prev.map((p) => (p.id === provider.id ? updated : p)))
      setDrafts((prev) => {
        const next = { ...prev }
        delete next[provider.id]
        return next
      })
    } catch (err) {
      setError(err.message || 'Error al actualizar proveedor')
    } finally {
      setSavingByProvider((prev) => ({ ...prev, [provider.id]: false }))
    }
  }

  const startEdit = (providerId, field) => {
    if (!canEdit) return
    setEditingCell({ providerId, field })
  }

  const finishEdit = async (provider) => {
    if (!canEdit) return
    await persistProvider(provider)
    setEditingCell(null)
  }

  const renderCell = (provider, field, fallback = 'N/D') => {
    const isEditing = canEdit
      && editingCell
      && editingCell.providerId === provider.id
      && editingCell.field === field

    if (field === 'moneda_id') {
      const displayMoneda = provider.moneda_nombre || 'N/D'

      if (isEditing) {
        return (
          <select
            autoFocus
            value={getDraftValue(provider, field)}
            onChange={(e) => setDraftValue(provider.id, field, e.target.value)}
            onBlur={() => finishEdit(provider)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') finishEdit(provider)
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
          className={`provider-cell-btn ${canEdit ? 'editable' : ''}`}
          onClick={() => startEdit(provider.id, field)}
          disabled={!canEdit || Boolean(savingByProvider[provider.id])}
        >
          {displayMoneda}
        </button>
      )
    }

    const sourceValue = field === 'contacto'
      ? provider.persona_responsable
      : field === 'email'
        ? provider.correo
        : provider[field]

    if (isEditing) {
      return (
        <input
          autoFocus
          value={getDraftValue(provider, field)}
          onChange={(e) => setDraftValue(provider.id, field, e.target.value)}
          onBlur={() => finishEdit(provider)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') finishEdit(provider)
            if (e.key === 'Escape') setEditingCell(null)
          }}
          disabled={Boolean(savingByProvider[provider.id])}
        />
      )
    }

    return (
      <button
        type="button"
        className={`provider-cell-btn ${canEdit ? 'editable' : ''}`}
        onClick={() => startEdit(provider.id, field)}
        disabled={!canEdit || Boolean(savingByProvider[provider.id])}
      >
        {sourceValue || fallback}
      </button>
    )
  }

  return (
    <section className="providers-view-section">
      <div className="section-header">
        <h1>Proveedores</h1>
        <p>Total: {rows.length}</p>
        {canEdit && (
          <button
            type="button"
            className="add-provider-btn"
            onClick={openCreateModal}
          >
            + Agregar proveedor
          </button>
        )}
      </div>

      {!canEdit && <p className="providers-hint">Modo lectura: solo el rol Compras puede editar.</p>}

      <div className="providers-search-row">
        <input
          type="text"
          placeholder="Buscar por nombre, razon social o RUC"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {loading && <p className="providers-hint">Buscando proveedores...</p>}
      {error && <p className="providers-error">{error}</p>}

      {rows.length === 0 ? (
        <div className="empty-state">No hay proveedores para mostrar.</div>
      ) : (
        <div className="providers-table-wrap">
          <table className="providers-table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>RUC</th>
                <th>Contacto</th>
                <th>Telefono</th>
                <th>Email</th>
                <th>Moneda</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((provider) => (
                <tr key={provider.id}>
                  <td>{renderCell(provider, 'nombre')}</td>
                  <td>{renderCell(provider, 'ruc')}</td>
                  <td>{renderCell(provider, 'contacto')}</td>
                  <td>{renderCell(provider, 'telefono')}</td>
                  <td>{renderCell(provider, 'email')}</td>
                  <td>{renderCell(provider, 'moneda_id')}</td>
                  <td>
                    {savingByProvider[provider.id]
                      ? <span className="providers-saving">Guardando...</span>
                      : <span className="providers-ready">Listo</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreateModal && (
        <div className="provider-modal-backdrop" onClick={closeCreateModal}>
          <div className="provider-modal" onClick={(e) => e.stopPropagation()}>
            <div className="provider-modal-head">
              <h2>Agregar proveedor</h2>
              <button type="button" onClick={closeCreateModal} disabled={creating}>×</button>
            </div>

            <form className="provider-modal-form" onSubmit={submitCreateProvider}>
              <label>
                Nombre *
                <input
                  value={createForm.nombre}
                  onChange={(e) => updateCreateForm({ nombre: e.target.value })}
                />
                {createErrors.nombre && <small className="providers-error-inline">{createErrors.nombre}</small>}
              </label>

              <label>
                RUC *
                <input
                  value={createForm.ruc}
                  onChange={(e) => updateCreateForm({ ruc: e.target.value })}
                />
                {createErrors.ruc && <small className="providers-error-inline">{createErrors.ruc}</small>}
              </label>

              <label>
                Contacto
                <input
                  value={createForm.contacto}
                  onChange={(e) => updateCreateForm({ contacto: e.target.value })}
                />
              </label>

              <label>
                Telefono
                <input
                  value={createForm.telefono}
                  onChange={(e) => updateCreateForm({ telefono: e.target.value })}
                />
              </label>

              <label>
                Email
                <input
                  value={createForm.email}
                  onChange={(e) => updateCreateForm({ email: e.target.value })}
                />
              </label>

              <label>
                Moneda *
                <select
                  value={createForm.moneda_id}
                  onChange={(e) => updateCreateForm({ moneda_id: e.target.value })}
                >
                  <option value="">Selecciona moneda</option>
                  {monedas.map((m) => (
                    <option key={m.id} value={m.id}>{m.nombre}</option>
                  ))}
                </select>
                {createErrors.moneda_id && <small className="providers-error-inline">{createErrors.moneda_id}</small>}
              </label>

              <div className="provider-modal-actions">
                <button type="button" onClick={closeCreateModal} disabled={creating}>Cancelar</button>
                <button type="submit" disabled={creating}>{creating ? 'Guardando...' : 'Guardar proveedor'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  )
}
