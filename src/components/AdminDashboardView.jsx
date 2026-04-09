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

function BarChartCard({ title, subtitle, data = [], valueKey = 'total', labelKey = 'area', valueFormatter }) {
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
            const rowName = String(item?.[labelKey] || item?.area || item?.material || 'Sin dato')

            return (
              <div className="admin-bar-row" key={`${rowName}-${idx}`}>
                <div className="admin-bar-label">{rowName}</div>
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

function PieChartCard({ title, subtitle, data = [], valueKey = 'porcentaje', labelKey = 'area' }) {
  const slices = useMemo(() => {
    const palette = ['#0284c7', '#0ea5e9', '#06b6d4', '#14b8a6', '#10b981', '#22c55e', '#84cc16', '#eab308']
    return data.map((item, idx) => ({
      label: String(item?.[labelKey] || 'Sin area'),
      value: Number(item?.[valueKey] || 0),
      color: palette[idx % palette.length],
    }))
  }, [data, labelKey, valueKey])

  const total = useMemo(() => slices.reduce((sum, item) => sum + item.value, 0), [slices])

  const gradient = useMemo(() => {
    if (total <= 0) return 'conic-gradient(#e2e8f0 0 100%)'
    let start = 0
    const parts = slices.map((item) => {
      const ratio = item.value / total
      const end = start + ratio * 100
      const stop = `${item.color} ${start.toFixed(2)}% ${end.toFixed(2)}%`
      start = end
      return stop
    })
    return `conic-gradient(${parts.join(', ')})`
  }, [slices, total])

  return (
    <article className="admin-chart-card">
      <header>
        <h3>{title}</h3>
        {subtitle && <p>{subtitle}</p>}
      </header>

      {slices.length === 0 || total <= 0 ? (
        <div className="admin-empty">Sin datos disponibles</div>
      ) : (
        <div className="admin-pie-layout">
          <div className="admin-pie-chart" style={{ background: gradient }} aria-label={title} />
          <div className="admin-pie-legend">
            {slices.map((item) => (
              <div key={item.label} className="admin-pie-legend-row">
                <span className="admin-pie-dot" style={{ background: item.color }} />
                <span className="admin-pie-name">{item.label}</span>
                <span className="admin-pie-value">{item.value.toFixed(2)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </article>
  )
}

export default function AdminDashboardView({ data, loading = false, onRefresh }) {
  const fechaInicio = String(data?.filtro_fechas?.fecha_inicio || '')
  const fechaFin = String(data?.filtro_fechas?.fecha_fin || '')

  const resumen = data?.resumen || {
    total_compras: 0,
    total_requerimientos: 0,
    total_servicios: 0,
    monto_total_compras: 0,
  }

  const comprasPorArea = Array.isArray(data?.compras_por_area) ? data.compras_por_area : []
  const requerimientosPorArea = Array.isArray(data?.requerimientos_por_area) ? data.requerimientos_por_area : []
  const serviciosPorArea = Array.isArray(data?.servicios_por_area) ? data.servicios_por_area : []
  const materialesMasUtilizados = Array.isArray(data?.materiales_mas_utilizados) ? data.materiales_mas_utilizados : []
  const distribucionSalidaPorArea = Array.isArray(data?.distribucion_salida_por_area) ? data.distribucion_salida_por_area : []
  const gastoSalidaPorArea = Array.isArray(data?.gasto_salida_por_area) ? data.gasto_salida_por_area : []
  const cantidadMaterialesRecibidosPorArea = Array.isArray(data?.cantidad_materiales_recibidos_por_area)
    ? data.cantidad_materiales_recibidos_por_area
    : []

  const chartConfigs = [
    {
      key: 'compras',
      type: 'bar',
      title: 'Compras por área',
      subtitle: 'Ranking por cantidad de solicitudes de compra',
      data: comprasPorArea,
      valueKey: 'total',
      labelKey: 'area',
      valueFormatter: (value, item) => `${value} (${formatMoney(item.monto_total || 0)})`,
    },
    {
      key: 'requerimientos',
      type: 'bar',
      title: 'Requerimientos por área',
      subtitle: 'Áreas con más requerimientos',
      data: requerimientosPorArea,
      valueKey: 'total',
      labelKey: 'area',
    },
    {
      key: 'servicios',
      type: 'bar',
      title: 'Servicios por área',
      subtitle: 'Áreas con mayor demanda de servicios',
      data: serviciosPorArea,
      valueKey: 'total',
      labelKey: 'area',
    },
    {
      key: 'materiales',
      type: 'bar',
      title: 'Materiales más utilizados',
      subtitle: 'Basado en movimientos de salida',
      data: materialesMasUtilizados,
      valueKey: 'cantidad_total_salida',
      labelKey: 'material',
      valueFormatter: (value) => String(Number(value || 0)),
    },
    {
      key: 'distribucion',
      type: 'pie',
      title: 'Distribución (%) por área',
      subtitle: 'Porcentaje de salida por área',
      data: distribucionSalidaPorArea,
      valueKey: 'porcentaje',
      labelKey: 'area',
    },
    {
      key: 'gasto',
      type: 'bar',
      title: 'Gasto por área',
      subtitle: 'Cantidad de salida x precio disponible',
      data: gastoSalidaPorArea,
      valueKey: 'total_gastado',
      labelKey: 'area',
      valueFormatter: (value) => formatMoney(value),
    },
    {
      key: 'cantidad',
      type: 'bar',
      title: 'Cantidad de materiales recibidos por área',
      subtitle: 'Total recibido basado en movimientos de salida',
      data: cantidadMaterialesRecibidosPorArea,
      valueKey: 'total_materiales_recibidos',
      labelKey: 'area',
      valueFormatter: (value) => String(Number(value || 0)),
    },
  ]

  const visibleCharts = chartConfigs.filter((chart) => Array.isArray(chart.data) && chart.data.length > 0)

  return (
    <section className="admin-dashboard-section">
      <div className="section-header admin-dashboard-header">
        <div>
          <h1>Dashboard</h1>
          <p>Métricas clave y ranking de áreas por actividad</p>
        </div>
        <div className="admin-dashboard-actions">
          <div className="admin-date-filters">
            <label>
              Fecha inicio
              <input
                type="date"
                value={fechaInicio}
                onChange={(event) => onRefresh({ fecha_inicio: event.target.value, fecha_fin: fechaFin, auto: false })}
                disabled={loading}
              />
            </label>
            <label>
              Fecha fin
              <input
                type="date"
                value={fechaFin}
                onChange={(event) => onRefresh({ fecha_inicio: fechaInicio, fecha_fin: event.target.value, auto: false })}
                disabled={loading}
              />
            </label>
            <button
              type="button"
              className="admin-refresh"
              onClick={() => onRefresh({ fecha_inicio: fechaInicio, fecha_fin: fechaFin, auto: true })}
              disabled={loading}
            >
              {loading ? 'Actualizando...' : 'Aplicar'}
            </button>
            <button
              type="button"
              className="admin-refresh"
              onClick={() => onRefresh({ fecha_inicio: '', fecha_fin: '', auto: true })}
              disabled={loading}
            >
              Limpiar
            </button>
          </div>
        </div>
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

      {visibleCharts.length === 0 ? (
        <article className="admin-empty-panel">No hay datos en el rango seleccionado</article>
      ) : (
        <div className="admin-charts-grid">
          {visibleCharts.map((chart) => {
            if (chart.type === 'pie') {
              return (
                <PieChartCard
                  key={chart.key}
                  title={chart.title}
                  subtitle={chart.subtitle}
                  data={chart.data}
                  valueKey={chart.valueKey}
                  labelKey={chart.labelKey}
                />
              )
            }

            return (
              <BarChartCard
                key={chart.key}
                title={chart.title}
                subtitle={chart.subtitle}
                data={chart.data}
                valueKey={chart.valueKey}
                labelKey={chart.labelKey}
                valueFormatter={chart.valueFormatter}
              />
            )
          })}
        </div>
      )}
    </section>
  )
}
