const multer = require('multer');

module.exports = function(app, deps) {
  const { pool, authMiddleware, requirePermissions } = deps;

  const allowedImageMimeTypes = new Set(['image/jpeg', 'image/png']);
  const uploadsDir = require('path').join(__dirname, '..', 'uploads');

  const imageStorage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => {
      const ext = (file.originalname || '').split('.').pop() || 'jpg';
      cb(null, `material_${Date.now()}.${ext}`);
    },
  });

  const uploadImage = multer({
    storage: imageStorage,
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (allowedImageMimeTypes.has(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE'));
      }
    },
  });

  app.post('/api/upload/material', authMiddleware, requirePermissions('AGREGAR_INVENTARIO_MANUAL', 'EDITAR_INVENTARIO'), (req, res) => {
    uploadImage.single('image')(req, res, (error) => {
      if (error) {
        if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'La imagen no debe superar 2MB' });
        }
        return res.status(400).json({ error: error.message || 'Error subiendo imagen' });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'Debes enviar un archivo en el campo image' });
      }

      const imageUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
      return res.json({ url: imageUrl, path: `/uploads/${req.file.filename}` });
    });
  });
};
