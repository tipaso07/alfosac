-- Add UNIQUE constraints to categorias and almacenes (idempotent)
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'categorias_nombre_unique'
	) THEN
		ALTER TABLE categorias
			ADD CONSTRAINT categorias_nombre_unique UNIQUE (nombre);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'almacenes_nombre_unique'
	) THEN
		ALTER TABLE almacenes
			ADD CONSTRAINT almacenes_nombre_unique UNIQUE (nombre);
	END IF;
END$$;
