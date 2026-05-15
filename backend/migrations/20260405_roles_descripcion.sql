-- Add descripcion column to roles table if not exists
ALTER TABLE roles ADD COLUMN IF NOT EXISTS descripcion TEXT;
