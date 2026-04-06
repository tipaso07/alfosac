import { useEffect, useState } from 'react'
import '../styles/GestionarUsuariosView.css'
import {
  fetchUsuarios,
  fetchRoles,
  fetchAreas,
  createUsuario,
  updateUsuario,
  updateUsuarioPassword,
  deleteUsuario,
} from '../services/api'

const initialForm = {
  nombre: '',
  email: '',
  id_role: '',
  id_area: '',
  password: '',
  estado: 'ACTIVO',
}

const initialPasswordForm = {
  password: '',
  confirmPassword: '',
}

export default function GestionarUsuariosView() {
  const [form, setForm] = useState(initialForm)
  const [passwordForm, setPasswordForm] = useState(initialPasswordForm)
  const [usuarios, setUsuarios] = useState([])
  const [roles, setRoles] = useState([])
  const [areas, setAreas] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [showFormModal, setShowFormModal] = useState(false)
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [editingUserId, setEditingUserId] = useState(null)
  const [changingPasswordUserId, setChangingPasswordUserId] = useState(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true)
        const [rolesData, areasData] = await Promise.all([
          fetchRoles(),
          fetchAreas(''),
        ])
        setRoles(Array.isArray(rolesData) ? rolesData : [])
        setAreas(Array.isArray(areasData) ? areasData : [])
      } catch (err) {
        setError(err.message || 'Error al cargar datos')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  useEffect(() => {
    let cancelled = false

    const loadUsuarios = async () => {
      try {
        setLoading(true)
        setError('')
        const data = await fetchUsuarios()
        if (!cancelled) {
          setUsuarios(Array.isArray(data) ? data : [])
        }
      } catch (err) {
        if (!cancelled) {
          setUsuarios([])
          setError(err.message || 'Error al cargar usuarios')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    const timeoutId = setTimeout(loadUsuarios, 250)
    return () => {
      cancelled = true
      clearTimeout(timeoutId)
    }
  }, [query])

  const update = (patch) => {
    setForm((prev) => ({ ...prev, ...patch }))
    setFieldErrors({})
  }

  const updatePassword = (patch) => {
    setPasswordForm((prev) => ({ ...prev, ...patch }))
  }

  const refreshUsuarios = async () => {
    const data = await fetchUsuarios()
    setUsuarios(Array.isArray(data) ? data : [])
  }

  const openCreateModal = () => {
    setEditingUserId(null)
    setForm(initialForm)
    setFieldErrors({})
    setError('')
    setSuccess('')
    setShowFormModal(true)
  }

  const openEditModal = (usuario) => {
    setEditingUserId(usuario.id)
    setForm({
      nombre: usuario.nombre || '',
      email: usuario.email || '',
      id_role: usuario.id_role || '',
      id_area: usuario.id_area || '',
      password: '',
      estado: usuario.estado || 'ACTIVO',
    })
    setFieldErrors({})
    setError('')
    setSuccess('')
    setShowFormModal(true)
  }

  const openPasswordModal = (usuario) => {
    setChangingPasswordUserId(usuario.id)
    setPasswordForm(initialPasswordForm)
    setError('')
    setSuccess('')
    setShowPasswordModal(true)
  }

  const closeFormModal = () => {
    if (saving) return
    setShowFormModal(false)
    setEditingUserId(null)
    setForm(initialForm)
    setFieldErrors({})
  }

  const closePasswordModal = () => {
    if (saving) return
    setShowPasswordModal(false)
    setChangingPasswordUserId(null)
    setPasswordForm(initialPasswordForm)
  }

  const validateForm = (currentForm) => {
    const errors = {}

    if (!String(currentForm.nombre || '').trim()) {
      errors.nombre = 'Nombre es obligatorio'
    }

    if (!String(currentForm.email || '').trim()) {
      errors.email = 'Email es obligatorio'
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(currentForm.email).trim())) {
      errors.email = 'Email invalido'
    }

    if (!currentForm.id_role) {
      errors.id_role = 'Rol es obligatorio'
    }

    if (!editingUserId && !String(currentForm.password || '').trim()) {
      errors.password = 'Contraseña es obligatoria (para nuevo usuario)'
    }

    return errors
  }

  const currentErrors = validateForm(form)
  const isSubmitDisabled = saving || Object.keys(currentErrors).length > 0

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
        nombre: String(form.nombre).trim(),
        email: String(form.email).trim().toLowerCase(),
        id_role: Number(form.id_role),
        id_area: form.id_area ? Number(form.id_area) : null,
        estado: String(form.estado || 'ACTIVO').toUpperCase(),
      }

      if (!editingUserId && form.password) {
        payload.password = String(form.password)
      }

      if (editingUserId) {
        await updateUsuario(editingUserId, payload)
        setSuccess('Usuario actualizado correctamente')
      } else {
        await createUsuario(payload)
        setSuccess('Usuario creado correctamente')
      }

      await refreshUsuarios()
      setForm(initialForm)
      setFieldErrors({})
      setShowFormModal(false)
      setEditingUserId(null)
    } catch (err) {
      setError(err.message || `Error al ${editingUserId ? 'actualizar' : 'crear'} usuario`)
    } finally {
      setSaving(false)
    }
  }

  const validatePasswordForm = () => {
    const errors = {}

    if (!String(passwordForm.password || '').trim()) {
      errors.password = 'Contraseña es obligatoria'
    } else if (String(passwordForm.password).length < 6) {
      errors.password = 'Contraseña debe tener al menos 6 caracteres'
    }

    if (!String(passwordForm.confirmPassword || '').trim()) {
      errors.confirmPassword = 'Confirmación de contraseña es obligatoria'
    }

    if (
      String(passwordForm.password || '').trim() !== String(passwordForm.confirmPassword || '').trim()
    ) {
      errors.confirmPassword = 'Las contraseñas no coinciden'
    }

    return errors
  }

  const submitePassword = async (event) => {
    event.preventDefault()
    setError('')
    setSuccess('')

    const validationErrors = validatePasswordForm()
    if (Object.keys(validationErrors).length > 0) {
      setFieldErrors(validationErrors)
      setError('Corrige los errores en el formulario')
      return
    }

    try {
      setSaving(true)
      await updateUsuarioPassword(changingPasswordUserId, String(passwordForm.password))
      setSuccess('Contraseña actualizada correctamente')
      setPasswordForm(initialPasswordForm)
      setShowPasswordModal(false)
      setChangingPasswordUserId(null)
      await refreshUsuarios()
    } catch (err) {
      setError(err.message || 'Error al actualizar contraseña')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteUsuario = async (usuario) => {
    if (!window.confirm(`¿Estas seguro de que deseas eliminar al usuario ${usuario.nombre}?`)) {
      return
    }

    try {
      setError('')
      setSaving(true)
      await deleteUsuario(usuario.id)
      setSuccess('Usuario eliminado correctamente')
      await refreshUsuarios()
    } catch (err) {
      setError(err.message || 'Error al eliminar usuario')
    } finally {
      setSaving(false)
    }
  }

  const rows = usuarios.filter((usuario) => {
    const q = String(query || '').toLowerCase().trim()
    if (!q) return true
    return (
      String(usuario.nombre || '').toLowerCase().includes(q)
      || String(usuario.email || '').toLowerCase().includes(q)
    )
  })

  return (
    <section className="manage-users-section">
      <div className="section-header">
        <h1>Gestionar Usuarios</h1>
        <p>Panel de administración de usuarios del sistema</p>
        <button type="button" className="primary-btn" onClick={openCreateModal}>
          + Agregar usuario
        </button>
      </div>

      <div className="users-toolbar">
        <input
          type="text"
          placeholder="Buscar por nombre o email"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {loading && <p className="user-hint">Cargando usuarios...</p>}
      {error && <p className="user-error">{error}</p>}
      {success && <p className="user-success">{success}</p>}

      <div className="users-table-wrap">
        <table className="users-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Nombre</th>
              <th>Email</th>
              <th>Rol</th>
              <th>Area</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7}>No hay usuarios para mostrar.</td>
              </tr>
            )}
            {rows.map((usuario) => (
              <tr key={usuario.id}>
                <td>{usuario.id}</td>
                <td>{usuario.nombre}</td>
                <td>{usuario.email}</td>
                <td>{usuario.rol || 'N/D'}</td>
                <td>{usuario.area || 'N/D'}</td>
                <td>
                  <span className={`status-badge status-${String(usuario.estado || '').toLowerCase()}`}>
                    {usuario.estado}
                  </span>
                </td>
                <td>
                  <div className="row-actions">
                    <button
                      type="button"
                      className="secondary-btn"
                      onClick={() => openEditModal(usuario)}
                      disabled={saving}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      className="warning-btn"
                      onClick={() => openPasswordModal(usuario)}
                      disabled={saving}
                    >
                      Contraseña
                    </button>
                    <button
                      type="button"
                      className="danger-btn"
                      onClick={() => handleDeleteUsuario(usuario)}
                      disabled={saving}
                    >
                      Eliminar
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showFormModal && (
        <div className="user-modal-backdrop" onClick={closeFormModal}>
          <div className="user-modal" onClick={(event) => event.stopPropagation()}>
            <div className="user-modal-header">
              <h2>{editingUserId ? 'Editar usuario' : 'Crear usuario'}</h2>
              <button type="button" onClick={closeFormModal} disabled={saving}>×</button>
            </div>

            <form className="manage-users-form" onSubmit={submit}>
              <label>
                Nombre *
                <input
                  value={form.nombre}
                  onChange={(e) => update({ nombre: e.target.value })}
                  disabled={saving}
                />
                {fieldErrors.nombre && <small className="field-error">{fieldErrors.nombre}</small>}
              </label>

              <label>
                Email *
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => update({ email: e.target.value })}
                  disabled={saving}
                />
                {fieldErrors.email && <small className="field-error">{fieldErrors.email}</small>}
              </label>

              <label>
                Rol *
                <select
                  value={form.id_role}
                  onChange={(e) => update({ id_role: e.target.value })}
                  disabled={saving}
                >
                  <option value="">Selecciona un rol</option>
                  {roles.map((role) => (
                    <option key={role.id} value={role.id}>{role.nombre}</option>
                  ))}
                </select>
                {fieldErrors.id_role && <small className="field-error">{fieldErrors.id_role}</small>}
              </label>

              <label>
                Area (opcional)
                <select
                  value={form.id_area}
                  onChange={(e) => update({ id_area: e.target.value })}
                  disabled={saving}
                >
                  <option value="">Selecciona un area</option>
                  {areas.map((area) => (
                    <option key={area.id} value={area.id}>{area.nombre}</option>
                  ))}
                </select>
              </label>

              {!editingUserId && (
                <label>
                  Contraseña *
                  <input
                    type="password"
                    value={form.password}
                    onChange={(e) => update({ password: e.target.value })}
                    disabled={saving}
                  />
                  {fieldErrors.password && <small className="field-error">{fieldErrors.password}</small>}
                </label>
              )}

              <label>
                Estado
                <select
                  value={form.estado}
                  onChange={(e) => update({ estado: e.target.value })}
                  disabled={saving}
                >
                  <option value="ACTIVO">ACTIVO</option>
                  <option value="INACTIVO">INACTIVO</option>
                  <option value="SUSPENDIDO">SUSPENDIDO</option>
                </select>
              </label>

              <div className="user-form-actions">
                <button type="button" className="secondary-btn" onClick={closeFormModal} disabled={saving}>
                  Cancelar
                </button>
                <button type="submit" className="primary-btn" disabled={isSubmitDisabled}>
                  {saving
                    ? 'Guardando...'
                    : editingUserId
                      ? 'Actualizar usuario'
                      : 'Crear usuario'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showPasswordModal && (
        <div className="user-modal-backdrop" onClick={closePasswordModal}>
          <div className="user-modal" onClick={(event) => event.stopPropagation()}>
            <div className="user-modal-header">
              <h2>Cambiar contraseña</h2>
              <button type="button" onClick={closePasswordModal} disabled={saving}>×</button>
            </div>

            <form className="manage-users-form" onSubmit={submitePassword}>
              <label>
                Nueva contraseña *
                <input
                  type="password"
                  value={passwordForm.password}
                  onChange={(e) => updatePassword({ password: e.target.value })}
                  disabled={saving}
                />
                {fieldErrors.password && <small className="field-error">{fieldErrors.password}</small>}
              </label>

              <label>
                Confirmar contraseña *
                <input
                  type="password"
                  value={passwordForm.confirmPassword}
                  onChange={(e) => updatePassword({ confirmPassword: e.target.value })}
                  disabled={saving}
                />
                {fieldErrors.confirmPassword && <small className="field-error">{fieldErrors.confirmPassword}</small>}
              </label>

              <div className="user-form-actions">
                <button type="button" className="secondary-btn" onClick={closePasswordModal} disabled={saving}>
                  Cancelar
                </button>
                <button type="submit" className="primary-btn" disabled={saving}>
                  {saving ? 'Actualizando...' : 'Actualizar contraseña'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  )
}
