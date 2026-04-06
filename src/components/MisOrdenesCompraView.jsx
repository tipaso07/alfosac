import { useMemo, useState } from 'react'
import '../styles/MisOrdenesCompraView.css'
import { fetchProveedores } from '../services/api'

const emptyForm = {
  id_proveedor: '',
  proveedor: '',
  ruc: '',
  direccion: '',
  distrito: '',
  correo: '',
  persona_responsable: '',
  telefono: '',
  contacto_proveedor: '',
  condiciones_pago: '',
  banco: '',
  id_moneda: '',
  moneda: '',
  numero_cuenta: '',
  cuenta: '',
  cci: '',
  retencion: '',
  descuento: '',
  aplica_retencion: false,
  tipo: '',
  tipo_retencion: 'RETENCION',
  subtotal: '',
  costo_envio: '',
  otros_costos: '',
  igv: '',
  total: '',
  importe_final: '',
  comentarios: '',
  recibido_por: '',
  id_area_final: '',
}

const requiredProviderFields = [
  'proveedor',
  'ruc',
  'direccion',
  'correo',
  'persona_responsable',
  'telefono',
  'condiciones_pago',
  'banco',
  'numero_cuenta',
  'cci',
]

const computeRetentionData = ({ subtotal, igv, costoEnvio, otrosCostos, moneda, retencionFlag, retencionPct }) => {
  const totalBase = Number((subtotal + igv + costoEnvio + otrosCostos).toFixed(2))
  const monedaNorm = String(moneda || '').trim().toUpperCase()
  const isUsd = monedaNorm.includes('USD') || monedaNorm.includes('DOLAR')
  const isPen = monedaNorm.includes('PEN') || monedaNorm.includes('SOL')
  const totalSoles = isUsd ? Number((totalBase * 3.4).toFixed(2)) : totalBase
  const superaUmbral = (isPen && totalBase > 700) || (isUsd && totalSoles > 700)
  const providerAllowsRetention = retencionFlag && Number.isFinite(retencionPct) && retencionPct > 0
  const aplicaRetencion = providerAllowsRetention && superaUmbral
  const montoRetencion = aplicaRetencion
    ? Number((totalBase * (retencionPct / 100)).toFixed(2))
    : 0
  const totalFinal = aplicaRetencion
    ? Number((totalBase - montoRetencion).toFixed(2))
    : totalBase

  return {
    totalBase,
    aplicaRetencion,
    montoRetencion,
    totalFinal,
    totalSoles,
    isUsd,
  }
}

export default function MisOrdenesCompraView({
  compras,
  onCompletarDatos,
  onGenerarOrden,
  onDescargarPdf,
}) {
  const [activeFilter, setActiveFilter] = useState('APROBADAS')
  const [error, setError] = useState('')
  const [loadingByCompra, setLoadingByCompra] = useState({})
  const [formsByCompra, setFormsByCompra] = useState({})
  const [expandedByCompra, setExpandedByCompra] = useState({})
  const [supplierOptionsByCompra, setSupplierOptionsByCompra] = useState({})
  const [supplierLoadingByCompra, setSupplierLoadingByCompra] = useState({})

  const normalize = (value) => String(value || '').trim().toUpperCase()

  const filtered = useMemo(() => {
    return (compras || []).filter((compra) => {
      const estado = normalize(compra.estado)
      if (activeFilter === 'APROBADAS') return estado === 'APROBADA'
      if (activeFilter === 'POR_RECIBIR') return ['POR_RECIBIR'].includes(estado)
      if (activeFilter === 'RECIBIDAS') return ['RECIBIDA', 'RECIBIDO'].includes(estado)
      return true
    })
  }, [activeFilter, compras])

  const getStatusLabel = (compra) => {
    if (String(compra?.estado_aprobacion_detalle || '').trim()) {
      return compra.estado_aprobacion_detalle
    }

    const estado = compra?.estado
    const normalized = normalize(estado)
    if (normalized === 'POR_RECIBIR') return 'PENDIENTE DE ENTREGA'
    if (normalized === 'RECIBIDA' || normalized === 'RECIBIDO') return 'RECIBIDA'
    if (normalized === 'APROBADA') return 'APROBADA'
    return estado || 'N/D'
  }

  const getFormValue = (compra) => {
    const previous = formsByCompra[compra.id]
    if (previous) return previous

    return {
      ...emptyForm,
      id_proveedor: compra.id_proveedor || '',
      proveedor: compra.proveedor || compra.razon_social_proveedor || '',
      ruc: compra.ruc || '',
      direccion: compra.direccion || '',
      distrito: compra.distrito || '',
      correo: compra.correo || '',
      persona_responsable: compra.persona_responsable || '',
      telefono: compra.telefono || '',
      contacto_proveedor: compra.contacto_proveedor || compra.persona_responsable || '',
      condiciones_pago: compra.condiciones_pago || '',
      banco: compra.banco || '',
      id_moneda: compra.id_moneda || '',
      moneda: compra.moneda || '',
      numero_cuenta: compra.numero_cuenta || compra.cuenta || '',
      cuenta: compra.numero_cuenta || compra.cuenta || '',
      cci: compra.cci || '',
      retencion: compra.retencion || '',
      descuento: compra.descuento || '',
      aplica_retencion: Boolean(compra.aplica_retencion),
      tipo: compra.tipo || '',
      tipo_retencion:
        ['RETENCION', 'DETRACCION'].includes(normalize(compra.tipo_retencion || ''))
          ? normalize(compra.tipo_retencion)
          : 'RETENCION',
      subtotal: compra.subtotal ?? '',
      costo_envio: compra.costo_envio ?? '',
      otros_costos: compra.otros_costos ?? '',
      igv: compra.igv ?? '',
      total: compra.total ?? '',
      importe_final: compra.importe_final ?? compra.total ?? '',
      comentarios: compra.comentarios || '',
      recibido_por: compra.recibido_por || '',
      id_area_final: compra.id_area_final || compra.id_area_solicitante || '',
    }
  }

  const updateForm = (compraId, patch) => {
    const previous = formsByCompra[compraId] || emptyForm
    const merged = {
      ...emptyForm,
      ...previous,
      ...patch,
    }

    const subtotal = Number(merged.subtotal || 0)
    const igv = Number((subtotal * 0.18).toFixed(2))
    const costoEnvio = Number(merged.costo_envio || 0)
    const otrosCostos = Number(merged.otros_costos || 0)
    const retencionFlag = normalize(merged.retencion) === 'SI'
    const retencionPct = Number(merged.descuento || 0)
    const retentionData = computeRetentionData({
      subtotal,
      igv,
      costoEnvio,
      otrosCostos,
      moneda: merged.moneda,
      retencionFlag,
      retencionPct,
    })

    setFormsByCompra((prev) => ({
      ...prev,
      [compraId]: {
        ...merged,
        igv,
        total: retentionData.totalFinal,
        total_base: retentionData.totalBase,
        aplica_retencion: retentionData.aplicaRetencion,
        monto_retencion: retentionData.montoRetencion,
        importe_final: retentionData.totalFinal,
      },
    }))
  }

  const applyProveedor = (compraId, proveedor) => {
    const idMoneda = Number(proveedor.id_moneda || 0)

    updateForm(compraId, {
      id_proveedor: proveedor.id,
      proveedor: proveedor.razon_social || '',
      ruc: proveedor.ruc || '',
      direccion: proveedor.direccion || '',
      distrito: proveedor.distrito || '',
      correo: proveedor.correo || '',
      persona_responsable: proveedor.persona_responsable || '',
      telefono: proveedor.telefono || '',
      contacto_proveedor: proveedor.persona_responsable || '',
      condiciones_pago: proveedor.condiciones_pago || '',
      banco: proveedor.banco || '',
      id_moneda: idMoneda > 0 ? idMoneda : '',
      moneda: proveedor.moneda_nombre || proveedor.moneda || '',
      numero_cuenta: proveedor.numero_cuenta || '',
      cuenta: proveedor.numero_cuenta || '',
      cci: proveedor.cci || '',
      retencion: proveedor.retencion || '',
      descuento: proveedor.descuento || '',
      tipo: proveedor.tipo || '',
      tipo_retencion:
        ['RETENCION', 'DETRACCION'].includes(normalize(proveedor.tipo_retencion || ''))
          ? normalize(proveedor.tipo_retencion)
          : 'RETENCION',
    })

    setSupplierOptionsByCompra((prev) => ({ ...prev, [compraId]: [] }))
  }

  const searchProveedor = async (compraId, rawValue) => {
    const value = String(rawValue || '')
    updateForm(compraId, { proveedor: value, id_proveedor: '' })

    if (!value.trim()) {
      setSupplierOptionsByCompra((prev) => ({ ...prev, [compraId]: [] }))
      return
    }

    try {
      setSupplierLoadingByCompra((prev) => ({ ...prev, [compraId]: true }))
      const options = await fetchProveedores(value.trim())
      setSupplierOptionsByCompra((prev) => ({ ...prev, [compraId]: options }))

      const byExactRuc = options.find((provider) => String(provider.ruc || '').trim() === value.trim())
      if (byExactRuc) {
        applyProveedor(compraId, byExactRuc)
      }
    } catch (err) {
      setError(err.message || 'Error al buscar proveedores')
    } finally {
      setSupplierLoadingByCompra((prev) => ({ ...prev, [compraId]: false }))
    }
  }

  const validateProviderData = (data) => {
    if (!data.id_proveedor) {
      return 'Debes seleccionar un proveedor existente de la lista.'
    }

    const missing = requiredProviderFields.filter((field) => !String(data[field] || '').trim())
    if (missing.length > 0) {
      return `Faltan datos del proveedor seleccionado: ${missing.join(', ')}`
    }

    if (!Number(data.id_moneda)) {
      return 'Debes seleccionar una moneda valida de la lista.'
    }

    const retencionNum = Number(data.descuento)
    if (!Number.isFinite(retencionNum) || retencionNum < 0) {
      return 'Retencion (%) debe ser numerica y mayor o igual a 0.'
    }

    const tipoRetencionNorm = normalize(data.tipo_retencion)
    if (!['RETENCION', 'DETRACCION'].includes(tipoRetencionNorm)) {
      return 'Tipo de retencion solo puede ser RETENCION o DETRACCION.'
    }

    if (Number(data.importe_final) < 0) {
      return 'Importe final no puede ser negativo.'
    }

    return ''
  }

  const saveDatos = async (compra) => {
    setError('')
    const data = getFormValue(compra)

    const providerValidation = validateProviderData(data)
    if (providerValidation) {
      setError(providerValidation)
      return false
    }

    try {
      setLoadingByCompra((prev) => ({ ...prev, [compra.id]: true }))
      const subtotal = Number(data.subtotal || 0)
      const igv = Number((subtotal * 0.18).toFixed(2))
      const costoEnvio = Number(data.costo_envio || 0)
      const otrosCostos = Number(data.otros_costos || 0)

      await onCompletarDatos(compra.id, {
        ...data,
        id_proveedor: Number(data.id_proveedor),
        id_moneda: Number(data.id_moneda),
        subtotal,
        costo_envio: costoEnvio,
        otros_costos: otrosCostos,
        igv,
        id_area_final: Number(data.id_area_final || compra.id_area_final || compra.id_area_solicitante || compra.id_area || 0) || null,
      })
      return true
    } catch (err) {
      setError(err.message || 'Error al guardar datos de compra')
      return false
    } finally {
      setLoadingByCompra((prev) => ({ ...prev, [compra.id]: false }))
    }
  }

  const generateOrden = async (compra) => {
    setError('')
    try {
      setLoadingByCompra((prev) => ({ ...prev, [compra.id]: true }))
      const saved = await saveDatos(compra)
      if (!saved) return
      await onGenerarOrden(compra.id)
    } catch (err) {
      setError(err.message || 'Error al generar orden de compra')
    } finally {
      setLoadingByCompra((prev) => ({ ...prev, [compra.id]: false }))
    }
  }

  const downloadPdf = async (compra) => {
    setError('')
    if (!onDescargarPdf) return

    try {
      setLoadingByCompra((prev) => ({ ...prev, [compra.id]: true }))
      await onDescargarPdf(compra.id)
    } catch (err) {
      setError(err.message || 'Error al descargar PDF de la orden')
    } finally {
      setLoadingByCompra((prev) => ({ ...prev, [compra.id]: false }))
    }
  }

  const toggleExpanded = (compraId) => {
    setExpandedByCompra((prev) => ({ ...prev, [compraId]: !prev[compraId] }))
  }

  const renderReadOnlyField = (label, value) => (
    <label>
      {label}
      <input value={value || ''} readOnly />
    </label>
  )

  const renderProviderSummary = (form) => (
    <div className="provider-summary full-row">
      <h4>Resumen del proveedor</h4>
      <p><strong>Proveedor:</strong> {form.proveedor || 'N/D'}</p>
      <p><strong>RUC:</strong> {form.ruc || 'N/D'}</p>
      <p><strong>Direccion:</strong> {form.direccion || 'N/D'}</p>
      <p><strong>Distrito:</strong> {form.distrito || 'N/D'}</p>
      <p><strong>Correo:</strong> {form.correo || 'N/D'}</p>
      <p><strong>Responsable:</strong> {form.persona_responsable || 'N/D'}</p>
      <p><strong>Telefono:</strong> {form.telefono || 'N/D'}</p>
      <p><strong>Banco:</strong> {form.banco || 'N/D'}</p>
      <p><strong>Cuenta:</strong> {form.numero_cuenta || 'N/D'}</p>
      <p><strong>CCI:</strong> {form.cci || 'N/D'}</p>
      <p><strong>Moneda:</strong> {form.moneda || 'N/D'}</p>
      <p><strong>Retencion:</strong> {normalize(form.retencion) === 'SI' ? 'SI' : 'NO'}</p>
      <p><strong>Porcentaje:</strong> {Number(form.descuento || 0).toFixed(2)}%</p>
      <p><strong>Tipo:</strong> {normalize(form.retencion) === 'SI' ? (form.tipo_retencion || 'RETENCION') : '-'}</p>
    </div>
  )

  const renderCostSummary = (form) => {
    const subtotal = Number(form.subtotal || 0)
    const igv = Number(form.igv || 0)
    const costoEnvio = Number(form.costo_envio || 0)
    const otrosCostos = Number(form.otros_costos || 0)
    const retencionFlag = normalize(form.retencion) === 'SI'
    const retencionPct = Number(form.descuento || 0)
    const retentionData = computeRetentionData({
      subtotal,
      igv,
      costoEnvio,
      otrosCostos,
      moneda: form.moneda,
      retencionFlag,
      retencionPct,
    })

    return (
      <div className="provider-summary full-row">
        <h4>Resumen de costos</h4>
        <p><strong>Subtotal:</strong> {Number(subtotal).toFixed(2)}</p>
        <p><strong>IGV:</strong> {Number(igv).toFixed(2)}</p>
        <p><strong>Costo envío:</strong> {Number(costoEnvio).toFixed(2)}</p>
        <p><strong>Otros costos:</strong> {Number(otrosCostos).toFixed(2)}</p>
        <p><strong>Total base:</strong> {Number(retentionData.totalBase).toFixed(2)}</p>
        <p><strong>Retención aplicada:</strong> {retentionData.aplicaRetencion ? 'SI' : 'NO'}</p>
        {retentionData.aplicaRetencion && <p><strong>Porcentaje:</strong> {retencionPct.toFixed(2)}%</p>}
        {retentionData.aplicaRetencion && <p><strong>Monto retenido:</strong> {retentionData.montoRetencion.toFixed(2)}</p>}
        <p><strong>TOTAL FINAL:</strong> {retentionData.totalFinal.toFixed(2)}</p>
      </div>
    )
  }

  return (
    <section className="my-po-section">
      <div className="section-header">
        <h1>Mis Ordenes de Compra</h1>
        <p>Total: {filtered.length}</p>
      </div>

      <div className="my-po-filters">
        <button type="button" className={activeFilter === 'APROBADAS' ? 'active' : ''} onClick={() => setActiveFilter('APROBADAS')}>
          Aprobadas
        </button>
        <button type="button" className={activeFilter === 'POR_RECIBIR' ? 'active' : ''} onClick={() => setActiveFilter('POR_RECIBIR')}>
          Pendientes de entrega
        </button>
        <button type="button" className={activeFilter === 'RECIBIDAS' ? 'active' : ''} onClick={() => setActiveFilter('RECIBIDAS')}>
          Recibidas
        </button>
      </div>

      {error && <p className="my-po-error">{error}</p>}

      {filtered.length === 0 ? (
        <div className="empty-state">No hay compras para este filtro.</div>
      ) : (
        <div className="my-po-list">
          {filtered.map((compra) => {
            const form = getFormValue(compra)
            const isEditable = normalize(compra.estado) === 'APROBADA'
            const isExpanded = Boolean(expandedByCompra[compra.id])
            const supplierOptions = supplierOptionsByCompra[compra.id] || []
            const materials = Array.isArray(compra.items) ? compra.items : []

            return (
              <article className="my-po-card" key={compra.id}>
                <div className="my-po-head">
                  <div>
                    <h3>Compra #{compra.id}</h3>
                    {compra.numero_orden && <p className="my-po-summary-line"><strong>OC:</strong> {compra.numero_orden}</p>}
                    <p className="my-po-summary-line"><strong>Area:</strong> {compra.area_solicitante || 'Sin area'}</p>
                    <p className="my-po-summary-line"><strong>Solicitante:</strong> {compra.usuario || 'Sin solicitante'}</p>
                    <p className="my-po-summary-line"><strong>Fecha:</strong> {compra.fecha_creacion ? new Date(compra.fecha_creacion).toLocaleString() : 'Sin fecha'}</p>
                  </div>
                  <span className={`my-po-status ${normalize(compra.estado).toLowerCase()}`}>{getStatusLabel(compra)}</span>
                </div>

                {normalize(compra.estado) === 'RECIBIDA' && compra.recibido_por && (
                  <p><strong>Recibido por:</strong> {compra.recibido_por}</p>
                )}

                <div className="my-po-card-actions">
                  <button type="button" className="btn-detail" onClick={() => toggleExpanded(compra.id)}>
                    {isExpanded ? 'Ocultar detalle' : 'Ver detalle'}
                  </button>
                </div>

                {isExpanded && (
                  <div className="my-po-edit-grid">
                    <div className="full-row">
                      <strong>Materiales:</strong>
                      <ul>
                        {materials.map((item) => (
                          <li key={`${compra.id}-${item.id_detalle || item.id || item.descripcion || item.material}`}>
                            {item.material || item.descripcion || 'Material'} - {item.cantidad}
                          </li>
                        ))}
                      </ul>
                    </div>

                    {isEditable ? (
                      <>
                        <label className="full-row supplier-field">
                          Proveedor (Razon social o RUC)
                          <input
                            value={form.proveedor}
                            onChange={(e) => searchProveedor(compra.id, e.target.value)}
                            placeholder="Escribe razon social o RUC"
                          />
                          {supplierLoadingByCompra[compra.id] && <small>Buscando proveedores...</small>}
                          {supplierOptions.length > 0 && (
                            <ul className="supplier-options">
                              {supplierOptions.map((provider) => (
                                <li key={`${compra.id}-supplier-${provider.id}`}>
                                  <button type="button" onClick={() => applyProveedor(compra.id, provider)}>
                                    <span>{provider.razon_social || 'Sin razon social'}</span>
                                    <small>{provider.ruc || 'Sin RUC'}</small>
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </label>

                        {renderProviderSummary(form)}
                        <label>
                          Subtotal
                          <input type="number" step="0.01" value={form.subtotal} onChange={(e) => updateForm(compra.id, { subtotal: e.target.value })} />
                        </label>
                        <label>
                          IGV
                          <input type="number" step="0.01" value={form.igv} readOnly />
                        </label>
                        <label>
                          Costo envio
                          <input type="number" step="0.01" value={form.costo_envio} onChange={(e) => updateForm(compra.id, { costo_envio: e.target.value })} />
                        </label>
                        <label>
                          Otros costos
                          <input type="number" step="0.01" value={form.otros_costos} onChange={(e) => updateForm(compra.id, { otros_costos: e.target.value })} />
                        </label>
                        <label>
                          Total
                          <input type="number" step="0.01" value={form.total} readOnly />
                        </label>

                        {renderCostSummary(form)}
                      </>
                    ) : (
                      <>
                        {renderProviderSummary(form)}
                        {renderReadOnlyField('Subtotal', form.subtotal || 0)}
                        {renderReadOnlyField('IGV', form.igv || 0)}
                        {renderReadOnlyField('Costo envio', form.costo_envio || 0)}
                        {renderReadOnlyField('Otros costos', form.otros_costos || 0)}
                        {renderReadOnlyField('Total', form.total || 0)}
                        {renderCostSummary(form)}
                        {renderReadOnlyField('Recibido por', form.recibido_por || compra.recibido_por || 'N/D')}
                        <div className="full-row">
                          <strong>Comentarios:</strong>
                          <p className="my-po-comments">{form.comentarios || 'Sin comentarios'}</p>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {isExpanded && isEditable && (
                  <div className="my-po-actions">
                    <button type="button" onClick={() => saveDatos(compra)} disabled={loadingByCompra[compra.id]}>
                      Guardar datos
                    </button>
                    <button type="button" className="btn-generate" onClick={() => generateOrden(compra)} disabled={loadingByCompra[compra.id]}>
                      Finalizar orden de compra
                    </button>
                  </div>
                )}

                {['POR_RECIBIR', 'RECIBIDA', 'RECIBIDO'].includes(normalize(compra.estado)) && (
                  <div className="my-po-actions">
                    <button type="button" className="btn-download" onClick={() => downloadPdf(compra)} disabled={loadingByCompra[compra.id]}>
                      Descargar PDF
                    </button>
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
