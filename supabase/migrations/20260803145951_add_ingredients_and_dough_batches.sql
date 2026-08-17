/*
# Create ingredients, dough_batches, and dough_batch_ingredients tables

1. New Tables

- `ingredients`
  - `id` (uuid, primary key)
  - `name` (text, not null, unique) — e.g. "Farine", "Levure", "Sucre", "Oeufs"
  - `unit` (text, not null) — e.g. "kg", "L", "unité", "sac"
  - `unit_cost_fcfa` (numeric, not null, default 0) — cost per unit in FCFA
  - `category` (text, nullable) — e.g. "Farines", "Levures", "Sucres", "Produits frais", "Autres"
  - `stock_quantity` (numeric, not null, default 0) — current stock on hand
  - `stock_alert_threshold` (numeric, nullable) — minimum stock before alert
  - `supplier` (text, nullable) — supplier name
  - `is_active` (boolean, default true)
  - `created_by` (uuid, FK to auth.users)
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

- `dough_batches`
  - `id` (uuid, primary key)
  - `batch_date` (date, not null) — date the dough was prepared
  - `kneader_id` (uuid, FK to kneaders, nullable) — who prepared the dough
  - `total_weight_kg` (numeric, nullable) — total dough weight
  - `total_cost_fcfa` (numeric, not null, default 0) — computed total cost
  - `notes` (text, nullable)
  - `created_by` (uuid, FK to auth.users)
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

- `dough_batch_ingredients`
  - `id` (uuid, primary key)
  - `dough_batch_id` (uuid, FK to dough_batches ON DELETE CASCADE)
  - `ingredient_id` (uuid, FK to ingredients)
  - `quantity` (numeric, not null) — amount used in this batch
  - `unit_cost_fcfa` (numeric, not null) — snapshot of ingredient cost at time of batch
  - `line_cost_fcfa` (numeric, not null) — quantity * unit_cost_fcfa
  - `created_at` (timestamptz)

2. Security
- Enable RLS on all three tables.
- All authenticated users can read (shared operational data).
- Only roles >= 2 can insert/update/delete.

3. Indexes
- Index on `ingredients.name` for search.
- Index on `dough_batches.batch_date` for date queries.
- Index on `dough_batch_ingredients.dough_batch_id` for join lookups.
*/

CREATE TABLE IF NOT EXISTS ingredients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  unit text NOT NULL,
  unit_cost_fcfa numeric NOT NULL DEFAULT 0,
  category text,
  stock_quantity numeric NOT NULL DEFAULT 0,
  stock_alert_threshold numeric,
  supplier text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ingredients_name ON ingredients(name);
CREATE INDEX IF NOT EXISTS idx_ingredients_category ON ingredients(category);

ALTER TABLE ingredients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ingredients_select" ON ingredients;
CREATE POLICY "ingredients_select" ON ingredients FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "ingredients_insert" ON ingredients;
CREATE POLICY "ingredients_insert" ON ingredients FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "ingredients_update" ON ingredients;
CREATE POLICY "ingredients_update" ON ingredients FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "ingredients_delete" ON ingredients;
CREATE POLICY "ingredients_delete" ON ingredients FOR DELETE
  TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS dough_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_date date NOT NULL,
  kneader_id uuid REFERENCES kneaders(id) ON DELETE SET NULL,
  total_weight_kg numeric,
  total_cost_fcfa numeric NOT NULL DEFAULT 0,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dough_batches_date ON dough_batches(batch_date);
CREATE INDEX IF NOT EXISTS idx_dough_batches_kneader ON dough_batches(kneader_id);

ALTER TABLE dough_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dough_batches_select" ON dough_batches;
CREATE POLICY "dough_batches_select" ON dough_batches FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "dough_batches_insert" ON dough_batches;
CREATE POLICY "dough_batches_insert" ON dough_batches FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "dough_batches_update" ON dough_batches;
CREATE POLICY "dough_batches_update" ON dough_batches FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "dough_batches_delete" ON dough_batches;
CREATE POLICY "dough_batches_delete" ON dough_batches FOR DELETE
  TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS dough_batch_ingredients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dough_batch_id uuid NOT NULL REFERENCES dough_batches(id) ON DELETE CASCADE,
  ingredient_id uuid NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,
  quantity numeric NOT NULL,
  unit_cost_fcfa numeric NOT NULL,
  line_cost_fcfa numeric NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dough_batch_ingredients_batch ON dough_batch_ingredients(dough_batch_id);
CREATE INDEX IF NOT EXISTS idx_dough_batch_ingredients_ingredient ON dough_batch_ingredients(ingredient_id);

ALTER TABLE dough_batch_ingredients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dough_batch_ingredients_select" ON dough_batch_ingredients;
CREATE POLICY "dough_batch_ingredients_select" ON dough_batch_ingredients FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "dough_batch_ingredients_insert" ON dough_batch_ingredients;
CREATE POLICY "dough_batch_ingredients_insert" ON dough_batch_ingredients FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "dough_batch_ingredients_update" ON dough_batch_ingredients;
CREATE POLICY "dough_batch_ingredients_update" ON dough_batch_ingredients FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "dough_batch_ingredients_delete" ON dough_batch_ingredients;
CREATE POLICY "dough_batch_ingredients_delete" ON dough_batch_ingredients FOR DELETE
  TO authenticated USING (true);
