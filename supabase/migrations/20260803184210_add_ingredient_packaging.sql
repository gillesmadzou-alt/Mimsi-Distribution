/*
# Add packaging data to ingredients

1. Modified Tables
- `ingredients`: add four nullable columns to describe how the ingredient is packaged.
  - `package_unit` (text) — large packaging unit, e.g. "sac", "bidon", "carton".
  - `package_capacity` (numeric) — how many base units fit in one package, e.g. 25 (kg per sac of farine).
  - `sub_package_unit` (text) — optional smaller sub-unit, e.g. "sachet" for levure.
  - `sub_package_capacity` (numeric) — how many sub-units per base unit, e.g. 6 (sachets per paquet of levure).

2. Data
- Seed standard ingredients (Farine, Huile, Sucre, Levure, Œufs) with their packaging info:
  - Farine: 1 sac = 25 kg
  - Huile: 1 bidon = 25 L
  - Sucre: 1 sac = 50 kg
  - Levure: 1 carton = 54 paquets, 1 paquet = 6 sachets
  - Œufs: no packaging defined (unité)

3. Security
- No policy changes. Existing policies already allow authenticated CRUD.
*/

ALTER TABLE public.ingredients
  ADD COLUMN IF NOT EXISTS package_unit text,
  ADD COLUMN IF NOT EXISTS package_capacity numeric,
  ADD COLUMN IF NOT EXISTS sub_package_unit text,
  ADD COLUMN IF NOT EXISTS sub_package_capacity numeric;

-- Seed standard ingredients with packaging data
INSERT INTO public.ingredients (name, unit, unit_cost_fcfa, category, stock_quantity, package_unit, package_capacity, sub_package_unit, sub_package_capacity)
VALUES
  ('Farine', 'kg', 0, 'Farines', 0, 'sac', 25, NULL, NULL),
  ('Huile', 'L', 0, 'Matières grasses', 0, 'bidon', 25, NULL, NULL),
  ('Sucre', 'kg', 0, 'Sucres', 0, 'sac', 50, NULL, NULL),
  ('Levure', 'paquet', 0, 'Levures', 0, 'carton', 54, 'sachet', 6),
  ('Œufs', 'unites', 0, 'Œufs', 0, NULL, NULL, NULL, NULL)
ON CONFLICT (name) DO UPDATE SET
  package_unit = EXCLUDED.package_unit,
  package_capacity = EXCLUDED.package_capacity,
  sub_package_unit = EXCLUDED.sub_package_unit,
  sub_package_capacity = EXCLUDED.sub_package_capacity;
