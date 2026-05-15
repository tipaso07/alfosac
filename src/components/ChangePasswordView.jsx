import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { changePassword, logout } from '../services/api'
import '../styles/ChangePasswordView.css'

export default function ChangePasswordView() {
  const navigate = useNavigate()
  const [passwordActual, setPasswordActual] = useState('')
  const [passwordNueva, setPasswordNueva] = useState('')
  const [passwordConfirmacion, setPasswordConfirmacion] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const isStrongPassword = (value) => {
    const text = String(value || '')
    const hasLength = text.length > 8
    const hasUppercase = /[A-Z]/.test(text)
    const hasSpecial = /[^A-Za-z0-9]/.test(text)
    return hasLength && hasUppercase && hasSpecial
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    setSuccess('')

    if (!String(passwordActual).trim()) {
      setError('Contraseña actual es requerida')
      return
    }

    if (!String(passwordNueva).trim()) {
      setError('Nueva contraseña es requerida')
      return
    }

    if (!String(passwordConfirmacion).trim()) {
      setError('Confirmación de contraseña es requerida')
      return
    }

    if (!isStrongPassword(String(passwordNueva))) {
      setError('La nueva contraseña debe tener mas de 8 caracteres, una mayuscula y un caracter especial')
      return
    }

    if (String(passwordNueva).trim() !== String(passwordConfirmacion).trim()) {
      setError('Las contraseñas no coinciden')
      return
    }

    try {
      setLoading(true)
      await changePassword({
        password_actual: passwordActual.trim(),
        password_nueva: passwordNueva.trim(),
        password_confirmacion: passwordConfirmacion.trim(),
      })
      setSuccess('Contraseña actualizada correctamente')
      localStorage.removeItem('requiresPasswordChange')
      setTimeout(() => {
        navigate('/inventario', { replace: true })
      }, 1500)
    } catch (err) {
      setError(err.message || 'No se pudo cambiar la contraseña')
    } finally {
      setLoading(false)
    }
  }

  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <main className="change-password-page">
      <section className="change-password-card">
        <div className="change-password-header">
          <h1>Cambiar Contraseña</h1>
          <p>Esta es tu primera vez accediendo. Por favor cambia tu contraseña para continuar.</p>
        </div>

        <form onSubmit={handleSubmit} className="change-password-form">
          <label>
            Contraseña Actual
            <input
              type="password"
              value={passwordActual}
              onChange={(e) => setPasswordActual(e.target.value)}
              placeholder="Ingresa tu contraseña actual"
              disabled={loading}
              autoFocus
            />
          </label>

          <label>
            Nueva Contraseña
            <input
              type="password"
              value={passwordNueva}
              onChange={(e) => setPasswordNueva(e.target.value)}
              placeholder="Mas de 8, una mayuscula y un caracter especial"
              disabled={loading}
            />
          </label>

          <label>
            Confirmar Contraseña
            <input
              type="password"
              value={passwordConfirmacion}
              onChange={(e) => setPasswordConfirmacion(e.target.value)}
              placeholder="Confirma tu nueva contraseña"
              disabled={loading}
            />
          </label>

          {error && <p className="change-password-error">{error}</p>}
          {success && <p className="change-password-success">{success}</p>}

          <button type="submit" disabled={loading} className="change-password-submit">
            {loading ? 'Actualizando...' : 'Actualizar Contraseña'}
          </button>
        </form>

        <button onClick={handleLogout} className="change-password-logout">
          Cerrar Sesión
        </button>
      </section>
    </main>
  )
}
