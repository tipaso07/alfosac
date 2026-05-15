-- Migration: cleanup duplicate categorias and almacenes before adding UNIQUE constraints
-- Fecha: 2026-05-04


-- Use PL/pgSQL loops to merge duplicate categorias safely
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT nombre, array_agg(id ORDER BY id) AS ids, min(id) AS keep_id
    FROM categorias
    GROUP BY nombre
    HAVING count(*) > 1
  LOOP
    UPDATE materiales SET id_categoria = r.keep_id WHERE id_categoria = ANY(r.ids) AND id_categoria <> r.keep_id;
    UPDATE material_categoria SET id_categoria = r.keep_id WHERE id_categoria = ANY(r.ids) AND id_categoria <> r.keep_id;
    DELETE FROM categorias WHERE nombre = r.nombre AND id <> r.keep_id;
  END LOOP;
END$$;

-- Use PL/pgSQL loops to merge duplicate almacenes safely
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT nombre, array_agg(id ORDER BY id) AS ids, min(id) AS keep_id
    FROM almacenes
    GROUP BY nombre
    HAVING count(*) > 1
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'stock' AND column_name = 'id_almacen') THEN
      UPDATE stock SET id_almacen = r.keep_id WHERE id_almacen = ANY(r.ids) AND id_almacen <> r.keep_id;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'movimientos' AND column_name = 'id_almacen') THEN
      UPDATE movimientos SET id_almacen = r.keep_id WHERE id_almacen = ANY(r.ids) AND id_almacen <> r.keep_id;
    END IF;

    DELETE FROM almacenes WHERE nombre = r.nombre AND id <> r.keep_id;
  END LOOP;
END$$;
