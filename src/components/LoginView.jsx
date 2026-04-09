import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { login } from '../services/api'
import '../styles/LoginView.css'

// Rate limiting configuration
const MAX_LOGIN_ATTEMPTS = 5
const LOCKOUT_DURATION = 15 * 60 * 1000 // 15 minutes
const LOGIN_ATTEMPT_WINDOW = 5 * 60 * 1000 // 5 minutes window

const getLoginAttempts = () => {
  const stored = localStorage.getItem('loginAttempts')
  if (!stored) return []
  
  const attempts = JSON.parse(stored)
  const now = Date.now()
  return attempts.filter(timestamp => now - timestamp < LOGIN_ATTEMPT_WINDOW)
}

const recordLoginAttempt = () => {
  const attempts = getLoginAttempts()
  attempts.push(Date.now())
  localStorage.setItem('loginAttempts', JSON.stringify(attempts))
}

const isLockedOut = () => {
  const attempts = getLoginAttempts()
  if (attempts.length >= MAX_LOGIN_ATTEMPTS) {
    const oldestAttempt = attempts[0]
    const now = Date.now()
    if (now - oldestAttempt < LOCKOUT_DURATION) {
      return true
    } else {
      localStorage.removeItem('loginAttempts')
      return false
    }
  }
  return false
}

const getMessagesForError = (error) => {
  const msg = String(error?.message || '').toLowerCase()
  
  if (msg.includes('credenciales')) {
    return 'Correo o contraseña incorrectos'
  }
  if (msg.includes('usuario')) {
    return 'Usuario no encontrado'
  }
  if (msg.includes('expirada') || msg.includes('expir')) {
    return 'Tu sesión ha expirado. Por favor inicia sesión nuevamente'
  }
  if (msg.includes('token')) {
    return 'Tu sesión no es válida. Por favor inicia sesión nuevamente'
  }
  if (msg.includes('permisos') || msg.includes('autorizado')) {
    return 'No tienes permisos para acceder'
  }
  
  return 'No se pudo iniciar sesión. Intenta nuevamente'
}

export default function LoginView({ onLoginSuccess }) {
  const navigate = useNavigate()
  const [correo, setCorreo] = useState('')
  const [contrasena, setContrasena] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [warning, setWarning] = useState('')
  const [lockoutTime, setLockoutTime] = useState(null)
  const lockoutIntervalRef = useRef(null)

  useEffect(() => {
    if (isLockedOut()) {
      const attempts = getLoginAttempts()
      const oldestAttempt = attempts[0]
      const timeRemaining = Math.ceil((LOCKOUT_DURATION - (Date.now() - oldestAttempt)) / 1000)
      setLockoutTime(timeRemaining)
      handleLockoutTimer(timeRemaining)
    }

    return () => {
      if (lockoutIntervalRef.current) {
        clearInterval(lockoutIntervalRef.current)
      }
    }
  }, [])

  const handleLockoutTimer = (initialTime) => {
    let timeLeft = initialTime
    
    if (lockoutIntervalRef.current) {
      clearInterval(lockoutIntervalRef.current)
    }

    lockoutIntervalRef.current = setInterval(() => {
      timeLeft -= 1
      setLockoutTime(timeLeft)

      if (timeLeft <= 0) {
        clearInterval(lockoutIntervalRef.current)
        localStorage.removeItem('loginAttempts')
        setLockoutTime(null)
        setError('')
        setWarning('Cuenta desbloqueada. Puedes intentar nuevamente')
        setTimeout(() => setWarning(''), 5000)
      }
    }, 1000)
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    setWarning('')

    if (isLockedOut()) {
      const attempts = getLoginAttempts()
      const oldestAttempt = attempts[0]
      const timeRemaining = Math.ceil((LOCKOUT_DURATION - (Date.now() - oldestAttempt)) / 1000)
      const minutes = Math.floor(timeRemaining / 60)
      const seconds = timeRemaining % 60
      setError(`Cuenta bloqueada. Intenta en ${minutes}m ${seconds}s`)
      return
    }

    if (!String(correo).trim() || !String(contrasena).trim()) {
      setError('Correo y contraseña son obligatorios')
      return
    }

    try {
      setLoading(true)
      await login({ correo, contrasena })
      localStorage.removeItem('loginAttempts')
      
      if (onLoginSuccess) {
        await Promise.resolve(onLoginSuccess())
      }
      navigate('/inventario', { replace: true })
    } catch (err) {
      recordLoginAttempt()
      const attempts = getLoginAttempts()
      const remaining = MAX_LOGIN_ATTEMPTS - attempts.length
      
      const messageError = getMessagesForError(err)
      setError(messageError)
      
      if (remaining <= 2 && remaining > 0) {
        setWarning(`⚠️ Te quedan ${remaining} intentos`)
      } else if (remaining <= 0) {
        setLockoutTime(Math.ceil(LOCKOUT_DURATION / 1000))
        handleLockoutTimer(Math.ceil(LOCKOUT_DURATION / 1000))
      }
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
              disabled={loading || lockoutTime !== null}
            />
          </label>

          <label>
            Contraseña
            <input
              type="password"
              value={contrasena}
              onChange={(e) => setContrasena(e.target.value)}
              autoComplete="current-password"
              disabled={loading || lockoutTime !== null}
            />
          </label>

          {error && <p className="login-error">{error}</p>}
          {warning && <p className="login-warning">{warning}</p>}

          <button type="submit" disabled={loading || lockoutTime !== null}>
            {loading ? 'Ingresando...' : lockoutTime !== null ? `Bloqueado ${lockoutTime}s` : 'Iniciar sesión'}
          </button>
        </form>

        {lockoutTime !== null && (
          <p className="login-lockout-notice">
            Tu cuenta está bloqueada por demasiados intentos fallidos. Intenta más tarde.
          </p>
        )}
      </section>
    </main>
  )
}
