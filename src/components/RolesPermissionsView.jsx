import { useEffect, useMemo, useState } from 'react'
import {
  createRol,
  fetchPermisos,
  fetchPermisosRol,
  fetchRoles,
  updatePermisosRol,
} from '../services/api'
import { getPermissionsByRole } from '../services/permissions'
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
    title: 'Solicitar servicio',
    permissions: [
      { name: 'CREAR_SOLICITUD_SERVICIO', label: 'Crear solicitud de servicio', description: 'Permite registrar servicios a solicitar.' },
      { name: 'CAMBIAR_ESTADO_SERVICIO', label: 'Actualizar servicio', description: 'Permite cambiar el estado operativo de un servicio.' },
    ],
  },
  {
    title: 'Gestionar solicitudes',
    permissions: [
      { name: 'APROBAR_JEFE_AREA', label: 'Aprobar jefe de area/subgerente', description: 'Primera etapa de aprobación jerárquica.' },
      { name: 'APROBAR_GERENCIA_AREA', label: 'Aprobar en gerencia', description: 'Segunda etapa de aprobación jerárquica.' },
      { name: 'APROBAR_FINANZAS', label: 'Aprobar en finanzas', description: 'Tercera etapa de aprobación jerárquica.' },
      { name: 'APROBAR_ADMIN', label: 'Aprobar en administración', description: 'Etapa final de aprobación antes del cierre.' },
    ],
  },
  {
    title: 'Calificar productos',
    permissions: [
      { name: 'CALIFICAR_COMPRA', label: 'Calificar productos de compras', description: 'Permite calificar entregas vinculadas al flujo de compra.' },
      { name: 'CALIFICAR_REQUERIMIENTO', label: 'Calificar productos de requerimientos', description: 'Permite calificar entregas vinculadas al flujo de requerimiento.' },
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
]

const permissionMetaByName = PERMISSION_SECTIONS.flatMap((section) => section.permissions).reduce((accumulator, permission) => {
  accumulator[normalizePermissionName(permission.name)] = permission
  return accumulator
}, {})

export default function RolesPermissionsView() {
  const [roles, setRoles] = useState([])
  const [permisos, setPermisos] = useState([])
  const [selectedRoleId, setSelectedRoleId] = useState(null)
  const [selectedPermissionIds, setSelectedPermissionIds] = useState([])
  const [newRoleName, setNewRoleName] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const selectedRole = useMemo(
    () => roles.find((role) => Number(role.id) === Number(selectedRoleId)) || null,
    [roles, selectedRoleId]
  )

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
      const [rolesData, permisosData] = await Promise.all([
        fetchRoles(),
        fetchPermisos(),
      ])

      const normalizedRoles = Array.isArray(rolesData) ? rolesData : []
      const normalizedPermisos = Array.isArray(permisosData) ? permisosData : []
      setRoles(normalizedRoles)
      setPermisos(normalizedPermisos)

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

      // If role-permission rows are empty in DB, show effective fallback permissions by role.
      if (permissionIds.length === 0) {
        const fallbackNames = getPermissionsByRole(Number(roleId)).map((name) => normalizePermissionName(name))
        const fallbackIds = permisos
          .filter((permiso) => fallbackNames.includes(normalizePermissionName(permiso.nombre)))
          .map((permiso) => Number(permiso.id || 0))
          .filter((id) => Number.isInteger(id) && id > 0)

        setSelectedPermissionIds(fallbackIds)
        return
      }

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

        // Si se quita VER_INVENTARIO, tambien se quita EDITAR_INVENTARIO.
        if (toggledName === 'VER_INVENTARIO') {
          Object.entries(permissionNameById).forEach(([permissionId, permissionName]) => {
            if (permissionName === 'EDITAR_INVENTARIO') {
              current.delete(Number(permissionId))
            }
          })
        }
      } else {
        current.add(id)

        // Si se activa EDITAR_INVENTARIO, asegurar VER_INVENTARIO.
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

  return (
    <section className="roles-permissions-page">
      <header className="roles-permissions-header">
        <h2>Gestión de Roles y Permisos</h2>
        <p>Administra dinámicamente roles y permisos del sistema.</p>
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
              <button type="button" onClick={handleSavePermissions} disabled={!selectedRoleId || saving}>
                {saving ? 'Guardando...' : 'Guardar cambios'}
              </button>
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
