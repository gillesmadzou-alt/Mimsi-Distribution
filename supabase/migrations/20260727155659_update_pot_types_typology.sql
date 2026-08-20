-- Add shape column to distinguish pots, barquettes, sachets
ALTER TABLE pot_types ADD COLUMN IF NOT EXISTS shape text NOT NULL DEFAULT 'pot'
  CHECK (shape IN ('pot', 'barquette', 'sachet'));

-- Deactivate old placeholder pot types (they have existing batch references)
UPDATE pot_types SET is_active = false WHERE name IN ('Nature', 'Chocolat', 'Citron', 'Miel');

-- Insert the real product typology
INSERT INTO pot_types (name, madeleine_count, shape, unit_price_fcfa, stock_quantity, low_stock_threshold, is_active)
VALUES
  ('Pot rond 100 pièces', 100, 'pot', 0, 0, 20, true),
  ('Pot carré 100 pièces', 100, 'pot', 0, 0, 20, true),
  ('Pot 125 pièces', 125, 'pot', 0, 0, 20, true),
  ('Pot 180 pièces', 180, 'pot', 0, 0, 20, true),
  ('Pot 250 pièces', 250, 'pot', 0, 0, 15, true),
  ('Pot 350 pièces', 350, 'pot', 0, 0, 10, true),
  ('Barquette 20 pièces', 20, 'barquette', 0, 0, 30, true),
  ('Sachet 10 pièces', 10, 'sachet', 0, 0, 40, true)
ON CONFLICT DO NOTHING;
