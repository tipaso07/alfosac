--
-- PostgreSQL database dump
--

\restrict 5qg7rKi5G4tPv3MT8Dv9D9b0rYkpzpaWmzLm40Ci81kTsdHlJQUaq6YTGBrrcwZ

-- Dumped from database version 18.4
-- Dumped by pg_dump version 18.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: actualizar_stock(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.actualizar_stock() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    tipo_mov VARCHAR(20);
    stock_actual INTEGER;
BEGIN
    -- Obtener tipo de movimiento
    SELECT tipo INTO tipo_mov
    FROM movimientos
    WHERE id = NEW.movimiento_id;

    -- Crear registro si no existe
    INSERT INTO stock (material_id, almacen_id, cantidad)
    VALUES (NEW.material_id, NEW.almacen_id, 0)
    ON CONFLICT (material_id, almacen_id) DO NOTHING;

    -- Obtener stock actual
    SELECT cantidad INTO stock_actual
    FROM stock
    WHERE material_id = NEW.material_id
    AND almacen_id = NEW.almacen_id;

    -- ENTRADA
    IF tipo_mov = 'ENTRADA' THEN
        UPDATE stock
        SET cantidad = stock_actual + NEW.cantidad
        WHERE material_id = NEW.material_id
        AND almacen_id = NEW.almacen_id;

    -- SALIDA
    ELSIF tipo_mov = 'SALIDA' THEN

        -- Validar stock suficiente
        IF stock_actual < NEW.cantidad THEN
            RAISE EXCEPTION 'Stock insuficiente para material % en almacén %',
            NEW.material_id, NEW.almacen_id;
        END IF;

        UPDATE stock
        SET cantidad = stock_actual - NEW.cantidad
        WHERE material_id = NEW.material_id
        AND almacen_id = NEW.almacen_id;

    END IF;

    RETURN NEW;
END;
$$;


--
-- Name: fn_sync_estado_entrega_requerimiento(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_sync_estado_entrega_requerimiento() RETURNS trigger
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


--
-- Name: generar_salida_requerimiento(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generar_salida_requerimiento(p_requerimiento_id integer) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
    nuevo_movimiento_id INTEGER;
    registro RECORD;
BEGIN
    -- Crear movimiento
    INSERT INTO movimientos (
        tipo,
        usuario_id,
        fecha,
        observacion,
        origen_tipo,
        origen_id
    )
    VALUES (
        'SALIDA',
        1, -- ⚠️ luego lo puedes hacer dinámico
        CURRENT_TIMESTAMP,
        'Salida generada desde requerimiento',
        'REQUERIMIENTO',
        p_requerimiento_id
    )
    RETURNING id INTO nuevo_movimiento_id;

    -- Recorrer detalle del requerimiento
    FOR registro IN
        SELECT *
        FROM detalle_requerimiento
        WHERE requerimiento_id = p_requerimiento_id
    LOOP

        INSERT INTO detalle_movimientos (
            movimiento_id,
            material_id,
            almacen_id,
            cantidad
        )
        VALUES (
            nuevo_movimiento_id,
            registro.material_id,
            1, -- ⚠️ almacén por defecto (luego lo mejoras)
            registro.cantidad
        );

    END LOOP;

END;
$$;


--
-- Name: manejar_estado_requerimiento(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.manejar_estado_requerimiento() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    mov_id INTEGER;
BEGIN

    -- ✅ SI SE APRUEBA
    IF NEW.estado = 'APROBADO' AND OLD.estado <> 'APROBADO' THEN
        
        PERFORM generar_salida_requerimiento(NEW.id);

    END IF;

    -- 🔄 SI SE RECHAZA (y ya estaba aprobado antes)
    IF NEW.estado = 'RECHAZADO' AND OLD.estado = 'APROBADO' THEN

        -- buscar movimiento asociado
        SELECT id INTO mov_id
        FROM movimientos
        WHERE origen_tipo = 'REQUERIMIENTO'
        AND origen_id = NEW.id;

        -- eliminar movimiento (esto revierte stock si haces trigger DELETE luego)
        DELETE FROM movimientos
        WHERE id = mov_id;

    END IF;

    RETURN NEW;
END;
$$;


--
-- Name: trigger_aprobar_requerimiento(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trigger_aprobar_requerimiento() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Solo cuando cambia a APROBADO
    IF NEW.estado = 'APROBADO' AND OLD.estado <> 'APROBADO' THEN
        
        PERFORM generar_salida_requerimiento(NEW.id);

    END IF;

    RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: almacenes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.almacenes (
    id integer NOT NULL,
    nombre character varying(100) NOT NULL,
    ubicacion character varying(255),
    encargado character varying(100)
);


--
-- Name: almacenes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.almacenes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: almacenes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.almacenes_id_seq OWNED BY public.almacenes.id;


--
-- Name: aprobaciones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aprobaciones (
    id integer NOT NULL,
    tipo character varying(30) NOT NULL,
    referencia_id integer NOT NULL,
    orden integer NOT NULL,
    rol_aprobador integer NOT NULL,
    estado character varying(60) DEFAULT 'PENDIENTE'::character varying NOT NULL,
    usuario_id integer,
    fecha timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: aprobaciones_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.aprobaciones_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: aprobaciones_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.aprobaciones_id_seq OWNED BY public.aprobaciones.id;


--
-- Name: areas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.areas (
    id integer NOT NULL,
    nombre character varying(100) NOT NULL,
    descripcion text
);


--
-- Name: areas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.areas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: areas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.areas_id_seq OWNED BY public.areas.id;


--
-- Name: calificaciones_proveedor; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.calificaciones_proveedor (
    id integer NOT NULL,
    id_proveedor integer NOT NULL,
    id_usuario integer NOT NULL,
    tipo character varying(20) NOT NULL,
    id_referencia integer NOT NULL,
    puntuacion integer NOT NULL,
    comentario text,
    fecha timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT calificaciones_proveedor_puntuacion_check CHECK (((puntuacion >= 1) AND (puntuacion <= 5))),
    CONSTRAINT chk_tipo_calificacion CHECK (((tipo)::text = ANY (ARRAY[('compra'::character varying)::text, ('servicio'::character varying)::text])))
);


--
-- Name: calificaciones_proveedor_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.calificaciones_proveedor_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: calificaciones_proveedor_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.calificaciones_proveedor_id_seq OWNED BY public.calificaciones_proveedor.id;


--
-- Name: categorias; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.categorias (
    id integer NOT NULL,
    nombre character varying(100) NOT NULL,
    descripcion text
);


--
-- Name: categorias_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.categorias_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: categorias_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.categorias_id_seq OWNED BY public.categorias.id;


--
-- Name: comentarios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.comentarios (
    id integer NOT NULL,
    id_usuario integer NOT NULL,
    tipo_entidad character varying(20) NOT NULL,
    id_entidad integer NOT NULL,
    contenido text NOT NULL,
    fecha timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_tipo_entidad CHECK (((tipo_entidad)::text = ANY (ARRAY[('requerimiento'::character varying)::text, ('compra'::character varying)::text, ('servicio'::character varying)::text])))
);


--
-- Name: comentarios_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.comentarios_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: comentarios_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.comentarios_id_seq OWNED BY public.comentarios.id;


--
-- Name: compras; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.compras (
    id integer NOT NULL,
    numero_compra character varying(50),
    id_usuario integer,
    id_area_solicitante integer,
    id_area_final integer,
    id_usuario_solicita integer,
    id_usuario_aprueba integer,
    id_proveedor integer,
    id_area integer,
    fecha_solicitud date,
    fecha_aprobacion date,
    fecha_creacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    estado character varying(50) DEFAULT 'PENDIENTE'::character varying,
    proveedor character varying(200),
    ruc character varying(11),
    direccion character varying(255),
    distrito character varying(100),
    correo character varying(100),
    persona_responsable character varying(100),
    telefono character varying(50),
    contacto_proveedor character varying(100),
    banco character varying(100),
    numero_cuenta character varying(50),
    cuenta character varying(50),
    cci character varying(100),
    retencion character varying(10),
    descuento numeric(12,2),
    aplica_retencion boolean DEFAULT false,
    tipo character varying(20),
    tipo_retencion character varying(20),
    importe_final numeric(12,2),
    condiciones_pago character varying(100),
    monto_total numeric(12,2),
    subtotal numeric(12,2),
    costo_envio numeric(12,2),
    otros_costos numeric(12,2),
    igv numeric(12,2),
    total numeric(12,2),
    moneda character varying(20),
    id_moneda integer,
    numero_orden character varying(50),
    comentarios text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    estado_pedido character varying(50) DEFAULT 'PENDIENTE'::character varying,
    detalle text,
    tipo_cambio numeric(12,4),
    id_unidad integer
);


--
-- Name: compras_directas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.compras_directas (
    id integer NOT NULL,
    id_usuario integer NOT NULL,
    id_area integer NOT NULL,
    proveedor_texto character varying(255),
    tipo_pago character varying(50) DEFAULT 'EFECTIVO'::character varying NOT NULL,
    numero_comprobante character varying(100),
    total numeric(12,2) DEFAULT 0 NOT NULL,
    foto text,
    observaciones text,
    fecha_compra timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    id_moneda integer
);


--
-- Name: compras_directas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.compras_directas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: compras_directas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.compras_directas_id_seq OWNED BY public.compras_directas.id;


--
-- Name: compras_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.compras_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: compras_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.compras_id_seq OWNED BY public.compras.id;


--
-- Name: detalle_compras; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.detalle_compras (
    id integer NOT NULL,
    id_compra integer,
    id_material integer,
    descripcion text,
    cantidad integer NOT NULL,
    precio_unitario numeric,
    total numeric,
    categoria character varying(50),
    id_unidad integer
);


--
-- Name: detalle_compras_directas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.detalle_compras_directas (
    id integer NOT NULL,
    id_compra_directa integer NOT NULL,
    descripcion text NOT NULL,
    cantidad numeric(12,2) NOT NULL,
    precio_unitario numeric(12,2) NOT NULL,
    total numeric(12,2) NOT NULL
);


--
-- Name: detalle_compras_directas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.detalle_compras_directas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: detalle_compras_directas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.detalle_compras_directas_id_seq OWNED BY public.detalle_compras_directas.id;


--
-- Name: detalle_compras_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.detalle_compras_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: detalle_compras_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.detalle_compras_id_seq OWNED BY public.detalle_compras.id;


--
-- Name: detalle_movimientos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.detalle_movimientos (
    id integer NOT NULL,
    id_movimiento integer,
    id_material integer,
    cantidad numeric(12,2),
    tipo character varying(50)
);


--
-- Name: detalle_movimientos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.detalle_movimientos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: detalle_movimientos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.detalle_movimientos_id_seq OWNED BY public.detalle_movimientos.id;


--
-- Name: detalle_requerimiento; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.detalle_requerimiento (
    id integer NOT NULL,
    id_requerimiento integer,
    id_material integer,
    cantidad integer NOT NULL
);


--
-- Name: detalle_requerimiento_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.detalle_requerimiento_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: detalle_requerimiento_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.detalle_requerimiento_id_seq OWNED BY public.detalle_requerimiento.id;


--
-- Name: material_categoria; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.material_categoria (
    id integer NOT NULL,
    id_material integer,
    id_categoria integer
);


--
-- Name: material_categoria_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.material_categoria_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: material_categoria_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.material_categoria_id_seq OWNED BY public.material_categoria.id;


--
-- Name: materiales; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.materiales (
    id integer NOT NULL,
    nombre character varying(150) NOT NULL,
    descripcion text,
    id_unidad integer,
    id_proveedor integer,
    costo_unitario numeric(12,2),
    id_moneda integer,
    imagen text,
    id_categoria integer
);


--
-- Name: materiales_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.materiales_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: materiales_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.materiales_id_seq OWNED BY public.materiales.id;


--
-- Name: materiales_proveedores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.materiales_proveedores (
    id integer NOT NULL,
    id_material integer,
    id_proveedor integer,
    precio_unitario numeric(12,2)
);


--
-- Name: materiales_proveedores_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.materiales_proveedores_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: materiales_proveedores_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.materiales_proveedores_id_seq OWNED BY public.materiales_proveedores.id;


--
-- Name: monedas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.monedas (
    id integer NOT NULL,
    nombre character varying(50) NOT NULL,
    simbolo character varying(10)
);


--
-- Name: monedas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.monedas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: monedas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.monedas_id_seq OWNED BY public.monedas.id;


--
-- Name: movimiento_detalles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.movimiento_detalles (
    id integer NOT NULL,
    id_movimiento integer,
    id_material integer,
    cantidad integer NOT NULL
);


--
-- Name: movimiento_detalles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.movimiento_detalles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: movimiento_detalles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.movimiento_detalles_id_seq OWNED BY public.movimiento_detalles.id;


--
-- Name: movimientos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.movimientos (
    id integer NOT NULL,
    tipo character varying(50) NOT NULL,
    fecha timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    id_usuario integer,
    id_almacen integer
);


--
-- Name: movimientos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.movimientos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: movimientos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.movimientos_id_seq OWNED BY public.movimientos.id;


--
-- Name: notificaciones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notificaciones (
    id integer NOT NULL,
    id_usuario integer,
    mensaje text,
    leido boolean DEFAULT false,
    fecha timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: notificaciones_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.notificaciones_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notificaciones_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notificaciones_id_seq OWNED BY public.notificaciones.id;


--
-- Name: proveedores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.proveedores (
    id integer NOT NULL,
    nombre character varying(200) NOT NULL,
    razon_social character varying(200),
    contacto character varying(255),
    direccion character varying(255),
    distrito character varying(100),
    ruc character varying(11),
    email character varying(100),
    correo character varying(100),
    persona_responsable character varying(100),
    telefono character varying(50),
    condiciones_pago character varying(100),
    banco character varying(100),
    numero_cuenta character varying(50),
    cci character varying(100),
    id_moneda integer,
    id_area_destino integer,
    descripcion text,
    retencion character varying(10) DEFAULT 'NO'::character varying,
    categoria character varying(100),
    descuento numeric(5,2) DEFAULT 0,
    tipo character varying(20) DEFAULT 'BIEN'::character varying,
    tipo_retencion character varying(20) DEFAULT 'RETENCION'::character varying,
    estado boolean DEFAULT true,
    fecha_creacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    moneda_nombre character varying(50)
);


--
-- Name: proveedores_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.proveedores_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: proveedores_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.proveedores_id_seq OWNED BY public.proveedores.id;


--
-- Name: requerimiento_productos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.requerimiento_productos (
    id integer NOT NULL,
    id_requerimiento integer,
    id_material integer,
    cantidad integer NOT NULL
);


--
-- Name: requerimiento_productos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.requerimiento_productos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: requerimiento_productos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.requerimiento_productos_id_seq OWNED BY public.requerimiento_productos.id;


--
-- Name: requerimientos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.requerimientos (
    id integer NOT NULL,
    estado character varying(50) NOT NULL,
    prioridad character varying(50) NOT NULL,
    descripcion text,
    id_usuario integer,
    fecha_creacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    estado_entrega character varying(50),
    nombre_receptor character varying(120),
    dni_receptor character varying(20)
);


--
-- Name: requerimientos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.requerimientos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: requerimientos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.requerimientos_id_seq OWNED BY public.requerimientos.id;


--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    id integer NOT NULL,
    nombre character varying(100) NOT NULL,
    descripcion text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: roles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.roles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: roles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.roles_id_seq OWNED BY public.roles.id;


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    id integer NOT NULL,
    filename text NOT NULL,
    executed_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: schema_migrations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.schema_migrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: schema_migrations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.schema_migrations_id_seq OWNED BY public.schema_migrations.id;


--
-- Name: servicios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.servicios (
    id integer NOT NULL,
    id_usuario integer,
    area_id integer,
    proveedor_id integer,
    moneda_id integer,
    nombre_servicio character varying(255),
    descripcion_servicio text,
    costo numeric(12,2),
    subtotal numeric(12,2),
    igv numeric(12,2),
    costo_envio numeric(12,2),
    otros_costos numeric(12,2),
    total numeric(12,2),
    aplica_retencion boolean DEFAULT false,
    retencion numeric(8,2),
    tipo_retencion character varying(20),
    prioridad character varying(10),
    dentro_plan boolean DEFAULT false,
    estado_aprobacion character varying(30) DEFAULT 'PENDIENTE'::character varying,
    estado_flujo character varying(30),
    estado_servicio character varying(30),
    fecha timestamp without time zone,
    numero_orden character varying(50),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    impuestos numeric(12,2),
    tipo_cambio numeric(12,4),
    CONSTRAINT chk_prioridad CHECK (((prioridad)::text = ANY (ARRAY[('ALTA'::character varying)::text, ('MEDIA'::character varying)::text, ('BAJA'::character varying)::text]))),
    CONSTRAINT chk_servicios_estado_flujo CHECK (((estado_flujo IS NULL) OR ((estado_flujo)::text = ANY (ARRAY[('APROBADO'::character varying)::text, ('DATOS_COMPLETADOS'::character varying)::text, ('PENDIENTE'::character varying)::text, ('REALIZADO'::character varying)::text])))),
    CONSTRAINT chk_servicios_estado_servicio CHECK (((estado_servicio IS NULL) OR ((estado_servicio)::text = ANY (ARRAY[('COMPLETADO'::character varying)::text, ('PENDIENTE'::character varying)::text, ('REALIZADO'::character varying)::text])))),
    CONSTRAINT chk_servicios_retencion_positiva CHECK (((retencion IS NULL) OR (retencion >= (0)::numeric))),
    CONSTRAINT chk_servicios_tipo_retencion CHECK (((tipo_retencion IS NULL) OR ((tipo_retencion)::text = ANY (ARRAY[('RETENCION'::character varying)::text, ('DETRACCION'::character varying)::text]))))
);


--
-- Name: servicios_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.servicios_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: servicios_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.servicios_id_seq OWNED BY public.servicios.id;


--
-- Name: stock; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stock (
    id integer NOT NULL,
    id_material integer,
    id_almacen integer,
    cantidad integer DEFAULT 0 NOT NULL,
    stock_seguridad integer DEFAULT 0 NOT NULL
);


--
-- Name: stock_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.stock_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: stock_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.stock_id_seq OWNED BY public.stock.id;


--
-- Name: unidades; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.unidades (
    id integer NOT NULL,
    nombre character varying(50) NOT NULL
);


--
-- Name: unidades_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.unidades_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: unidades_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.unidades_id_seq OWNED BY public.unidades.id;


--
-- Name: usuarios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.usuarios (
    id integer NOT NULL,
    email character varying(255) NOT NULL,
    password_hash character varying(255) NOT NULL,
    nombre character varying(100) NOT NULL,
    dni character varying(20),
    foto text,
    imagen text,
    id_role integer,
    id_area integer,
    estado character varying(20) DEFAULT 'ACTIVO'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    telefono character varying(50) DEFAULT ''::character varying NOT NULL,
    sub_area character varying(100) DEFAULT ''::character varying
);


--
-- Name: usuarios_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.usuarios_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: usuarios_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.usuarios_id_seq OWNED BY public.usuarios.id;


--
-- Name: almacenes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.almacenes ALTER COLUMN id SET DEFAULT nextval('public.almacenes_id_seq'::regclass);


--
-- Name: aprobaciones id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aprobaciones ALTER COLUMN id SET DEFAULT nextval('public.aprobaciones_id_seq'::regclass);


--
-- Name: areas id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.areas ALTER COLUMN id SET DEFAULT nextval('public.areas_id_seq'::regclass);


--
-- Name: calificaciones_proveedor id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calificaciones_proveedor ALTER COLUMN id SET DEFAULT nextval('public.calificaciones_proveedor_id_seq'::regclass);


--
-- Name: categorias id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categorias ALTER COLUMN id SET DEFAULT nextval('public.categorias_id_seq'::regclass);


--
-- Name: comentarios id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comentarios ALTER COLUMN id SET DEFAULT nextval('public.comentarios_id_seq'::regclass);


--
-- Name: compras id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compras ALTER COLUMN id SET DEFAULT nextval('public.compras_id_seq'::regclass);


--
-- Name: compras_directas id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compras_directas ALTER COLUMN id SET DEFAULT nextval('public.compras_directas_id_seq'::regclass);


--
-- Name: detalle_compras id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_compras ALTER COLUMN id SET DEFAULT nextval('public.detalle_compras_id_seq'::regclass);


--
-- Name: detalle_compras_directas id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_compras_directas ALTER COLUMN id SET DEFAULT nextval('public.detalle_compras_directas_id_seq'::regclass);


--
-- Name: detalle_movimientos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_movimientos ALTER COLUMN id SET DEFAULT nextval('public.detalle_movimientos_id_seq'::regclass);


--
-- Name: detalle_requerimiento id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_requerimiento ALTER COLUMN id SET DEFAULT nextval('public.detalle_requerimiento_id_seq'::regclass);


--
-- Name: material_categoria id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_categoria ALTER COLUMN id SET DEFAULT nextval('public.material_categoria_id_seq'::regclass);


--
-- Name: materiales id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.materiales ALTER COLUMN id SET DEFAULT nextval('public.materiales_id_seq'::regclass);


--
-- Name: materiales_proveedores id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.materiales_proveedores ALTER COLUMN id SET DEFAULT nextval('public.materiales_proveedores_id_seq'::regclass);


--
-- Name: monedas id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monedas ALTER COLUMN id SET DEFAULT nextval('public.monedas_id_seq'::regclass);


--
-- Name: movimiento_detalles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.movimiento_detalles ALTER COLUMN id SET DEFAULT nextval('public.movimiento_detalles_id_seq'::regclass);


--
-- Name: movimientos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.movimientos ALTER COLUMN id SET DEFAULT nextval('public.movimientos_id_seq'::regclass);


--
-- Name: notificaciones id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notificaciones ALTER COLUMN id SET DEFAULT nextval('public.notificaciones_id_seq'::regclass);


--
-- Name: proveedores id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proveedores ALTER COLUMN id SET DEFAULT nextval('public.proveedores_id_seq'::regclass);


--
-- Name: requerimiento_productos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.requerimiento_productos ALTER COLUMN id SET DEFAULT nextval('public.requerimiento_productos_id_seq'::regclass);


--
-- Name: requerimientos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.requerimientos ALTER COLUMN id SET DEFAULT nextval('public.requerimientos_id_seq'::regclass);


--
-- Name: roles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles ALTER COLUMN id SET DEFAULT nextval('public.roles_id_seq'::regclass);


--
-- Name: schema_migrations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations ALTER COLUMN id SET DEFAULT nextval('public.schema_migrations_id_seq'::regclass);


--
-- Name: servicios id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.servicios ALTER COLUMN id SET DEFAULT nextval('public.servicios_id_seq'::regclass);


--
-- Name: stock id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock ALTER COLUMN id SET DEFAULT nextval('public.stock_id_seq'::regclass);


--
-- Name: unidades id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unidades ALTER COLUMN id SET DEFAULT nextval('public.unidades_id_seq'::regclass);


--
-- Name: usuarios id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuarios ALTER COLUMN id SET DEFAULT nextval('public.usuarios_id_seq'::regclass);


--
-- Data for Name: almacenes; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.almacenes (id, nombre, ubicacion, encargado) FROM stdin;
1	ALMACÉN PRINCIPAL	Físico principal	\N
\.


--
-- Data for Name: aprobaciones; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.aprobaciones (id, tipo, referencia_id, orden, rol_aprobador, estado, usuario_id, fecha, created_at) FROM stdin;
\.


--
-- Data for Name: areas; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.areas (id, nombre, descripcion) FROM stdin;
1	ADMINISTRACIÓN	Área administrativa
2	OPERACIONES	Área de operaciones
3	VENTAS	Área de ventas
4	ALMACÉN	Área de almacén
10	GERENCIA GENERAL	Gerencia General
11	FINANZAS	Área de Finanzas
\.


--
-- Data for Name: calificaciones_proveedor; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.calificaciones_proveedor (id, id_proveedor, id_usuario, tipo, id_referencia, puntuacion, comentario, fecha) FROM stdin;
\.


--
-- Data for Name: categorias; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.categorias (id, nombre, descripcion) FROM stdin;
1	ELECTRÓNICA	Componentes electrónicos
2	OFICINA	Artículos de oficina
3	HERRAMIENTAS	Herramientas
4	SEGURIDAD	Equipos de seguridad
5	LIMPIEZA	\N
6	testeable	\N
\.


--
-- Data for Name: comentarios; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.comentarios (id, id_usuario, tipo_entidad, id_entidad, contenido, fecha) FROM stdin;
1	1	compra	10	Se requiere con urgencia este material.	2026-04-06 19:02:06.128839
2	1	compra	2	Comentario de prueba	2026-05-06 21:07:25.235409
3	1	compra	2	Si	2026-05-06 21:07:31.657413
4	1	compra	3	prueba comentario	2026-05-06 21:12:09.792624
5	1	compra	1	HOLA	2026-05-07 18:14:17.286958
6	1	servicio	20	test comentario	2026-05-09 09:30:58.618711
7	2	compra	1	hola	2026-05-13 02:18:29.131473
8	2	compra	1	ad	2026-05-13 14:26:40.691763
\.


--
-- Data for Name: compras; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.compras (id, numero_compra, id_usuario, id_area_solicitante, id_area_final, id_usuario_solicita, id_usuario_aprueba, id_proveedor, id_area, fecha_solicitud, fecha_aprobacion, fecha_creacion, fecha_actualizacion, estado, proveedor, ruc, direccion, distrito, correo, persona_responsable, telefono, contacto_proveedor, banco, numero_cuenta, cuenta, cci, retencion, descuento, aplica_retencion, tipo, tipo_retencion, importe_final, condiciones_pago, monto_total, subtotal, costo_envio, otros_costos, igv, total, moneda, id_moneda, numero_orden, comentarios, created_at, updated_at, estado_pedido, detalle, tipo_cambio, id_unidad) FROM stdin;
\.


--
-- Data for Name: compras_directas; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.compras_directas (id, id_usuario, id_area, proveedor_texto, tipo_pago, numero_comprobante, total, foto, observaciones, fecha_compra, created_at, updated_at, id_moneda) FROM stdin;
\.


--
-- Data for Name: detalle_compras; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.detalle_compras (id, id_compra, id_material, descripcion, cantidad, precio_unitario, total, categoria, id_unidad) FROM stdin;
\.


--
-- Data for Name: detalle_compras_directas; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.detalle_compras_directas (id, id_compra_directa, descripcion, cantidad, precio_unitario, total) FROM stdin;
\.


--
-- Data for Name: detalle_movimientos; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.detalle_movimientos (id, id_movimiento, id_material, cantidad, tipo) FROM stdin;
\.


--
-- Data for Name: detalle_requerimiento; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.detalle_requerimiento (id, id_requerimiento, id_material, cantidad) FROM stdin;
\.


--
-- Data for Name: material_categoria; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.material_categoria (id, id_material, id_categoria) FROM stdin;
\.


--
-- Data for Name: materiales; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.materiales (id, nombre, descripcion, id_unidad, id_proveedor, costo_unitario, id_moneda, imagen, id_categoria) FROM stdin;
\.


--
-- Data for Name: materiales_proveedores; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.materiales_proveedores (id, id_material, id_proveedor, precio_unitario) FROM stdin;
\.


--
-- Data for Name: monedas; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.monedas (id, nombre, simbolo) FROM stdin;
1	SOLES	S/
2	DÓLARES	$
\.


--
-- Data for Name: movimiento_detalles; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.movimiento_detalles (id, id_movimiento, id_material, cantidad) FROM stdin;
\.


--
-- Data for Name: movimientos; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.movimientos (id, tipo, fecha, id_usuario, id_almacen) FROM stdin;
\.


--
-- Data for Name: notificaciones; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.notificaciones (id, id_usuario, mensaje, leido, fecha) FROM stdin;
\.


--
-- Data for Name: proveedores; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.proveedores (id, nombre, razon_social, contacto, direccion, distrito, ruc, email, correo, persona_responsable, telefono, condiciones_pago, banco, numero_cuenta, cci, id_moneda, id_area_destino, descripcion, retencion, categoria, descuento, tipo, tipo_retencion, estado, fecha_creacion, created_at, updated_at, moneda_nombre) FROM stdin;
\.


--
-- Data for Name: requerimiento_productos; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.requerimiento_productos (id, id_requerimiento, id_material, cantidad) FROM stdin;
\.


--
-- Data for Name: requerimientos; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.requerimientos (id, estado, prioridad, descripcion, id_usuario, fecha_creacion, estado_entrega, nombre_receptor, dni_receptor) FROM stdin;
\.


--
-- Data for Name: roles; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.roles (id, nombre, descripcion, created_at) FROM stdin;
2	COMPRAS	Rol de compras	2026-05-13 00:02:26.953146
3	ALMACENERO	Rol de almacenero	2026-05-13 00:02:26.953567
1	GERENTES	Gerentes de la empresa	2026-05-13 00:02:26.951155
4	SOLICITANTES	Solicitantes de materiales/servicios	2026-05-13 00:02:26.9538
8	SERVICIOS GENERALES	Servicios Generales	2026-05-13 23:44:06.624997
\.


--
-- Data for Name: schema_migrations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.schema_migrations (id, filename, executed_at) FROM stdin;
1	20260330_create_servicios_base.sql	2026-05-14 13:09:16.970359
2	20260402_materiales_moneda_id.sql	2026-05-14 13:09:17.016498
3	20260404_cleanup_duplicates.sql	2026-05-14 13:09:17.017752
4	20260404_proveedores_base.sql	2026-05-14 13:09:17.022559
5	20260404_servicios_estado_flujo_default.sql	2026-05-14 13:09:17.025705
6	20260404_servicios_estados_y_montos.sql	2026-05-14 13:09:17.033233
7	20260404_servicios_flujo_dos_etapas.sql	2026-05-14 13:09:17.035197
8	20260404_servicios_flujo_y_montos.sql	2026-05-14 13:09:17.03927
9	20260404_servicios_retenciones.sql	2026-05-14 13:09:17.042356
10	20260405_add_unique_constraints.sql	2026-05-14 13:09:17.043142
11	20260405_monedas_simbolo.sql	2026-05-14 13:09:17.047039
12	20260405_roles_descripcion.sql	2026-05-14 13:09:17.047999
13	20260405_roles_nombre_unique.sql	2026-05-14 13:09:17.048845
14	20260505_aprobaciones_dinamicas_base.sql	2026-05-14 13:13:10.810053
15	20260509_add_aprobado_estado_flujo.sql	2026-05-14 13:13:10.84704
16	20260527_expand_compras_estado.sql	2026-07-21 03:43:24.390291
17	20260528_expand_aprobaciones_estado.sql	2026-07-21 03:43:24.396131
18	20260529_add_id_almacen_movimientos.sql	2026-07-21 03:43:24.399281
19	20260529_add_tipo_cambio_compras.sql	2026-07-21 03:43:24.401828
20	20260530_add_tipo_cambio_servicios.sql	2026-07-21 03:43:24.403002
21	20260531_add_id_unidad_compras.sql	2026-07-21 03:43:24.406508
22	20260601_add_id_unidad_detalle_compras.sql	2026-07-21 03:43:24.409411
23	20260601_alter_telefono_lenght.sql	2026-07-21 03:43:24.412016
24	20260616_compras_directas.sql	2026-07-21 03:43:24.413341
\.


--
-- Data for Name: servicios; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.servicios (id, id_usuario, area_id, proveedor_id, moneda_id, nombre_servicio, descripcion_servicio, costo, subtotal, igv, costo_envio, otros_costos, total, aplica_retencion, retencion, tipo_retencion, prioridad, dentro_plan, estado_aprobacion, estado_flujo, estado_servicio, fecha, numero_orden, created_at, updated_at, impuestos, tipo_cambio) FROM stdin;
\.


--
-- Data for Name: stock; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.stock (id, id_material, id_almacen, cantidad, stock_seguridad) FROM stdin;
\.


--
-- Data for Name: unidades; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.unidades (id, nombre) FROM stdin;
1	UND
2	KG
3	LT
4	M
5	M2
6	CAJA
7	PACK
\.


--
-- Data for Name: usuarios; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.usuarios (id, email, password_hash, nombre, dni, foto, imagen, id_role, id_area, estado, created_at, updated_at, telefono, sub_area) FROM stdin;
2	compras@alfosac.pe	admin	compras	00000002	\N	\N	2	4	ACTIVO	2026-05-13 00:08:35.818594	2026-05-13 00:08:35.818594		
3	almacenero@alfosac.pe	admin	almacenero	00000003	\N	\N	3	2	ACTIVO	2026-05-13 00:12:27.763847	2026-05-13 00:12:27.763847		
4	solicitante@alfosac.pe	admin	solicitante	00000004	\N	\N	4	3	ACTIVO	2026-05-13 00:12:48.866684	2026-05-13 00:12:48.866684		
8	servicios@alfosac.pe	admin	SERVICIOS	00000008	\N	\N	8	1	ACTIVO	2026-05-13 23:45:32.097833	2026-05-13 23:45:32.097833		
5	jefe@alfosac.pe	admin	Jefe De Area	00000005	\N	\N	1	1	ACTIVO	2026-05-13 00:14:18.162503	2026-05-13 00:14:18.162503		ADMINISTRACIÓN
6	gerencia@alfosac.pe	admin	gerencia	00000006	\N	\N	1	10	ACTIVO	2026-05-13 00:15:46.646235	2026-05-13 00:15:46.646235		GERENCIA GENERAL
7	finanzas@alfosac.pe	admin	finanzas	00000007	\N	\N	1	11	ACTIVO	2026-05-13 00:16:04.726214	2026-05-13 00:16:04.726214		FINANZAS
1	admin@alfosac.pe	admin	admin	00000001	\N	\N	1	10	ACTIVO	2026-05-13 00:02:26.995437	2026-05-13 00:02:26.995437		GERENCIA GENERAL
\.


--
-- Name: almacenes_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.almacenes_id_seq', 1, true);


--
-- Name: aprobaciones_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.aprobaciones_id_seq', 61, true);


--
-- Name: areas_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.areas_id_seq', 11, true);


--
-- Name: calificaciones_proveedor_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.calificaciones_proveedor_id_seq', 28, true);


--
-- Name: categorias_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.categorias_id_seq', 6, true);


--
-- Name: comentarios_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.comentarios_id_seq', 8, true);


--
-- Name: compras_directas_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.compras_directas_id_seq', 1, false);


--
-- Name: compras_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.compras_id_seq', 14, true);


--
-- Name: detalle_compras_directas_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.detalle_compras_directas_id_seq', 1, false);


--
-- Name: detalle_compras_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.detalle_compras_id_seq', 113, true);


--
-- Name: detalle_movimientos_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.detalle_movimientos_id_seq', 1, false);


--
-- Name: detalle_requerimiento_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.detalle_requerimiento_id_seq', 74, true);


--
-- Name: material_categoria_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.material_categoria_id_seq', 51, true);


--
-- Name: materiales_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.materiales_id_seq', 78, true);


--
-- Name: materiales_proveedores_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.materiales_proveedores_id_seq', 1, false);


--
-- Name: monedas_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.monedas_id_seq', 3, true);


--
-- Name: movimiento_detalles_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.movimiento_detalles_id_seq', 152, true);


--
-- Name: movimientos_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.movimientos_id_seq', 141, true);


--
-- Name: notificaciones_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.notificaciones_id_seq', 1, false);


--
-- Name: proveedores_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.proveedores_id_seq', 2, true);


--
-- Name: requerimiento_productos_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.requerimiento_productos_id_seq', 1, false);


--
-- Name: requerimientos_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.requerimientos_id_seq', 64, true);


--
-- Name: roles_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.roles_id_seq', 9, true);


--
-- Name: schema_migrations_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.schema_migrations_id_seq', 24, true);


--
-- Name: servicios_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.servicios_id_seq', 23, true);


--
-- Name: stock_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.stock_id_seq', 216, true);


--
-- Name: unidades_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.unidades_id_seq', 7, true);


--
-- Name: usuarios_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.usuarios_id_seq', 11, true);


--
-- Name: almacenes almacenes_nombre_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.almacenes
    ADD CONSTRAINT almacenes_nombre_key UNIQUE (nombre);


--
-- Name: almacenes almacenes_nombre_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.almacenes
    ADD CONSTRAINT almacenes_nombre_unique UNIQUE (nombre);


--
-- Name: almacenes almacenes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.almacenes
    ADD CONSTRAINT almacenes_pkey PRIMARY KEY (id);


--
-- Name: aprobaciones aprobaciones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aprobaciones
    ADD CONSTRAINT aprobaciones_pkey PRIMARY KEY (id);


--
-- Name: aprobaciones aprobaciones_tipo_referencia_id_orden_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aprobaciones
    ADD CONSTRAINT aprobaciones_tipo_referencia_id_orden_key UNIQUE (tipo, referencia_id, orden);


--
-- Name: areas areas_nombre_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.areas
    ADD CONSTRAINT areas_nombre_key UNIQUE (nombre);


--
-- Name: areas areas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.areas
    ADD CONSTRAINT areas_pkey PRIMARY KEY (id);


--
-- Name: calificaciones_proveedor calificaciones_proveedor_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calificaciones_proveedor
    ADD CONSTRAINT calificaciones_proveedor_pkey PRIMARY KEY (id);


--
-- Name: categorias categorias_nombre_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categorias
    ADD CONSTRAINT categorias_nombre_key UNIQUE (nombre);


--
-- Name: categorias categorias_nombre_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categorias
    ADD CONSTRAINT categorias_nombre_unique UNIQUE (nombre);


--
-- Name: categorias categorias_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categorias
    ADD CONSTRAINT categorias_pkey PRIMARY KEY (id);


--
-- Name: comentarios comentarios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comentarios
    ADD CONSTRAINT comentarios_pkey PRIMARY KEY (id);


--
-- Name: compras_directas compras_directas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compras_directas
    ADD CONSTRAINT compras_directas_pkey PRIMARY KEY (id);


--
-- Name: compras compras_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compras
    ADD CONSTRAINT compras_pkey PRIMARY KEY (id);


--
-- Name: detalle_compras_directas detalle_compras_directas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_compras_directas
    ADD CONSTRAINT detalle_compras_directas_pkey PRIMARY KEY (id);


--
-- Name: detalle_compras detalle_compras_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_compras
    ADD CONSTRAINT detalle_compras_pkey PRIMARY KEY (id);


--
-- Name: detalle_movimientos detalle_movimientos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_movimientos
    ADD CONSTRAINT detalle_movimientos_pkey PRIMARY KEY (id);


--
-- Name: detalle_requerimiento detalle_requerimiento_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_requerimiento
    ADD CONSTRAINT detalle_requerimiento_pkey PRIMARY KEY (id);


--
-- Name: material_categoria material_categoria_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_categoria
    ADD CONSTRAINT material_categoria_pkey PRIMARY KEY (id);


--
-- Name: materiales materiales_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.materiales
    ADD CONSTRAINT materiales_pkey PRIMARY KEY (id);


--
-- Name: materiales_proveedores materiales_proveedores_id_material_id_proveedor_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.materiales_proveedores
    ADD CONSTRAINT materiales_proveedores_id_material_id_proveedor_key UNIQUE (id_material, id_proveedor);


--
-- Name: materiales_proveedores materiales_proveedores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.materiales_proveedores
    ADD CONSTRAINT materiales_proveedores_pkey PRIMARY KEY (id);


--
-- Name: monedas monedas_nombre_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monedas
    ADD CONSTRAINT monedas_nombre_key UNIQUE (nombre);


--
-- Name: monedas monedas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monedas
    ADD CONSTRAINT monedas_pkey PRIMARY KEY (id);


--
-- Name: movimiento_detalles movimiento_detalles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.movimiento_detalles
    ADD CONSTRAINT movimiento_detalles_pkey PRIMARY KEY (id);


--
-- Name: movimientos movimientos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.movimientos
    ADD CONSTRAINT movimientos_pkey PRIMARY KEY (id);


--
-- Name: notificaciones notificaciones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notificaciones
    ADD CONSTRAINT notificaciones_pkey PRIMARY KEY (id);


--
-- Name: proveedores proveedores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proveedores
    ADD CONSTRAINT proveedores_pkey PRIMARY KEY (id);


--
-- Name: proveedores proveedores_ruc_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proveedores
    ADD CONSTRAINT proveedores_ruc_key UNIQUE (ruc);


--
-- Name: requerimiento_productos requerimiento_productos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.requerimiento_productos
    ADD CONSTRAINT requerimiento_productos_pkey PRIMARY KEY (id);


--
-- Name: requerimientos requerimientos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.requerimientos
    ADD CONSTRAINT requerimientos_pkey PRIMARY KEY (id);


--
-- Name: roles roles_nombre_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_nombre_key UNIQUE (nombre);


--
-- Name: roles roles_nombre_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_nombre_unique UNIQUE (nombre);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_filename_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_filename_key UNIQUE (filename);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (id);


--
-- Name: servicios servicios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.servicios
    ADD CONSTRAINT servicios_pkey PRIMARY KEY (id);


--
-- Name: stock stock_id_material_id_almacen_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock
    ADD CONSTRAINT stock_id_material_id_almacen_key UNIQUE (id_material, id_almacen);


--
-- Name: stock stock_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock
    ADD CONSTRAINT stock_pkey PRIMARY KEY (id);


--
-- Name: unidades unidades_nombre_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unidades
    ADD CONSTRAINT unidades_nombre_key UNIQUE (nombre);


--
-- Name: unidades unidades_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unidades
    ADD CONSTRAINT unidades_pkey PRIMARY KEY (id);


--
-- Name: usuarios usuarios_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_email_key UNIQUE (email);


--
-- Name: usuarios usuarios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_pkey PRIMARY KEY (id);


--
-- Name: idx_aprobaciones_rol_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_aprobaciones_rol_estado ON public.aprobaciones USING btree (rol_aprobador, estado);


--
-- Name: idx_aprobaciones_tipo_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_aprobaciones_tipo_ref ON public.aprobaciones USING btree (tipo, referencia_id);


--
-- Name: idx_calif_proveedor_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_calif_proveedor_ref ON public.calificaciones_proveedor USING btree (id_proveedor, id_referencia);


--
-- Name: idx_calificaciones_proveedor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_calificaciones_proveedor ON public.calificaciones_proveedor USING btree (id_proveedor);


--
-- Name: idx_comentarios_entidad; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comentarios_entidad ON public.comentarios USING btree (tipo_entidad, id_entidad);


--
-- Name: idx_detalle_compras_compra; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_detalle_compras_compra ON public.detalle_compras USING btree (id_compra);


--
-- Name: idx_servicios_id_usuario; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_servicios_id_usuario ON public.servicios USING btree (id_usuario);


--
-- Name: idx_servicios_proveedor_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_servicios_proveedor_id ON public.servicios USING btree (proveedor_id);


--
-- Name: uq_aprobaciones_tipo_ref_orden; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_aprobaciones_tipo_ref_orden ON public.aprobaciones USING btree (tipo, referencia_id, orden);


--
-- Name: requerimientos trg_sync_estado_entrega_requerimiento; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_estado_entrega_requerimiento BEFORE INSERT OR UPDATE ON public.requerimientos FOR EACH ROW EXECUTE FUNCTION public.fn_sync_estado_entrega_requerimiento();


--
-- Name: aprobaciones aprobaciones_rol_aprobador_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aprobaciones
    ADD CONSTRAINT aprobaciones_rol_aprobador_fkey FOREIGN KEY (rol_aprobador) REFERENCES public.roles(id);


--
-- Name: aprobaciones aprobaciones_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aprobaciones
    ADD CONSTRAINT aprobaciones_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id);


--
-- Name: compras_directas compras_directas_id_area_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compras_directas
    ADD CONSTRAINT compras_directas_id_area_fkey FOREIGN KEY (id_area) REFERENCES public.areas(id);


--
-- Name: compras_directas compras_directas_id_moneda_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compras_directas
    ADD CONSTRAINT compras_directas_id_moneda_fkey FOREIGN KEY (id_moneda) REFERENCES public.monedas(id);


--
-- Name: compras_directas compras_directas_id_usuario_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compras_directas
    ADD CONSTRAINT compras_directas_id_usuario_fkey FOREIGN KEY (id_usuario) REFERENCES public.usuarios(id);


--
-- Name: compras compras_id_area_final_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compras
    ADD CONSTRAINT compras_id_area_final_fkey FOREIGN KEY (id_area_final) REFERENCES public.areas(id);


--
-- Name: compras compras_id_area_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compras
    ADD CONSTRAINT compras_id_area_fkey FOREIGN KEY (id_area) REFERENCES public.areas(id);


--
-- Name: compras compras_id_area_solicitante_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compras
    ADD CONSTRAINT compras_id_area_solicitante_fkey FOREIGN KEY (id_area_solicitante) REFERENCES public.areas(id);


--
-- Name: compras compras_id_moneda_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compras
    ADD CONSTRAINT compras_id_moneda_fkey FOREIGN KEY (id_moneda) REFERENCES public.monedas(id);


--
-- Name: compras compras_id_proveedor_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compras
    ADD CONSTRAINT compras_id_proveedor_fkey FOREIGN KEY (id_proveedor) REFERENCES public.proveedores(id);


--
-- Name: compras compras_id_unidad_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compras
    ADD CONSTRAINT compras_id_unidad_fkey FOREIGN KEY (id_unidad) REFERENCES public.unidades(id);


--
-- Name: compras compras_id_usuario_aprueba_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compras
    ADD CONSTRAINT compras_id_usuario_aprueba_fkey FOREIGN KEY (id_usuario_aprueba) REFERENCES public.usuarios(id);


--
-- Name: compras compras_id_usuario_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compras
    ADD CONSTRAINT compras_id_usuario_fkey FOREIGN KEY (id_usuario) REFERENCES public.usuarios(id);


--
-- Name: compras compras_id_usuario_solicita_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compras
    ADD CONSTRAINT compras_id_usuario_solicita_fkey FOREIGN KEY (id_usuario_solicita) REFERENCES public.usuarios(id);


--
-- Name: detalle_compras_directas detalle_compras_directas_id_compra_directa_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_compras_directas
    ADD CONSTRAINT detalle_compras_directas_id_compra_directa_fkey FOREIGN KEY (id_compra_directa) REFERENCES public.compras_directas(id) ON DELETE CASCADE;


--
-- Name: detalle_compras detalle_compras_id_material_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_compras
    ADD CONSTRAINT detalle_compras_id_material_fkey FOREIGN KEY (id_material) REFERENCES public.materiales(id);


--
-- Name: detalle_compras detalle_compras_id_unidad_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_compras
    ADD CONSTRAINT detalle_compras_id_unidad_fkey FOREIGN KEY (id_unidad) REFERENCES public.unidades(id);


--
-- Name: detalle_movimientos detalle_movimientos_id_material_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_movimientos
    ADD CONSTRAINT detalle_movimientos_id_material_fkey FOREIGN KEY (id_material) REFERENCES public.materiales(id);


--
-- Name: detalle_movimientos detalle_movimientos_id_movimiento_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_movimientos
    ADD CONSTRAINT detalle_movimientos_id_movimiento_fkey FOREIGN KEY (id_movimiento) REFERENCES public.movimientos(id);


--
-- Name: detalle_requerimiento detalle_requerimiento_id_material_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_requerimiento
    ADD CONSTRAINT detalle_requerimiento_id_material_fkey FOREIGN KEY (id_material) REFERENCES public.materiales(id) ON DELETE SET NULL;


--
-- Name: detalle_requerimiento detalle_requerimiento_id_requerimiento_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_requerimiento
    ADD CONSTRAINT detalle_requerimiento_id_requerimiento_fkey FOREIGN KEY (id_requerimiento) REFERENCES public.requerimientos(id) ON DELETE CASCADE;


--
-- Name: materiales fk_materiales_monedas; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.materiales
    ADD CONSTRAINT fk_materiales_monedas FOREIGN KEY (id_moneda) REFERENCES public.monedas(id);


--
-- Name: material_categoria material_categoria_id_material_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_categoria
    ADD CONSTRAINT material_categoria_id_material_fkey FOREIGN KEY (id_material) REFERENCES public.materiales(id) ON DELETE CASCADE;


--
-- Name: materiales_proveedores materiales_proveedores_id_material_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.materiales_proveedores
    ADD CONSTRAINT materiales_proveedores_id_material_fkey FOREIGN KEY (id_material) REFERENCES public.materiales(id);


--
-- Name: movimiento_detalles movimiento_detalles_id_material_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.movimiento_detalles
    ADD CONSTRAINT movimiento_detalles_id_material_fkey FOREIGN KEY (id_material) REFERENCES public.materiales(id) ON DELETE SET NULL;


--
-- Name: movimiento_detalles movimiento_detalles_id_movimiento_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.movimiento_detalles
    ADD CONSTRAINT movimiento_detalles_id_movimiento_fkey FOREIGN KEY (id_movimiento) REFERENCES public.movimientos(id) ON DELETE CASCADE;


--
-- Name: proveedores proveedores_id_area_destino_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proveedores
    ADD CONSTRAINT proveedores_id_area_destino_fkey FOREIGN KEY (id_area_destino) REFERENCES public.areas(id);


--
-- Name: proveedores proveedores_id_moneda_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proveedores
    ADD CONSTRAINT proveedores_id_moneda_fkey FOREIGN KEY (id_moneda) REFERENCES public.monedas(id);


--
-- Name: requerimiento_productos requerimiento_productos_id_material_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.requerimiento_productos
    ADD CONSTRAINT requerimiento_productos_id_material_fkey FOREIGN KEY (id_material) REFERENCES public.materiales(id) ON DELETE SET NULL;


--
-- Name: requerimiento_productos requerimiento_productos_id_requerimiento_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.requerimiento_productos
    ADD CONSTRAINT requerimiento_productos_id_requerimiento_fkey FOREIGN KEY (id_requerimiento) REFERENCES public.requerimientos(id) ON DELETE CASCADE;


--
-- Name: servicios servicios_area_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.servicios
    ADD CONSTRAINT servicios_area_id_fkey FOREIGN KEY (area_id) REFERENCES public.areas(id);


--
-- Name: servicios servicios_id_usuario_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.servicios
    ADD CONSTRAINT servicios_id_usuario_fkey FOREIGN KEY (id_usuario) REFERENCES public.usuarios(id);


--
-- Name: servicios servicios_moneda_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.servicios
    ADD CONSTRAINT servicios_moneda_id_fkey FOREIGN KEY (moneda_id) REFERENCES public.monedas(id);


--
-- Name: servicios servicios_proveedor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.servicios
    ADD CONSTRAINT servicios_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES public.proveedores(id);


--
-- Name: stock stock_id_material_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock
    ADD CONSTRAINT stock_id_material_fkey FOREIGN KEY (id_material) REFERENCES public.materiales(id) ON DELETE CASCADE;


--
-- Name: usuarios usuarios_id_area_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_id_area_fkey FOREIGN KEY (id_area) REFERENCES public.areas(id);


--
-- Name: usuarios usuarios_id_role_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_id_role_fkey FOREIGN KEY (id_role) REFERENCES public.roles(id);


--
-- PostgreSQL database dump complete
--

\unrestrict 5qg7rKi5G4tPv3MT8Dv9D9b0rYkpzpaWmzLm40Ci81kTsdHlJQUaq6YTGBrrcwZ

