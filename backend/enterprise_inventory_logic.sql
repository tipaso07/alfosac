-- =====================================================
-- INVENTORY CORE LOGIC (POSTGRESQL)
-- Restricciones cumplidas:
-- 1) No crea tablas nuevas.
-- 2) Usa solo tablas declaradas por el negocio.
-- 3) Implementa reglas de stock/requerimientos/movimientos.
-- =====================================================

-- -----------------------------------------------------
-- 0.a) Extensión mínima permitida para flujo logístico
-- -----------------------------------------------------
ALTER TABLE requerimientos
ADD COLUMN IF NOT EXISTS estado_entrega VARCHAR(30);

ALTER TABLE requerimientos
ADD COLUMN IF NOT EXISTS nombre_receptor VARCHAR(120);

ALTER TABLE requerimientos
ADD COLUMN IF NOT EXISTS dni_receptor VARCHAR(20);

-- -----------------------------------------------------
-- 0.b) Reglas de consistencia estado / estado_entrega
-- -----------------------------------------------------
CREATE OR REPLACE FUNCTION fn_sync_estado_entrega_requerimiento()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.estado := upper(trim(COALESCE(NEW.estado, '')));

    IF NEW.estado = 'PENDIENTE' THEN
        NEW.estado_entrega := NULL;
        NEW.nombre_receptor := NULL;
        NEW.dni_receptor := NULL;
    ELSIF NEW.estado = 'APROBADO' THEN
        IF NEW.estado_entrega IS NULL OR trim(NEW.estado_entrega) = '' THEN
            NEW.estado_entrega := 'POR_RECOGER';
        ELSE
            NEW.estado_entrega := upper(trim(NEW.estado_entrega));
            IF NEW.estado_entrega NOT IN ('POR_RECOGER', 'ENTREGADO') THEN
                RAISE EXCEPTION 'estado_entrega invalido para APROBADO: %', NEW.estado_entrega;
            END IF;
        END IF;

        IF NEW.estado_entrega = 'ENTREGADO' THEN
            IF NEW.nombre_receptor IS NULL OR trim(NEW.nombre_receptor) = '' THEN
                RAISE EXCEPTION 'nombre_receptor es obligatorio para %', NEW.estado_entrega;
            END IF;

            IF NEW.dni_receptor IS NULL OR trim(NEW.dni_receptor) = '' THEN
                RAISE EXCEPTION 'dni_receptor es obligatorio para %', NEW.estado_entrega;
            END IF;
        ELSE
            NEW.nombre_receptor := NULL;
            NEW.dni_receptor := NULL;
        END IF;
    ELSE
        NEW.estado_entrega := NULL;
        NEW.nombre_receptor := NULL;
        NEW.dni_receptor := NULL;
    END IF;

    IF NEW.estado_entrega = 'ENTREGADO' AND NEW.estado <> 'APROBADO' THEN
        RAISE EXCEPTION 'No se puede asignar ENTREGADO si estado no es APROBADO';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_estado_entrega_requerimiento ON requerimientos;
CREATE TRIGGER trg_sync_estado_entrega_requerimiento
BEFORE INSERT OR UPDATE ON requerimientos
FOR EACH ROW
EXECUTE FUNCTION fn_sync_estado_entrega_requerimiento();

-- -----------------------------------------------------
-- 0) Validaciones de existencia minima de tablas
-- -----------------------------------------------------
DO $$
DECLARE
    missing_table text;
BEGIN
    FOREACH missing_table IN ARRAY ARRAY[
        'roles', 'permisos', 'rol_permiso', 'categorias', 'unidades', 'monedas',
        'almacenes', 'areas', 'proveedores', 'usuarios', 'materiales',
        'material_categoria', 'stock', 'requerimientos', 'detalle_requerimiento',
        'requerimiento_productos', 'movimientos', 'movimiento_detalles',
        'detalle_movimientos'
    ]
    LOOP
        IF to_regclass(missing_table) IS NULL THEN
            RAISE EXCEPTION 'Tabla requerida no existe: %', missing_table;
        END IF;
    END LOOP;
END $$;

-- -----------------------------------------------------
-- 1) Seguridad: permisos por rol
-- -----------------------------------------------------
CREATE OR REPLACE FUNCTION fn_usuario_tiene_permiso(
    p_id_usuario integer,
    p_permiso text
)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
    v_count integer;
BEGIN
    SELECT COUNT(*)
      INTO v_count
      FROM usuarios u
      JOIN rol_permiso rp ON rp.id_rol = u.id_role
      JOIN permisos p ON p.id = rp.id_permiso
     WHERE u.id = p_id_usuario
       AND upper(trim(p.nombre)) = upper(trim(p_permiso));

    RETURN v_count > 0;
END;
$$;

-- -----------------------------------------------------
-- 2) Utilidad: calcular stock total disponible por material
-- -----------------------------------------------------
CREATE OR REPLACE FUNCTION fn_stock_total_material(
    p_id_material integer
)
RETURNS numeric
LANGUAGE sql
AS $$
    SELECT COALESCE(SUM(s.cantidad), 0)
    FROM stock s
    WHERE s.id_material = p_id_material;
$$;

-- -----------------------------------------------------
-- 3) Utilidad: descontar stock distribuido entre almacenes
--    Estrategia: descuenta primero de almacenes con mayor stock
-- -----------------------------------------------------
CREATE OR REPLACE FUNCTION fn_descontar_stock_distribuido(
    p_id_material integer,
    p_cantidad numeric
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_pendiente numeric := p_cantidad;
    r_stock record;
BEGIN
    IF p_cantidad <= 0 THEN
        RAISE EXCEPTION 'Cantidad a descontar debe ser > 0';
    END IF;

    IF fn_stock_total_material(p_id_material) < p_cantidad THEN
        RAISE EXCEPTION 'Stock insuficiente para material % (solicitado %, disponible %)',
            p_id_material, p_cantidad, fn_stock_total_material(p_id_material);
    END IF;

    FOR r_stock IN
        SELECT s.id_material, s.id_almacen, s.cantidad
          FROM stock s
         WHERE s.id_material = p_id_material
         ORDER BY s.cantidad DESC
         FOR UPDATE
    LOOP
        EXIT WHEN v_pendiente <= 0;

        IF r_stock.cantidad >= v_pendiente THEN
            UPDATE stock
               SET cantidad = cantidad - v_pendiente
             WHERE id_material = r_stock.id_material
               AND id_almacen = r_stock.id_almacen;
            v_pendiente := 0;
        ELSE
            UPDATE stock
               SET cantidad = 0
             WHERE id_material = r_stock.id_material
               AND id_almacen = r_stock.id_almacen;
            v_pendiente := v_pendiente - r_stock.cantidad;
        END IF;
    END LOOP;

    IF v_pendiente > 0 THEN
        RAISE EXCEPTION 'No fue posible descontar el total. Pendiente: %', v_pendiente;
    END IF;
END;
$$;

-- -----------------------------------------------------
-- 4) Requerimientos
--    4.1 Crear requerimiento con multiples materiales
-- -----------------------------------------------------
CREATE OR REPLACE FUNCTION sp_crear_requerimiento(
    p_id_usuario integer,
    p_descripcion text,
    p_prioridad text,
    p_items jsonb
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    v_id_requerimiento integer;
    v_item jsonb;
    v_id_material integer;
    v_cantidad numeric;
BEGIN
    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'Debe enviar al menos 1 item';
    END IF;

    INSERT INTO requerimientos (estado, prioridad, descripcion, id_usuario, fecha_creacion)
    VALUES ('PENDIENTE', upper(trim(COALESCE(p_prioridad, 'MEDIA'))), p_descripcion, p_id_usuario, NOW())
    RETURNING id INTO v_id_requerimiento;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_id_material := (v_item ->> 'id_material')::integer;
        v_cantidad := (v_item ->> 'cantidad')::numeric;

        IF v_id_material IS NULL OR v_cantidad IS NULL OR v_cantidad <= 0 THEN
            RAISE EXCEPTION 'Item invalido en requerimiento';
        END IF;

        INSERT INTO detalle_requerimiento (id_requerimiento, id_material, cantidad)
        VALUES (v_id_requerimiento, v_id_material, v_cantidad);
    END LOOP;

    RETURN v_id_requerimiento;
END;
$$;

-- -----------------------------------------------------
--    4.2 Aprobar requerimiento: valida stock suficiente
-- -----------------------------------------------------
CREATE OR REPLACE FUNCTION sp_aprobar_requerimiento(
    p_id_requerimiento integer,
    p_id_usuario_admin integer
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    r_det record;
    v_estado text;
BEGIN
    IF NOT fn_usuario_tiene_permiso(p_id_usuario_admin, 'APROBAR_REQUERIMIENTO') THEN
        RAISE EXCEPTION 'Usuario % no tiene permiso APROBAR_REQUERIMIENTO', p_id_usuario_admin;
    END IF;

    SELECT upper(trim(estado))
      INTO v_estado
      FROM requerimientos
     WHERE id = p_id_requerimiento
     FOR UPDATE;

    IF v_estado IS NULL THEN
        RAISE EXCEPTION 'Requerimiento % no existe', p_id_requerimiento;
    END IF;

    IF v_estado <> 'PENDIENTE' THEN
        RAISE EXCEPTION 'Solo se puede aprobar un requerimiento PENDIENTE';
    END IF;

    FOR r_det IN
        SELECT dr.id_material, SUM(dr.cantidad) AS cantidad_solicitada
          FROM detalle_requerimiento dr
         WHERE dr.id_requerimiento = p_id_requerimiento
         GROUP BY dr.id_material
    LOOP
        IF fn_stock_total_material(r_det.id_material) < r_det.cantidad_solicitada THEN
            RAISE EXCEPTION
                'Stock insuficiente para material % (solicitado %, disponible %)',
                r_det.id_material,
                r_det.cantidad_solicitada,
                fn_stock_total_material(r_det.id_material);
        END IF;
    END LOOP;

    UPDATE requerimientos
       SET estado = 'APROBADO'
     WHERE id = p_id_requerimiento;
END;
$$;

-- -----------------------------------------------------
--    4.3 Completar requerimiento: debe estar aprobado
--        y descuenta stock automaticamente
-- -----------------------------------------------------
CREATE OR REPLACE FUNCTION sp_completar_requerimiento(
    p_id_requerimiento integer,
    p_id_usuario_admin integer
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    r_det record;
    v_estado text;
BEGIN
    IF NOT fn_usuario_tiene_permiso(p_id_usuario_admin, 'COMPLETAR_REQUERIMIENTO') THEN
        RAISE EXCEPTION 'Usuario % no tiene permiso COMPLETAR_REQUERIMIENTO', p_id_usuario_admin;
    END IF;

    SELECT upper(trim(estado))
      INTO v_estado
      FROM requerimientos
     WHERE id = p_id_requerimiento
     FOR UPDATE;

    IF v_estado IS NULL THEN
        RAISE EXCEPTION 'Requerimiento % no existe', p_id_requerimiento;
    END IF;

    IF v_estado <> 'APROBADO' THEN
        RAISE EXCEPTION 'No se puede completar sin estar APROBADO';
    END IF;

    FOR r_det IN
        SELECT dr.id_material, SUM(dr.cantidad) AS cantidad_total
          FROM detalle_requerimiento dr
         WHERE dr.id_requerimiento = p_id_requerimiento
         GROUP BY dr.id_material
    LOOP
        PERFORM fn_descontar_stock_distribuido(r_det.id_material, r_det.cantidad_total);
    END LOOP;

    UPDATE requerimientos
       SET estado = 'COMPLETADO'
     WHERE id = p_id_requerimiento;
END;
$$;

-- -----------------------------------------------------
--    4.4 Rechazar requerimiento
-- -----------------------------------------------------
CREATE OR REPLACE FUNCTION sp_rechazar_requerimiento(
    p_id_requerimiento integer,
    p_id_usuario_admin integer
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_estado text;
BEGIN
    IF NOT fn_usuario_tiene_permiso(p_id_usuario_admin, 'RECHAZAR_REQUERIMIENTO') THEN
        RAISE EXCEPTION 'Usuario % no tiene permiso RECHAZAR_REQUERIMIENTO', p_id_usuario_admin;
    END IF;

    SELECT upper(trim(estado))
      INTO v_estado
      FROM requerimientos
     WHERE id = p_id_requerimiento
     FOR UPDATE;

    IF v_estado IS NULL THEN
        RAISE EXCEPTION 'Requerimiento % no existe', p_id_requerimiento;
    END IF;

    IF v_estado IN ('COMPLETADO', 'RECHAZADO') THEN
        RAISE EXCEPTION 'No se puede rechazar un requerimiento ya cerrado';
    END IF;

    UPDATE requerimientos
       SET estado = 'RECHAZADO'
     WHERE id = p_id_requerimiento;
END;
$$;

-- -----------------------------------------------------
-- 5) Movimientos
--    Se asume:
--    - movimientos.tipo contiene ENTRADA o SALIDA
--    - movimiento_detalles tiene id_movimiento, id_material, cantidad
--    - movimientos tiene id_almacen para afectar stock por almacen
-- -----------------------------------------------------
CREATE OR REPLACE FUNCTION fn_aplicar_movimiento_stock(
    p_id_movimiento integer
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_tipo text;
    v_id_almacen integer;
    r_det record;
BEGIN
    SELECT upper(trim(m.tipo)), m.id_almacen
      INTO v_tipo, v_id_almacen
      FROM movimientos m
     WHERE m.id = p_id_movimiento
     FOR UPDATE;

    IF v_tipo IS NULL THEN
        RAISE EXCEPTION 'Movimiento % no existe', p_id_movimiento;
    END IF;

    IF v_tipo NOT IN ('ENTRADA', 'SALIDA') THEN
        RAISE EXCEPTION 'Tipo de movimiento invalido: %', v_tipo;
    END IF;

    IF v_id_almacen IS NULL THEN
        RAISE EXCEPTION 'El movimiento % no tiene id_almacen', p_id_movimiento;
    END IF;

    FOR r_det IN
        SELECT md.id_material, md.cantidad
          FROM movimiento_detalles md
         WHERE md.id_movimiento = p_id_movimiento
    LOOP
        IF r_det.cantidad <= 0 THEN
            RAISE EXCEPTION 'Cantidad invalida en detalle de movimiento';
        END IF;

        -- Asegura existencia de fila de stock sin asumir unique constraint
        IF NOT EXISTS (
            SELECT 1
            FROM stock s
            WHERE s.id_material = r_det.id_material
              AND s.id_almacen = v_id_almacen
        ) THEN
            INSERT INTO stock (id_material, id_almacen, cantidad)
            VALUES (r_det.id_material, v_id_almacen, 0);
        END IF;

        IF v_tipo = 'ENTRADA' THEN
            UPDATE stock
               SET cantidad = cantidad + r_det.cantidad
             WHERE id_material = r_det.id_material
               AND id_almacen = v_id_almacen;
        ELSE
            -- SALIDA
            IF (SELECT cantidad FROM stock WHERE id_material = r_det.id_material AND id_almacen = v_id_almacen FOR UPDATE) < r_det.cantidad THEN
                RAISE EXCEPTION 'Stock insuficiente para SALIDA. Material %, almacen %',
                    r_det.id_material, v_id_almacen;
            END IF;

            UPDATE stock
               SET cantidad = cantidad - r_det.cantidad
             WHERE id_material = r_det.id_material
               AND id_almacen = v_id_almacen;
        END IF;
    END LOOP;
END;
$$;

-- -----------------------------------------------------
-- 6) Trigger automatico al insertar detalle de movimiento
-- -----------------------------------------------------
CREATE OR REPLACE FUNCTION trg_movimiento_detalle_actualiza_stock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM fn_aplicar_movimiento_stock(NEW.id_movimiento);
    RETURN NEW;
END;
$$;

DO $$
BEGIN
    IF to_regclass('movimiento_detalles') IS NOT NULL THEN
        IF EXISTS (
            SELECT 1
              FROM information_schema.columns
             WHERE table_name = 'movimiento_detalles'
               AND column_name = 'id_movimiento'
        ) THEN
            DROP TRIGGER IF EXISTS tg_movimiento_detalle_actualiza_stock ON movimiento_detalles;
            CREATE TRIGGER tg_movimiento_detalle_actualiza_stock
            AFTER INSERT ON movimiento_detalles
            FOR EACH ROW
            EXECUTE FUNCTION trg_movimiento_detalle_actualiza_stock();
        END IF;
    END IF;
END $$;

-- -----------------------------------------------------
-- 7) Consultas operativas utiles
-- -----------------------------------------------------
-- 7.1 Inventario consolidado por material
-- SELECT
--   m.id,
--   m.nombre,
--   u.nombre AS unidad,
--   p.nombre AS proveedor,
--   COALESCE(SUM(s.cantidad), 0) AS stock_total
-- FROM materiales m
-- LEFT JOIN unidades u ON u.id = m.id_unidad
-- LEFT JOIN proveedores p ON p.id = m.id_proveedor
-- LEFT JOIN stock s ON s.id_material = m.id
-- GROUP BY m.id, m.nombre, u.nombre, p.nombre
-- ORDER BY m.nombre;

-- 7.2 Requerimientos con detalle
-- SELECT
--   r.id,
--   r.estado,
--   r.prioridad,
--   r.fecha_creacion,
--   u.nombre AS solicitante,
--   dr.id_material,
--   m.nombre AS material,
--   dr.cantidad
-- FROM requerimientos r
-- JOIN usuarios u ON u.id = r.id_usuario
-- JOIN detalle_requerimiento dr ON dr.id_requerimiento = r.id
-- JOIN materiales m ON m.id = dr.id_material
-- ORDER BY r.fecha_creacion DESC, r.id DESC;

-- =====================================================
-- FIN
-- =====================================================
