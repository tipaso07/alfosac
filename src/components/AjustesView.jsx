import { useMemo, useRef, useState } from 'react'
import '../styles/AjustesView.css'

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

export default function AjustesView({ currentUser, onUpdatePhoto }) {
  const [photoBase64, setPhotoBase64] = useState('')
  const [photoPreview, setPhotoPreview] = useState('')
  const [selectedFileName, setSelectedFileName] = useState('')
  const [isEditingPhoto, setIsEditingPhoto] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const fileInputRef = useRef(null)

  const previewSrc = useMemo(() => {
    if (photoPreview) return photoPreview
    const current = String(currentUser?.foto || currentUser?.imagen || '').trim()
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

  return (
    <section className="settings-section">
      <div className="settings-header">
        <h1>Ajustes</h1>
        <p>Informacion del usuario actual. Solo la foto es editable.</p>
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
          </div>
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
      </div>
    </section>
  )
}
