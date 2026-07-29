const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const net = require('net');
require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });
const multer = require('multer');

const { pool, loadSchemaMeta, ROLE_NAME_BY_ID } = require('./db/pool');
const { loadRoleNamesCache, ensureCoreApprovalPermissions } = require('./services/approval');
const { ensureProveedoresColumns, ensureRequerimientosColumns, ensureComprasColumns, ensureMovimientosColumns } = require('./db/migrations');
const { seedInventoryDemoData } = require('./db/seeds');
const registerAuthRoutes = require('./middleware/auth').registerAuthRoutes;
const registerRoutes = require('./routes/index');

const app = express();
const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:5173';
app.use(cors({ origin: corsOrigin.split(',').map(s => s.trim()), credentials: true }));
app.use(express.json({ limit: '10mb' }));

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));

const companyBlueLogoPath = path.join(__dirname, '..', 'public', 'alfosac-logo-azul.png');
const companyWhiteLogoPath = path.join(__dirname, '..', 'public', 'alfosac-logo-blanco.png');

const allowedImageMimeTypes = new Set(['image/jpeg', 'image/png']);

const imageStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (_req, file, cb) => {
    const originalName = String(file.originalname || 'imagen').replace(/[^a-zA-Z0-9._-]/g, '_');
    const ext = path.extname(originalName || '').toLowerCase();
    const safeExt = ext === '.jpg' || ext === '.jpeg' || ext === '.png' ? ext : '.jpg';
    cb(null, `material-${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`);
  },
});

const uploadImage = multer({
  storage: imageStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!allowedImageMimeTypes.has(String(file.mimetype || '').toLowerCase())) {
      cb(new Error('Solo se permiten archivos JPG, JPEG o PNG'));
      return;
    }
    cb(null, true);
  },
});

const configuredDbHost = process.env.DB_HOST || 'localhost';
const effectiveDbHost = configuredDbHost === 'postgres' && process.platform === 'win32'
  ? 'localhost'
  : configuredDbHost;

const PORT = process.env.PORT || 5000;

const isPortInUse = (port) => new Promise((resolve) => {
  const socket = new net.Socket();
  socket.setTimeout(1000);
  socket.once('connect', () => {
    socket.destroy();
    resolve(true);
  });
  socket.once('timeout', () => {
    socket.destroy();
    resolve(false);
  });
  socket.once('error', () => {
    resolve(false);
  });
  socket.connect(port, '127.0.0.1');
});

const startServer = async () => {
  if (configuredDbHost !== effectiveDbHost) {
    console.warn(`DB_HOST=${configuredDbHost} no es resolvible desde Windows host. Usando ${effectiveDbHost} temporalmente.`);
  }

  await loadSchemaMeta();
  await ensureProveedoresColumns();
  await ensureCoreApprovalPermissions();
  await loadRoleNamesCache();

  if (String(process.env.RUN_DEMO_SEED || 'false').toLowerCase() === 'true') {
    await seedInventoryDemoData();
  }

  if (await isPortInUse(PORT)) {
    console.error(`El puerto ${PORT} ya esta en uso. Si el backend ya esta corriendo, usa esa instancia o libera el puerto antes de iniciar otra.`);
    process.exit(1);
    return;
  }

  // Landing page
  app.get('/', (req, res) => {
    res.status(200).send(`
      <html>
        <head>
          <title>ALFOSAC API</title>
          <meta charset="utf-8" />
          <style>
            body {
              font-family: Arial, sans-serif;
              background: #f8fafc;
              color: #0f172a;
              display: grid;
              place-items: center;
              min-height: 100vh;
              margin: 0;
            }
            main {
              background: white;
              padding: 24px 28px;
              border-radius: 14px;
              box-shadow: 0 10px 30px rgba(15, 23, 42, 0.12);
              max-width: 520px;
            }
            h1 {
              margin: 0 0 12px;
              font-size: 24px;
            }
            p {
              margin: 8px 0;
              line-height: 1.5;
            }
            a {
              color: #0f766e;
              text-decoration: none;
            }
          </style>
        </head>
        <body>
          <main>
            <h1>ALFOSAC API</h1>
            <p>El backend esta en linea.</p>
            <p>Estado de salud: <a href="/api/health">/api/health</a></p>
          </main>
        </body>
      </html>
    `);
  });

  // Auth routes (login, logout, /api/me, etc.)
  registerAuthRoutes(app);

  // All other routes
  registerRoutes(app, {
    pool,
    authMiddleware: require('./middleware/auth').authMiddleware,
    requireRoles: require('./middleware/auth').requireRoles,
    requireRoleIds: require('./middleware/auth').requireRoleIds,
    requirePermissions: require('./middleware/permissions').requirePermissions,
    requireAdmin: require('./middleware/auth').requireAdmin,
    requireCompras: require('./middleware/auth').requireCompras,
    requireRoleAdminOrCompras: require('./middleware/auth').requireRoleAdminOrCompras,
    hasPurchaseOrdersAccess: require('./middleware/auth').hasPurchaseOrdersAccess,
    uploadImage,
    ROLE_NAME_BY_ID,
  });

  const server = app.listen(PORT, () => {
    console.log(`Servidor ejecutandose en http://localhost:${PORT}`);
    console.log(`Base de datos: ${process.env.DB_NAME}`);
    console.log(`Host BD en uso: ${effectiveDbHost}`);
    console.log('Modo empresarial: materiales+stock+requerimientos+movimientos');
  });

  if (String(process.env.RUN_SCHEMA_BOOTSTRAP || '').toLowerCase() === 'true') {
    void (async () => {
      try {
        await ensureRequerimientosColumns();
        await ensureComprasColumns();
        await ensureMovimientosColumns();
        console.log('Bootstrap de esquema completado');
      } catch (error) {
        console.error('Error en bootstrap de esquema:', error.message);
      }
    })();
  }

  server.on('error', (error) => {
    if (error && error.code === 'EADDRINUSE') {
      console.error(`El puerto ${PORT} ya esta en uso. Cierra la instancia previa del backend antes de iniciar otra.`);
      process.exit(1);
      return;
    }
    console.error('Error inesperado del servidor:', error.message);
    process.exit(1);
  });
};

startServer().catch((error) => {
  console.error('Error iniciando servidor:', error.message);
  process.exit(1);
});
