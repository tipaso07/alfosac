import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { changePassword, clearAuthSession } from '../services/api'
import '../styles/ChangePasswordView.css'

export default function ChangePasswordView() {
  const navigate = useNavigate()
  const [passwordNueva, setPasswordNueva] = useState('')
  const [passwordConfirmacion, setPasswordConfirmacion] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    setSuccess('')

    if (!String(passwordNueva).trim()) {
      setError('Nueva contraseña es requerida')
      return
    }

    if (!String(passwordConfirmacion).trim()) {
      setError('Confirmación de contraseña es requerida')
      return
    }

    if (String(passwordNueva).trim().length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres')
      return
    }

    if (String(passwordNueva).trim() !== String(passwordConfirmacion).trim()) {
      setError('Las contraseñas no coinciden')
      return
    }

    try {
      setLoading(true)
      await changePassword({
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

  const handleLogout = () => {
    clearAuthSession()
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
            Nueva Contraseña
            <input
              type="password"
              value={passwordNueva}
              onChange={(e) => setPasswordNueva(e.target.value)}
              placeholder="Mínimo 8 caracteres"
              disabled={loading}
              autoFocus
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
