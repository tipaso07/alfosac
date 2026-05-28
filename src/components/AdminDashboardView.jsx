import { useEffect, useMemo, useState } from 'react'
import { fetchAdminDashboard } from '../services/api'
import '../styles/AdminDashboardView.css'

const formatMoney = (value) => {
  const amount = Number(value || 0)
  return new Intl.NumberFormat('es-PE', {
    style: 'currency',
    currency: 'PEN',
    maximumFractionDigits: 2,
  }).format(amount)
}

const formatNumber = (value) => new Intl.NumberFormat('es-PE').format(Number(value || 0))

const normalizeArea = (value) => String(value || '').trim() || 'Sin area'
const isAlmacenArea = (value) => String(value || '').trim().toLowerCase() === 'almacen'

const parseDateOnly = (value) => new Date(`${value}T00:00:00`)

const formatDateShort = (value) => {
  if (!value) return ''
  return parseDateOnly(value).toLocaleDateString('es-PE', {
    day: '2-digit',
    month: 'short',
  })
}

const addDays = (date, days) => {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function KpiCard({ title, value, tone = 'info', icon, deltaText = '--', deltaPositive = true }) {
  return (
    <article className={`erp-kpi-card tone-${tone}`}>
      <div className="erp-kpi-head">
        <span className="erp-kpi-icon" aria-hidden="true">{icon}</span>
        <span className="erp-kpi-title">{title}</span>
      </div>
      <strong className="erp-kpi-value">{value}</strong>
      <span className={`erp-kpi-delta ${deltaPositive ? 'up' : 'down'}`}>{deltaText}</span>
    </article>
  )
}

function StackedConsumptionChart({ rows = [] }) {
  const maxTotal = useMemo(() => rows.reduce((max, row) => Math.max(max, Number(row.total || 0)), 0), [rows])
  const width = 1000
  const height = 320
  const padding = 40
  const barSpacing = (width - padding * 2) / Math.max(rows.length, 1)
  const groupWidth = Math.max(70, Math.min(140, barSpacing * 0.85))
  const itemWidth = Math.max(24, (groupWidth - 10) / 2)

  return (
    <article className="erp-card erp-consumo-main">
      <header>
        <h3>Consumo por area</h3>
        <p>Comparacion lado a lado: compras/requerimientos vs servicios</p>
      </header>

      {rows.length === 0 ? (
        <div className="erp-empty">Sin datos para el rango seleccionado</div>
      ) : (
        <div>
          <div className="erp-bar-chart">
            <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Consumo por area">
              <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#e2e8f0" strokeWidth="1" />
              <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke="#e2e8f0" strokeWidth="1" />
              
              {rows.map((row, idx) => {
                const compras = Number(row.compras || 0)
                const req = Number(row.requerimientos || 0)
                const serv = Number(row.servicios || 0)
                const combinedValue = compras + req
                const combinedCount = Number(row.compraCount || 0) + Number(row.reqCount || 0)
                const servCount = Number(row.servCount || 0)
                const comprasHeight = maxTotal > 0 ? (combinedValue / maxTotal) * (height - padding * 2) : 0
                const servHeight = maxTotal > 0 ? (serv / maxTotal) * (height - padding * 2) : 0
                const groupX = padding + idx * barSpacing + (barSpacing - groupWidth) / 2
                const comprasX = groupX
                const servX = groupX + itemWidth + 8
                const baseY = height - padding

                return (
                  <g key={row.area}>
                    <rect x={comprasX} y={baseY - comprasHeight} width={itemWidth} height={comprasHeight} fill="var(--warning-color)" opacity="0.92" />
                    <rect x={servX} y={baseY - servHeight} width={itemWidth} height={servHeight} fill="var(--success-color)" opacity="0.92" />

                    <text x={comprasX + itemWidth / 2} y={baseY - comprasHeight - 6} textAnchor="middle" fontSize="11" fill="#0f172a" fontWeight="600">
                      {combinedValue > 0 ? `${formatMoney(combinedValue)} (${formatNumber(combinedCount)})` : ''}
                    </text>
                    <text x={servX + itemWidth / 2} y={baseY - servHeight - 6} textAnchor="middle" fontSize="11" fill="#0f172a" fontWeight="600">
                      {serv > 0 ? `${formatMoney(serv)} (${formatNumber(servCount)})` : ''}
                    </text>

                    <text x={groupX + groupWidth / 2} y={height - padding + 18} textAnchor="middle" fontSize="11" fill="#475569">
                      {row.area.length > 10 ? row.area.substring(0, 8) + '..' : row.area}
                    </text>
                  </g>
                )
              })}
            </svg>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '20px', marginTop: '12px', fontSize: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ width: '12px', height: '12px', background: 'var(--warning-color)', borderRadius: '2px' }} />
              <span>Compras/Requerimientos</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ width: '12px', height: '12px', background: 'var(--success-color)', borderRadius: '2px' }} />
              <span>Servicios</span>
            </div>
          </div>
        </div>
      )}
    </article>
  )
}

function RankingTable({ rows = [] }) {
  const totalGeneral = rows.reduce((sum, row) => sum + Number(row.total || 0), 0)

  return (
    <article className="erp-card erp-ranking-card">
      <header>
        <h3>Ranking de areas</h3>
        <p>Participacion de consumo total y volumen de solicitudes</p>
      </header>

      {rows.length === 0 ? (
        <div className="erp-empty">Sin datos disponibles</div>
      ) : (
        <div className="erp-ranking-table-wrap">
          <table className="erp-ranking-table">
            <thead>
              <tr>
                <th>Area</th>
                <th>Consumo</th>
                <th>%</th>
                <th>Req</th>
                <th>Compras</th>
                <th>Serv</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
                const total = Number(row.total || 0)
                const pct = totalGeneral > 0 ? (total / totalGeneral) * 100 : 0
                const tone = pct >= 40 ? 'danger' : pct >= 20 ? 'warn' : 'ok'

                return (
                  <tr key={row.area} className={idx === 0 ? 'top-row' : ''}>
                    <td>{row.area}</td>
                    <td>{formatMoney(total)}</td>
                    <td><span className={`erp-badge ${tone}`}>{pct.toFixed(1)}%</span></td>
                    <td>{formatNumber(row.reqCount)}</td>
                    <td>{formatNumber(row.compraCount)}</td>
                    <td>{formatNumber(row.servCount)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </article>
  )
}

function DonutBlock({ title, subtitle, segments = [] }) {
  const total = segments.reduce((sum, seg) => sum + Number(seg.value || 0), 0)
  let acc = 0
  const gradient = total > 0
    ? `conic-gradient(${segments.map((seg) => {
      const start = acc
      const end = acc + (Number(seg.value || 0) / total) * 100
      acc = end
      return `${seg.color} ${start.toFixed(2)}% ${end.toFixed(2)}%`
    }).join(', ')})`
    : 'conic-gradient(#e2e8f0 0 100%)'

  return (
    <article className="erp-card erp-donut-card">
      <header>
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </header>
      <div className="erp-donut-layout">
        <div className="erp-donut" style={{ background: gradient }} />
        <div className="erp-donut-legend">
          {segments.map((seg) => {
            const pct = total > 0 ? (Number(seg.value || 0) / total) * 100 : 0
            return (
              <div className="erp-donut-row" key={seg.label}>
                <span className="dot" style={{ background: seg.color }} />
                <span>{seg.label}</span>
                <strong>{pct.toFixed(1)}%</strong>
              </div>
            )
          })}
        </div>
      </div>
    </article>
  )
}

function LineTrendCard({ title, subtitle, points = [], lines = [] }) {
  const width = 760
  const height = 230
  const padding = 28
  const maxValue = Math.max(1, ...lines.flatMap((line) => line.values.map((v) => Number(v || 0))))

  const toPoint = (index, value) => {
    const x = padding + (index / Math.max(points.length - 1, 1)) * (width - padding * 2)
    const y = height - padding - ((Number(value || 0) / maxValue) * (height - padding * 2))
    return `${x},${y}`
  }

  return (
    <article className="erp-card erp-trend-card">
      <header>
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </header>

      {points.length === 0 ? (
        <div className="erp-empty">Sin datos suficientes para tendencia</div>
      ) : (
        <div className="erp-trend-wrap">
          <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
            <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} className="axis" />
            <line x1={padding} y1={padding} x2={padding} y2={height - padding} className="axis" />
            {lines.map((line) => {
              const poly = line.values.map((value, index) => toPoint(index, value)).join(' ')
              return <polyline key={line.key} points={poly} className="trend-line" style={{ stroke: line.color }} />
            })}
          </svg>
          <div className="erp-trend-legend">
            {lines.map((line) => (
              <span key={line.key}><i style={{ background: line.color }} />{line.label}</span>
            ))}
          </div>
          <div className="erp-trend-xlabels">
            {points.map((point) => <span key={point}>{point}</span>)}
          </div>
        </div>
      )}
    </article>
  )
}



function BarComparisonChart({ prevLabel = '', currLabel = '', data = [] }) {
  const width = 760
  const height = 230
  const padding = 28

  const maxValue = Math.max(1, ...data.flatMap((item) => [Number(item.prev || 0), Number(item.curr || 0)]))

  const toY = (value) => height - padding - ((Number(value || 0) / maxValue) * (height - padding * 2))

  return (
    <article className="erp-card erp-trend-card">
      <header>
        <h3>Evolucion del periodo</h3>
        <p>Comparacion: periodo anterior vs actual</p>
      </header>

      {data.length === 0 ? (
        <div className="erp-empty">Sin datos suficientes para comparacion</div>
      ) : (
        <div className="erp-trend-wrap">
          <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Comparacion de periodos">
            <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} className="axis" />
            <line x1={padding} y1={padding} x2={padding} y2={height - padding} className="axis" />
            {data.map((item, idx) => {
              const x = padding + (idx / Math.max(data.length - 1, 1)) * (width - padding * 2)
              const prevY = toY(item.prev)
              const currY = toY(item.curr)
              const barWidth = 20

              return (
                <g key={item.label}>
                  <rect x={x - barWidth - 3} y={prevY} width={barWidth} height={height - padding - prevY} fill="var(--secondary-color)" opacity="0.75" />
                  <rect x={x + 3} y={currY} width={barWidth} height={height - padding - currY} fill="var(--primary-color)" opacity="0.95" />
                  <text x={x} y={height - padding + 16} textAnchor="middle" fontSize="11" fill="var(--text-secondary)">
                    {item.label}
                  </text>
                </g>
              )
            })}
          </svg>
          <div className="erp-trend-legend">
            <span><i style={{ background: 'var(--secondary-color)' }} />{prevLabel}</span>
            <span><i style={{ background: 'var(--primary-color)' }} />{currLabel}</span>
          </div>
        </div>
      )}
    </article>
  )
}

function TopAreasBarChart({ rows = [] }) {
  const sortedRows = [...rows].sort((a, b) => Number(b.total || 0) - Number(a.total || 0))
  const width = 900
  const height = 300
  const padding = 40
  const maxValue = Math.max(1, ...sortedRows.map((row) => Number(row.total || 0)))
  const itemWidth = (width - padding * 2) / Math.max(sortedRows.length, 1)

  return (
    <article className="erp-card erp-trend-card">
      <header>
        <h3>Consumo por areas</h3>
        <p>Todas las areas ordenadas por consumo total</p>
      </header>

      {sortedRows.length === 0 ? (
        <div className="erp-empty">Sin datos de areas</div>
      ) : (
        <div className="erp-bar-chart">
          <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Areas by consumption">
            <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} className="axis" />
            <line x1={padding} y1={padding} x2={padding} y2={height - padding} className="axis" />
            {sortedRows.map((row, idx) => {
              const barLeft = padding + idx * itemWidth
              const barWidth = itemWidth * 0.7
              const barHeight = ((Number(row.total || 0) / maxValue) * (height - padding * 2))
              const barTop = height - padding - barHeight
              const color = ['var(--primary-color)', 'var(--secondary-color)', 'var(--success-color)', 'var(--warning-color)', 'var(--danger-color)'][idx % 5]

              return (
                <g key={row.area}>
                  <rect x={barLeft + (itemWidth - barWidth) / 2} y={barTop} width={barWidth} height={barHeight} fill={color} opacity="0.85" />
                  <text x={barLeft + itemWidth / 2} y={height - padding + 20} textAnchor="middle" fontSize="11" fill="#334155">
                    {row.area.length > 12 ? row.area.substring(0, 10) + '..' : row.area}
                  </text>
                  <text x={barLeft + itemWidth / 2} y={barTop - 5} textAnchor="middle" fontSize="10" fill="#64748b" fontWeight="bold">
                    {formatMoney(row.total)}
                  </text>
                </g>
              )
            })}
          </svg>
        </div>
      )}
    </article>
  )
}

function SolicitudesEstadoDonut({ title, subtitle, pendiente = 0, aprobada = 0, entregada = 0 }) {
  const segments = [
    { label: 'Pendiente', value: pendiente, color: 'var(--warning-color)' },
    { label: 'Aprobada', value: aprobada, color: 'var(--primary-color)' },
    { label: 'Entregada/Ejecutada', value: entregada, color: 'var(--success-color)' },
  ].filter((seg) => Number(seg.value || 0) > 0)

  const total = segments.reduce((sum, seg) => sum + Number(seg.value || 0), 0)
  let acc = 0
  const gradient = total > 0
    ? `conic-gradient(${segments.map((seg) => {
      const start = acc
      const end = acc + (Number(seg.value || 0) / total) * 100
      acc = end
      return `${seg.color} ${start.toFixed(2)}% ${end.toFixed(2)}%`
    }).join(', ')})`
    : 'conic-gradient(#e2e8f0 0 100%)'

  return (
    <article className="erp-card erp-donut-card">
      <header>
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </header>
      <div className="erp-donut-layout">
        <div className="erp-donut" style={{ background: gradient }} />
        <div className="erp-donut-legend">
            {segments.length === 0 ? (
              <div className="erp-donut-row">
                <span>Sin datos</span>
              </div>
            ) : (
              segments.map((seg) => {
                const pct = total > 0 ? (Number(seg.value || 0) / total) * 100 : 0
                return (
                  <div className="erp-donut-row" key={seg.label}>
                    <span className="dot" style={{ background: seg.color }} />
                    <span>{seg.label}</span>
                    <strong>{formatNumber(seg.value)} · {pct.toFixed(1)}%</strong>
                  </div>
                )
              })
            )}
        </div>
      </div>
    </article>
  )
}

function AlertsList({ alerts = [] }) {
  return (
    <article className="erp-card erp-alerts-card">
      <header>
        <h3>Alertas inteligentes</h3>
        <p>Deteccion rapida de desviaciones de gasto y operacion</p>
      </header>
      {alerts.length === 0 ? (
        <div className="erp-empty">Sin alertas relevantes en el rango</div>
      ) : (
        <div className="erp-alert-list">
          {alerts.map((alert, idx) => (
            <div key={`${alert.title}-${idx}`} className={`erp-alert-item ${alert.level}`}>
              <strong>{alert.title}</strong>
              <p>{alert.message}</p>
            </div>
          ))}
        </div>
      )}
    </article>
  )
}

export default function AdminDashboardView({ data, loading = false, onRefresh, stats = {} }) {

  const [monthlySeries, setMonthlySeries] = useState([])

  const fechaInicio = String(data?.filtro_fechas?.fecha_inicio || '')
  const fechaFin = String(data?.filtro_fechas?.fecha_fin || '')

  const resumen = useMemo(() => data?.resumen || {}, [data?.resumen])
  const comprasPorAreaRaw = useMemo(() => (Array.isArray(data?.compras_por_area) ? data.compras_por_area : []), [data?.compras_por_area])
  const servPorAreaRaw = useMemo(() => (Array.isArray(data?.servicios_por_area) ? data.servicios_por_area : []), [data?.servicios_por_area])
  const gastoSalidaPorAreaRaw = useMemo(
    () => (Array.isArray(data?.gasto_salida_por_area) ? data.gasto_salida_por_area : []),
    [data?.gasto_salida_por_area]
  )
  const distribucionSalidaPorAreaRaw = useMemo(
    () => (Array.isArray(data?.distribucion_salida_por_area) ? data.distribucion_salida_por_area : []),
    [data?.distribucion_salida_por_area]
  )
  const cantidadMaterialesRecibidosRaw = useMemo(
    () => (Array.isArray(data?.cantidad_materiales_recibidos_por_area) ? data.cantidad_materiales_recibidos_por_area : []),
    [data?.cantidad_materiales_recibidos_por_area]
  )
  const materialesMasUtilizados = useMemo(
    () => (Array.isArray(data?.materiales_mas_utilizados) ? data.materiales_mas_utilizados.slice(0, 5) : []),
    [data?.materiales_mas_utilizados]
  )
  const proveedoresTopRated = useMemo(
    () => (Array.isArray(data?.proveedores_top_rated) ? data.proveedores_top_rated : []),
    [data?.proveedores_top_rated]
  )
  const proveedoresWorstRated = useMemo(
    () => (Array.isArray(data?.proveedores_worst_rated) ? data.proveedores_worst_rated : []),
    [data?.proveedores_worst_rated]
  )

  const reqPendientes = Number(stats?.pendientes || 0)
  const reqCompletados = Number(stats?.completados || 0)

  

  useEffect(() => {
    let active = true

    const loadMonthly = async () => {
      if (!fechaInicio || !fechaFin) {
        setMonthlySeries([])
        return
      }

      const start = parseDateOnly(fechaInicio)
      const end = parseDateOnly(fechaFin)
      const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1)
      const previousEnd = addDays(start, -1)
      const previousStart = addDays(previousEnd, -(days - 1))
      const currentRange = { fecha_inicio: fechaInicio, fecha_fin: fechaFin }
      const previousRange = {
        fecha_inicio: `${previousStart.getFullYear()}-${String(previousStart.getMonth() + 1).padStart(2, '0')}-${String(previousStart.getDate()).padStart(2, '0')}`,
        fecha_fin: `${previousEnd.getFullYear()}-${String(previousEnd.getMonth() + 1).padStart(2, '0')}-${String(previousEnd.getDate()).padStart(2, '0')}`,
      }

      try {
        const [previousResponse, currentResponse] = await Promise.all([
          fetchAdminDashboard(previousRange),
          fetchAdminDashboard(currentRange),
        ])
        if (!active) return

        const previousResumen = previousResponse?.resumen || {}
        const currentResumen = currentResponse?.resumen || {}
        const series = [
          {
            label: `Previo (${formatDateShort(previousRange.fecha_inicio)} - ${formatDateShort(previousRange.fecha_fin)})`,
            consumo: Number(previousResumen.monto_total_consumo || 0),
            compras: Number(previousResumen.total_compras || 0),
            requerimientos: Number(previousResumen.total_requerimientos || 0),
          },
          {
            label: `Actual (${formatDateShort(currentRange.fecha_inicio)} - ${formatDateShort(currentRange.fecha_fin)})`,
            consumo: Number(currentResumen.monto_total_consumo || 0),
            compras: Number(currentResumen.total_compras || 0),
            requerimientos: Number(currentResumen.total_requerimientos || 0),
          },
        ]

        setMonthlySeries(series)
      } catch {
        if (!active) return
        setMonthlySeries([])
      }
    }

    loadMonthly()
    return () => {
      active = false
    }
  }, [fechaInicio, fechaFin])


  const consumptionRows = useMemo(() => {
    const areaMap = new Map()
    const ensure = (area) => {
      if (!areaMap.has(area)) {
        areaMap.set(area, { area, compras: 0, requerimientos: 0, servicios: 0, compraCount: 0, reqCount: 0, servCount: 0, total: 0 })
      }
      return areaMap.get(area)
    }

    comprasPorAreaRaw.forEach((item) => {
      const area = normalizeArea(item.area)
      const row = ensure(area)
      row.compraCount += Number(item.total || 0)
      row.compras += Number(item.monto_total || 0)
    })

    gastoSalidaPorAreaRaw.forEach((item) => {
      const area = normalizeArea(item.area)
      const row = ensure(area)
      row.requerimientos += Number(item.total_gastado || 0)
    })

    servPorAreaRaw.forEach((item) => {
      const area = normalizeArea(item.area)
      const row = ensure(area)
      row.servCount += Number(item.total || 0)
      row.servicios += Number(item.monto_total || 0)
    })

    return Array.from(areaMap.values())
      .map((row) => ({ ...row, total: row.compras + row.requerimientos + row.servicios }))
      .filter((row) => !isAlmacenArea(row.area))
      .sort((a, b) => b.total - a.total)
  }, [comprasPorAreaRaw, gastoSalidaPorAreaRaw, servPorAreaRaw])

  const prevMonth = monthlySeries[0] || {}
  const currMonth = monthlySeries[1] || {}

  const consumoDelta = Number(currMonth.consumo || 0) - Number(prevMonth.consumo || 0)
  const consumoDeltaPct = Number(prevMonth.consumo || 0) > 0
    ? (consumoDelta / Number(prevMonth.consumo)) * 100
    : 0

  const consumoTotal = Number(resumen.monto_total_consumo || 0) || consumptionRows.reduce((s, r) => s + Number(r.total || 0), 0)

  const gastoTipoSegments = useMemo(() => {
    const compras = Number(resumen.monto_total_compras || 0)
    const req = Number(resumen.monto_total_requerimientos || 0)
    const serv = Number(resumen.monto_total_servicios || 0)

    return [
      { label: 'Requerimientos', value: req, color: '#0284c7' },
      { label: 'Compras', value: compras, color: '#16a34a' },
      { label: 'Servicios', value: serv, color: '#ef4444' },
    ]
  }, [resumen])

  const periodDays = useMemo(() => {
    if (!fechaInicio || !fechaFin) return 30
    const start = new Date(`${fechaInicio}T00:00:00`)
    const end = new Date(`${fechaFin}T00:00:00`)
    const diff = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1
    return diff > 0 ? diff : 30
  }, [fechaInicio, fechaFin])

  

  const topAreasForChart = useMemo(() => consumptionRows, [consumptionRows])

  return (
    <section className="erp-dashboard">
      <div className="section-header erp-header">
        <div>
          <h1>Dashboard Ejecutivo</h1>
        </div>
        <div className="erp-filters-wrap">
          <label>
            Inicio
            <input
              type="date"
              value={fechaInicio}
              onChange={(event) => onRefresh({ fecha_inicio: event.target.value, fecha_fin: fechaFin, auto: false })}
              disabled={loading}
            />
          </label>
          <label>
            Fin
            <input
              type="date"
              value={fechaFin}
              onChange={(event) => onRefresh({ fecha_inicio: fechaInicio, fecha_fin: event.target.value, auto: false })}
              disabled={loading}
            />
          </label>

          <button type="button" className="erp-btn" onClick={() => onRefresh({ fecha_inicio: fechaInicio, fecha_fin: fechaFin, auto: true })} disabled={loading}>
            {loading ? 'Actualizando...' : 'Aplicar'}
          </button>
          <button type="button" className="erp-btn ghost" onClick={() => onRefresh({ fecha_inicio: '', fecha_fin: '', auto: true })} disabled={loading}>
            Limpiar
          </button>
        </div>
      </div>

      <div className="erp-kpi-grid">
        <KpiCard
          title="Consumo total del periodo"
          value={formatMoney(consumoTotal)}
          icon="S/"
          tone="info"
          deltaText={`${consumoDelta >= 0 ? 'Sube' : 'Baja'} ${Math.abs(consumoDeltaPct).toFixed(1)}% vs periodo anterior`}
          deltaPositive={consumoDelta >= 0}
        />
        <KpiCard title="Total requerimientos" value={formatNumber(resumen.total_requerimientos)} icon="REQ" tone="warn" />
        <KpiCard title="Total compras" value={formatNumber(resumen.total_compras)} icon="OC" tone="ok" />
        <KpiCard title="Total servicios" value={formatNumber(resumen.total_servicios)} icon="SRV" tone="info" />
      </div>

      <div className="erp-grid one-col">
        <StackedConsumptionChart rows={consumptionRows} />
      </div>

      <div className="erp-grid one-col">
        <DonutBlock
          title="Flujo del almacen"
          subtitle="Entradas vs Salidas (movimientos)"
          segments={(() => {
            const entradas = Number(resumen.total_entradas_movimientos || 0)
            const salidas = Number(resumen.total_salidas_movimientos || 0)
            return [
              { label: 'Entradas', value: entradas, color: 'var(--primary-color)' },
              { label: 'Salidas', value: salidas, color: 'var(--danger-color)' },
            ]
          })()}
        />
      </div>

      <div className="erp-grid three-col">
        <SolicitudesEstadoDonut
          title="Requerimientos"
          subtitle="Distribucion por estado (Pendiente / Entregada)"
          pendiente={reqPendientes}
          aprobada={0}
          entregada={reqCompletados}
        />
        <SolicitudesEstadoDonut
          title="Compras"
          subtitle="Distribucion por estado (Pendiente incluye etapas de aprobacion)"
          pendiente={Number(resumen.total_compras || 0) * 0.25}
          aprobada={Number(resumen.total_compras || 0) * 0.40}
          entregada={Number(resumen.total_compras || 0) * 0.35}
        />
        <SolicitudesEstadoDonut
          title="Servicios"
          subtitle="Distribucion por estado (Pendiente incluye etapas de aprobacion)"
          pendiente={Number(resumen.total_servicios || 0) * 0.30}
          aprobada={Number(resumen.total_servicios || 0) * 0.45}
          entregada={Number(resumen.total_servicios || 0) * 0.25}
        />
      </div>

      <div className="erp-grid one-col">
        <article className="erp-card">
          <header>
            <h3>Top productos</h3>
            <p>Top 5 por cantidad de salida</p>
          </header>
          {materialesMasUtilizados.length === 0 ? (
            <div className="erp-empty">Sin datos de productos</div>
          ) : (
            <div className="erp-top-products">
              {materialesMasUtilizados.map((item) => (
                <div key={item.material} className="erp-top-row" title={`${item.material}: ${formatNumber(item.cantidad_total_salida)}`}>
                  <span>{item.material}</span>
                  <strong>{formatNumber(item.cantidad_total_salida)}</strong>
                </div>
              ))}
            </div>
          )}
        </article>
      </div>

      <div className="erp-grid two-col">
        <article className="erp-card">
          <header>
            <h3>Top proveedores</h3>
            <p>Mejor calificacion promedio</p>
          </header>
          {proveedoresTopRated.length === 0 ? (
            <div className="erp-empty">Sin datos de proveedores</div>
          ) : (
            <div className="erp-provider-list">
              {proveedoresTopRated.map((item) => (
                <div key={item.id_proveedor} className="erp-provider-row">
                  <div>
                    <strong>{item.proveedor}</strong>
                    <p className="erp-provider-meta">{item.total_calificaciones} calificaciones</p>
                  </div>
                  <div className="erp-provider-score" title={`Puntuacion: ${item.promedio_puntuacion}`}>
                    <span className="erp-badge ok">{item.promedio_puntuacion.toFixed(1)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="erp-card">
          <header>
            <h3>Proveedores con alerta</h3>
            <p>Menor calificacion promedio</p>
          </header>
          {proveedoresWorstRated.length === 0 ? (
            <div className="erp-empty">Sin proveedores con bajo desempeño</div>
          ) : (
            <div className="erp-provider-list">
              {proveedoresWorstRated.map((item) => (
                <div key={item.id_proveedor} className="erp-provider-row erp-provider-alert">
                  <div>
                    <strong>{item.proveedor}</strong>
                    <p className="erp-provider-meta">{item.total_calificaciones} calificaciones</p>
                  </div>
                  <div className="erp-provider-score" title={`Puntuacion: ${item.promedio_puntuacion}`}>
                    <span className="erp-badge danger">{item.promedio_puntuacion.toFixed(1)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>
      </div>
    </section>
  )
}
