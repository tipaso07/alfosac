-- Add simbolo column to monedas table if not exists
ALTER TABLE monedas ADD COLUMN IF NOT EXISTS simbolo VARCHAR(10);
