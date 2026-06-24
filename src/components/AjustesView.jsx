import { useMemo, useRef, useState } from 'react'
import '../styles/AjustesView.css'
import { changePassword, API_BASE_URL } from '../services/api'

const isValidBase64Image = (value) => {
  const trimmed = String(value || '').trim()
  const plainBase64Regex = /^[A-Za-z0-9+/=\s]+$/
  return plainBase64Regex.test(trimmed) && trimmed.replace(/\s+/g, '').length > 80
}

const resolvePhotoSrc = (value) => {
  const trimmed = String(value || '').trim()
  if (!trimmed) return ''

  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (/^data:image\//i.test(trimmed)) return trimmed

  if (/^[A-Za-z0-9+/=\s]+$/.test(trimmed)) {
    return `data:image/png;base64,${trimmed.replace(/\s+/g, '')}`
  }

  return ''
}

export default function AjustesView({ currentUser, onUpdatePhoto, onRefreshUser }) {
  const [photoBase64, setPhotoBase64] = useState('')
  const [photoPreview, setPhotoPreview] = useState('')
  const [selectedFileName, setSelectedFileName] = useState('')
  const [isEditingPhoto, setIsEditingPhoto] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [isChangingPassword, setIsChangingPassword] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const [passwordSuccess, setPasswordSuccess] = useState('')
  const fileInputRef = useRef(null)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [isEditingPhone, setIsEditingPhone] = useState(false)
  const [phoneValue, setPhoneValue] = useState('')
  const [savingPhone, setSavingPhone] = useState(false)
  const [phoneError, setPhoneError] = useState('')
  const [phoneSuccess, setPhoneSuccess] = useState('')

  const handleSavePhone = async () => {
  setPhoneError('')
  setPhoneSuccess('')

  if (!String(phoneValue || '').trim()) {
    setPhoneError('El teléfono no puede estar vacío')
    return
  }

  try {
    setSavingPhone(true)
    const token = localStorage.getItem('authToken')
    const res = await fetch(`${API_BASE_URL}/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ telefono: String(phoneValue).trim() }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Error al actualizar teléfono')
    setPhoneSuccess('Teléfono actualizado correctamente')
    setIsEditingPhone(false)
    if (onRefreshUser) onRefreshUser()
  } catch (err) {
    setPhoneError(err.message || 'No se pudo actualizar el teléfono')
  } finally {
    setSavingPhone(false)
  }
}
  const isStrongPassword = (value) => {
    const text = String(value || '')
    const hasLength = text.length > 8
    const hasUppercase = /[A-Z]/.test(text)
    const hasSpecial = /[^A-Za-z0-9]/.test(text)
    return hasLength && hasUppercase && hasSpecial
  }

  const pwdText = String(newPassword || '')
  const pwdHasLength = pwdText.length > 8
  const pwdHasUpper = /[A-Z]/.test(pwdText)
  const pwdHasSpecial = /[^A-Za-z0-9]/.test(pwdText)
  const pwdMatches = String(newPassword) === String(confirmNewPassword)
  const canSubmitPassword = Boolean(String(currentPassword || '').trim()) && pwdHasLength && pwdHasUpper && pwdHasSpecial && pwdMatches
  const getFirstMissing = () => {
    if (!pwdHasLength) return 'Más de 8 caracteres'
    if (!pwdHasUpper) return 'Al menos una mayúscula'
    if (!pwdHasSpecial) return 'Al menos un carácter especial'
    if (!pwdMatches) return 'La confirmación no coincide'
    return null
  }
  const firstMissing = getFirstMissing()

  const previewSrc = useMemo(() => {
    if (photoPreview) return photoPreview
    const current = String(currentUser?.imagen || currentUser?.foto || '').trim()
    if (!current) return ''
    return resolvePhotoSrc(current)
  }, [photoPreview, currentUser])

  const userFields = useMemo(() => {
    return [
      { label: 'Nombre completo', value: currentUser?.nombre || 'N/D' },
      { label: 'Correo electronico', value: currentUser?.correo || currentUser?.email || 'N/D' },
      { label: 'Rol', value: currentUser?.rol || 'N/D' },
      { label: 'Area', value: currentUser?.area || 'N/D' },
      { label: 'DNI', value: currentUser?.dni || 'N/D' },
    ]
  }, [currentUser])

  const handleStartEdit = () => {
    setError('')
    setSuccessMessage('')
    setPhotoBase64('')
    setPhotoPreview('')
    setSelectedFileName('')
    setIsEditingPhoto(true)
  }

  const handleCancelEdit = () => {
    setError('')
    setSuccessMessage('')
    setPhotoBase64('')
    setPhotoPreview('')
    setSelectedFileName('')
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
    setIsEditingPhoto(false)
  }

  const handleSelectPhoto = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click()
    }
  }

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0]
    setError('')
    setSuccessMessage('')

    if (!file) {
      return
    }

    const mime = String(file.type || '').toLowerCase()
    const allowed = ['image/png', 'image/jpeg', 'image/jpg']

    if (!allowed.includes(mime)) {
      setError('Solo se permiten imagenes PNG, JPG o JPEG')
      event.target.value = ''
      return
    }

    try {
      // Convertimos el archivo a Data URL (data:image/...;base64,XXXX) para poder previsualizarlo.
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result || ''))
        reader.onerror = () => reject(new Error('No se pudo leer el archivo de imagen'))
        reader.readAsDataURL(file)
      })

      const parts = dataUrl.split(',')
      const onlyBase64 = parts.length > 1 ? parts[1].trim() : ''

      if (!isValidBase64Image(onlyBase64)) {
        throw new Error('No se pudo convertir la imagen a base64 valida')
      }

      setPhotoPreview(dataUrl)
      setPhotoBase64(onlyBase64)
      setSelectedFileName(file.name)
    } catch (err) {
      setError(err.message || 'No se pudo procesar la imagen')
    }
  }

  const handleSavePhoto = async () => {
    setError('')
    setSuccessMessage('')

    if (!photoBase64 || !isValidBase64Image(photoBase64)) {
      setError('Selecciona una imagen valida antes de guardar')
      return
    }

    try {
      setSaving(true)
      // Guardamos en backend solo el contenido base64 para actualizar unicamente la columna foto.
      await onUpdatePhoto(photoBase64)
      setSuccessMessage('Foto actualizada correctamente')
      setIsEditingPhoto(false)
      setSelectedFileName('')
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    } catch (err) {
      setError(err.message || 'No se pudo actualizar la foto')
    } finally {
      setSaving(false)
    }
  }

  const handleStartPasswordChange = () => {
    setPasswordError('')
    setPasswordSuccess('')
    setCurrentPassword('')
    setNewPassword('')
    setConfirmNewPassword('')
    setIsChangingPassword(true)
  }

  const handleCancelPasswordChange = () => {
    setPasswordError('')
    setPasswordSuccess('')
    setCurrentPassword('')
    setNewPassword('')
    setConfirmNewPassword('')
    setShowNewPassword(false)
    setShowConfirmPassword(false)
    setIsChangingPassword(false)
  }

  const handleSavePassword = async () => {
    setPasswordError('')
    setPasswordSuccess('')

    if (!String(currentPassword || '').trim()) {
      setPasswordError('Ingrese contraseña actual')
      return
    }

    if (!String(newPassword || '').trim()) {
      setPasswordError('Ingrese nueva contraseña')
      return
    }

    if (!String(confirmNewPassword || '').trim()) {
      setPasswordError('Confirme la nueva contraseña')
      return
    }

    if (String(newPassword) !== String(confirmNewPassword)) {
      setPasswordError('La nueva contraseña y su confirmación no coinciden')
      return
    }

    if (!isStrongPassword(newPassword)) {
      setPasswordError('La nueva contraseña debe tener mas de 8 caracteres, una mayuscula y un caracter especial')
      return
    }

    try {
      setPasswordSaving(true)
      await changePassword({
        password_actual: String(currentPassword),
        password_nueva: String(newPassword),
        password_confirmacion: String(confirmNewPassword),
      })
      setPasswordSuccess('Contraseña actualizada correctamente')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmNewPassword('')
      setIsChangingPassword(false)
    } catch (err) {
      setPasswordError(err.message || 'No se pudo actualizar la contraseña')
    } finally {
      setPasswordSaving(false)
    }
  }

  

  return (
    <>
      <section className="settings-section">
        <div className="settings-header">
          <h1>Ajustes</h1>
        </div>

        <div className="settings-grid">
          <article className="settings-card">
            <h2>Perfil</h2>
             <div className="settings-field-list">
              {userFields.map((field) => (
                <div className="settings-field" key={field.label}>
                  <span className="settings-field-label">{field.label}</span>
                  <span className="settings-field-value">{field.value}</span>
                </div>
              ))}
              <div className="settings-field">
                <span className="settings-field-label">Teléfono</span>
                {isEditingPhone ? (
                  <input
                    type="text"
                    value={phoneValue}
                    onChange={(e) => setPhoneValue(e.target.value)}
                    className="settings-field-input"
                    placeholder="Ingresa tu teléfono"
                  />
                ) : (
                  <span className="settings-field-value">
                    {currentUser?.telefono || 'N/D'}
                    <button
                      type="button"
                      className="settings-edit-icon"
                      onClick={() => {
                        setPhoneValue(currentUser?.telefono || '');
                        setIsEditingPhone(true);
                        setPhoneError('');
                        setPhoneSuccess('');
                      }}
                      title="Editar teléfono"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>
                  </span>
                )}
              </div>
            </div>

            {isEditingPhone && (
              <div className="settings-editor">
                <div className="settings-actions">
                  <button type="button" className="settings-btn" onClick={handleSavePhone} disabled={savingPhone}>
                    {savingPhone ? 'Guardando...' : 'Guardar'}
                  </button>
                  <button type="button" className="settings-btn secondary" onClick={() => setIsEditingPhone(false)} disabled={savingPhone}>
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {phoneError && <p className="settings-message error">{phoneError}</p>}
            {phoneSuccess && <p className="settings-message success">{phoneSuccess}</p>}
          </article>

          <article className="settings-card">
            <h2>Foto de usuario</h2>
            <div className="settings-photo-box">
              {previewSrc ? (
                <img
                  src={previewSrc}
                  alt={currentUser?.nombre || 'Usuario'}
                  className="settings-photo"
                  onError={(event) => {
                    event.currentTarget.style.display = 'none'
                  }}
                />
              ) : (
                <div className="settings-photo-placeholder">Sin foto configurada</div>
              )}
              <div className="settings-photo-meta">
                <strong>{currentUser?.nombre || 'Usuario'}</strong>
                <span>DNI: {currentUser?.dni || 'N/D'}</span>
              </div>
            </div>

            {!isEditingPhoto ? (
              <button type="button" className="settings-btn" onClick={handleStartEdit}>
                Cambiar foto
              </button>
            ) : (
              <div className="settings-editor">
                <input
                  ref={fileInputRef}
                  id="foto-archivo"
                  type="file"
                  accept=".png,.jpg,.jpeg,image/png,image/jpeg"
                  className="settings-file-input"
                  onChange={handleFileChange}
                />
                <button type="button" className="settings-btn secondary" onClick={handleSelectPhoto}>
                  Seleccionar archivo
                </button>
                <span className="settings-file-name">{selectedFileName || 'Ningun archivo seleccionado'}</span>
                <div className="settings-actions">
                  <button type="button" className="settings-btn" onClick={handleSavePhoto} disabled={saving}>
                    {saving ? 'Guardando...' : 'Guardar cambios'}
                  </button>
                  <button type="button" className="settings-btn secondary" onClick={handleCancelEdit} disabled={saving}>
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {error && <p className="settings-message error">{error}</p>}
            {successMessage && <p className="settings-message success">{successMessage}</p>}
          </article>

          
        
          <article className="settings-card">
            <h2>Seguridad</h2>

            <div className="settings-security-container">

              {!isChangingPassword && (
                <button
                  type="button"
                  className="settings-btn"
                  onClick={handleStartPasswordChange}
                >
                  Cambiar contraseña
                </button>
              )}

              {isChangingPassword && (
                <div className="settings-password-editor">
                  <label>
                    Contraseña actual
                    <input
                      type="password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      placeholder="Contraseña actual"
                      disabled={passwordSaving}
                    />
                  </label>

                  <label>
                    Nueva contraseña
                    <div className="password-field-row">
                      <input
                        type={showNewPassword ? 'text' : 'password'}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="Nueva contraseña"
                        disabled={passwordSaving}
                      />
                      <button
                        type="button"
                        className="password-toggle"
                        aria-pressed={showNewPassword}
                        aria-label={showNewPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                        onClick={() => setShowNewPassword((s) => !s)}
                      >
                        {showNewPassword ? (
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d="M15 9l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        ) : (
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </button>
                    </div>
                  </label>

                  <label>
                    Confirmar nueva contraseña
                    <div className="password-field-row">
                      <input
                        type={showConfirmPassword ? 'text' : 'password'}
                        value={confirmNewPassword}
                        onChange={(e) => setConfirmNewPassword(e.target.value)}
                        placeholder="Confirmar nueva contraseña"
                        disabled={passwordSaving}
                      />
                      <button
                        type="button"
                        className="password-toggle"
                        aria-pressed={showConfirmPassword}
                        aria-label={showConfirmPassword ? 'Ocultar confirmación' : 'Mostrar confirmación'}
                        onClick={() => setShowConfirmPassword((s) => !s)}
                      >
                        {showConfirmPassword ? (
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d="M15 9l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        ) : (
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </button>
                    </div>
                  </label>

                  <p className="settings-next-req">{firstMissing ? `Falta: ${firstMissing}` : 'La contraseña cumple los requisitos.'}</p>

                  <div className="settings-actions">
                    <button type="button" className="settings-btn" onClick={handleSavePassword} disabled={!canSubmitPassword || passwordSaving}>
                      {passwordSaving ? 'Guardando...' : 'Guardar contraseña'}
                    </button>
                    <button type="button" className="settings-btn secondary" onClick={handleCancelPasswordChange} disabled={passwordSaving}>
                      Cancelar
                    </button>
                  </div>
                </div>
              )}

              {passwordError && <p className="settings-message error">{passwordError}</p>}
              {passwordSuccess && <p className="settings-message success">{passwordSuccess}</p>}
            </div>
          </article>
        </div>
      </section>


    </>
  )
}

// Modal JSX inserted after main component return via conditional render inside same file
