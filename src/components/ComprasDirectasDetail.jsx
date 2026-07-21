import { useState, useEffect } from 'react'
import { fetchCompraDirecta } from '../services/api'
import '../styles/ComprasDirectasDetail.css'

export default function ComprasDirectasDetail({ idCompra, onBack, onEdit }) {
  const [compra, setCompra] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetchCompraDirecta(idCompra)
      .then(setCompra)
      .catch(alert)
      .finally(() => setLoading(false))
  }, [idCompra])

  if (loading) return <div className="cd-loading">Cargando...</div>
  if (!compra) return <div className="cd-loading">No encontrado</div>

  const total = (compra.detalle || []).reduce((s, d) => s + Number(d.subtotal || 0), 0)

  return (
    <div className="cd-detail">
      <div className="cd-detail-header">
        <h2>Compra Directa #{compra.id}</h2>
        <div>
          <button className="cd-btn cd-btn-secondary" onClick={onBack}>Volver</button>
        </div>
      </div>

      <div className="cd-detail-grid">
        <div><strong>Proveedor:</strong> {compra.proveedor_texto || '-'}</div>
        <div><strong>Área:</strong> {compra.area_nombre || '-'}</div>
        <div><strong>Fecha:</strong> {compra.fecha_compra ? compra.fecha_compra.slice(0, 10) : '-'}</div>
        <div><strong>Tipo pago:</strong> {compra.tipo_pago || 'EFECTIVO'}</div>
        <div><strong>Moneda:</strong> {compra.id_moneda === 2 ? 'USD' : 'PEN'}</div>
        <div><strong>Usuario:</strong> {compra.usuario_nombre || '-'}</div>
        <div className="cd-detail-full">
          <strong>Observaciones:</strong> {compra.observaciones || '-'}
        </div>
      </div>

      {compra.foto && (
        <div className="cd-detail-foto">
          <strong>Foto:</strong><br />
          <img src={compra.foto} alt="Foto" style={{ maxWidth: 300, maxHeight: 300 }} />
        </div>
      )}

      <h3>Detalle</h3>
      <table className="cd-table">
        <thead>
          <tr>
            <th>Material</th>
            <th>Cantidad</th>
            <th>Precio Unit.</th>
            <th>Subtotal</th>
          </tr>
        </thead>
        <tbody>
          {(compra.detalle || []).map(d => (
            <tr key={d.id}>
              <td>{d.nombre_material}</td>
              <td>{Number(d.cantidad || 0).toFixed(2)}</td>
              <td>{Number(d.precio_unitario || 0).toFixed(2)}</td>
              <td>{Number(d.subtotal || 0).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3} className="cd-total-label">Total:</td>
            <td className="cd-total-value">{total.toFixed(2)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
