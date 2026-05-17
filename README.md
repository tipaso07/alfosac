# Alfosac

Sistema web para gestión interna de inventario, servicios, compras, proveedores, usuarios y aprobaciones. La aplicación está preparada para ejecutarse con Docker y exponerse en una red local usando la IP de la laptop servidor.

## Requisitos

- Docker Desktop o Docker Engine con Compose
- PostgreSQL 16 o la imagen incluida en `docker-compose.yml`
- Navegador moderno en las PCs cliente

## Estructura

- `src/`: frontend React + Vite
- `backend/`: API Node.js + Express + scripts de base de datos
- `public/`: logos e iconos estáticos
- `backups/`: dumps SQL para restaurar datos, si se desean usar
- `docker-compose.yml`: orquestación local

## Variables de entorno

Copia los ejemplos y ajusta los valores según la máquina donde se despliegue:

- `.env.example`
- `backend/.env.example`

No subas archivos `.env` con secretos al repositorio.

## Levantar con Docker

```bash
docker compose up -d --build
```

Servicios expuestos:

- Frontend: `http://<IP_DEL_SERVIDOR>/`
- Backend: `http://<IP_DEL_SERVIDOR>:5000/`
- Base de datos: `5432` solo si decides exponer ese puerto

## Restaurar base de datos

Si vas a importar el backup SQL, hazlo sobre la base `alfosac` antes de abrir el sistema a los usuarios.

```powershell
docker cp .\backups\FirstBackup.sql alfosac-db:/tmp/FirstBackup.dump
docker compose exec db pg_restore -U postgres -d alfosac --no-owner --no-acl -v /tmp/FirstBackup.dump
```

## Archivos omitidos

- `backend/uploads/` se considera carpeta de trabajo en tiempo de ejecución y no debe compartirse como parte del paquete final.
- `node_modules/`, `dist/`, `.env` y archivos temporales también deben quedar fuera del ZIP y de Git.

## Verificación

```bash
docker compose ps
docker compose logs -f backend
```

## Notas

- Usa una IP fija o reserva DHCP para la laptop servidor.
- Abre el puerto 80 en el firewall de la laptop para que otras PCs puedan entrar por navegador.
- Si necesitas reiniciar con datos limpios, usa los scripts de `backend/` según el caso.
