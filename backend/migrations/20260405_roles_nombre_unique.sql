-- Add UNIQUE constraint to roles.nombre if not exists
-- Note: Using IF NOT EXISTS syntax for creating constraints
ALTER TABLE roles ADD CONSTRAINT roles_nombre_unique UNIQUE (nombre);
