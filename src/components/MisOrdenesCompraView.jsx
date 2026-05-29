import { useEffect, useMemo, useState } from 'react'
import '../styles/MisOrdenesCompraView.css'
import {
  fetchProveedores,
  fetchReceptoresByCompra,
  guardarCalificacionProveedor,
  marcarRecibidoEnAlmacen,
} from '../services/api'
import { hasPermission } from '../services/permissions'
import { evaluateProviderRatingState } from '../services/providerRatingRules'

const normalize = (value) => String(value || '').trim().toUpperCase()

const normalizeText = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toUpperCase()

const isRetentionEnabled = (value) => {
  if (typeof value === 'boolean') return value
  return normalize(value) === 'SI'
}

const getStageStatus = (compra) => {
  const userStage = normalize(compra?.gestion_estado_usuario)
  if (userStage) return userStage
  return normalize(compra?.estado_pedido || compra?.estado)
}

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
  detalle: '',
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
  const monedaNorm = normalizeText(moneda)
  const isUsd = /USD|DOLAR|DOLARES|US\$/.test(monedaNorm)
  const isPen = /PEN|SOL|SOLES/.test(monedaNorm)
  const totalSoles = isUsd ? Number((totalBase * 3.5).toFixed(2)) : totalBase
  const superaUmbral = (isPen && totalBase > 700) || (isUsd && totalSoles > 700)
  const providerAllowsRetention = Boolean(retencionFlag) && Number.isFinite(retencionPct) && retencionPct > 0
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
  currentUserRoleId,
  currentUserPermissions = [],
  onCompletarDatos,
  onGenerarOrden,
  onDescargarPdf,
  onMarcarRecibidoAlmacen,
  onMarcarEntregado,
  onAgregarComentario,
}) {
  const defaultFilter = hasPermission(currentUserPermissions, 'GESTIONAR_ENTREGAS')
    ? 'PENDIENTE_ENTREGA'
    : hasPermission(currentUserPermissions, 'GESTIONAR_COMPRAS')
      ? 'APROBADAS'
      : 'POR_RECIBIR'
  const [activeFilter, setActiveFilter] = useState(defaultFilter)
  const [error, setError] = useState('')
  const [loadingByCompra, setLoadingByCompra] = useState({})
  const [formsByCompra, setFormsByCompra] = useState({})
  const [expandedByCompra, setExpandedByCompra] = useState({})
  const [supplierOptionsByCompra, setSupplierOptionsByCompra] = useState({})
  const [supplierLoadingByCompra, setSupplierLoadingByCompra] = useState({})
  const [receptorQueryByCompra, setReceptorQueryByCompra] = useState({})
  const [receptorOptionsByCompra, setReceptorOptionsByCompra] = useState({})
  const [receptorLoadingByCompra, setReceptorLoadingByCompra] = useState({})
  const [receptorSelectedByCompra, setReceptorSelectedByCompra] = useState({})
  const [entregaFlowOpenByCompra, setEntregaFlowOpenByCompra] = useState({})
  const [commentDraftByCompra, setCommentDraftByCompra] = useState({})
  const [commentStatusByCompra, setCommentStatusByCompra] = useState({})
  const [ratingCompra, setRatingCompra] = useState(null)
  const [ratingForm, setRatingForm] = useState({ puntuacion: 5, comentario: '' })
  const [ratingSaving, setRatingSaving] = useState(false)
  const [ratingError, setRatingError] = useState('')
  const [ratingNotice, setRatingNotice] = useState('')
  const currentUserId = useMemo(() => Number(localStorage.getItem('userId') || 0), [])
  const canRateProviders = hasPermission(currentUserPermissions, 'CALIFICAR_COMPRA')
    || hasPermission(currentUserPermissions, 'CALIFICAR_REQUERIMIENTO')
  const canSeeCriticalAlert = hasPermission(currentUserPermissions, 'GESTIONAR_COMPRAS')

  useEffect(() => {
    setActiveFilter(defaultFilter)
  }, [defaultFilter])

  const normalize = (value) => String(value || '').trim().toUpperCase()
  const getReceptorPhotoSrc = (receptor) => {
    const raw = String(receptor?.imagen || receptor?.foto || '').trim()
    if (!raw) return ''
    if (raw.startsWith('data:image/')) return raw
    if (raw.startsWith('http://') || raw.startsWith('https://')) return raw
    return `data:image/png;base64,${raw}`
  }

  const filtered = useMemo(() => {
  return (compras || []).filter((compra) => {
    const estado = normalize(compra.estado_pedido || compra.estado)

    if (activeFilter === 'APROBADAS') {
      return ['APROBADA', 'APROBADO'].includes(estado)
    }

    if (activeFilter === 'POR_RECIBIR') {
      return estado === 'POR_RECIBIR'
    }

    if (activeFilter === 'PENDIENTE_ENTREGA') {
      return estado === 'PENDIENTE_ENTREGA'
    }

    // Removed 'RECIBIDO_EN_ALMACEN' because it duplicated 'PENDIENTE_ENTREGA'

    if (activeFilter === 'ENTREGADO') {
      return estado === 'ENTREGADO'
    }

    return true
  })
}, [activeFilter, compras])

  const getStatusLabel = (compra) => {
    if (String(compra?.estado_aprobacion_detalle || '').trim()) {
      return compra.estado_aprobacion_detalle
    }

    const estado = compra?.estado_pedido || compra?.estado
    const normalized = normalize(estado)
    if (normalized === 'POR_RECIBIR') return 'POR RECIBIR'
    if (normalized === 'RECIBIDO_EN_ALMACEN') return 'RECIBIDO EN ALMACEN'
    if (normalized === 'PENDIENTE_ENTREGA') return 'PENDIENTE ENTREGA'
    if (normalized === 'RECIBIDA' || normalized === 'RECIBIDO') return 'RECIBIDA'
    if (normalized === 'ENTREGADO') return 'ENTREGADO'
    if (normalized === 'APROBADA' || normalized === 'APROBADO') return 'APROBADA'
    return estado || 'N/D'
  }

  const getFormValue = (compra) => {
    const baseForm = {
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
      detalle: compra.detalle || '',
      recibido_por: compra.recibido_por || '',
      id_area_final: compra.id_area_final || compra.id_area_solicitante || '',
      calificacion_promedio: Number(compra.calificacion_promedio || 0) || 0,
      calificacion_total: Number(compra.calificacion_total || 0) || 0,
      alerta_cambio_proveedor: Boolean(compra.alerta_cambio_proveedor),
      alerta_critica: Boolean(compra.alerta_critica),
    }

    const previous = formsByCompra[compra.id]
    if (!previous) return baseForm

    return {
      ...baseForm,
      ...previous,
      moneda: previous.moneda || baseForm.moneda,
      retencion: previous.retencion || baseForm.retencion,
      descuento: previous.descuento || baseForm.descuento,
      aplica_retencion: typeof previous.aplica_retencion === 'boolean' ? previous.aplica_retencion : baseForm.aplica_retencion,
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
      calificacion_promedio: Number(proveedor.calificacion_promedio || 0) || 0,
      calificacion_total: Number(proveedor.calificacion_total || 0) || 0,
      alerta_cambio_proveedor: Boolean(proveedor.alerta_cambio_proveedor),
      alerta_critica: Boolean(proveedor.alerta_critica),
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

  const handleMarcarRecibidoAlmacen = async (compra) => {
    setError('')
    setRatingNotice('')
    try {
      setLoadingByCompra((prev) => ({ ...prev, [compra.id]: true }))
      if (onMarcarRecibidoAlmacen) {
        await onMarcarRecibidoAlmacen(compra.id)
      } else {
        await marcarRecibidoEnAlmacen(compra.id)
      }
      setRatingNotice('Recepcion registrada. La calificacion del proveedor se realiza desde Movimientos > Entradas.')
    } catch (err) {
      setError(err.message || 'Error al marcar compra como recibida en almacen')
    } finally {
      setLoadingByCompra((prev) => ({ ...prev, [compra.id]: false }))
    }
  }

  const canMarcarRecibidoAlmacen = (compra) => {
    const estado = normalize(compra.estado)
    return estado === 'POR_RECIBIR'
  }

  const canMarcarEntregado = (compra) => {
    const estado = normalize(compra.estado)
    if (estado !== 'RECIBIDO_EN_ALMACEN' && estado !== 'PENDIENTE_ENTREGA') return false

    const idAreaFinal = Number(compra.id_area_final || 0)
    const idAreaSolicitante = Number(compra.id_area_solicitante || 0)
    const isGeneralDestination = idAreaFinal === 0 || idAreaFinal === idAreaSolicitante

    return !isGeneralDestination
  }

  const searchReceptoresCompra = async (compraId, rawQuery) => {
    const query = String(rawQuery || '')
    setReceptorQueryByCompra((prev) => ({ ...prev, [compraId]: query }))

    const selected = receptorSelectedByCompra[compraId]
    const selectedLabel = selected ? `${selected.nombre || ''} - DNI ${selected.dni || ''}`.trim() : ''
    if (!selected || normalize(selectedLabel) !== normalize(query)) {
      setReceptorSelectedByCompra((prev) => ({ ...prev, [compraId]: null }))
    }

    if (!query.trim()) {
      setReceptorOptionsByCompra((prev) => ({ ...prev, [compraId]: [] }))
      return
    }

    try {
      setReceptorLoadingByCompra((prev) => ({ ...prev, [compraId]: true }))
      const options = await fetchReceptoresByCompra(compraId, query.trim())
      setReceptorOptionsByCompra((prev) => ({ ...prev, [compraId]: Array.isArray(options) ? options : [] }))
    } catch (err) {
      setError(err.message || 'Error al buscar receptor por DNI')
      setReceptorOptionsByCompra((prev) => ({ ...prev, [compraId]: [] }))
    } finally {
      setReceptorLoadingByCompra((prev) => ({ ...prev, [compraId]: false }))
    }
  }

  const selectReceptorCompra = (compraId, receptor) => {
    const label = String(receptor.nombre || '').trim()
    setReceptorSelectedByCompra((prev) => ({ ...prev, [compraId]: receptor }))
    setReceptorQueryByCompra((prev) => ({ ...prev, [compraId]: label }))
    setReceptorOptionsByCompra((prev) => ({ ...prev, [compraId]: [] }))
  }

  const openEntregaFlow = (compraId) => {
    setEntregaFlowOpenByCompra((prev) => ({ ...prev, [compraId]: true }))
  }

  const closeEntregaFlow = (compraId) => {
    setEntregaFlowOpenByCompra((prev) => ({ ...prev, [compraId]: false }))
    setReceptorOptionsByCompra((prev) => ({ ...prev, [compraId]: [] }))
  }

  const handleMarcarEntregado = async (compra) => {
    setError('')
    const receptor = receptorSelectedByCompra[compra.id]
    const receptorUserId = Number(receptor?.id || 0)
    const receptorDni = String(receptor?.dni || '').trim()
    if (!receptorUserId) {
      setError('Debes seleccionar un receptor valido (DNI) para marcar como entregado')
      return
    }
    if (!receptorDni) {
      setError('Debes seleccionar un receptor con DNI valido para marcar como entregado')
      return
    }

    try {
      setLoadingByCompra((prev) => ({ ...prev, [compra.id]: true }))
      if (onMarcarEntregado) {
        await onMarcarEntregado(compra.id, receptorUserId)
      }
    } catch (err) {
      setError(err.message || 'Error al marcar compra como entregada')
    } finally {
      setLoadingByCompra((prev) => ({ ...prev, [compra.id]: false }))
    }
  }

  const handleAgregarComentario = async (compra) => {
    const contenido = String(commentDraftByCompra[compra.id] || '').trim()
    if (!contenido) {
      setCommentStatusByCompra((prev) => ({ ...prev, [compra.id]: { type: 'error', message: 'Escribe un comentario antes de enviar' } }))
      return
    }

    try {
      setCommentStatusByCompra((prev) => ({ ...prev, [compra.id]: { type: 'info', message: 'Enviando comentario...' } }))
      setLoadingByCompra((prev) => ({ ...prev, [compra.id]: true }))
      if (onAgregarComentario) {
        await onAgregarComentario(compra.id, contenido)
      }
      setCommentDraftByCompra((prev) => ({ ...prev, [compra.id]: '' }))
      setCommentStatusByCompra((prev) => ({ ...prev, [compra.id]: { type: 'success', message: 'Comentario enviado' } }))
    } catch (err) {
      setCommentStatusByCompra((prev) => ({
        ...prev,
        [compra.id]: { type: 'error', message: err.message || 'Error al agregar comentario' },
      }))
    } finally {
      setLoadingByCompra((prev) => ({ ...prev, [compra.id]: false }))
    }
  }

  const closeRatingModal = () => {
    if (ratingSaving) return
    setRatingCompra(null)
    setRatingError('')
    setRatingForm({ puntuacion: 5, comentario: '' })
  }

  const submitPurchaseRating = async (event) => {
    event.preventDefault()
    if (!ratingCompra) return
    if (!canRateProviders) {
      setRatingError('No autorizado para calificar proveedores')
      return
    }

    const proveedorId = Number(ratingCompra.id_proveedor || 0)
    const score = Number(ratingForm.puntuacion || 0)
    if (!proveedorId) {
      setRatingError('No se pudo resolver el proveedor de esta compra')
      return
    }
    if (!Number.isInteger(score) || score < 1 || score > 5) {
      setRatingError('Selecciona una puntuacion entre 1 y 5')
      return
    }

    try {
      setRatingSaving(true)
      setRatingError('')
      await guardarCalificacionProveedor(proveedorId, {
        tipo: 'compra',
        id_referencia: Number(ratingCompra.id || 0),
        puntuacion: score,
        comentario: String(ratingForm.comentario || '').trim(),
      })
      setRatingNotice('Calificacion guardada correctamente')
      closeRatingModal()
    } catch (err) {
      const message = err.message || 'Error al guardar la calificacion'
      if (String(message).toLowerCase().includes('ya calificaste')) {
        closeRatingModal()
        setRatingNotice('Ya calificaste este proveedor')
      } else {
        setRatingError(message)
      }
    } finally {
      setRatingSaving(false)
    }
  }

  const renderReadOnlyField = (label, value) => (
    <label>
      {label}
      <input value={value || ''} readOnly />
    </label>
  )

  const renderProviderSummary = (form) => (
    (() => {
      const ratingState = evaluateProviderRatingState({
        promedio: form.calificacion_promedio,
        total: form.calificacion_total,
        alertaCritica: form.alerta_critica,
      })

      return (
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
          <p><strong>Estado proveedor:</strong> {ratingState.averageLabel}</p>
          <p className="my-po-provider-state-row"><span className={`my-po-provider-state-chip ${ratingState.colorClass}`}>{ratingState.label}</span></p>
          <p><strong>Retencion:</strong> {isRetentionEnabled(form.retencion) ? 'SI' : 'NO'}</p>
          <p><strong>Porcentaje:</strong> {Number(form.descuento || 0).toFixed(2)}%</p>
          <p><strong>Tipo:</strong> {isRetentionEnabled(form.retencion) ? (form.tipo_retencion || 'RETENCION') : '-'}</p>
          {ratingState.showLowAlert && <p className="my-po-alert-warning"><strong>Alerta:</strong> Se recomienda evaluar cambio de proveedor</p>}
          {canSeeCriticalAlert && ratingState.showCriticalAlert && <p className="my-po-alert-critical"><strong>Alerta critica:</strong> Proveedor con calificacion critica, se recomienda contactar</p>}
        </div>
      )
    })()
  )

  const renderCostSummary = (form) => {
    const subtotal = Number(form.subtotal || 0)
    const igv = Number(form.igv || 0)
    const costoEnvio = Number(form.costo_envio || 0)
    const otrosCostos = Number(form.otros_costos || 0)
    const retencionFlag = isRetentionEnabled(form.retencion)
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

    // Debug logs
    console.log('[RETENTION DEBUG]', {
      'form.retencion (VARCHAR SI/NO)': form.retencion,
      'form.descuento (%)': form.descuento,
      'form.moneda': form.moneda,
      'form.subtotal': subtotal,
      'form.igv': igv,
      'form.costo_envio': costoEnvio,
      'form.otros_costos': otrosCostos,
      'retencionFlag (is SI?)': retencionFlag,
      'retencionPct': retencionPct,
      'totalBase': retentionData.totalBase,
      'isUsd': /USD|US\$|\$|DOL|DÓLAR|DOLAR/.test(String(form.moneda || '').toUpperCase()),
      'isPen': /PEN|SOL/.test(String(form.moneda || '').toUpperCase()),
      'aplicaRetencion (RESULT)': retentionData.aplicaRetencion,
    })

    return (
      <div className="provider-summary full-row">
        <h4>Resumen de costos</h4>
        <p><strong>Subtotal:</strong> {Number(subtotal).toFixed(2)}</p>
        <p><strong>IGV:</strong> {Number(igv).toFixed(2)}</p>
        <p><strong>Costo envío:</strong> {Number(costoEnvio).toFixed(2)}</p>
        <p><strong>Otros costos:</strong> {Number(otrosCostos).toFixed(2)}</p>
        <p><strong>Total base:</strong> {Number(retentionData.totalBase).toFixed(2)}</p>
        <p><strong>Retencion Aplicada:</strong> {retentionData.aplicaRetencion ? 'SI' : 'NO'}</p>
        {retentionData.aplicaRetencion && <p><strong>Porcentaje:</strong> {retencionPct.toFixed(2)}%</p>}
        {retentionData.aplicaRetencion && <p><strong>Monto retenido:</strong> {retentionData.montoRetencion.toFixed(2)}</p>}
        <p><strong>TOTAL FINAL:</strong> {retentionData.totalFinal.toFixed(2)}</p>
      </div>
    )
  }

  return (
    <section className="my-po-section">
      <div className="section-header">
        <h1>Mis ordenes de compra</h1>
        <p>Total: {filtered.length}</p>
      </div>

      <div className="my-po-filters">
        <button type="button" className={activeFilter === 'APROBADAS' ? 'active' : ''} onClick={() => setActiveFilter('APROBADAS')}>
          Aprobadas
        </button>
        <button type="button" className={activeFilter === 'POR_RECIBIR' ? 'active' : ''} onClick={() => setActiveFilter('POR_RECIBIR')}>
          Por recibir
        </button>
        <button type="button" className={activeFilter === 'PENDIENTE_ENTREGA' ? 'active' : ''} onClick={() => setActiveFilter('PENDIENTE_ENTREGA')}>
          Pendiente entrega
        </button>
        <button type="button" className={activeFilter === 'ENTREGADO' ? 'active' : ''} onClick={() => setActiveFilter('ENTREGADO')}>
          Entregado
        </button>
      </div>

      {error && <p className="my-po-error">{error}</p>}
      {ratingNotice ? <p className="my-po-comment-feedback success">{ratingNotice}</p> : null}

      {filtered.length === 0 ? (
        <div className="empty-state">No hay compras para este filtro.</div>
      ) : (
        <div className="my-po-list">
          {filtered.map((compra) => {
            const form = getFormValue(compra)
            const estadoNorm = normalize(compra.estado).toUpperCase()
            const isPorRecibir = estadoNorm === 'POR_RECIBIR' || estadoNorm === 'POR RECIBIR' || compra.estado === 'POR_RECIBIR'
            const stageStatus = getStageStatus(compra)
            const isEditable = !isPorRecibir && ['APROBADA', 'APROBADO'].includes(stageStatus)
            const isExpanded = Boolean(expandedByCompra[compra.id])
            const supplierOptions = supplierOptionsByCompra[compra.id] || []
            const materials = Array.isArray(compra.items) ? compra.items : []
            const isEntregaFlowOpen = Boolean(entregaFlowOpenByCompra[compra.id])
            const selectedReceptor = receptorSelectedByCompra[compra.id]

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
                  {canMarcarEntregado(compra) && (
                    !isEntregaFlowOpen ? (
                      <button
                        type="button"
                        className="btn-generate"
                        onClick={() => openEntregaFlow(compra.id)}
                        disabled={loadingByCompra[compra.id]}
                      >
                        Marcar como entregado
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="btn-generate"
                          onClick={() => handleMarcarEntregado(compra)}
                          disabled={loadingByCompra[compra.id]}
                        >
                          Confirmar entrega
                        </button>
                        <button
                          type="button"
                          className="btn-detail"
                          onClick={() => closeEntregaFlow(compra.id)}
                          disabled={loadingByCompra[compra.id]}
                        >
                          Cancelar
                        </button>
                      </>
                    )
                  )}
                  <button type="button" className="btn-detail" onClick={() => toggleExpanded(compra.id)}>
                    {isExpanded ? 'Ocultar detalle' : 'Ver detalle'}
                  </button>
                  {activeFilter !== 'APROBADAS' && onDescargarPdf && (
                    <button
                      type="button"
                      className="btn-download"
                      onClick={() => downloadPdf(compra)}
                      disabled={loadingByCompra[compra.id]}
                    >
                      Descargar orden
                    </button>
                  )}
                </div>

                {canMarcarEntregado(compra) && isEntregaFlowOpen && (
                  <div className="my-po-actions">
                    <label className="full-row supplier-field">
                      Receptor (nombre o DNI)
                      <input
                        value={receptorQueryByCompra[compra.id] || ''}
                        onChange={(event) => searchReceptoresCompra(compra.id, event.target.value)}
                        placeholder="Buscar receptor por nombre o DNI"
                      />
                      {receptorLoadingByCompra[compra.id] && <small>Buscando receptor...</small>}
                      {(receptorOptionsByCompra[compra.id] || []).length > 0 && (
                        <ul className="supplier-options">
                          {(receptorOptionsByCompra[compra.id] || []).map((receptor) => (
                            <li key={`${compra.id}-receptor-${receptor.id}`}>
                              <button type="button" onClick={() => selectReceptorCompra(compra.id, receptor)}>
                                <span>{`${receptor.nombre || 'Sin nombre'} - DNI ${receptor.dni || 'N/D'}`}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </label>

                    {selectedReceptor && (
                      <div className="receptor-selected-card full-row">
                        {getReceptorPhotoSrc(selectedReceptor) ? (
                          <img
                            className="receptor-selected-photo"
                            src={getReceptorPhotoSrc(selectedReceptor)}
                            alt={selectedReceptor?.nombre || 'Receptor'}
                          />
                        ) : (
                          <div className="receptor-selected-photo receptor-selected-photo-placeholder">?</div>
                        )}
                        <div className="receptor-selected-meta">
                          <strong>{selectedReceptor?.nombre || 'Sin nombre'}</strong>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {isExpanded && (
                  <div className="my-po-edit-grid">
                    <div className="full-row">
                      <strong>Materiales:</strong>
                      <ul>
                        {materials.map((item) => (
                          <li key={`${compra.id}-${item.id_detalle || item.id || item.descripcion || item.material}`}>
                            {item.material_solicitado || item.material || item.descripcion || 'Material'} - {item.cantidad}
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
                        <label className="full-row">
                          Detalles (opcional)
                          <textarea
                            value={form.detalle}
                            onChange={(e) => updateForm(compra.id, { detalle: e.target.value })}
                            placeholder="Agregar observaciones o detalles sobre la orden"
                            rows={3}
                          />
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
                          <strong>Detalles:</strong>
                          <p className="my-po-comments">{form.detalle || 'Sin detalles'}</p>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {isExpanded && isEditable && normalize(compra.estado) !== 'POR_RECIBIR' && (
                  <div className="my-po-actions">
                    <button type="button" onClick={() => saveDatos(compra)} disabled={loadingByCompra[compra.id]}>
                      Guardar datos
                    </button>
                    <button type="button" className="btn-generate" onClick={() => generateOrden(compra)} disabled={loadingByCompra[compra.id]}>
                      Finalizar orden de compra
                    </button>
                  </div>
                )}

              </article>
            )
          })}
        </div>
      )}

      {ratingCompra && (
        <div className="provider-modal-backdrop" onClick={closeRatingModal}>
          <div className="provider-modal provider-rating-modal" onClick={(event) => event.stopPropagation()}>
            <div className="provider-modal-head">
              <h2>Calificar proveedor</h2>
              <button type="button" onClick={closeRatingModal} disabled={ratingSaving}>×</button>
            </div>
            <div className="provider-rating-header">
              <h3>{ratingCompra.proveedor || 'Proveedor'}</h3>
              <p>Completa una calificación breve después de recibir la compra.</p>
            </div>

            {ratingError ? <p className="providers-error">{ratingError}</p> : null}

            <form className="provider-rating-form" onSubmit={submitPurchaseRating}>
              <div className="provider-rating-stars-picker" aria-label="Selecciona puntuacion">
                {[1, 2, 3, 4, 5].map((score) => (
                  <button
                    key={score}
                    type="button"
                    className={`rating-star-btn ${Number(ratingForm.puntuacion || 0) >= score ? 'active' : ''}`}
                    onClick={() => setRatingForm((prev) => ({ ...prev, puntuacion: score }))}
                    disabled={ratingSaving}
                  >
                    ★
                  </button>
                ))}
              </div>

              <label>
                Puntuacion
                <select
                  value={ratingForm.puntuacion}
                  onChange={(event) => setRatingForm((prev) => ({ ...prev, puntuacion: Number(event.target.value) }))}
                  disabled={ratingSaving}
                >
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                  <option value={3}>3</option>
                  <option value={4}>4</option>
                  <option value={5}>5</option>
                </select>
              </label>

              <label>
                Comentario
                <textarea
                  value={ratingForm.comentario}
                  onChange={(event) => setRatingForm((prev) => ({ ...prev, comentario: event.target.value }))}
                  placeholder="Comentario opcional"
                  rows={4}
                  disabled={ratingSaving}
                />
              </label>

              <div className="provider-modal-actions">
                <button type="button" onClick={closeRatingModal} disabled={ratingSaving}>Omitir</button>
                <button type="submit" disabled={ratingSaving}>{ratingSaving ? 'Guardando...' : 'Guardar calificacion'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  )
}
