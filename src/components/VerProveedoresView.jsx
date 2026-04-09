import { useEffect, useMemo, useState } from 'react'
import '../styles/VerProveedoresView.css'
import {
  createProveedor,
  fetchMonedas,
  fetchProveedores,
  fetchProveedorCalificaciones,
  guardarCalificacionProveedor,
  updateProveedor,
} from '../services/api'
import { evaluateProviderRatingState } from '../services/providerRatingRules'

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
  const [ratingModalProvider, setRatingModalProvider] = useState(null)
  const [ratingLoading, setRatingLoading] = useState(false)
  const [ratingSaving, setRatingSaving] = useState(false)
  const [ratingError, setRatingError] = useState('')
  const [ratingSuccess, setRatingSuccess] = useState('')
  const [ratingDetail, setRatingDetail] = useState(null)
  const [ratingForm, setRatingForm] = useState({ puntuacion: 5, comentario: '' })

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
    const timer = setTimeout(run, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
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
  const renderStars = (value) => Array.from({ length: 5 }).map((_, index) => (
    <span key={index} className={index < Number(value || 0) ? 'star-on' : 'star-off'}>★</span>
  ))

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

  const refreshProviders = async () => {
    const refreshed = await fetchProveedores(String(query || '').trim())
    setProviders(Array.isArray(refreshed) ? refreshed : [])
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
      await refreshProviders()
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
      [providerId]: { ...(prev[providerId] || {}), [field]: value },
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
            {monedas.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
          </select>
        )
      }
      return (
        <button type="button" className={`provider-cell-btn ${canEdit ? 'editable' : ''}`} onClick={() => startEdit(provider.id, field)} disabled={!canEdit || Boolean(savingByProvider[provider.id])}>
          {provider.moneda_nombre || fallback}
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
      <button type="button" className={`provider-cell-btn ${canEdit ? 'editable' : ''}`} onClick={() => startEdit(provider.id, field)} disabled={!canEdit || Boolean(savingByProvider[provider.id])}>
        {sourceValue || fallback}
      </button>
    )
  }

  const openRatingModal = async (provider) => {
    setRatingModalProvider(provider)
    setRatingError('')
    setRatingSuccess('')
    setRatingDetail(null)
    setRatingLoading(true)
    try {
      const detail = await fetchProveedorCalificaciones(provider.id)
      setRatingDetail(detail)
      setRatingForm({
        puntuacion: Number(detail?.mi_calificacion || provider.mi_calificacion || 5) || 5,
        comentario: String(detail?.mi_comentario || provider.mi_comentario || '').trim(),
      })
    } catch (err) {
      setRatingError(err.message || 'Error al cargar calificaciones del proveedor')
      setRatingForm({ puntuacion: Number(provider.mi_calificacion || 5) || 5, comentario: String(provider.mi_comentario || '').trim() })
    } finally {
      setRatingLoading(false)
    }
  }

  const closeRatingModal = () => {
    if (ratingSaving) return
    setRatingModalProvider(null)
    setRatingLoading(false)
    setRatingSaving(false)
    setRatingError('')
    setRatingSuccess('')
    setRatingDetail(null)
    setRatingForm({ puntuacion: 5, comentario: '' })
  }

  const submitRating = async (event) => {
    event.preventDefault()
    if (!ratingModalProvider) return

    const score = Number(ratingForm.puntuacion || 0)
    if (!Number.isInteger(score) || score < 1 || score > 5) {
      setRatingError('Selecciona una puntuacion entre 1 y 5')
      return
    }

    try {
      setRatingSaving(true)
      setRatingError('')
      setRatingSuccess('')
      await guardarCalificacionProveedor(ratingModalProvider.id, {
        puntuacion: score,
        comentario: String(ratingForm.comentario || '').trim(),
      })
      await refreshProviders()
      const detail = await fetchProveedorCalificaciones(ratingModalProvider.id)
      setRatingDetail(detail)
      setRatingSuccess('Calificacion guardada correctamente')
    } catch (err) {
      setRatingError(err.message || 'Error al guardar calificacion')
    } finally {
      setRatingSaving(false)
    }
  }

  return (
    <section className="providers-view-section">
      <div className="section-header">
        <h1>Proveedores</h1>
        <p>Total: {rows.length}</p>
        {canEdit && (
          <button type="button" className="add-provider-btn" onClick={openCreateModal}>+ Agregar proveedor</button>
        )}
      </div>

      {!canEdit && <p className="providers-hint">Modo lectura: solo el rol Compras puede editar.</p>}

      <div className="providers-search-row">
        <input type="text" placeholder="Buscar por nombre, razon social o RUC" value={query} onChange={(e) => setQuery(e.target.value)} />
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
                <th>Calificacion</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((provider) => (
                (() => {
                  const ratingState = evaluateProviderRatingState({
                    promedio: provider.calificacion_promedio,
                    total: provider.calificacion_total,
                    alertaCritica: provider.alerta_critica,
                  })

                  return (
                <tr key={provider.id}>
                  <td>{renderCell(provider, 'nombre')}</td>
                  <td>{renderCell(provider, 'ruc')}</td>
                  <td>{renderCell(provider, 'contacto')}</td>
                  <td>{renderCell(provider, 'telefono')}</td>
                  <td>{renderCell(provider, 'email')}</td>
                  <td>{renderCell(provider, 'moneda_id')}</td>
                  <td>
                    <div className="provider-rating-summary">
                      <div className="provider-rating-stars">{renderStars(Math.round(Number(provider.calificacion_promedio || 0)))}</div>
                      <small>{ratingState.averageLabel} ({Number(provider.calificacion_total || 0)})</small>
                      <small className={`provider-state-chip ${ratingState.colorClass}`}>{ratingState.label}</small>
                    </div>
                  </td>
                  <td>
                    <div className="provider-actions-stack">
                      {savingByProvider[provider.id] ? <span className="providers-saving">Guardando...</span> : <span className="providers-ready">Listo</span>}
                      <button type="button" className="provider-rate-btn" onClick={() => openRatingModal(provider)}>Calificar</button>
                    </div>
                  </td>
                </tr>
                  )
                })()
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
                <input value={createForm.nombre} onChange={(e) => updateCreateForm({ nombre: e.target.value })} />
                {createErrors.nombre && <small className="providers-error-inline">{createErrors.nombre}</small>}
              </label>
              <label>
                RUC *
                <input value={createForm.ruc} onChange={(e) => updateCreateForm({ ruc: e.target.value })} />
                {createErrors.ruc && <small className="providers-error-inline">{createErrors.ruc}</small>}
              </label>
              <label>
                Contacto
                <input value={createForm.contacto} onChange={(e) => updateCreateForm({ contacto: e.target.value })} />
              </label>
              <label>
                Telefono
                <input value={createForm.telefono} onChange={(e) => updateCreateForm({ telefono: e.target.value })} />
              </label>
              <label>
                Email
                <input value={createForm.email} onChange={(e) => updateCreateForm({ email: e.target.value })} />
              </label>
              <label>
                Moneda *
                <select value={createForm.moneda_id} onChange={(e) => updateCreateForm({ moneda_id: e.target.value })}>
                  <option value="">Selecciona moneda</option>
                  {monedas.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
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

      {ratingModalProvider && (
        <div className="provider-modal-backdrop" onClick={closeRatingModal}>
          <div className="provider-modal provider-rating-modal" onClick={(event) => event.stopPropagation()}>
            <div className="provider-modal-head">
              <h2>Calificar proveedor</h2>
              <button type="button" onClick={closeRatingModal} disabled={ratingSaving}>×</button>
            </div>
            <div className="provider-rating-header">
              <h3>{ratingModalProvider.razon_social || ratingModalProvider.nombre || 'Proveedor'}</h3>
              <p>
                Promedio: <strong>{Number(ratingModalProvider.calificacion_promedio || 0).toFixed(1)} / 5</strong> - {Number(ratingModalProvider.calificacion_total || 0)} calificaciones
              </p>
            </div>
            {ratingLoading ? <p className="providers-hint">Cargando calificaciones...</p> : null}
            {ratingError ? <p className="providers-error">{ratingError}</p> : null}
            {ratingSuccess ? <p className="provider-success">{ratingSuccess}</p> : null}
            <form className="provider-rating-form" onSubmit={submitRating}>
              <div className="provider-rating-stars-picker" aria-label="Selecciona puntuacion">
                {[1, 2, 3, 4, 5].map((score) => (
                  <button
                    key={score}
                    type="button"
                    className={`rating-star-btn ${Number(ratingForm.puntuacion || 0) >= score ? 'active' : ''}`}
                    onClick={() => setRatingForm((prev) => ({ ...prev, puntuacion: score }))}
                    disabled={ratingSaving}
                  >
                    ★
                  </button>
                ))}
              </div>
              <label>
                Puntuacion
                <select
                  value={ratingForm.puntuacion}
                  onChange={(event) => setRatingForm((prev) => ({ ...prev, puntuacion: Number(event.target.value) }))}
                  disabled={ratingSaving}
                >
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                  <option value={3}>3</option>
                  <option value={4}>4</option>
                  <option value={5}>5</option>
                </select>
              </label>
              <label>
                Comentario
                <textarea
                  value={ratingForm.comentario}
                  onChange={(event) => setRatingForm((prev) => ({ ...prev, comentario: event.target.value }))}
                  placeholder="Escribe una observacion opcional"
                  rows={4}
                  disabled={ratingSaving}
                />
              </label>
              <div className="provider-modal-actions">
                <button type="button" onClick={closeRatingModal} disabled={ratingSaving}>Cancelar</button>
                <button type="submit" disabled={ratingSaving}>{ratingSaving ? 'Guardando...' : 'Guardar calificacion'}</button>
              </div>
            </form>
            <div className="provider-rating-list">
              <h4>Ultimas calificaciones</h4>
              <p className="providers-hint">Ordenadas por fecha (mas recientes primero).</p>
              {(ratingDetail?.calificaciones || []).length === 0 ? (
                <p className="providers-hint">Aun no hay calificaciones registradas.</p>
              ) : (
                <ul>
                  {(ratingDetail?.calificaciones || []).map((item) => (
                    <li key={item.id} className="provider-rating-item">
                      <div className="provider-rating-item-head">
                        <strong>{item.usuario || 'Usuario'}</strong>
                        <span>{item.fecha ? new Date(item.fecha).toLocaleString() : 'Sin fecha'}</span>
                      </div>
                      <div className="provider-rating-item-score">{renderStars(Number(item.puntuacion || 0))}</div>
                      {item.comentario ? <p>{item.comentario}</p> : <p className="providers-hint">Sin comentario</p>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
