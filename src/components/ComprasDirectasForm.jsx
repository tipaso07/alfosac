import { useState, useEffect } from 'react'
import { createCompraDirecta, updateCompraDirecta, fetchAreas, fetchUnidades } from '../services/api'
import '../styles/ComprasDirectasForm.css'

const emptyRow = () => ({
  id_material: '',
  nombre_material: '',
  cantidad: 1,
  precio_unitario: 0,
  id_unidad: '',
})

export default function ComprasDirectasForm({ compra, onSave, onCancel }) {
  const isEdit = Boolean(compra?.id)
  const [proveedorTexto, setProveedorTexto] = useState(compra?.proveedor_texto || '')
  const [idArea, setIdArea] = useState(compra?.id_area || '')
  const [fechaCompra, setFechaCompra] = useState(compra?.fecha_compra ? compra.fecha_compra.slice(0, 10) : new Date().toISOString().slice(0, 10))
  const [observaciones, setObservaciones] = useState(compra?.observaciones || '')
  const [foto, setFoto] = useState(compra?.foto || '')
  const [areas, setAreas] = useState([])
  const [unidades, setUnidades] = useState([])
  const [detalle, setDetalle] = useState(
    compra?.detalle && compra.detalle.length > 0
      ? compra.detalle.map(d => ({ ...d }))
      : [emptyRow()]
  )
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    Promise.all([fetchAreas(), fetchUnidades()])
      .then(([a, u]) => { setAreas(a); setUnidades(u) })
      .catch(() => {})
  }, [])

  const updateRow = (index, field, value) => {
    setDetalle(prev => {
      const next = prev.map((r, i) => i === index ? { ...r, [field]: value } : { ...r })
      return next
    })
  }

  const addRow = () => setDetalle(prev => [...prev, emptyRow()])
  const removeRow = (index) => {
    if (detalle.length <= 1) return
    setDetalle(prev => prev.filter((_, i) => i !== index))
  }

  const subtotal = (row) => Number(row.cantidad || 0) * Number(row.precio_unitario || 0)
  const totalGeneral = detalle.reduce((s, r) => s + subtotal(r), 0)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const payload = {
        proveedor_texto: proveedorTexto,
        id_area: idArea || null,
        fecha_compra: fechaCompra,
        foto: foto || null,
        observaciones,
        detalle: detalle.map(r => ({
          id_material: r.id_material || null,
          nombre_material: r.nombre_material,
          cantidad: Number(r.cantidad || 0),
          precio_unitario: Number(r.precio_unitario || 0),
          id_unidad: r.id_unidad || null,
        })),
      }
      if (isEdit) {
        await updateCompraDirecta(compra.id, payload)
      } else {
        await createCompraDirecta(payload)
      }
      onSave()
    } catch (err) {
      alert(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="cd-form">
      <h2>{isEdit ? 'Editar' : 'Nueva'} Compra Directa</h2>
      <form onSubmit={handleSubmit}>
        <div className="cd-form-grid">
          <label>
            Proveedor:
            <input value={proveedorTexto} onChange={e => setProveedorTexto(e.target.value)} />
          </label>
          <label>
            Área:
            <select value={idArea} onChange={e => setIdArea(e.target.value)}>
              <option value="">Seleccionar</option>
              {areas.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
            </select>
          </label>
          <label>
            Fecha:
            <input type="date" value={fechaCompra} onChange={e => setFechaCompra(e.target.value)} />
          </label>
          <label>
            Foto (URL):
            <input value={foto} onChange={e => setFoto(e.target.value)} placeholder="URL o base64" />
          </label>
          <label className="cd-full-width">
            Observaciones:
            <textarea value={observaciones} onChange={e => setObservaciones(e.target.value)} rows={2} />
          </label>
        </div>

        <h3>Detalle</h3>
        <table className="cd-form-table">
          <thead>
            <tr>
              <th>Material</th>
              <th>Cantidad</th>
              <th>Precio Unit.</th>
              <th>Subtotal</th>
              <th>Unidad</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {detalle.map((row, i) => (
              <tr key={i}>
                <td><input value={row.nombre_material} onChange={e => updateRow(i, 'nombre_material', e.target.value)} /></td>
                <td><input type="number" step="0.01" min="0" value={row.cantidad} onChange={e => updateRow(i, 'cantidad', e.target.value)} /></td>
                <td><input type="number" step="0.01" min="0" value={row.precio_unitario} onChange={e => updateRow(i, 'precio_unitario', e.target.value)} /></td>
                <td className="cd-subtotal">{subtotal(row).toFixed(2)}</td>
                <td>
                  <select value={row.id_unidad} onChange={e => updateRow(i, 'id_unidad', e.target.value)}>
                    <option value="">-</option>
                    {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                  </select>
                </td>
                <td>
                  <button type="button" className="cd-btn cd-btn-sm cd-btn-danger" onClick={() => removeRow(i)}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5} className="cd-total-label">Total:</td>
              <td className="cd-total-value">{totalGeneral.toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>
        <button type="button" className="cd-btn cd-btn-secondary" onClick={addRow}>+ Agregar fila</button>

        <div className="cd-form-actions">
          <button type="submit" className="cd-btn cd-btn-primary" disabled={saving}>
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
          <button type="button" className="cd-btn cd-btn-secondary" onClick={onCancel}>Cancelar</button>
        </div>
      </form>
    </div>
  )
}