import { useEffect, useState } from 'react'
import { fetchSubAreas } from '../services/api'
import '../styles/SolicitarServicioForm.css'

export default function SolicitarServicioForm({
  currentUser,
  currentAreaId,
  onSubmitServicio,
}) {
  const [form, setForm] = useState({
    nombre_servicio: '',
    descripcion_servicio: '',
    prioridad: 'MEDIA',
    sub_area: '',
  })
  const [subAreas, setSubAreas] = useState([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const update = (patch) => setForm((prev) => ({ ...prev, ...patch }))

  useEffect(() => {
    let mounted = true

    const loadSubAreas = async () => {
      try {
        const result = await fetchSubAreas()
        if (!mounted) return
        setSubAreas(Array.isArray(result) ? result : [])
      } catch {
        if (!mounted) return
        setSubAreas([])
      }
    }

    loadSubAreas()
    return () => {
      mounted = false
    }
  }, [])

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')

    const nombreServicio = String(form.nombre_servicio || '').trim()
    const descripcionServicio = String(form.descripcion_servicio || '').trim()
    const prioridad = String(form.prioridad || '').trim().toUpperCase()
    const subArea = String(form.sub_area || '').trim()

    if (!subArea) {
      setError('Selecciona una sub-area destino')
      return
    }

    if (!nombreServicio) {
      setError('El nombre del servicio es obligatorio')
      return
    }

    if (!descripcionServicio) {
      setError('La descripcion del servicio es obligatoria')
      return
    }

    if (!['ALTA', 'MEDIA', 'BAJA'].includes(prioridad)) {
      setError('La prioridad debe ser ALTA, MEDIA o BAJA')
      return
    }

    try {
      setSaving(true)
      await onSubmitServicio({
        nombre_servicio: nombreServicio,
        sub_area: subArea,
        descripcion_servicio: descripcionServicio,
        prioridad,
      })

      setForm({
        nombre_servicio: '',
        descripcion_servicio: '',
        prioridad: 'MEDIA',
        sub_area: '',
      })
    } catch (err) {
      setError(err.message || 'Error al crear solicitud de servicio')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="service-request-section">
      <div className="section-header">
        <h1>Solicitar Servicio</h1>
      </div>

      <form className="service-request-form" onSubmit={handleSubmit}>
        <div className="service-user-info">
          <p><strong>Usuario:</strong> {currentUser || 'Usuario'}</p>
        </div>

        <label>
          Nombre del servicio
          <input
            type="text"
            value={form.nombre_servicio}
            onChange={(event) => update({ nombre_servicio: event.target.value })}
            placeholder="Ejemplo: Mantenimiento de compresor"
            disabled={saving}
          />
        </label>

        <label>
          Descripcion del servicio
          <textarea
            rows={4}
            value={form.descripcion_servicio}
            onChange={(event) => update({ descripcion_servicio: event.target.value })}
            placeholder="Describe el servicio solicitado"
            disabled={saving}
          />
        </label>

        <div className="service-request-grid single-column-grid">
          <label>
            Sub-area destino
            <select
            className='select-request'
              value={form.sub_area}
              onChange={(event) => update({ sub_area: event.target.value })}
              disabled={saving}
            >
              <option value="">Selecciona sub-area destino</option>
              {subAreas.filter((sub) => sub !== 'GERENTE').map((sub) => (
                <option key={sub} value={sub}>
                  {sub}
                </option>
              ))}
            </select>
          </label>

          <label>
            Prioridad
            <select
            className='select-request'
              value={form.prioridad}
              onChange={(event) => update({ prioridad: event.target.value })}
              disabled={saving}
            >
              <option value="ALTA">ALTA</option>
              <option value="MEDIA">MEDIA</option>
              <option value="BAJA">BAJA</option>
            </select>
          </label>

        </div>

        <div className="service-request-actions">
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Guardando...' : 'Registrar solicitud de servicio'}
          </button>
        </div>

        {error && <p className="service-request-error">{error}</p>}
      </form>
    </section>
  )
}
