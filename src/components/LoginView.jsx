import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { login } from '../services/api'
import '../styles/LoginView.css'

export default function LoginView({ onLoginSuccess }) {
  const navigate = useNavigate()
  const [correo, setCorreo] = useState('')
  const [contrasena, setContrasena] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')

    if (!String(correo).trim() || !String(contrasena).trim()) {
      setError('Correo y contrasena son obligatorios')
      return
    }

    try {
      setLoading(true)
      await login({ correo, contrasena })
      if (onLoginSuccess) {
        await Promise.resolve(onLoginSuccess())
      }
      navigate('/inventario', { replace: true })
    } catch (err) {
      setError(err.message || 'No se pudo iniciar sesion')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <h1>Alfosac</h1>
        <p>Ingresa con tu cuenta para continuar</p>

        <form onSubmit={handleSubmit} className="login-form">
          <label>
            Correo
            <input
              type="email"
              value={correo}
              onChange={(e) => setCorreo(e.target.value)}
              autoComplete="username"
              disabled={loading}
            />
          </label>

          <label>
            Contrasena
            <input
              type="password"
              value={contrasena}
              onChange={(e) => setContrasena(e.target.value)}
              autoComplete="current-password"
              disabled={loading}
            />
          </label>

          {error && <p className="login-error">{error}</p>}

          <button type="submit" disabled={loading}>
            {loading ? 'Ingresando...' : 'Iniciar sesion'}
          </button>
        </form>
      </section>
    </main>
  )
}
