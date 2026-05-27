import '../styles/Header.css'

const resolveProfilePhotoSrc = (user) => {
  // Prefer `imagen` column value over `foto` when available
  const raw = String(user?.imagen || user?.foto || '').trim()
  if (!raw) return ''

  if (/^https?:\/\//i.test(raw)) return raw
  if (/^data:image\//i.test(raw)) return raw
  if (/^\/uploads\//i.test(raw)) return raw

  if (/^[A-Za-z0-9+/=\s]+$/.test(raw)) {
    return `data:image/png;base64,${raw.replace(/\s+/g, '')}`
  }

  return ''
}

export default function Header({ currentUserName, currentUser, onLogout }) {
  const photoSrc = resolveProfilePhotoSrc(currentUser)
  const userName = currentUserName || currentUser?.nombre || 'Usuario'

  return (
    <header className="header">
      <div className="header-content">
        <img
          className="header-logo"
          src="/alfosac-logo-azul.png"
          alt="Alfosac"
        />
        <div className="header-actions">
          <div className="profile-chip">
            {photoSrc ? (
              <img
                className="profile-avatar"
                src={photoSrc}
                alt={userName}
                onError={(event) => {
                  event.currentTarget.style.display = 'none'
                }}
              />
            ) : (
              <div className="profile-avatar placeholder" aria-hidden="true">
                {String(userName).trim().charAt(0).toUpperCase() || 'U'}
              </div>
            )}
            <span>{userName}</span>
          </div>
          <button type="button" className="logout-btn" onClick={onLogout}>Salir</button>
        </div>
      </div>
    </header>
  )
}
