Instrucciones para migración: `servicios`, `calificaciones_proveedor` y aprobaciones dinámicas

Objetivo
- Añadir la tabla `servicios` y la tabla `calificaciones_proveedor` a la base de datos existente de forma reproducible.

Archivos añadidos
- `backend/migrations/20260330_create_servicios_base.sql` — crea las tablas base de servicios y calificaciones.
- `backend/migrations/20260505_aprobaciones_dinamicas_base.sql` — crea tablas para aprobaciones y configuración dinámica de flujos.

Pasos para aplicar la migración
1. Desde la raíz del proyecto, ejecutar el script de migraciones:

```bash
# usando npm script en la carpeta backend
npm --prefix backend run db:migrate
# o, directamente
node backend/run-migrations.js
```

2. Verificar que las tablas existen (ejemplo usando `psql`):

```bash
psql -h <host> -U <user> -d <database> -c "SELECT to_regclass('public.servicios'), to_regclass('public.calificaciones_proveedor');"
psql -h <host> -U <user> -d <database> -c "SELECT count(*) FROM servicios;"
```

Notas importantes
- El script de migraciones en `backend/run-migrations.js` aplica los archivos en `backend/migrations/` por orden alfabético.
- Los flujos iniciales de aprobaciones se siembran en `aprobaciones_config` con tres variantes:
	- `COMPRA`
	- `SERVICIO_DENTRO_PLAN`
	- `SERVICIO_FUERA_PLAN`
- Si su base de datos tiene restricciones de seguridad o esquemas distintos, adapte el SQL antes de aplicarlo.
- Después de aplicar la migración, reinicie el servidor con `npm --prefix backend run dev` o `npm --prefix backend start`.

Verificación desde la aplicación
- Hacer una petición GET a `/api/servicios` (con usuario autenticado) o abrir la UI para confirmar que los servicios se listan.
