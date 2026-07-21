import './App.css'
import InventoryDashboard from './components/InventoryDashboard'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import LoginView from './components/LoginView'
import ChangePasswordView from './components/ChangePasswordView'
import { clearAuthSession, logout, fetchCurrentUser, fetchApprovalConfig, hasActiveSession, requiresPasswordChange, setUnauthorizedHandler } from './services/api'
import { buildAllowedModules, hasPermission, modules } from './services/moduleAccess'

const normalizeRoleName = (value) => String(value || '')
  .trim()
  .toUpperCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^A-Z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '')

function ProtectedRoute({ isAuthenticated, moduleId = null, allowedModules = [], children }) {
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  if (requiresPasswordChange()) {
    return <Navigate to="/cambiar-contrasena" replace />
  }

  if (moduleId && !allowedModules.includes(moduleId)) {
    return <Navigate to="/no-autorizado" replace />
  }

  return children
}

function NoAutorizadoView({ onLogout }) {
  return (
    <main className="login-page">
      <section className="login-card">
        <h1>No autorizado</h1>
        <p>No tienes permisos para acceder a este modulo.</p>
        <button type="button" className="login-btn" onClick={onLogout}>
          Cerrar sesion
        </button>
      </section>
    </main>
  )
}

function App() {
  const [authReady, setAuthReady] = useState(false)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [currentUser, setCurrentUser] = useState(null)

  // Configurar manejador global de errores 401/403
  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearAuthSession()
      setIsAuthenticated(false)
      setCurrentUser(null)
    })
  }, [])

  useEffect(() => {
    const bootstrapAuth = async () => {
      if (!hasActiveSession()) {
        setIsAuthenticated(false)
        setCurrentUser(null)
        setAuthReady(true)
        return
      }

      try {
        const me = await fetchCurrentUser()
        setCurrentUser(me)
        console.log('Rol usuario:', me?.rol_id ?? me?.id_role)
        setIsAuthenticated(true)
      } catch {
        clearAuthSession()
        setIsAuthenticated(false)
        setCurrentUser(null)
      } finally {
        setAuthReady(true)
      }
    }

    bootstrapAuth()
  }, [])

  const handleLoginSuccess = async () => {
    const me = await fetchCurrentUser()
    setCurrentUser(me)
    console.log('Rol usuario:', me?.rol_id ?? me?.id_role)
    setIsAuthenticated(true)
  }

  const handleLogout = async () => {
    await logout()
    setIsAuthenticated(false)
    setCurrentUser(null)
  }

  const [approvalConfig, setApprovalConfig] = useState({ flujos: {} })

  useEffect(() => {
    const loadApprovalConfig = async () => {
      try {
        const config = await fetchApprovalConfig()
        setApprovalConfig(config || { flujos: {} })
      } catch (error) {
        console.error('No se pudo cargar la configuración de aprobaciones:', error)
        setApprovalConfig({ flujos: {} })
      }
    }

    loadApprovalConfig()
  }, [])

  const roleId = Number(currentUser?.rol_id ?? currentUser?.id_role ?? 0)
  const roleName = String(currentUser?.rol || currentUser?.rol_nombre || currentUser?.nombre_rol || '').trim()
  const userPermissions = Array.isArray(currentUser?.permisos) ? currentUser.permisos : []

  const currentUserInApprovalFlow = useMemo(() => {
    const flows = approvalConfig?.flujos && typeof approvalConfig.flujos === 'object' ? approvalConfig.flujos : {}
    const normalizedRoleName = normalizeRoleName(roleName)

    return Object.values(flows).some((flow) => Array.isArray(flow) && flow.some((step) => {
      const stepRoleId = Number(step?.rol_id || 0)
      const stepRoleName = normalizeRoleName(step?.rol_nombre || step?.nombre || '')
      return (stepRoleId && stepRoleId === roleId) || (stepRoleName && stepRoleName === normalizedRoleName)
    }))
  }, [approvalConfig, roleId, roleName])

  const effectivePermissions = useMemo(() => {
    const permissions = Array.isArray(userPermissions) ? [...new Set(userPermissions)] : []
    if (currentUserInApprovalFlow && !hasPermission(permissions, 'GESTIONAR_SOLICITUDES')) {
      permissions.push('GESTIONAR_SOLICITUDES')
    }
    return permissions
  }, [userPermissions, currentUserInApprovalFlow])

  const allowedModules = useMemo(() => buildAllowedModules(roleId, effectivePermissions), [roleId, effectivePermissions])

  const visibleModules = useMemo(() => modules.filter((mod) => allowedModules.includes(mod.id)), [allowedModules])
  const defaultPath = visibleModules[0]?.path || '/inventario'

  if (!authReady) {
    return <div className="app-loading">Validando sesion...</div>
  }

  const renderDashboard = (tab, moduleId) => (
    <ProtectedRoute isAuthenticated={isAuthenticated} moduleId={moduleId} allowedModules={allowedModules}>
      <InventoryDashboard
        initialTab={tab}
        onLogout={handleLogout}
        onAuthExpired={handleLogout}
      />
    </ProtectedRoute>
  )

  return (
    <BrowserRouter>
      <div className="app">
        <Routes>
          <Route
            path="/login"
            element={
              isAuthenticated
                ? <Navigate to={requiresPasswordChange() ? '/cambiar-contrasena' : defaultPath} replace />
                : <LoginView onLoginSuccess={handleLoginSuccess} />
            }
          />
          <Route
            path="/cambiar-contrasena"
            element={
              !isAuthenticated
                ? <Navigate to="/login" replace />
                : <ChangePasswordView />
            }
          />
          <Route path="/" element={<Navigate to={isAuthenticated ? (requiresPasswordChange() ? '/cambiar-contrasena' : defaultPath) : '/login'} replace />} />

          <Route path="/inventario" element={renderDashboard('materials', 1)} />
          <Route path="/dashboard" element={renderDashboard('admin-dashboard', 12)} />
          <Route path="/requerimiento" element={renderDashboard('request-material', 2)} />
          <Route path="/requerimientos" element={renderDashboard('request-material', 2)} />
          <Route path="/compra" element={renderDashboard('request-purchase', 3)} />
          <Route path="/solicitar-compra" element={renderDashboard('request-purchase', 3)} />
          <Route path="/servicio" element={renderDashboard('request-service', 4)} />
          <Route path="/gestionar" element={renderDashboard('manage-requests', 5)} />
          <Route path="/gestionar-requerimientos" element={renderDashboard('manage-requests', 5)} />
          <Route path="/gestionar-compras" element={renderDashboard('manage-requests', 5)} />
          <Route path="/mis-compras" element={renderDashboard('my-purchase-orders', 6)} />
          <Route path="/compras" element={renderDashboard('my-purchase-orders', 6)} />
          <Route path="/mis-servicios" element={<Navigate to="/mis-compras" replace />} />
          <Route path="/entregas" element={renderDashboard('manage-delivery', 7)} />
          <Route path="/historial-servicios" element={renderDashboard('services-history', 13)} />
          <Route path="/movimientos" element={renderDashboard('movements', 8)} />
          <Route path="/proveedores" element={renderDashboard('manage-providers', 10)} />
          <Route path="/ajustes" element={renderDashboard('settings', 11)} />
          <Route path="/notificaciones" element={renderDashboard('notifications', 14)} />
          <Route path="/gestionar-cuentas" element={renderDashboard('manage-accounts', 17)} />
          <Route path="/compras-directas" element={renderDashboard('direct-purchases', 18)} />

          <Route
            path="/no-autorizado"
            element={
              isAuthenticated
                ? <NoAutorizadoView onLogout={handleLogout} />
                : <Navigate to="/login" replace />
            }
          />
          <Route path="*" element={<Navigate to={isAuthenticated ? defaultPath : '/login'} replace />} />
        </Routes>
      </div>
    </BrowserRouter>
  )
}

export default App
