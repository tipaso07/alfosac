import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import '../styles/InventoryDashboard.css'
import Header from './Header'
import Sidebar from './Sidebar'
import ProductList from './ProductList'
import AddProductForm from './AddProductForm'
import SolicitarCompraForm from './SolicitarCompraForm'
import SolicitarServicioForm from './SolicitarServicioForm'
import GestionarComprasView from './GestionarComprasView'
import GestionarServiciosView from './GestionarServiciosView'
import GestionarProveedoresView from './GestionarProveedoresView'
import DeliveryManager from './DeliveryManager'
import MisOrdenesCompraView from './MisOrdenesCompraView'
import MisOrdenesServiciosView from './MisOrdenesServiciosView'
import MovimientosView from './MovimientosView'
import AjustesView from './AjustesView'
import AdminDashboardView from './AdminDashboardView'
import HistorialServiciosView from './HistorialServiciosView'
import NotificationsView from './NotificationsView'
import RolesPermissionsView from './RolesPermissionsView'
import GestionarUsuariosView from './GestionarUsuariosView'
import CalificarMaterialesView from './CalificarMaterialesView'
import { buildAllowedModules, buildAllowedTabs, modules, TAB_BY_MODULE_ID } from '../services/moduleAccess'
import { hasAnyPermission, hasPermission } from '../services/permissions'
import {
  createMaterial,
  fetchMateriales,
  fetchAlmacenes,
  fetchStats,
  createRequerimiento,
  createCompra,
  fetchCompras,
  fetchMisCompras,
  fetchMisServicios,
  fetchMisRequerimientos,
  fetchRequerimientos,
  fetchServicios,
  fetchMovimientos,
  createServicio,
  updateCompraEstado,
  updateServicioAprobacion,
  updateServicioEstado,
  completarServicioDatos,
  generarOrdenServicio,
  descargarOrdenServicioPdf,
  completarCompraDatos,
  generarOrdenCompra,
  descargarOrdenCompraPdf,
  confirmarRecepcionCompra,
  confirmarEntregaAreaCompra,
  marcarRecibidoEnAlmacen,
  updateRequerimientoEntrega,
  fetchCurrentUser,
  fetchCategorias,
  fetchMonedas,
  fetchProveedores,
  fetchUnidades,
  updateMaterial,
  uploadMaterialImage,
  updateCurrentUserPhoto,
  fetchAdminDashboard,
  agregarComentarioRequerimiento,
  agregarComentarioCompra,
  agregarComentarioServicio,
} from '../services/api'

const TAB_ROUTES = {
  'admin-dashboard': '/dashboard',
  materials: '/inventario',
  'request-material': '/requerimiento',
  'request-purchase': '/compra',
  'request-service': '/servicio',
  'manage-requests': '/gestionar',
  'my-purchase-orders': '/mis-compras',
  'manage-delivery': '/entregas',
  'services-history': '/historial-servicios',
  movements: '/movimientos',
  'manage-providers': '/proveedores',
  settings: '/ajustes',
  notifications: '/notificaciones',
  'roles-permissions': '/roles-permisos',
  'manage-accounts': '/gestionar-cuentas',
  'rate-products': '/calificar-productos',
}

const getDefaultAdminDashboardRange = () => {
  const today = new Date()
  const start = new Date(today)
  start.setDate(today.getDate() - 30)

  const formatDate = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

  return {
    fecha_inicio: formatDate(start),
    fecha_fin: formatDate(today),
  }
}

export default function InventoryDashboard({ initialTab = 'materials', onLogout, onAuthExpired }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [materials, setMaterials] = useState([])
  const [_stats, setStats] = useState({
    total_materiales: 0,
    stock_total: 0,
    pendientes: 0,
    completados: 0,
  })
  const [activeTab, setActiveTab] = useState(initialTab)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterWarehouse, setFilterWarehouse] = useState('Todos')
  const [requerimientos, setRequerimientos] = useState([])
  const [compras, setCompras] = useState([])
  const [misCompras, setMisCompras] = useState([])
  const [movimientos, setMovimientos] = useState([])
  const [servicios, setServicios] = useState([])
  const [misServicios, setMisServicios] = useState([])
  const [currentUserName, setCurrentUserName] = useState('')
  const [currentUserArea, setCurrentUserArea] = useState('')
  const [currentUserAreaId, setCurrentUserAreaId] = useState(null)
  const [currentUserRoleId, setCurrentUserRoleId] = useState(null)
  const [currentUserProfile, setCurrentUserProfile] = useState(null)
  const [categorias, setCategorias] = useState([])
  const [monedas, setMonedas] = useState([])
  const [proveedores, setProveedores] = useState([])
  const [unidades, setUnidades] = useState([])
  const [almacenes, setAlmacenes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activeRequestsView, setActiveRequestsView] = useState('compras')
  const [activeOrdersView, setActiveOrdersView] = useState('compras')
  const [adminDashboardData, setAdminDashboardData] = useState(null)
  const [adminDashboardLoading, setAdminDashboardLoading] = useState(false)
  const initialAdminDashboardRange = useMemo(() => getDefaultAdminDashboardRange(), [])
  const [adminDashboardDateRange, setAdminDashboardDateRange] = useState(initialAdminDashboardRange)

  const isUnauthorizedError = useCallback((err) => Number(err?.status || 0) === 401, [])
  const isForbiddenError = useCallback((err) => Number(err?.status || 0) === 403, [])
  const currentUserPermissions = useMemo(() => {
    return Array.isArray(currentUserProfile?.permisos)
      ? currentUserProfile.permisos
      : []
  }, [currentUserProfile])
  const allowedModules = useMemo(() => {
    return buildAllowedModules(currentUserRoleId, currentUserPermissions)
  }, [currentUserPermissions, currentUserRoleId])
  const visibleModules = useMemo(() => {
    return modules.filter((mod) => allowedModules.includes(mod.id))
  }, [allowedModules])
  const allowedTabs = useMemo(() => buildAllowedTabs(currentUserRoleId, currentUserPermissions), [currentUserPermissions, currentUserRoleId])
  const canReturnHomeFromError = useMemo(() => String(error || '').toLowerCase().includes('no autorizado'), [error])
  const canEditMaterials = hasPermission(currentUserPermissions, 'EDITAR_INVENTARIO')
  const canAddManualInventory = hasPermission(currentUserPermissions, 'AGREGAR_INVENTARIO_MANUAL')
  const canManageServiceApprovals = useMemo(() => {
    return hasAnyPermission(currentUserPermissions, [
      'APROBAR_JEFE_AREA',
      'APROBAR_GERENCIA_AREA',
      'APROBAR_FINANZAS',
      'APROBAR_ADMIN',
    ])
  }, [currentUserPermissions])

  const loadOptionalData = useCallback(async (loader, fallbackValue) => {
    try {
      return await loader()
    } catch (err) {
      if (isUnauthorizedError(err)) throw err
      if (isForbiddenError(err)) return fallbackValue
      throw err
    }
  }, [isUnauthorizedError, isForbiddenError])

  useEffect(() => {
    setActiveTab(initialTab)
  }, [initialTab])

  useEffect(() => {
    const targetPath = TAB_ROUTES[activeTab]
    if (targetPath && location.pathname !== targetPath) {
      navigate(targetPath, { replace: true })
    }
  }, [activeTab, location.pathname, navigate])

  useEffect(() => {
    if (!allowedTabs.includes(activeTab)) {
      setActiveTab(allowedTabs[0] || 'materials')
    }
  }, [activeTab, allowedTabs])

  useEffect(() => {
    if (!canManageServiceApprovals && activeRequestsView === 'servicios') {
      setActiveRequestsView('compras')
    }
  }, [activeRequestsView, canManageServiceApprovals])

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const currentUser = await fetchCurrentUser()
      setCurrentUserProfile(currentUser || null)
      setCurrentUserName(currentUser?.nombre || 'Usuario')
      setCurrentUserArea(currentUser?.area || 'Sin area')
      setCurrentUserAreaId(Number(currentUser?.id_area || 0) || null)
      const roleId = Number(currentUser?.rol_id ?? currentUser?.id_role ?? 0)
      const runtimePermissions = Array.isArray(currentUser?.permisos) ? currentUser.permisos : []
      console.log('Rol usuario:', currentUser?.rol_id ?? currentUser?.id_role)
      setCurrentUserRoleId(Number.isFinite(roleId) && roleId > 0 ? roleId : null)

      const [
        materialsData,
        statsData,
        adminDashboardDataResp,
        reqsData,
        comprasData,
        misComprasData,
        serviciosData,
        misServiciosData,
        movsData,
        categoriasData,
        monedasData,
        proveedoresData,
        unidadesData,
        almacenesData,
      ] = await Promise.all([
        hasPermission(runtimePermissions, 'VER_INVENTARIO')
          ? loadOptionalData(fetchMateriales, [])
          : Promise.resolve([]),
        loadOptionalData(fetchStats, {
          total_materiales: 0,
          stock_total: 0,
          pendientes: 0,
          completados: 0,
        }),
        hasPermission(runtimePermissions, 'APROBAR_ADMIN')
          ? loadOptionalData(() => fetchAdminDashboard(initialAdminDashboardRange), null)
          : Promise.resolve(null),
        loadOptionalData(fetchRequerimientos, []),
        loadOptionalData(fetchCompras, []),
        loadOptionalData(fetchMisCompras, []),
        loadOptionalData(fetchServicios, []),
        loadOptionalData(fetchMisServicios, []),
        loadOptionalData(fetchMovimientos, []),
        loadOptionalData(fetchCategorias, []),
        loadOptionalData(fetchMonedas, []),
        loadOptionalData(fetchProveedores, []),
        loadOptionalData(fetchUnidades, []),
        loadOptionalData(fetchAlmacenes, []),
      ])
      setMaterials(materialsData)
      setRequerimientos(reqsData)
      setCompras(comprasData)
      setMisCompras(misComprasData)
      setServicios(serviciosData)
      setMisServicios(misServiciosData)
      setMovimientos(movsData)
      setCategorias(Array.isArray(categoriasData) ? categoriasData : [])
      setMonedas(Array.isArray(monedasData) ? monedasData : [])
      setProveedores(Array.isArray(proveedoresData) ? proveedoresData : [])
      setUnidades(Array.isArray(unidadesData) ? unidadesData : [])
      setAlmacenes(Array.isArray(almacenesData) ? almacenesData : [])
      setAdminDashboardData(adminDashboardDataResp)
      setStats({
        total_materiales: parseInt(statsData.total_materiales, 10) || 0,
        stock_total: parseInt(statsData.stock_total, 10) || 0,
        pendientes: parseInt(statsData.pendientes, 10) || 0,
        completados: parseInt(statsData.completados, 10) || 0,
      })
    } catch (err) {
      if (isUnauthorizedError(err)) {
        if (onAuthExpired) onAuthExpired()
        return
      }
      console.error('Error cargando datos:', err)
      setError(err?.message ? `Error al cargar los datos: ${err.message}` : 'Error al cargar los datos. Verifica que el servidor está corriendo.')
    } finally {
      setLoading(false)
    }
  }, [initialAdminDashboardRange, isUnauthorizedError, loadOptionalData, onAuthExpired])

  // Cargar datos iniciales al montar el dashboard.
  useEffect(() => {
    loadData()
  }, [loadData])

  const handleRefreshAdminDashboard = useCallback(async ({ fecha_inicio = '', fecha_fin = '', auto = true } = {}) => {
    const nextRange = {
      fecha_inicio: String(fecha_inicio || ''),
      fecha_fin: String(fecha_fin || ''),
    }
    setAdminDashboardDateRange(nextRange)

    if (!auto) return

    try {
      setAdminDashboardLoading(true)
      const data = await fetchAdminDashboard(nextRange)
      setAdminDashboardData(data)
    } catch (err) {
      if (isUnauthorizedError(err)) {
        if (onAuthExpired) onAuthExpired()
        return
      }
      console.error('Error cargando dashboard administrativo:', err)
      setError(err.message || 'Error al cargar dashboard administrativo')
    } finally {
      setAdminDashboardLoading(false)
    }
  }, [isUnauthorizedError, onAuthExpired])

  const handleCreateRequirement = async (payload) => {
    try {
      await createRequerimiento(payload)
      await loadData()
      // Refrescar la página para confirmar que se guardó
      window.location.reload()
    } catch (err) {
      if (isUnauthorizedError(err)) {
        if (onAuthExpired) onAuthExpired()
        return
      }
      console.error('Error registrando requerimiento:', err)
      setError(err.message || 'Error al registrar el requerimiento')
    }
  }

  const handleCreateCompra = async (payload) => {
    try {
      await createCompra(payload)
      await loadData()
      setActiveTab('manage-requests')
      // Refrescar la página para confirmar que se guardó
      window.location.reload()
    } catch (err) {
      if (isUnauthorizedError(err)) {
        if (onAuthExpired) onAuthExpired()
        return
      }
      console.error('Error registrando compra:', err)
      setError(err.message || 'Error al registrar compra')
      throw err
    }
  }

  const handleCreateServicio = async (payload) => {
    try {
      await createServicio(payload)
      await loadData()
      setActiveTab('my-purchase-orders')
      setActiveOrdersView('servicios')
    } catch (err) {
      if (isUnauthorizedError(err)) {
        if (onAuthExpired) onAuthExpired()
        return
      }
      console.error('Error registrando servicio:', err)
      setError(err.message || 'Error al registrar servicio')
      throw err
    }
  }

  const handleServicioAprobacion = async (id, estadoAprobacion, options = {}) => {
    try {
      await updateServicioAprobacion(id, estadoAprobacion, options)
      await loadData()
    } catch (err) {
      if (isUnauthorizedError(err)) {
        if (onAuthExpired) onAuthExpired()
        return
      }
      console.error('Error actualizando aprobacion de servicio:', err)
      setError(err.message || 'Error al actualizar aprobacion de servicio')
      throw err
    }
  }

  const handleServicioRealizado = async (id) => {
    try {
      await updateServicioEstado(id, 'REALIZADO')
      await loadData()
    } catch (err) {
      if (isUnauthorizedError(err)) {
        if (onAuthExpired) onAuthExpired()
        return
      }
      console.error('Error actualizando estado de servicio:', err)
      setError(err.message || 'Error al actualizar estado del servicio')
      throw err
    }
  }

  const handleCompraStatus = async (id, estado) => {
    try {
      await updateCompraEstado(id, estado)
      await loadData()
    } catch (err) {
      if (isUnauthorizedError(err)) {
        if (onAuthExpired) onAuthExpired()
        return
      }
      console.error('Error actualizando estado de compra:', err)
      setError(err.message || 'Error al actualizar estado de compra')
      throw err
    }
  }

  const handleCompletarCompra = async (id, payload) => {
    try {
      await completarCompraDatos(id, payload)
      await loadData()
    } catch (err) {
      if (isUnauthorizedError(err)) {
        if (onAuthExpired) onAuthExpired()
        return
      }
      console.error('Error completando datos de compra:', err)
      setError(err.message || 'Error al completar datos de compra')
      throw err
    }
  }

  const handleGenerarOrdenCompra = async (id) => {
    try {
      const result = await generarOrdenCompra(id)

      const fileName = result?.archivo?.nombre || `OC-${id}.pdf`
      const b64 = result?.archivo?.base64 || ''
      if (b64) {
        const binary = atob(b64)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i += 1) {
          bytes[i] = binary.charCodeAt(i)
        }
        const blob = new Blob([bytes], { type: 'application/pdf' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = fileName
        document.body.appendChild(link)
        link.click()
        link.remove()
        URL.revokeObjectURL(url)
      }

      await loadData()
    } catch (err) {
      if (isUnauthorizedError(err)) {
        if (onAuthExpired) onAuthExpired()
        return
      }
      console.error('Error generando orden de compra:', err)
      setError(err.message || 'Error al generar orden de compra')
      throw err
    }
  }

  const handleMarcarRecibidoAlmacen = async (id) => {
    try {
      await marcarRecibidoEnAlmacen(id)
      await loadData()
    } catch (err) {
      if (isUnauthorizedError(err)) {
        if (onAuthExpired) onAuthExpired()
        return
      }
      console.error('Error marcando compra como recibida en almacen:', err)
      setError(err.message || 'Error al marcar compra como recibida en almacen')
      throw err
    }
  }

  const handleAgregarComentarioCompra = async (id, contenido) => {
    try {
      await agregarComentarioCompra(id, contenido)
      await loadData()
    } catch (err) {
      if (isUnauthorizedError(err)) {
        if (onAuthExpired) onAuthExpired()
        return
      }
      console.error('Error agregando comentario en compra:', err)
      setError(err.message || 'Error al agregar comentario en compra')
      throw err
    }
  }

  const handleAgregarComentarioRequerimiento = async (id, contenido) => {
    try {
      await agregarComentarioRequerimiento(id, contenido)
      await loadData()
    } catch (err) {
      if (isUnauthorizedError(err)) {
        if (onAuthExpired) onAuthExpired()
        return
      }
      console.error('Error agregando comentario en requerimiento:', err)
      setError(err.message || 'Error al agregar comentario en requerimiento')
      throw err
    }
  }

  const handleAgregarComentarioServicio = async (id, contenido) => {
    try {
      await agregarComentarioServicio(id, contenido)
      await loadData()
    } catch (err) {
      if (isUnauthorizedError(err)) {
        if (onAuthExpired) onAuthExpired()
        return
      }
      console.error('Error agregando comentario en servicio:', err)
      setError(err.message || 'Error al agregar comentario en servicio')
      throw err
    }
  }

  const handleCompletarServicio = async (id, payload) => {
    try {
      await completarServicioDatos(id, payload)
      await loadData()
    } catch (err) {
      if (isUnauthorizedError(err)) {
        if (onAuthExpired) onAuthExpired()
        return
      }
      console.error('Error completando datos de servicio:', err)
      setError(err.message || 'Error al completar datos del servicio')
      throw err
    }
  }

  const downloadBlob = (blob, fileName) => {
    if (!blob) return

    if (window.navigator && window.navigator.msSaveOrOpenBlob) {
      window.navigator.msSaveOrOpenBlob(blob, fileName)
      return
    }

    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    link.style.display = 'none'
    document.body.appendChild(link)

    try {
      link.click()
    } catch (clickError) {
      window.open(url, '_blank')
    }

    setTimeout(() => {
      URL.revokeObjectURL(url)
      link.remove()
    }, 100)
  }

  const handleGenerarOrdenServicio = async (id) => {
    try {
      const result = await generarOrdenServicio(id)
      const fileName = result?.archivo?.nombre || `OS-${id}.pdf`
      const b64 = result?.archivo?.base64 || ''

      if (b64) {
        const binary = atob(b64)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i += 1) {
          bytes[i] = binary.charCodeAt(i)
        }
        const blob = new Blob([bytes], { type: 'application/pdf' })
        downloadBlob(blob, fileName)
      }

      await loadData()
    } catch (err) {
      if (isUnauthorizedError(err)) {
        if (onAuthExpired) onAuthExpired()
        return
      }
      console.error('Error generando orden de servicio:', err)
      setError(err.message || 'Error al generar orden de servicio')
      throw err
    }
  }

  const handleDescargarOrdenServicioPdf = async (id) => {
    try {
      const result = await descargarOrdenServicioPdf(id)
      const fileName = result?.archivo?.nombre || `OS-${id}.pdf`
      const blob = result?.blob
      if (blob) {
        downloadBlob(blob, fileName)
      }
    } catch (err) {
      if (isUnauthorizedError(err)) {
        if (onAuthExpired) onAuthExpired()
        return
      }
      console.error('Error descargando PDF de orden de servicio:', err)
      setError(err.message || 'Error al descargar PDF de la orden de servicio')
      throw err
    }
  }

  const handleDescargarOrdenCompraPdf = async (id) => {
    try {
      const result = await descargarOrdenCompraPdf(id)
      const fileName = result?.archivo?.nombre || `OC-${id}.pdf`
      const blob = result?.blob
      if (blob) {
        downloadBlob(blob, fileName)
      }
    } catch (err) {
      if (isUnauthorizedError(err)) {
        if (onAuthExpired) onAuthExpired()
        return
      }
      console.error('Error descargando PDF de orden de compra:', err)
      setError(err.message || 'Error al descargar PDF de la orden de compra')
      throw err
    }
  }

  const handleConfirmarRecepcionCompra = async (id, payload = {}) => {
    try {
      await confirmarRecepcionCompra(id, payload)
      await loadData()
    } catch (err) {
      if (isUnauthorizedError(err)) {
        if (onAuthExpired) onAuthExpired()
        return
      }
      console.error('Error confirmando recepcion de compra:', err)
      setError(err.message || 'Error al confirmar recepcion de compra')
      throw err
    }
  }

  const handleConfirmarEntregaAreaCompra = async (id, receptorUserId) => {
    try {
      await confirmarEntregaAreaCompra(id, { receptor_user_id: receptorUserId })
      await loadData()
    } catch (err) {
      if (isUnauthorizedError(err)) {
        if (onAuthExpired) onAuthExpired()
        return
      }
      console.error('Error confirmando entrega al area de compra:', err)
      setError(err.message || 'Error al confirmar entrega al area de compra')
      throw err
    }
  }

  const handleRequirementDeliveryStatus = async (id, estadoEntrega, receptorUserId) => {
    try {
      await updateRequerimientoEntrega(id, estadoEntrega, receptorUserId)
      await loadData()
    } catch (err) {
      if (isUnauthorizedError(err)) {
        if (onAuthExpired) onAuthExpired()
        return
      }
      console.error('Error actualizando estado de entrega:', err)
      setError(err.message || 'Error al actualizar estado de entrega')
    }
  }

  const handleUpdateMaterial = async (id, payload) => {
    try {
      await updateMaterial(id, payload)
      await loadData()
    } catch (err) {
      if (isUnauthorizedError(err)) {
        if (onAuthExpired) onAuthExpired()
        return
      }
      console.error('Error actualizando material:', err)
      setError(err.message || 'Error al actualizar material')
      throw err
    }
  }

  const handleCreateMaterialManual = async (payload) => {
    try {
      await createMaterial(payload)
      await loadData()
    } catch (err) {
      if (isUnauthorizedError(err)) {
        if (onAuthExpired) onAuthExpired()
        return
      }
      console.error('Error creando material manual:', err)
      setError(err.message || 'Error al crear material manual')
      throw err
    }
  }

  const handleUploadMaterialImage = async (file) => {
    try {
      const result = await uploadMaterialImage(file)
      return result
    } catch (err) {
      if (isUnauthorizedError(err)) {
        if (onAuthExpired) onAuthExpired()
        return
      }
      console.error('Error subiendo imagen de material:', err)
      setError(err.message || 'Error al subir imagen de material')
      throw err
    }
  }

  const handleUpdateMyPhoto = async (foto) => {
    try {
      await updateCurrentUserPhoto(foto)
      await loadData()
      // Notificar a vistas que listan usuarios para que refresquen sus datos
      try {
        window.dispatchEvent(new CustomEvent('usuarios:refresh'))
      } catch (e) {
        // no-op
      }
    } catch (err) {
      if (isUnauthorizedError(err)) {
        if (onAuthExpired) onAuthExpired()
        return
      }
      console.error('Error actualizando foto de usuario:', err)
      setError(err.message || 'Error al actualizar foto de usuario')
      throw err
    }
  }

  const filteredMaterials = materials
    .filter((material) => {
      const hayNombre = String(material.nombre || '').toLowerCase()
      const query = searchTerm.toLowerCase()
      const matchesSearch = hayNombre.includes(query)
      const materialWarehouses = String(material.almacen || '')
        .split(',')
        .map((warehouse) => warehouse.trim())
        .filter(Boolean)
      const matchesWarehouse =
        filterWarehouse === 'Todos' || materialWarehouses.includes(filterWarehouse)
      return matchesSearch && matchesWarehouse
    })
    .sort((a, b) => {
      const stockA = Number(a?.stock || 0)
      const stockB = Number(b?.stock || 0)
      if (stockB !== stockA) return stockB - stockA
      return String(a?.nombre || '').localeCompare(String(b?.nombre || ''))
    })

  const warehouseOptions = [
    'Todos',
    ...new Set(
      materials
        .flatMap((material) => String(material.almacen || '').split(','))
        .map((warehouse) => warehouse.trim())
        .filter((warehouse) => warehouse && warehouse !== 'Sin almacen')
    ),
  ]

  const handleGoToHomeFromError = () => {
    const homeTab = allowedTabs.includes('materials')
      ? 'materials'
      : (allowedTabs[0] || 'materials')
    setActiveTab(homeTab)
    setError(null)
  }

  const handleLogoutFromError = async () => {
    try {
      await onLogout?.()
    } finally {
      setError(null)
    }
  }

  return (
    <div className="dashboard">
      <Header currentUserName={currentUserName} currentUser={currentUserProfile} onLogout={onLogout} />
      {error && (
        <div className="error-banner">
          <span>⚠️ {error}</span>
          <div className="error-banner-actions">
            {canReturnHomeFromError && (
              <button type="button" className="error-banner-home-btn" onClick={handleGoToHomeFromError}>
                Volver a inicio
              </button>
            )}
            {canReturnHomeFromError && (
              <button type="button" className="error-banner-logout-btn" onClick={handleLogoutFromError}>
                Cerrar sesion
              </button>
            )}
            <button type="button" onClick={() => setError(null)}>×</button>
          </div>
        </div>
      )}
      {loading && <div className="loading-indicator">Cargando datos...</div>}
      <div className="dashboard-container">
        <Sidebar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          visibleModules={visibleModules}
          tabByModuleId={TAB_BY_MODULE_ID}
        />
        <main className="main-content">
          {activeTab === 'admin-dashboard' && allowedTabs.includes('admin-dashboard') && (
            <AdminDashboardView
              data={{ ...(adminDashboardData || {}), filtro_fechas: adminDashboardDateRange }}
              loading={adminDashboardLoading}
              onRefresh={handleRefreshAdminDashboard}
              stats={_stats}
            />
          )}
          {activeTab === 'materials' && allowedTabs.includes('materials') && (
            <ProductList
              materials={filteredMaterials}
              warehouses={warehouseOptions}
              searchTerm={searchTerm}
              setSearchTerm={setSearchTerm}
              filterWarehouse={filterWarehouse}
              setFilterWarehouse={setFilterWarehouse}
              canEditMaterials={canEditMaterials}
              canAddManualInventory={canAddManualInventory}
              categorias={categorias}
              monedas={monedas}
              proveedores={proveedores}
              unidades={unidades}
              almacenes={almacenes}
              onSaveMaterial={handleUpdateMaterial}
              onUploadMaterialImage={handleUploadMaterialImage}
              onCreateMaterial={handleCreateMaterialManual}
            />
          )}
          {activeTab === 'request-material' && allowedTabs.includes('request-material') && (
            <AddProductForm
              onSubmitRequirement={handleCreateRequirement}
              materials={materials}
              currentUser={currentUserName}
              currentArea={currentUserArea}
            />
          )}
          {activeTab === 'request-purchase' && allowedTabs.includes('request-purchase') && (
            <SolicitarCompraForm
              onSubmitCompra={handleCreateCompra}
              materials={materials}
              proveedores={proveedores}
              currentUser={currentUserName}
              currentArea={currentUserArea}
            />
          )}
          {activeTab === 'manage-providers' && allowedTabs.includes('manage-providers') && (
            <GestionarProveedoresView
              canEdit={hasPermission(currentUserPermissions, 'GESTIONAR_PROVEEDORES')}
              currentUserRoleId={currentUserRoleId}
              onCreated={loadData}
            />
          )}
          {activeTab === 'request-service' && allowedTabs.includes('request-service') && (
            <SolicitarServicioForm
              onSubmitServicio={handleCreateServicio}
              currentUser={currentUserName}
              currentArea={currentUserArea}
              currentAreaId={currentUserAreaId}
            />
          )}
          {activeTab === 'manage-requests' && allowedTabs.includes('manage-requests') && (
            <div className="segmented-section-wrap">
              <div className="segmented-buttons">
                <button type="button" className={activeRequestsView === 'compras' ? 'active' : ''} onClick={() => setActiveRequestsView('compras')}>
                  Compras
                </button>
                {canManageServiceApprovals && (
                  <button type="button" className={activeRequestsView === 'servicios' ? 'active' : ''} onClick={() => setActiveRequestsView('servicios')}>
                    Servicios
                  </button>
                )}
              </div>
              {activeRequestsView === 'compras' && (
                <GestionarComprasView
                  compras={compras}
                  currentUserRoleId={currentUserRoleId}
                  currentUserRoleName={currentUserProfile?.rol || ''}
                  currentUserPermissions={currentUserPermissions}
                  currentUserArea={currentUserArea}
                  onChangeEstado={handleCompraStatus}
                />
              )}
              {canManageServiceApprovals && activeRequestsView === 'servicios' && (
                <GestionarServiciosView
                  servicios={servicios}
                  currentUserPermissions={currentUserPermissions}
                  currentUserRoleId={currentUserRoleId}
                  onChangeAprobacion={handleServicioAprobacion}
                />
              )}
            </div>
          )}
          {activeTab === 'my-purchase-orders' && allowedTabs.includes('my-purchase-orders') && (
            <div className="segmented-section-wrap">
              <div className="segmented-buttons">
                <button type="button" className={activeOrdersView === 'compras' ? 'active' : ''} onClick={() => setActiveOrdersView('compras')}>
                  Mis ordenes de compra
                </button>
                <button type="button" className={activeOrdersView === 'servicios' ? 'active' : ''} onClick={() => setActiveOrdersView('servicios')}>
                  Mis ordenes de servicios
                </button>
              </div>

              {activeOrdersView === 'compras' && (
                <MisOrdenesCompraView
                  compras={compras}
                  currentUserRoleId={currentUserRoleId}
                  currentUserPermissions={currentUserPermissions}
                  onCompletarDatos={handleCompletarCompra}
                  onGenerarOrden={handleGenerarOrdenCompra}
                  onDescargarPdf={handleDescargarOrdenCompraPdf}
                  onMarcarRecibidoAlmacen={handleMarcarRecibidoAlmacen}
                  onMarcarEntregado={handleConfirmarEntregaAreaCompra}
                  onAgregarComentario={handleAgregarComentarioCompra}
                />
              )}

              {activeOrdersView === 'servicios' && (
                <MisOrdenesServiciosView
                  servicios={servicios}
                  proveedores={proveedores}
                  monedas={monedas}
                  currentUserRoleId={currentUserRoleId}
                  currentUserPermissions={currentUserPermissions}
                  onCompletarDatos={handleCompletarServicio}
                  onGenerarOrden={handleGenerarOrdenServicio}
                  onDescargarPdf={handleDescargarOrdenServicioPdf}
                  onMarcarRealizado={handleServicioRealizado}
                  onChangeAprobacion={handleServicioAprobacion}
                  onAgregarComentario={handleAgregarComentarioServicio}
                />
              )}

            </div>
          )}
          {activeTab === 'manage-delivery' && allowedTabs.includes('manage-delivery') && (
            <DeliveryManager
              requerimientos={requerimientos}
              compras={compras}
              onConfirmarEntregaRequerimiento={(id, receptorUserId) => handleRequirementDeliveryStatus(id, 'ENTREGADO', receptorUserId)}
              onConfirmarRecepcion={handleConfirmarRecepcionCompra}
              onConfirmarEntregaAreaCompra={handleConfirmarEntregaAreaCompra}
              onDescargarPdf={handleDescargarOrdenCompraPdf}
            />
          )}
          {activeTab === 'services-history' && allowedTabs.includes('services-history') && (
            <HistorialServiciosView
              servicios={servicios}
              currentUserRoleId={currentUserRoleId}
              currentUserPermissions={currentUserPermissions}
            />
          )}
          {activeTab === 'movements' && allowedTabs.includes('movements') && (
            <MovimientosView
              movimientos={movimientos}
              currentUserPermissions={currentUserPermissions}
              currentUserRoleId={currentUserRoleId}
            />
          )}
          {activeTab === 'settings' && allowedTabs.includes('settings') && (
            <AjustesView currentUser={currentUserProfile} onUpdatePhoto={handleUpdateMyPhoto} />
          )}
          {activeTab === 'notifications' && allowedTabs.includes('notifications') && (
            <NotificationsView currentUser={currentUserProfile} onAuthExpired={onAuthExpired} />
          )}
          {activeTab === 'roles-permissions' && allowedTabs.includes('roles-permissions') && (
            <RolesPermissionsView />
          )}
          {activeTab === 'manage-accounts' && allowedTabs.includes('manage-accounts') && (
            <GestionarUsuariosView />
          )}
          {activeTab === 'rate-products' && allowedTabs.includes('rate-products') && (
            <CalificarMaterialesView
              movimientos={movimientos}
              currentUserPermissions={currentUserPermissions}
              currentUserRoleId={currentUserRoleId}
              currentUserArea={currentUserArea}
            />
          )}
        </main>
      </div>
    </div>
  )
}
