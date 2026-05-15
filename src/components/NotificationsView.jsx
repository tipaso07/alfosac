import { useEffect, useMemo, useState } from 'react'
import { fetchProveedorNotifications, clearProveedorNotifications } from '../services/api'
import '../styles/NotificationsView.css'

const buildReadKey = (userId) => `provider-notifications-read-${userId || 'guest'}`
const buildCleanupKey = (userId) => `provider-notifications-cleanup-${userId || 'guest'}`

const loadReadIds = (userId) => {
  try {
    const stored = localStorage.getItem(buildReadKey(userId))
    const parsed = stored ? JSON.parse(stored) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const loadCleanupTimestamp = (userId) => {
  try {
    const stored = localStorage.getItem(buildCleanupKey(userId))
    return stored ? Number(stored) : 0
  } catch {
    return 0
  }
}

const saveCleanupTimestamp = (userId, timestamp) => {
  try {
    localStorage.setItem(buildCleanupKey(userId), String(timestamp))
  } catch {
    // ignore
  }
}

export default function NotificationsView({ currentUser, onAuthExpired }) {
  const userId = Number(currentUser?.id || 0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notifications, setNotifications] = useState([])
  const [readIds, setReadIds] = useState(() => loadReadIds(userId))
  const [cleanupTimestamp, setCleanupTimestamp] = useState(() => loadCleanupTimestamp(userId))
  const [activeView, setActiveView] = useState('unread')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [providerFilter, setProviderFilter] = useState('all')

  useEffect(() => {
    setReadIds(loadReadIds(userId))
  }, [userId])

  useEffect(() => {
    const loadNotifications = async () => {
      try {
        setLoading(true)
        setError('')
        const data = await fetchProveedorNotifications()
        setNotifications(Array.isArray(data?.notificaciones) ? data.notificaciones : [])
      } catch (err) {
        if (Number(err?.status || 0) === 401 || Number(err?.status || 0) === 403) {
          if (onAuthExpired) onAuthExpired()
          return
        }
        setError(err?.message || 'No se pudieron cargar las notificaciones')
      } finally {
        setLoading(false)
      }
    }

    loadNotifications()
  }, [onAuthExpired])

  const notificationsWithState = useMemo(() => {
    return notifications
      .filter((item) => {
        if (cleanupTimestamp <= 0) return true
        const itemTimestamp = item.fecha_creacion_timestamp || 0
        return itemTimestamp > cleanupTimestamp
      })
      .map((item) => ({
        ...item,
        isRead: readIds.includes(item.id),
      }))
  }, [notifications, readIds, cleanupTimestamp])

  const unreadCount = useMemo(
    () => notificationsWithState.filter((item) => !item.isRead).length,
    [notificationsWithState]
  )

  const readCount = useMemo(
    () => notificationsWithState.filter((item) => item.isRead).length,
    [notificationsWithState]
  )

  const filteredByDate = useMemo(() => {
    const fromDate = dateFrom ? new Date(`${dateFrom}T00:00:00`) : null
    const toDate = dateTo ? new Date(`${dateTo}T23:59:59.999`) : null

    return notificationsWithState.filter((item) => {
      if (!item?.fecha) return true
      const itemDate = new Date(item.fecha)
      if (Number.isNaN(itemDate.getTime())) return true
      if (fromDate && itemDate < fromDate) return false
      if (toDate && itemDate > toDate) return false
      return true
    })
  }, [notificationsWithState, dateFrom, dateTo])

  const visibleNotifications = useMemo(() => {
    return filteredByDate.filter((item) => {
      const matchesView = activeView === 'read' ? item.isRead : !item.isRead
      const matchesProvider = providerFilter === 'all' || String(item.proveedor_id || 0) === providerFilter
      return matchesView && matchesProvider
    })
  }, [filteredByDate, activeView, providerFilter])

  const providerOptions = useMemo(() => {
    const uniqueProviders = new Map()

    notificationsWithState.forEach((item) => {
      const id = String(item.proveedor_id || 0)
      const name = String(item.proveedor_nombre || '').trim()
      if (!id || id === '0' || name.toLowerCase() === 'sin proveedor' || uniqueProviders.has(id)) return
      uniqueProviders.set(id, name)
    })

    return [...uniqueProviders.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [notificationsWithState])

  const persistReadIds = (nextReadIds) => {
    setReadIds(nextReadIds)
    localStorage.setItem(buildReadKey(userId), JSON.stringify(nextReadIds))
  }

  const markAsRead = (notificationId) => {
    if (readIds.includes(notificationId)) return
    persistReadIds([...readIds, notificationId])
  }

  const markAllAsRead = () => {
    persistReadIds(notifications.map((item) => item.id))
  }

  const clearNotifications = async () => {
    try {
      const result = await clearProveedorNotifications()
      const timestamp = Number(result?.cleanupTimestamp || Date.now())
      saveCleanupTimestamp(userId, timestamp)
      setCleanupTimestamp(timestamp)
      persistReadIds([])
    } catch (err) {
      setError(err?.message || 'Error al limpiar notificaciones')
    }
  }

  const clearDateFilters = () => {
    setDateFrom('')
    setDateTo('')
  }

  const clearProviderFilter = () => {
    setProviderFilter('all')
  }

  return (
    <section className="notifications-page">
      <div className="notifications-header">
        <div>
          <h2>Notificaciones</h2>
        </div>
        <div className="notifications-actions">
            <span className="notifications-badge">{unreadCount} sin leer</span>
          
          <div className='notifications-buttons'>
          <button type="button" onClick={markAllAsRead} disabled={notifications.length === 0}>
            Marcar todas como leídas
          </button>
          <button type="button" className="clear-notifications" onClick={clearNotifications} disabled={notifications.length === 0}>
            Limpiar notificaciones
          </button>
          </div>

        </div>
      </div>

      <div className="notifications-toolbar">
        <div className="notifications-view-switch" role="tablist" aria-label="Estado de lectura">
          <button
            type="button"
            className={activeView === 'unread' ? 'active' : ''}
            onClick={() => setActiveView('unread')}
          >
            Sin leer ({unreadCount})
          </button>
          <button
            type="button"
            className={activeView === 'read' ? 'active' : ''}
            onClick={() => setActiveView('read')}
          >
            Leídas ({readCount})
          </button>
        </div>

        <div className="notifications-date-filters">
          <label>
            Desde
            <input
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              max={dateTo || undefined}
            />
          </label>
          <label>
            Hasta
            <input
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
              min={dateFrom || undefined}
            />
          </label>
          <button type="button" className="clear-filters" onClick={clearDateFilters}>
            Limpiar fechas
          </button>
        </div>

        <div className="notifications-provider-filter">
          <label>
            Proveedor
            <select value={providerFilter} onChange={(event) => setProviderFilter(event.target.value)}>
              <option value="all">Todos los proveedores</option>
              {providerOptions.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="clear-filters" onClick={clearProviderFilter}>
            Limpiar proveedor
          </button>
        </div>
      </div>

      {error && <div className="notifications-error">{error}</div>}
      {loading && <div className="notifications-loading">Cargando notificaciones...</div>}

      {!loading && notifications.length === 0 && (
        <div className="notifications-empty">
          No hay notificaciones de proveedores con calificación baja.
        </div>
      )}

      {!loading && notifications.length > 0 && visibleNotifications.length === 0 && (
        <div className="notifications-empty">
          No hay notificaciones para los filtros y estado seleccionados.
        </div>
      )}

      <div className="notifications-list">
        {visibleNotifications.map((notification) => {
          const isRead = Boolean(notification.isRead)

          return (
            <article key={notification.id} className={`notification-card ${isRead ? 'read' : 'unread'}`}>
              <div className="notification-card-top">
                <div>
                  <h3>{notification.proveedor_nombre}</h3>
                  <p>{notification.mensaje}</p>
                </div>
                <span className={`notification-priority ${notification.prioridad.toLowerCase()}`}>
                  {notification.prioridad}
                </span>
              </div>

              <div className="notification-detail">
                <div className="notification-origin">
                  <strong>Origen:</strong> {notification.origen_tipo || 'Producto'}{notification.origen_nombre ? ` - ${notification.origen_nombre}` : ''}
                </div>
                {notification.origen_detalle ? (
                  <div className="notification-origin-detail">
                    <strong>Detalle:</strong> {notification.origen_detalle}
                  </div>
                ) : null}
                <div className="notification-rating-line">
                  <strong>Promedio:</strong> {Number(notification.promedio_puntuacion || 0).toFixed(2)}
                </div>
                <div className="notification-rating-line">
                  <strong>Calificación individual:</strong> {Number(notification.puntuacion_individual || 0)}/5
                </div>
                <div className="notification-rating-line">
                  <strong>Total de calificaciones:</strong> {Number(notification.total_calificaciones || 0)}
                </div>
                {notification.comentario ? <div className="notification-comment"><strong>Comentario:</strong> {notification.comentario}</div> : null}
              </div>

              <div className="notification-footer">
                <span>{notification.fecha ? new Date(notification.fecha).toLocaleString() : 'Sin fecha'}</span>
                <button type="button" onClick={() => markAsRead(notification.id)} disabled={isRead}>
                  {isRead ? 'Leída' : 'Marcar como leída'}
                </button>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
