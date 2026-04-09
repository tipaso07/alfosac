// Configuración de la API
export const API_BASE_URL = 'http://localhost:5000/api';
export const CURRENT_USER_ID = 1;

const getStoredUserId = () => String(localStorage.getItem('userId') || CURRENT_USER_ID);
const getAuthToken = () => String(localStorage.getItem('authToken') || '');

const buildHeaders = ({ includeJson = false, extra = {} } = {}) => {
  const headers = {
    ...extra,
    'x-user-id': getStoredUserId(),
  };

  if (includeJson) {
    headers['Content-Type'] = 'application/json';
  }

  const token = getAuthToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
};

export const API_ENDPOINTS = {
  MATERIALES: `${API_BASE_URL}/materiales`,
  REQUERIMIENTOS: `${API_BASE_URL}/requerimientos`,
  MOVIMIENTOS: `${API_BASE_URL}/movimientos`,
  SERVICIOS: `${API_BASE_URL}/servicios`,
  ME: `${API_BASE_URL}/me`,
  STATS: `${API_BASE_URL}/stats`,
  ADMIN_DASHBOARD: `${API_BASE_URL}/admin-dashboard`,
};

export const fetchMateriales = async () => {
  const response = await fetch(API_ENDPOINTS.MATERIALES, {
    headers: buildHeaders(),
  });
  if (!response.ok) throw new Error('Error al obtener materiales');
  return response.json();
};

export const fetchStats = async () => {
  const response = await fetch(API_ENDPOINTS.STATS, {
    headers: buildHeaders(),
  });
  if (!response.ok) throw new Error('Error al obtener estadisticas');
  return response.json();
};

export const fetchAdminDashboard = async ({ fecha_inicio = '', fecha_fin = '' } = {}) => {
  const params = new URLSearchParams();
  if (String(fecha_inicio || '').trim()) params.set('fecha_inicio', String(fecha_inicio).trim());
  if (String(fecha_fin || '').trim()) params.set('fecha_fin', String(fecha_fin).trim());
  const query = params.toString();

  const response = await fetch(`${API_ENDPOINTS.ADMIN_DASHBOARD}${query ? `?${query}` : ''}`, {
    headers: buildHeaders(),
  });

  if (!response.ok) {
    let msg = 'Error al obtener dashboard administrativo';
    try {
      const data = await response.json();
      if (data?.error) msg = data.error;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }

  return response.json();
};

export const createMaterial = async (material) => {
  const response = await fetch(API_ENDPOINTS.MATERIALES, {
    method: 'POST',
    headers: buildHeaders({ includeJson: true }),
    body: JSON.stringify(material),
  });
  if (!response.ok) throw new Error('Error al crear material');
  return response.json();
};

export const updateMaterial = async (id, material) => {
  const response = await fetch(`${API_ENDPOINTS.MATERIALES}/${id}`, {
    method: 'PUT',
    headers: buildHeaders({ includeJson: true }),
    body: JSON.stringify(material),
  });
  if (!response.ok) throw new Error('Error al actualizar material');
  return response.json();
};

export const deleteMaterial = async (id) => {
  const response = await fetch(`${API_ENDPOINTS.MATERIALES}/${id}`, {
    method: 'DELETE',
    headers: buildHeaders(),
  });
  if (!response.ok) throw new Error('Error al eliminar material');
  return response.json();
};

export const createRequerimiento = async (payload) => {
  const response = await fetch(API_ENDPOINTS.REQUERIMIENTOS, {
    method: 'POST',
    headers: buildHeaders({ includeJson: true }),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let msg = 'Error al crear requerimiento';
    try {
      const data = await response.json();
      if (data?.error) msg = data.error;
    } catch {
      // ignore parse error
    }
    throw new Error(msg);
  }

  return response.json();
};

export const fetchCurrentUser = async () => {
  const response = await fetch(API_ENDPOINTS.ME, {
    headers: buildHeaders(),
  });
  if (!response.ok) throw new Error('Error al obtener usuario actual');
  return response.json();
};

export const updateCurrentUserPhoto = async (foto) => {
  const response = await fetch(`${API_BASE_URL}/me/foto`, {
    method: 'PATCH',
    headers: buildHeaders({ includeJson: true }),
    body: JSON.stringify({ foto }),
  });

  if (!response.ok) {
    let msg = 'Error al actualizar foto';
    try {
      const data = await response.json();
      if (data?.error) msg = data.error;
    } catch {
      // ignore parse error
    }
    throw new Error(msg);
  }

  return response.json();
};

export const fetchRequerimientos = async () => {
  const response = await fetch(API_ENDPOINTS.REQUERIMIENTOS, {
    headers: buildHeaders(),
  });
  if (!response.ok) throw new Error('Error al obtener requerimientos');
  return response.json();
};

export const updateRequerimientoEstado = async (id, estado, extraData = {}) => {
  const response = await fetch(`${API_ENDPOINTS.REQUERIMIENTOS}/${id}/estado`, {
    method: 'PATCH',
    headers: buildHeaders({ includeJson: true }),
    body: JSON.stringify({ estado, ...extraData }),
  });

  if (!response.ok) {
    let msg = 'Error al actualizar estado del requerimiento';
    try {
      const data = await response.json();
      if (data?.error) msg = data.error;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }

  return response.json();
};

export const updateRequerimientoEntrega = async (id, estado_entrega, receptor_user_id) => {
  const response = await fetch(`${API_ENDPOINTS.REQUERIMIENTOS}/${id}/estado-entrega`, {
    method: 'PATCH',
    headers: buildHeaders({ includeJson: true }),
    body: JSON.stringify({ estado_entrega, receptor_user_id }),
  });

  if (!response.ok) {
    let msg = 'Error al actualizar estado de entrega';
    try {
      const data = await response.json();
      if (data?.error) msg = data.error;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }

  return response.json();
};

export const agregarComentarioRequerimiento = async (id, contenido) => {
  const response = await fetch(`${API_ENDPOINTS.REQUERIMIENTOS}/${id}/comentarios`, {
    method: 'POST',
    headers: buildHeaders({ includeJson: true }),
    body: JSON.stringify({ contenido }),
  });

  if (!response.ok) {
    let msg = 'Error al agregar comentario en requerimiento';
    try {
      const data = await response.json();
      if (data?.error) msg = data.error;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }

  return response.json();
};

export const fetchReceptoresByRequerimiento = async (idRequerimiento, query = '') => {
  const params = new URLSearchParams();
  if (query) params.set('query', query);

  const response = await fetch(
    `${API_ENDPOINTS.REQUERIMIENTOS}/${idRequerimiento}/receptores?${params.toString()}`,
    { headers: buildHeaders() }
  );

  if (!response.ok) {
    let msg = 'Error al buscar usuarios receptores';
    try {
      const data = await response.json();
      if (data?.error) msg = data.error;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }

  return response.json();
};

export const fetchReceptoresByCompra = async (idCompra, query = '') => {
  const params = new URLSearchParams();
  if (query) params.set('query', query);

  const response = await fetch(
    `${API_BASE_URL}/compras/${idCompra}/receptores?${params.toString()}`,
    { headers: buildHeaders() }
  );

  if (!response.ok) {
    let msg = 'Error al buscar receptores para la orden';
    try {
      const data = await response.json();
      if (data?.error) msg = data.error;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }

  return response.json();
};

export const fetchMovimientos = async () => {
  const response = await fetch(API_ENDPOINTS.MOVIMIENTOS, {
    headers: buildHeaders(),
  });
  if (!response.ok) throw new Error('Error al obtener movimientos');
  return response.json();
};

export const fetchCategorias = async () => {
  const response = await fetch(`${API_BASE_URL}/categorias`, {
    headers: buildHeaders(),
  });
  if (!response.ok) throw new Error('Error al obtener categorías');
  return response.json();
};

export const fetchMonedas = async () => {
  const response = await fetch(`${API_BASE_URL}/monedas`, {
    headers: buildHeaders(),
  });
  if (!response.ok) throw new Error('Error al obtener monedas');
  return response.json();
};

export const fetchAreas = async (query = '') => {
  const params = new URLSearchParams();
  const term = String(query || '').trim();
  if (term) params.set('query', term);

  const suffix = params.toString() ? `?${params.toString()}` : '';
  const response = await fetch(`${API_BASE_URL}/areas${suffix}`, {
    headers: buildHeaders(),
  });
  if (!response.ok) throw new Error('Error al obtener areas');
  return response.json();
};

export const fetchProveedores = async (query = '') => {
  const params = new URLSearchParams();
  const term = String(query || '').trim();
  if (term) params.set('query', term);

  const suffix = params.toString() ? `?${params.toString()}` : '';
  const response = await fetch(`${API_BASE_URL}/proveedores${suffix}`, {
    headers: buildHeaders(),
  });
  if (!response.ok) throw new Error('Error al obtener proveedores');
  return response.json();
};

export const createProveedor = async (payload) => {
  const response = await fetch(`${API_BASE_URL}/proveedores`, {
    method: 'POST',
    headers: buildHeaders({ includeJson: true }),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let msg = 'Error al crear proveedor';
    try {
      const data = await response.json();
      if (data?.error) msg = data.error;
    } catch {
      // ignore parse error
    }
    throw new Error(msg);
  }

  return response.json();
};

export const updateProveedor = async (id, payload) => {
  const response = await fetch(`${API_BASE_URL}/proveedores/${id}`, {
    method: 'PUT',
    headers: buildHeaders({ includeJson: true }),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let msg = 'Error al actualizar proveedor';
    try {
      const data = await response.json();
      if (data?.error) msg = data.error;
    } catch {
      // ignore parse error
    }
    throw new Error(msg);
  }

  return response.json();
};

export const fetchProveedorCalificaciones = async (id) => {
  const response = await fetch(`${API_BASE_URL}/proveedores/${id}/calificaciones`, {
    headers: buildHeaders(),
  });

  if (!response.ok) {
    let msg = 'Error al obtener calificaciones del proveedor';
    try {
      const data = await response.json();
      if (data?.error) msg = data.error;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }

  return response.json();
};

export const fetchPromediosCalificacionProveedores = async () => {
  const response = await fetch(`${API_BASE_URL}/proveedores/calificaciones/promedios`, {
    headers: buildHeaders(),
  });

  if (!response.ok) {
    let msg = 'Error al obtener promedios de calificacion de proveedores';
    try {
      const data = await response.json();
      if (data?.error) msg = data.error;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }

  return response.json();
};

export const fetchMiCalificacionProveedor = async (id, { tipo = 'proveedor', id_referencia = null } = {}) => {
  const params = new URLSearchParams();
  if (tipo) params.set('tipo', String(tipo));
  if (Number(id_referencia || 0) > 0) params.set('id_referencia', String(Number(id_referencia)));

  const query = params.toString();
  const response = await fetch(
    `${API_BASE_URL}/proveedores/${id}/calificaciones${query ? `?${query}` : ''}`,
    { headers: buildHeaders() }
  );

  if (!response.ok) {
    let msg = 'Error al verificar calificacion del proveedor';
    try {
      const data = await response.json();
      if (data?.error) msg = data.error;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }

  const data = await response.json();
  return {
    ya_calificado: Boolean(data?.ya_calificado),
    detalle: data,
  };
};

export const guardarCalificacionProveedor = async (id, payload) => {
  const response = await fetch(`${API_BASE_URL}/proveedores/${id}/calificaciones`, {
    method: 'POST',
    headers: buildHeaders({ includeJson: true }),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let msg = 'Error al guardar calificacion del proveedor';
    try {
      const data = await response.json();
      if (data?.error) msg = data.error;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }

  return response.json();
};

export const fetchUnidades = async () => {
  const response = await fetch(`${API_BASE_URL}/unidades`, {
    headers: buildHeaders(),
  });
  if (!response.ok) throw new Error('Error al obtener unidades');
  return response.json();
};

export const fetchMisRequerimientos = async () => {
  const response = await fetch(`${API_BASE_URL}/mis-requerimientos`, {
    headers: buildHeaders(),
  });
  if (!response.ok) throw new Error('Error al obtener mis requerimientos');
  return response.json();
};

export const fetchUsuarios = async () => {
  const response = await fetch(`${API_BASE_URL}/usuarios`, {
    headers: buildHeaders(),
  });
  if (!response.ok) throw new Error('Error al obtener usuarios');
  return response.json();
};

export const fetchRoles = async () => {
  const response = await fetch(`${API_BASE_URL}/roles`, {
    headers: buildHeaders(),
  });
  if (!response.ok) throw new Error('Error al obtener roles');
  return response.json();
};

export const createUsuario = async (payload) => {
  const response = await fetch(`${API_BASE_URL}/usuarios`, {
    method: 'POST',
    headers: buildHeaders({ includeJson: true }),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let msg = 'Error al crear usuario';
    try {
      const data = await response.json();
      if (data?.error) msg = data.error;
    } catch {
      // ignore parse error
    }
    throw new Error(msg);
  }

  return response.json();
};

export const updateUsuario = async (id, payload) => {
  const response = await fetch(`${API_BASE_URL}/usuarios/${id}`, {
    method: 'PUT',
    headers: buildHeaders({ includeJson: true }),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let msg = 'Error al actualizar usuario';
    try {
      const data = await response.json();
      if (data?.error) msg = data.error;
    } catch {
      // ignore parse error
    }
    throw new Error(msg);
  }

  return response.json();
};

export const updateUsuarioPassword = async (id, payload) => {
  const response = await fetch(`${API_BASE_URL}/usuarios/${id}/password`, {
    method: 'PUT',
    headers: buildHeaders({ includeJson: true }),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let msg = 'Error al actualizar contraseña';
    try {
      const data = await response.json();
      if (data?.error) msg = data.error;
    } catch {
      // ignore parse error
    }
    throw new Error(msg);
  }

  return response.json();
};

export const deleteUsuario = async (id) => {
  const response = await fetch(`${API_BASE_URL}/usuarios/${id}`, {
    method: 'DELETE',
    headers: buildHeaders(),
  });

  if (!response.ok) {
    let msg = 'Error al eliminar usuario';
    try {
      const data = await response.json();
      if (data?.error) msg = data.error;
    } catch {
      // ignore parse error
    }
    throw new Error(msg);
  }

  return response.json();
};

export const createCompra = async (payload) => {
  const response = await fetch(`${API_BASE_URL}/compras`, {
    method: 'POST',
    headers: buildHeaders({ includeJson: true }),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let msg = 'Error al crear compra';
    try {
      const data = await response.json();
      if (data?.error) msg = data.error;
    } catch {
      // ignore parse error
    }
    throw new Error(msg);
  }

  return response.json();
};

export const fetchCompras = async () => {
  const response = await fetch(`${API_BASE_URL}/compras`, {
    headers: buildHeaders(),
  });
  if (!response.ok) throw new Error('Error al obtener compras');
  return response.json();
};

export const fetchMisCompras = async () => {
  const response = await fetch(`${API_BASE_URL}/mis-compras`, {
    headers: buildHeaders(),
  });
  if (!response.ok) throw new Error('Error al obtener mis compras');
  return response.json();
};

export const createServicio = async (payload) => {
  const response = await fetch(API_ENDPOINTS.SERVICIOS, {
    method: 'POST',
    headers: buildHeaders({ includeJson: true }),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let msg = 'Error al crear servicio';
    try {
      const data = await response.json();
      if (data?.error) msg = data.error;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }

  return response.json();
};

export const fetchServicios = async () => {
  const response = await fetch(API_ENDPOINTS.SERVICIOS, {
    headers: buildHeaders(),
  });
  if (!response.ok) throw new Error('Error al obtener servicios');
  return response.json();
};

export const fetchMisServicios = async () => {
  const response = await fetch(`${API_BASE_URL}/mis-servicios`, {
    headers: buildHeaders(),
  });
  if (!response.ok) throw new Error('Error al obtener mis servicios');
  return response.json();
};

export const fetchAprobacionesPendientes = async () => {
  const response = await fetch(`${API_BASE_URL}/aprobaciones/pendientes`, {
    headers: buildHeaders(),
  });
  if (!response.ok) throw new Error('Error al obtener aprobaciones pendientes');
  return response.json();
};

export const updateServicioAprobacion = async (id, estado_aprobacion) => {
  const response = await fetch(`${API_BASE_URL}/servicios/${id}/aprobar`, {
    method: 'PUT',
    headers: buildHeaders({ includeJson: true }),
    body: JSON.stringify({ estado_aprobacion }),
  });

  if (!response.ok) {
    let msg = 'Error al actualizar aprobacion de servicio';
    try {
      const data = await response.json();
      if (data?.error) msg = data.error;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }

  return response.json();
};

export const agregarComentarioServicio = async (id, contenido) => {
  const response = await fetch(`${API_BASE_URL}/servicios/${id}/comentarios`, {
    method: 'POST',
    headers: buildHeaders({ includeJson: true }),
    body: JSON.stringify({ contenido }),
  });

  if (!response.ok) {
    let msg = 'Error al agregar comentario en servicio';
    try {
      const data = await response.json();
      if (data?.error) msg = data.error;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }

  return response.json();
};

export const updateServicioEstado = async (id, estado_servicio) => {
  const response = await fetch(`${API_BASE_URL}/servicios/${id}/estado`, {
    method: 'PUT',
    headers: buildHeaders({ includeJson: true }),
    body: JSON.stringify({ estado_servicio }),
  });

  if (!response.ok) {
    let msg = 'Error al actualizar estado del servicio';
    try {
      const data = await response.json();
      if (data?.error) msg = data.error;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }

  return response.json();
};

export const completarServicioDatos = async (id, payload) => {
  const response = await fetch(`${API_BASE_URL}/servicios/${id}/completar-datos`, {
    method: 'PATCH',
    headers: buildHeaders({ includeJson: true }),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let msg = 'Error al completar datos del servicio';
    try {
      const data = await response.json();
      if (data?.error) msg = data.error;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }

  return response.json();
};

export const generarOrdenServicio = async (id) => {
  const response = await fetch(`${API_BASE_URL}/servicios/${id}/generar-orden`, {
    method: 'POST',
    headers: buildHeaders({ includeJson: true }),
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    let msg = 'Error al generar orden de servicio';
    try {
      const data = await response.json();
      if (data?.error) msg = data.error;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }

  return response.json();
};

export const descargarOrdenServicioPdf = async (id) => {
  const response = await fetch(`${API_BASE_URL}/servicios/${id}/pdf`, {
    headers: buildHeaders(),
  });
  if (!response.ok) throw new Error('Error al descargar PDF de servicio');
  return response.json();
};

export const updateCompraEstado = async (id, estado) => {
  const response = await fetch(`${API_BASE_URL}/compras/${id}/estado`, {
    method: 'PATCH',
    headers: buildHeaders({ includeJson: true }),
    body: JSON.stringify({ estado }),
  });

  if (!response.ok) {
    let msg = 'Error al actualizar estado de compra';
    try {
      const data = await response.json();
      if (data?.error) msg = data.error;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }

  return response.json();
};

export const agregarComentarioCompra = async (id, contenido) => {
  const response = await fetch(`${API_BASE_URL}/compras/${id}/comentarios`, {
    method: 'POST',
    headers: buildHeaders({ includeJson: true }),
    body: JSON.stringify({ contenido }),
  });

  if (!response.ok) {
    let msg = 'Error al agregar comentario en compra';
    try {
      const data = await response.json();
      if (data?.error) msg = data.error;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }

  return response.json();
};

export const completarCompraDatos = async (id, payload) => {
  const response = await fetch(`${API_BASE_URL}/compras/${id}/completar-datos`, {
    method: 'PATCH',
    headers: buildHeaders({ includeJson: true }),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let msg = 'Error al completar datos de compra';
    try {
      const data = await response.json();
      if (data?.error) msg = data.error;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }

  return response.json();
};

export const generarOrdenCompra = async (id) => {
  const response = await fetch(`${API_BASE_URL}/compras/${id}/generar-orden`, {
    method: 'POST',
    headers: buildHeaders({ includeJson: true }),
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    let msg = 'Error al generar orden de compra';
    try {
      const data = await response.json();
      if (data?.error) msg = data.error;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }

  return response.json();
};

export const descargarOrdenCompraPdf = async (id) => {
  const response = await fetch(`${API_BASE_URL}/compras/${id}/pdf`, {
    headers: buildHeaders(),
  });
  if (!response.ok) throw new Error('Error al descargar PDF');
  return response.json();
};

export const confirmarRecepcionCompra = async (id, payload) => {
  const response = await fetch(`${API_BASE_URL}/compras/${id}/recepcionar`, {
    method: 'PATCH',
    headers: buildHeaders({ includeJson: true }),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let msg = 'Error al confirmar recepción de compra';
    try {
      const data = await response.json();
      if (data?.error) msg = data.error;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }

  return response.json();
};

export const confirmarEntregaAreaCompra = async (id, payload) => {
  const response = await fetch(`${API_BASE_URL}/compras/${id}/entregar-area`, {
    method: 'PATCH',
    headers: buildHeaders({ includeJson: true }),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let msg = 'Error al confirmar entrega al area';
    try {
      const data = await response.json();
      if (data?.error) msg = data.error;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }

  return response.json();
};

export const marcarRecibidoEnAlmacen = async (id) => {
  const response = await fetch(`${API_BASE_URL}/compras/${id}/marcar-recibido-almacen`, {
    method: 'PATCH',
    headers: buildHeaders({ includeJson: true }),
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    let msg = 'Error al marcar compra como recibida en almacen';
    try {
      const data = await response.json();
      if (data?.error) msg = data.error;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }

  return response.json();
};

export const uploadMaterialImage = async (formData) => {
  const response = await fetch(`${API_BASE_URL}/upload/material`, {
    method: 'POST',
    headers: buildHeaders(),
    body: formData,
  });
  if (!response.ok) throw new Error('Error al subir imagen');
  return response.json();
};

// Auth
export const login = async (credentials) => {
  const response = await fetch(`${API_BASE_URL}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  });

  if (!response.ok) {
    let msg = 'Error al iniciar sesión';
    try {
      const data = await response.json();
      if (data?.error) msg = data.error;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }

  const data = await response.json();
  if (data?.token) {
    localStorage.setItem('authToken', data.token);
    localStorage.setItem('userId', String(data.user?.id || ''));
    if (data?.requires_password_change === true) {
      localStorage.setItem('requiresPasswordChange', 'true');
    }
  }
  return data;
};

export const changePassword = async (passwordData) => {
  const response = await fetch(`${API_BASE_URL}/me/cambiar-contrasena`, {
    method: 'PUT',
    headers: buildHeaders({ includeJson: true }),
    body: JSON.stringify(passwordData),
  });

  if (!response.ok) {
    let msg = 'Error al cambiar contraseña';
    try {
      const data = await response.json();
      if (data?.error) msg = data.error;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }

  return response.json();
};

// Auth helpers
export const hasActiveSession = () => {
  const token = localStorage.getItem('authToken');
  return !!token;
};

export const requiresPasswordChange = () => {
  return localStorage.getItem('requiresPasswordChange') === 'true';
};

export const clearAuthSession = () => {
  localStorage.removeItem('authToken');
  localStorage.removeItem('userId');
  localStorage.removeItem('requiresPasswordChange');
};
