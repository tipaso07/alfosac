import { useEffect, useMemo, useState } from 'react'
import {
  createRol,
  deleteRol,
  fetchApprovalConfig,
  fetchPermisos,
  fetchPermisosRol,
  fetchRoles,
  updateApprovalFlowConfig,
  updatePermisosRol,
} from '../services/api'
import '../styles/RolesPermissionsView.css'

const normalizePermissionName = (value) => String(value || '')
  .trim()
  .toUpperCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^A-Z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '')

const PERMISSION_SECTIONS = [
  {
    title: 'Dashboard',
    permissions: [
      { name: 'VER_DASHBOARD', label: 'Ver panel principal', description: 'Accede al inicio y resumen general del sistema.' },
    ],
  },
  {
    title: 'Inventario',
    permissions: [
      { name: 'VER_INVENTARIO', label: 'Ver inventario', description: 'Consulta materiales y stock.' },
      { name: 'EDITAR_INVENTARIO', label: 'Editar inventario', description: 'Permite actualizar materiales y datos del catálogo.' },
      { name: 'AGREGAR_INVENTARIO_MANUAL', label: 'Agregar inventario manual', description: 'Permite registrar nuevos materiales manualmente en inventario.' },
    ],
  },
  {
    title: 'Solicitar requerimiento',
    permissions: [
      { name: 'CREAR_REQUERIMIENTO', label: 'Crear requerimiento', description: 'Permite registrar nuevos pedidos internos.' },
    ],
  },
  {
    title: 'Solicitar compra',
    permissions: [
      { name: 'CREAR_SOLICITUD_COMPRA', label: 'Crear solicitud de compra', description: 'Permite registrar solicitudes para adquirir materiales.' },
    ],
  },
    {
    title: 'Compras directas',
    permissions: [
      { name: 'CREAR_COMPRA_DIRECTA', label: 'Crear compra directa', description: 'Permite crear compras directas.' },
      { name: 'VER_HISTORIAL_COMPRAS_DIRECTAS', label: 'Ver historial de compras directas', description: 'Permite ver el historial de compras directas.' },
    ],
  },
  {
    title: 'Solicitar servicio',
    permissions: [
      { name: 'CREAR_SOLICITUD_SERVICIO', label: 'Crear solicitud de servicio', description: 'Permite registrar servicios a solicitar.' },
      { name: 'CAMBIAR_ESTADO_SERVICIO', label: 'Actualizar servicio', description: 'Permite cambiar el estado operativo de un servicio.' },
    ],
  },
  {
    title: 'Calificar productos y servicios',
    permissions: [
      { name: 'CALIFICAR_COMPRA', label: 'Calificar productos de compras', description: 'Permite calificar entregas vinculadas al flujo de compra.' },
      { name: 'CALIFICAR_REQUERIMIENTO', label: 'Calificar productos de requerimientos', description: 'Permite calificar entregas vinculadas al flujo de requerimiento.' },
      { name: 'CALIFICAR_SERVICIO', label: 'Calificar servicios', description: 'Permite calificar servicios realizados en el historial de servicios.' },
    ],
  },
  {
    title: 'Mis ordenes',
    permissions: [
      { name: 'GESTIONAR_COMPRAS', label: 'Gestionar compras', description: 'Permite acceder al módulo Mis órdenes para ver y gestionar órdenes de compra.' },
    ],
  },
  {
    title: 'Gestionar entregas',
    permissions: [
      { name: 'GESTIONAR_ENTREGAS', label: 'Gestionar entregas', description: 'Permite registrar y controlar entregas.' },
    ],
  },
  {
    title: 'Historial de servicios',
    permissions: [
      { name: 'VER_HISTORIAL_SERVICIOS', label: 'Ver historial de servicios', description: 'Permite acceder al historial de servicios.' },
    ],
  },
  {
    title: 'Movimientos',
    permissions: [
      { name: 'VER_MOVIMIENTOS', label: 'Ver movimientos', description: 'Habilita el modulo de Movimientos en el menu lateral.' },
    ],
  },
  {
    title: 'Gestión de proveedores',
    permissions: [
      { name: 'GESTIONAR_PROVEEDORES', label: 'Gestionar proveedores', description: 'Permite crear, editar y administrar proveedores.' },
    ],
  },
  {
    title: 'Ajustes',
    permissions: [
      { name: 'VER_AJUSTES', label: 'Ver ajustes', description: 'Permite acceder a la pantalla de ajustes del usuario.' },
    ],
  },
  {
    title: 'Notificaciones',
    permissions: [
      { name: 'VER_NOTIFICACIONES_PROVEEDOR', label: 'Ver alertas de proveedores', description: 'Permite ver alertas de proveedores con calificación baja.' },
    ],
  },
  {
    title: 'Roles y permisos',
    permissions: [
      { name: 'GESTIONAR_ROLES', label: 'Gestionar roles y permisos', description: 'Permite crear roles y administrar sus permisos.' },
    ],
  },
  {
    title: 'Cuentas de usuario',
    permissions: [
      { name: 'GESTIONAR_CUENTAS', label: 'Gestionar cuentas', description: 'Permite ver, crear, editar y eliminar cuentas de usuario.' },
    ],
  },
]

const permissionMetaByName = PERMISSION_SECTIONS.flatMap((section) => section.permissions).reduce((accumulator, permission) => {
  accumulator[normalizePermissionName(permission.name)] = permission
  return accumulator
}, {})

const APPROVAL_FLOWS = [
  { key: 'COMPRA', label: 'Flujo de compras' },
  { key: 'SERVICIO_DENTRO_PLAN', label: 'Flujo de servicios dentro del plan' },
  { key: 'SERVICIO_FUERA_PLAN', label: 'Flujo de servicios fuera del plan' },
]

export default function RolesPermissionsView() {
  const [roles, setRoles] = useState([])
  const [permisos, setPermisos] = useState([])
  const [selectedRoleId, setSelectedRoleId] = useState(null)
  const [selectedPermissionIds, setSelectedPermissionIds] = useState([])
  const [newRoleName, setNewRoleName] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deletingRoleId, setDeletingRoleId] = useState(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [approvalConfigByFlow, setApprovalConfigByFlow] = useState({})
  const [approvalSavingFlow, setApprovalSavingFlow] = useState('')
  const [expandedApprovalFlowKey, setExpandedApprovalFlowKey] = useState(null)

  const selectedRole = useMemo(
    () => roles.find((role) => Number(role.id) === Number(selectedRoleId)) || null,
    [roles, selectedRoleId]
  )

  const roleNameById = useMemo(() => {
    return roles.reduce((accumulator, role) => {
      accumulator[Number(role.id || 0)] = String(role.nombre || '').trim()
      return accumulator
    }, {})
  }, [roles])

  const visibleSections = useMemo(() => {
    return PERMISSION_SECTIONS
      .map((section) => ({
        ...section,
        sectionPermissions: permisos.filter((permiso) => {
          const permisoName = normalizePermissionName(permiso.nombre)
          return section.permissions.some((item) => normalizePermissionName(item.name) === permisoName)
        }),
      }))
      .filter((section) => section.sectionPermissions.length > 0)
  }, [permisos])

  const permissionNameById = useMemo(() => {
    return permisos.reduce((accumulator, permiso) => {
      const id = Number(permiso.id || 0)
      if (!Number.isInteger(id) || id <= 0) return accumulator
      accumulator[id] = normalizePermissionName(permiso.nombre)
      return accumulator
    }, {})
  }, [permisos])

  const loadBaseData = async () => {
    setLoading(true)
    setError('')

    try {
      const [rolesData, permisosData, approvalConfigData] = await Promise.all([
        fetchRoles(),
        fetchPermisos(),
        fetchApprovalConfig(),
      ])

      const normalizedRoles = Array.isArray(rolesData) ? rolesData : []
      const normalizedPermisos = Array.isArray(permisosData) ? permisosData : []
      setRoles(normalizedRoles)
      setPermisos(normalizedPermisos)

      const rawFlows = approvalConfigData?.flujos && typeof approvalConfigData.flujos === 'object'
        ? approvalConfigData.flujos
        : {}
      const normalizedFlowConfig = {}
      APPROVAL_FLOWS.forEach((flow) => {
        const rows = Array.isArray(rawFlows[flow.key]) ? rawFlows[flow.key] : []
        normalizedFlowConfig[flow.key] = rows
          .map((row) => Number(row?.rol_id || 0))
          .filter((id) => Number.isInteger(id) && id > 0)
      })
      setApprovalConfigByFlow(normalizedFlowConfig)

      const firstRoleId = Number(normalizedRoles[0]?.id || 0) || null
      setSelectedRoleId(firstRoleId)
    } catch (err) {
      setError(err.message || 'No se pudo cargar el modulo de roles y permisos')
    } finally {
      setLoading(false)
    }
  }

  const loadRolePermissions = async (roleId) => {
    if (!Number.isInteger(Number(roleId)) || Number(roleId) <= 0) {
      setSelectedPermissionIds([])
      return
    }

    try {
      setError('')
      const data = await fetchPermisosRol(roleId)
      const permissionIds = (Array.isArray(data?.permisos) ? data.permisos : [])
        .map((item) => Number(item.id || 0))
        .filter((id) => Number.isInteger(id) && id > 0)

      setSelectedPermissionIds(permissionIds)
    } catch (err) {
      setSelectedPermissionIds([])
      setError(err.message || 'No se pudieron cargar los permisos del rol')
    }
  }

  useEffect(() => {
    loadBaseData()
  }, [])

  useEffect(() => {
    if (!selectedRoleId) return
    if (!Array.isArray(permisos) || permisos.length === 0) return
    loadRolePermissions(selectedRoleId)
  }, [permisos, selectedRoleId])

  const togglePermission = (permissionId) => {
    const id = Number(permissionId || 0)
    if (!id) return

    setSelectedPermissionIds((prev) => {
      const current = new Set(prev)
      const toggledName = permissionNameById[id] || ''

      if (current.has(id)) {
        current.delete(id)

        if (toggledName === 'VER_INVENTARIO') {
          Object.entries(permissionNameById).forEach(([permissionId, permissionName]) => {
            if (permissionName === 'EDITAR_INVENTARIO') {
              current.delete(Number(permissionId))
            }
          })
        }
      } else {
        current.add(id)

        if (toggledName === 'EDITAR_INVENTARIO') {
          Object.entries(permissionNameById).forEach(([permissionId, permissionName]) => {
            if (permissionName === 'VER_INVENTARIO') {
              current.add(Number(permissionId))
            }
          })
        }
      }

      return [...current]
    })
  }

  const handleCreateRole = async (event) => {
    event.preventDefault()
    setError('')
    setSuccess('')

    const name = String(newRoleName || '').trim()
    if (!name) {
      setError('Nombre de rol es obligatorio')
      return
    }

    try {
      setSaving(true)
      const created = await createRol({ nombre: name })
      const createdId = Number(created?.id || 0)
      setNewRoleName('')
      setSuccess('Rol creado correctamente')
      await loadBaseData()
      if (createdId > 0) {
        setSelectedRoleId(createdId)
      }
    } catch (err) {
      setError(err.message || 'No se pudo crear el rol')
    } finally {
      setSaving(false)
    }
  }

  const handleSavePermissions = async () => {
    if (!selectedRoleId) {
      setError('Selecciona un rol para guardar cambios')
      return
    }

    try {
      setSaving(true)
      setError('')
      setSuccess('')
      await updatePermisosRol(selectedRoleId, selectedPermissionIds)
      setSuccess('Permisos actualizados correctamente')
      await loadRolePermissions(selectedRoleId)
    } catch (err) {
      setError(err.message || 'No se pudieron actualizar los permisos del rol')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteRole = async () => {
    const roleId = Number(selectedRole?.id || 0)
    if (!Number.isInteger(roleId) || roleId <= 0) return

    const roleName = String(selectedRole?.nombre || `#${roleId}`)
    const confirmed = window.confirm(`Se eliminara el rol "${roleName}". Esta accion no se puede deshacer. ¿Deseas continuar?`)
    if (!confirmed) return

    try {
      setDeletingRoleId(roleId)
      setError('')
      setSuccess('')
      await deleteRol(roleId)
      await loadBaseData()
      setSuccess('Rol eliminado correctamente')
    } catch (err) {
      setError(err.message || 'No se pudo eliminar el rol')
    } finally {
      setDeletingRoleId(null)
    }
  }

  const toggleFlowRole = (flowKey, roleId) => {
    const id = Number(roleId || 0)
    if (!id) return

    setApprovalConfigByFlow((prev) => {
      const current = Array.isArray(prev[flowKey]) ? prev[flowKey] : []
      if (current.includes(id)) {
        return {
          ...prev,
          [flowKey]: current.filter((value) => value !== id),
        }
      }

      return {
        ...prev,
        [flowKey]: [...current, id],
      }
    })
  }

  const moveFlowRole = (flowKey, roleId, direction) => {
    const id = Number(roleId || 0)
    if (!id) return

    setApprovalConfigByFlow((prev) => {
      const current = Array.isArray(prev[flowKey]) ? prev[flowKey] : []
      const index = current.indexOf(id)
      if (index < 0) return prev

      const nextIndex = direction === 'up' ? index - 1 : index + 1
      if (nextIndex < 0 || nextIndex >= current.length) return prev

      const next = [...current]
      const temp = next[index]
      next[index] = next[nextIndex]
      next[nextIndex] = temp

      return {
        ...prev,
        [flowKey]: next,
      }
    })
  }

  const handleSaveFlow = async (flowKey) => {
    const roleIds = Array.isArray(approvalConfigByFlow[flowKey]) ? approvalConfigByFlow[flowKey] : []
    if (roleIds.length === 0) {
      setError('Cada flujo debe tener al menos un rol aprobador')
      return
    }

    try {
      setError('')
      setSuccess('')
      setApprovalSavingFlow(flowKey)
      await updateApprovalFlowConfig(flowKey, roleIds)
      setSuccess(`Flujo ${flowKey} actualizado correctamente`)
    } catch (err) {
      setError(err.message || 'No se pudo actualizar el flujo de aprobaciones')
    } finally {
      setApprovalSavingFlow('')
    }
  }

  return (
    <section className="roles-permissions-page">
      <header className="roles-permissions-header">
        <h2>Gestión de Roles y Permisos</h2>
      </header>

      <form className="role-create-form" onSubmit={handleCreateRole}>
        <input
          type="text"
          placeholder="Nombre del nuevo rol"
          value={newRoleName}
          onChange={(event) => setNewRoleName(event.target.value)}
          disabled={saving}
        />
        <button type="submit" disabled={saving}>{saving ? 'Guardando...' : 'Crear rol'}</button>
      </form>

      {error && <div className="roles-permissions-message error">{error}</div>}
      {success && <div className="roles-permissions-message success">{success}</div>}

      <article className="permissions-section-card approval-config-card standalone-approval-config-card">
        <div className="permissions-section-header">
          <h4>Aprobaciones dinámicas</h4>
        </div>

        <div className="approval-config-grid">
          {APPROVAL_FLOWS.map((flow) => {
            const selected = Array.isArray(approvalConfigByFlow[flow.key]) ? approvalConfigByFlow[flow.key] : []
            const selectedSet = new Set(selected)
            const availableRoles = roles.filter((role) => !selectedSet.has(Number(role.id || 0)))
            const isExpanded = expandedApprovalFlowKey === flow.key

            return (
              <section key={flow.key} className="approval-flow-card">
                <button
                  type="button"
                  className="approval-flow-toggle"
                  onClick={() => setExpandedApprovalFlowKey((current) => (current === flow.key ? null : flow.key))}
                  aria-expanded={isExpanded}
                  aria-controls={`approval-flow-body-${flow.key}`}
                >
                  <span className="approval-flow-toggle-label">{flow.label}</span>
                  <span className="approval-flow-toggle-meta">
                    <strong>{selected.length}</strong>
                    <span>pasos</span>
                    <span className="approval-flow-toggle-icon">{isExpanded ? '−' : '+'}</span>
                  </span>
                </button>

                {isExpanded && (
                  <div id={`approval-flow-body-${flow.key}`} className="approval-flow-body">
                    <div className="approval-flow-step-list">
                      {selected.length === 0 ? (
                        <div className="approval-flow-empty">No hay pasos definidos</div>
                      ) : selected.map((roleId, index) => (
                        <div key={`${flow.key}-step-${roleId}`} className="approval-flow-step-item">
                          <div className="approval-flow-step-main">
                            <span className="approval-flow-step-number">{index + 1}</span>
                            <strong>{roleNameById[roleId] || `Rol #${roleId}`}</strong>
                          </div>
                          <button
                            type="button"
                            className="approval-flow-step-remove"
                            onClick={() => toggleFlowRole(flow.key, roleId)}
                            disabled={saving || Boolean(approvalSavingFlow)}
                            aria-label="Quitar del flujo"
                            title="Quitar del flujo"
                          >
                            ×
                          </button>
                          <div className="approval-flow-step-actions">
                            <button
                              type="button"
                              onClick={() => moveFlowRole(flow.key, roleId, 'up')}
                              disabled={saving || Boolean(approvalSavingFlow) || index === 0}
                              aria-label="Mover arriba"
                              title="Mover arriba"
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              onClick={() => moveFlowRole(flow.key, roleId, 'down')}
                              disabled={saving || Boolean(approvalSavingFlow) || index === selected.length - 1}
                              aria-label="Mover abajo"
                              title="Mover abajo"
                            >
                              ↓
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="approval-flow-available-title">Agregar roles al flujo</div>
                    <div className="approval-flow-list">
                      {availableRoles.map((role) => {
                        const roleId = Number(role.id || 0)
                        return (
                          <button
                            key={`${flow.key}-${roleId}`}
                            type="button"
                            className="approval-flow-add-item"
                            onClick={() => toggleFlowRole(flow.key, roleId)}
                            disabled={saving || Boolean(approvalSavingFlow)}
                          >
                            <span>Agregar</span>
                            <strong>{role.nombre}</strong>
                          </button>
                        )
                      })}
                    </div>

                    <button
                      type="button"
                      className="approval-save-btn"
                      onClick={() => handleSaveFlow(flow.key)}
                      disabled={saving || Boolean(approvalSavingFlow)}
                    >
                      {approvalSavingFlow === flow.key ? 'Guardando...' : 'Guardar flujo'}
                    </button>
                  </div>
                )}
              </section>
            )
          })}
        </div>
      </article>

      {loading ? (
        <div className="roles-permissions-loading">Cargando roles y permisos...</div>
      ) : (
        <div className="roles-permissions-layout">
          <aside className="roles-list-panel">
            <h3>Roles</h3>
            <div className="roles-list">
              {roles.map((role) => {
                const isActive = Number(selectedRoleId) === Number(role.id)
                return (
                  <button
                    key={role.id}
                    type="button"
                    className={`role-item ${isActive ? 'active' : ''}`}
                    onClick={() => setSelectedRoleId(Number(role.id || 0) || null)}
                  >
                    <span className="role-id">#{role.id}</span>
                    <span className="role-name">{role.nombre}</span>
                  </button>
                )
              })}
            </div>
          </aside>

          <section className="permissions-panel">
            <div className="permissions-header">
              <h3>{selectedRole ? `Permisos de ${selectedRole.nombre}` : 'Selecciona un rol'}</h3>
              <div className="permissions-actions">
                <button type="button" onClick={handleSavePermissions} disabled={!selectedRoleId || saving}>
                  {saving ? 'Guardando...' : 'Guardar cambios'}
                </button>
                <button
                  type="button"
                  className="permissions-delete-btn"
                  onClick={handleDeleteRole}
                  disabled={!selectedRoleId || saving || Number(deletingRoleId) === Number(selectedRoleId)}
                >
                  {Number(deletingRoleId) === Number(selectedRoleId) ? 'Eliminando...' : 'Eliminar rol'}
                </button>
              </div>
            </div>

            <div className="permissions-section-list">
              {visibleSections.map((section) => {
                return (
                  <article key={section.title} className="permissions-section-card">
                    <div className="permissions-section-header">
                      <h4>{section.title}</h4>
                    </div>

                    <div className="permissions-grid">
                      {section.sectionPermissions.map((permiso) => {
                        const permissionId = Number(permiso.id || 0)
                        const checked = selectedPermissionIds.includes(permissionId)
                        const meta = permissionMetaByName[normalizePermissionName(permiso.nombre)] || {}

                        return (
                          <label key={permiso.id} className="permission-item">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => togglePermission(permissionId)}
                              disabled={!selectedRoleId || saving}
                            />
                            <span className="permission-text">
                              <span className="permission-name">{meta.label || permiso.nombre}</span>
                              <span className="permission-description">{meta.description || permiso.nombre}</span>
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  </article>
                )
              })}
            </div>
          </section>
        </div>
      )}
    </section>
  )

}
