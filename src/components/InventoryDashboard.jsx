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
import MisRequerimientosView from './MisRequerimientosView'
import MovimientosView from './MovimientosView'
import AjustesView from './AjustesView'
import AdminDashboardView from './AdminDashboardView'
import HistorialServiciosView from './HistorialServiciosView'
import { buildAllowedTabs, getModulesByRole, modules, TAB_BY_MODULE_ID } from '../services/moduleAccess'
import {
  fetchMateriales,
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
  const [misRequerimientos, setMisRequerimientos] = useState([])
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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activeRequestsView, setActiveRequestsView] = useState('compras')
  const [activeOrdersView, setActiveOrdersView] = useState('compras')
  const [adminDashboardData, setAdminDashboardData] = useState(null)
  const [adminDashboardLoading, setAdminDashboardLoading] = useState(false)
  const [adminDashboardDateRange, setAdminDashboardDateRange] = useState({ fecha_inicio: '', fecha_fin: '' })

  const isUnauthorizedError = useCallback((err) => Number(err?.status || 0) === 401, [])
  const isForbiddenError = useCallback((err) => Number(err?.status || 0) === 403, [])
  const allowedModules = useMemo(() => getModulesByRole(currentUserRoleId), [currentUserRoleId])
  const visibleModules = useMemo(() => {
    return modules.filter((mod) => allowedModules.includes(mod.id))
  }, [allowedModules])
  const allowedTabs = useMemo(() => buildAllowedTabs(currentUserRoleId), [currentUserRoleId])
  const canEditMaterials = currentUserRoleId === 8 || currentUserRoleId === 9

  const loadOptionalData = useCallback(async (loader, fallbackValue) => {
    try {
      return await loader()
    } catch (err) {
      if (isUnauthorizedError(err)) throw err
      if (isForbiddenError(err)) return fallbackValue
      throw err
    }
  }, [isUnauthorizedError, isForbiddenError])

  // Cargar materiales y estadísticas
  useEffect(() => {
    // Keep first-load behavior stable; loadData is defined later in scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    loadData()
  }, [])

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
      console.log('Rol usuario:', currentUser?.rol_id ?? currentUser?.id_role)
      setCurrentUserRoleId(Number.isFinite(roleId) && roleId > 0 ? roleId : null)

      const [
        materialsData,
        statsData,
        adminDashboardDataResp,
        reqsData,
        myReqsData,
        comprasData,
        misComprasData,
        serviciosData,
        misServiciosData,
        movsData,
        categoriasData,
        monedasData,
        proveedoresData,
        unidadesData,
      ] = await Promise.all([
        fetchMateriales(),
        loadOptionalData(fetchStats, {
          total_materiales: 0,
          stock_total: 0,
          pendientes: 0,
          completados: 0,
        }),
        roleId === 8
          ? loadOptionalData(() => fetchAdminDashboard(adminDashboardDateRange), null)
          : Promise.resolve(null),
        loadOptionalData(fetchRequerimientos, []),
        loadOptionalData(fetchMisRequerimientos, []),
        loadOptionalData(fetchCompras, []),
        loadOptionalData(fetchMisCompras, []),
        loadOptionalData(fetchServicios, []),
        loadOptionalData(fetchMisServicios, []),
        loadOptionalData(fetchMovimientos, []),
        loadOptionalData(fetchCategorias, []),
        loadOptionalData(fetchMonedas, []),
        loadOptionalData(fetchProveedores, []),
        loadOptionalData(fetchUnidades, []),
      ])
      setMaterials(materialsData)
      setRequerimientos(reqsData)
      setMisRequerimientos(myReqsData)
      setCompras(comprasData)
      setMisCompras(misComprasData)
      setServicios(serviciosData)
      setMisServicios(misServiciosData)
      setMovimientos(movsData)
      setCategorias(Array.isArray(categoriasData) ? categoriasData : [])
      setMonedas(Array.isArray(monedasData) ? monedasData : [])
      setProveedores(Array.isArray(proveedoresData) ? proveedoresData : [])
      setUnidades(Array.isArray(unidadesData) ? unidadesData : [])
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
  }, [isUnauthorizedError, loadOptionalData, onAuthExpired])

  const handleRefreshAdminDashboard = async ({ fecha_inicio = null, fecha_fin = null, auto = true } = {}) => {
    const nextRange = {
      fecha_inicio: fecha_inicio == null ? adminDashboardDateRange.fecha_inicio : String(fecha_inicio || ''),
      fecha_fin: fecha_fin == null ? adminDashboardDateRange.fecha_fin : String(fecha_fin || ''),
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
  }

  const handleCreateRequirement = async (payload) => {
    try {
      await createRequerimiento(payload)
      await loadData()
      setActiveTab('manage-requests')
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

  const handleServicioAprobacion = async (id, estadoAprobacion) => {
    try {
      await updateServicioAprobacion(id, estadoAprobacion)
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
      console.error('Error generando orden de servicio:', err)
      setError(err.message || 'Error al generar orden de servicio')
      throw err
    }
  }

  const handleDescargarOrdenServicioPdf = async (id) => {
    try {
      const result = await descargarOrdenServicioPdf(id)

      const fileName = result?.archivo?.nombre || `OS-${id}.pdf`
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

  const filteredMaterials = materials.filter((material) => {
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

  const warehouseOptions = [
    'Todos',
    ...new Set(
      materials
        .flatMap((material) => String(material.almacen || '').split(','))
        .map((warehouse) => warehouse.trim())
        .filter((warehouse) => warehouse && warehouse !== 'Sin almacen')
    ),
  ]

  return (
    <div className="dashboard">
      <Header currentUserName={currentUserName} currentUser={currentUserProfile} onLogout={onLogout} />
      {error && (
        <div className="error-banner">
          ⚠️ {error}
          <button onClick={() => setError(null)}>×</button>
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
              categorias={categorias}
              monedas={monedas}
              proveedores={proveedores}
              unidades={unidades}
              onSaveMaterial={handleUpdateMaterial}
              onUploadMaterialImage={handleUploadMaterialImage}
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
              canEdit={currentUserRoleId === 8 || currentUserRoleId === 9}
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
                <button type="button" className={activeRequestsView === 'servicios' ? 'active' : ''} onClick={() => setActiveRequestsView('servicios')}>
                  Servicios
                </button>
              </div>
              {activeRequestsView === 'compras' && (
                <GestionarComprasView
                  compras={compras}
                  currentUserRoleId={currentUserRoleId}
                  onChangeEstado={handleCompraStatus}
                />
              )}
              {activeRequestsView === 'servicios' && (
                <GestionarServiciosView
                  servicios={servicios}
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
                <button type="button" className={activeOrdersView === 'requerimientos' ? 'active' : ''} onClick={() => setActiveOrdersView('requerimientos')}>
                  Mis requerimientos
                </button>
              </div>

              {activeOrdersView === 'compras' && (
                <MisOrdenesCompraView
                  compras={misCompras}
                  currentUserRoleId={currentUserRoleId}
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
                  servicios={misServicios}
                  proveedores={proveedores}
                  monedas={monedas}
                  currentUserRoleId={currentUserRoleId}
                  onCompletarDatos={handleCompletarServicio}
                  onGenerarOrden={handleGenerarOrdenServicio}
                  onDescargarPdf={handleDescargarOrdenServicioPdf}
                  onMarcarRealizado={handleServicioRealizado}
                  onAgregarComentario={handleAgregarComentarioServicio}
                />
              )}

              {activeOrdersView === 'requerimientos' && (
                <MisRequerimientosView
                  requerimientos={misRequerimientos}
                  onAgregarComentario={handleAgregarComentarioRequerimiento}
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
            <HistorialServiciosView servicios={servicios} currentUserRoleId={currentUserRoleId} />
          )}
          {activeTab === 'movements' && allowedTabs.includes('movements') && (
            <MovimientosView movimientos={movimientos} />
          )}
          {activeTab === 'settings' && allowedTabs.includes('settings') && (
            <AjustesView currentUser={currentUserProfile} onUpdatePhoto={handleUpdateMyPhoto} />
          )}
        </main>
      </div>
    </div>
  )
}
