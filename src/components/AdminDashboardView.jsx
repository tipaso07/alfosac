import { useMemo } from 'react'
import '../styles/AdminDashboardView.css'

const formatMoney = (value) => {
  const amount = Number(value || 0)
  return new Intl.NumberFormat('es-PE', {
    style: 'currency',
    currency: 'PEN',
    maximumFractionDigits: 2,
  }).format(amount)
}

function BarChartCard({ title, subtitle, data = [], valueKey = 'total', valueFormatter }) {
  const maxValue = useMemo(() => {
    return data.reduce((max, item) => Math.max(max, Number(item?.[valueKey] || 0)), 0)
  }, [data, valueKey])

  return (
    <article className="admin-chart-card">
      <header>
        <h3>{title}</h3>
        {subtitle && <p>{subtitle}</p>}
      </header>

      {data.length === 0 ? (
        <div className="admin-empty">Sin datos disponibles</div>
      ) : (
        <div className="admin-bars">
          {data.map((item, idx) => {
            const value = Number(item?.[valueKey] || 0)
            const width = maxValue > 0 ? Math.max((value / maxValue) * 100, 4) : 0
            const label = valueFormatter ? valueFormatter(value, item) : String(value)

            return (
              <div className="admin-bar-row" key={`${item.area || 'Area'}-${idx}`}>
                <div className="admin-bar-label">{item.area || 'Sin area'}</div>
                <div className="admin-bar-track">
                  <div className="admin-bar-fill" style={{ width: `${width}%` }} />
                </div>
                <div className="admin-bar-value">{label}</div>
              </div>
            )
          })}
        </div>
      )}
    </article>
  )
}

export default function AdminDashboardView({ data, loading = false, onRefresh }) {
  const resumen = data?.resumen || {
    total_compras: 0,
    total_requerimientos: 0,
    total_servicios: 0,
    monto_total_compras: 0,
  }

  const comprasPorArea = Array.isArray(data?.compras_por_area) ? data.compras_por_area : []
  const requerimientosPorArea = Array.isArray(data?.requerimientos_por_area) ? data.requerimientos_por_area : []
  const serviciosPorArea = Array.isArray(data?.servicios_por_area) ? data.servicios_por_area : []

  return (
    <section className="admin-dashboard-section">
      <div className="section-header admin-dashboard-header">
        <div>
          <h1>Dashboard</h1>
          <p>Métricas clave y ranking de áreas por actividad</p>
        </div>
        <button type="button" className="admin-refresh" onClick={onRefresh} disabled={loading}>
          {loading ? 'Actualizando...' : 'Actualizar'}
        </button>
      </div>

      <div className="admin-kpis-grid">
        <article className="admin-kpi-card">
          <span>Total compras</span>
          <strong>{Number(resumen.total_compras || 0)}</strong>
        </article>
        <article className="admin-kpi-card">
          <span>Total requerimientos</span>
          <strong>{Number(resumen.total_requerimientos || 0)}</strong>
        </article>
        <article className="admin-kpi-card">
          <span>Total servicios</span>
          <strong>{Number(resumen.total_servicios || 0)}</strong>
        </article>
        <article className="admin-kpi-card emphasis">
          <span>Monto total compras</span>
          <strong>{formatMoney(resumen.monto_total_compras || 0)}</strong>
        </article>
      </div>

      <div className="admin-charts-grid">
        <BarChartCard
          title="Compras por área"
          subtitle="Ranking por cantidad de solicitudes de compra"
          data={comprasPorArea}
          valueKey="total"
          valueFormatter={(value, item) => `${value} (${formatMoney(item.monto_total || 0)})`}
        />
        <BarChartCard
          title="Requerimientos por área"
          subtitle="Áreas con más requerimientos"
          data={requerimientosPorArea}
          valueKey="total"
        />
        <BarChartCard
          title="Servicios por área"
          subtitle="Áreas con mayor demanda de servicios"
          data={serviciosPorArea}
          valueKey="total"
        />
      </div>
    </section>
  )
}
