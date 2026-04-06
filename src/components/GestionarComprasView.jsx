import { useMemo, useState } from 'react'
import '../styles/GestionarComprasView.css'

const normalize = (value) => String(value || '').trim().toUpperCase()
const getStageStatus = (compra) => {
  const userStage = normalize(compra?.gestion_estado_usuario)
  if (userStage) return userStage
  return normalize(compra?.estado)
}

export default function GestionarComprasView({ compras = [], onChangeEstado }) {
  const [activeStatus, setActiveStatus] = useState('PENDIENTE')

  const pending = useMemo(() => compras
    .filter((compra) => getStageStatus(compra) === 'PENDIENTE')
    .sort((a, b) => new Date(b.fecha_creacion || 0).getTime() - new Date(a.fecha_creacion || 0).getTime()), [compras])

  const approved = useMemo(() => compras
    .filter((compra) => getStageStatus(compra) === 'APROBADA')
    .sort((a, b) => new Date(b.fecha_creacion || 0).getTime() - new Date(a.fecha_creacion || 0).getTime()), [compras])

  const rejected = useMemo(() => compras
    .filter((compra) => getStageStatus(compra) === 'RECHAZADA')
    .sort((a, b) => new Date(b.fecha_creacion || 0).getTime() - new Date(a.fecha_creacion || 0).getTime()), [compras])

  const config = {
    PENDIENTE: { label: 'Pendientes', data: pending, actions: true },
    APROBADA: { label: 'Aprobadas', data: approved, actions: false },
    RECHAZADA: { label: 'Rechazadas', data: rejected, actions: false },
  }

  const view = config[activeStatus]

  return (
    <section className="purchase-manage-section">
      <div className="section-header">
        <h1>Gestionar Compras</h1>
        <p>Total: {compras.length}</p>
      </div>

      <div className="purchase-status-tabs">
        {Object.entries(config).map(([key, val]) => (
          <button
            key={key}
            type="button"
            className={activeStatus === key ? 'active' : ''}
            onClick={() => setActiveStatus(key)}
          >
            {val.label} ({val.data.length})
          </button>
        ))}
      </div>

      {view.data.length === 0 ? (
        <div className="empty-state">No hay compras en esta seccion.</div>
      ) : (
        <div className="purchase-manage-list">
          {view.data.map((compra) => (
            <article className="purchase-manage-card" key={compra.id}>
              <div className="purchase-manage-head">
                <h3>Compra #{compra.id}</h3>
                <span className={`purchase-status ${normalize(compra.estado).toLowerCase()}`}>
                  {compra.estado_aprobacion_detalle || compra.estado}
                </span>
              </div>

              <p><strong>Usuario:</strong> {compra.usuario || `ID ${compra.id_usuario}`}</p>
              <p><strong>Area solicitante:</strong> {compra.area_solicitante || 'Sin area'}</p>
              <p><strong>Fecha:</strong> {compra.fecha_creacion ? new Date(compra.fecha_creacion).toLocaleString() : 'Sin fecha'}</p>

              <div>
                <strong>Materiales solicitados:</strong>
                <ul>
                  {(compra.items || []).map((item) => (
                    <li key={`${compra.id}-${item.id_detalle}`}>
                      {item.material || item.descripcion || 'Material'} - {item.cantidad}
                    </li>
                  ))}
                </ul>
              </div>

              {view.actions && (
                <div className="purchase-manage-actions">
                  {compra.puede_aprobar ? (
                    <>
                      <button className="btn-approve" onClick={() => onChangeEstado(compra.id, 'APROBADA')}>Aprobar</button>
                      <button className="btn-reject" onClick={() => onChangeEstado(compra.id, 'RECHAZADA')}>Rechazar</button>
                    </>
                  ) : (
                    <span className="empty-state">Pendiente de otro nivel de aprobacion.</span>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
