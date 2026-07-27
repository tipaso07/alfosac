const { fetchProveedorNotifications } = require('../services/proveedores');

module.exports = function(app, deps) {
  const { pool, authMiddleware, requirePermissions } = deps;

  app.get('/api/notificaciones/proveedores', authMiddleware, requirePermissions('VER_NOTIFICACIONES_PROVEEDOR'), async (req, res) => {
    try {
      const notificaciones = await fetchProveedorNotifications(pool);

      res.json({
        usuario_destino: {
          id: req.user?.id || null,
          nombre: req.user?.nombre || 'Usuario',
        },
        permisos: Array.isArray(req.user?.permisos) ? req.user.permisos : [],
        total: notificaciones.length,
        notificaciones,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/notificaciones/proveedores/limpiar', authMiddleware, requirePermissions('VER_NOTIFICACIONES_PROVEEDOR'), async (req, res) => {
    try {
      const cleanupTimestamp = Date.now();

      res.json({
        success: true,
        cleanupTimestamp,
        message: 'Notificaciones limpiadas correctamente',
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
};
