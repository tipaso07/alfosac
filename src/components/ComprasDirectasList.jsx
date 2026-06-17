import { useState, useEffect, useCallback } from 'react'
import ComprasDirectasForm from './ComprasDirectasForm'
import ComprasDirectasDetail from './ComprasDirectasDetail'
import { fetchComprasDirectas, deleteCompraDirecta, fetchAreas } from '../services/api'
import '../styles/ComprasDirectasList.css'

export default function ComprasDirectasList({ comprasDirectas: initialData, onRefresh }) {
  const [view, setView] = useState('list')
  const [compras, setCompras] = useState(Array.isArray(initialData) ? initialData : [])
  const [selectedId, setSelectedId] = useState(null)
  const [editCompra, setEditCompra] = useState(null)

  // Filtros
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [idArea, setIdArea] = useState('')
  const [areas, setAreas] = useState([])

  useEffect(() => {
    setCompras(Array.isArray(initialData) ? initialData : [])
  }, [initialData])

  useEffect(() => {
    fetchAreas().then(setAreas).catch(() => {})
  }, [])

  const handleApplyFilters = useCallback(async () => {
    try {
      const data = await fetchComprasDirectas({
        desde: desde || undefined,
        hasta: hasta || undefined,
        id_area: idArea || undefined,
      })
      setCompras(data)
    } catch (e) {
      console.error(e)
    }
  }, [desde, hasta, idArea])

  const handleDelete = useCallback(async (id) => {
    if (!window.confirm('Eliminar compra directa?')) return
    await deleteCompraDirecta(id)
    onRefresh()
  }, [onRefresh])

  const handleNew = () => {
    setEditCompra(null)
    setView('form')
  }

  const handleEdit = (compra) => {
    setEditCompra(compra)
    setView('form')
  }

  const handleView = (id) => {
    setSelectedId(id)
    setView('detail')
  }

  const handleSave = () => {
    setView('list')
    onRefresh()
  }

  const handleCancel = () => {
    setView('list')
    setEditCompra(null)
  }

  if (view === 'form') {
    return (
      <ComprasDirectasForm
        compra={editCompra}
        onSave={handleSave}
        onCancel={handleCancel}
      />
    )
  }

  if (view === 'detail') {
    return (
      <ComprasDirectasDetail
        idCompra={selectedId}
        onBack={() => setView('list')}
        onEdit={() => {
          const c = compras.find(x => x.id === selectedId)
          if (c) handleEdit(c)
        }}
      />
    )
  }

  return (
    <div className="cd-list">
      <div className="cd-list-header">
        <h2>Compras Directas</h2>
        <button className="cd-btn cd-btn-primary" onClick={handleNew}>
          + Nueva Compra Directa
        </button>
      </div>

      <div className="cd-filters">
        <label>
          Desde:
          <input type="date" value={desde} onChange={e => setDesde(e.target.value)} />
        </label>
        <label>
          Hasta:
          <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} />
        </label>
        <label>
          Área:
          <select value={idArea} onChange={e => setIdArea(e.target.value)}>
            <option value="">Todas</option>
            {areas.map(a => (
              <option key={a.id} value={a.id}>{a.nombre}</option>
            ))}
          </select>
        </label>
        <button className="cd-btn cd-btn-secondary" onClick={handleApplyFilters}>
          Filtrar
        </button>
      </div>

      <table className="cd-table">
        <thead>
          <tr>
            <th>N°</th>
            <th>Fecha</th>
            <th>Proveedor</th>
            <th>Área</th>
            <th>Total</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {compras.map(c => (
            <tr key={c.id}>
              <td>{c.id}</td>
              <td>{c.fecha_compra ? c.fecha_compra.slice(0, 10) : '-'}</td>
              <td>{c.proveedor_texto || '-'}</td>
              <td>{c.area_nombre || '-'}</td>
              <td>{Number(c.total || 0).toFixed(2)}</td>
              <td className="cd-actions">
                <button className="cd-btn cd-btn-sm" onClick={() => handleView(c.id)}>Ver</button>
                <button className="cd-btn cd-btn-sm cd-btn-warning" onClick={() => handleEdit(c)}>Editar</button>
                <button className="cd-btn cd-btn-sm cd-btn-danger" onClick={() => handleDelete(c.id)}>Eliminar</button>
              </td>
            </tr>
          ))}
          {compras.length === 0 && (
            <tr><td colSpan={6} className="cd-empty">Sin registros</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}