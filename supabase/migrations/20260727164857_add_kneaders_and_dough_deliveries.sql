-- ===========================
-- KNEADERS (Pétrisseurs)
-- ===========================
CREATE TABLE IF NOT EXISTS kneaders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  phone text,
  status text NOT NULL DEFAULT 'actif' CHECK (status IN ('actif', 'inactif')),
  avatar_url text,
  notes text,
  profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE kneaders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "kneader_select" ON kneaders;
CREATE POLICY "kneader_select" ON kneaders FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 2));

DROP POLICY IF EXISTS "kneader_insert" ON kneaders;
CREATE POLICY "kneader_insert" ON kneaders FOR INSERT
  TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 2));

DROP POLICY IF EXISTS "kneader_update" ON kneaders;
CREATE POLICY "kneader_update" ON kneaders FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 4))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 4));

DROP POLICY IF EXISTS "kneader_delete" ON kneaders;
CREATE POLICY "kneader_delete" ON kneaders FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 4));

-- ===========================
-- DOUGH DELIVERIES (Livraisons de pâte)
-- ===========================
CREATE TABLE IF NOT EXISTS dough_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kneader_id uuid NOT NULL REFERENCES kneaders(id) ON DELETE CASCADE,
  baker_id uuid NOT NULL REFERENCES bakers(id) ON DELETE CASCADE,
  bucket_count integer NOT NULL CHECK (bucket_count > 0),
  bucket_weight_kg numeric(8,2) NOT NULL CHECK (bucket_weight_kg > 0),
  total_weight_kg numeric(10,2) GENERATED ALWAYS AS (bucket_count * bucket_weight_kg) STORED,
  delivery_date date NOT NULL DEFAULT CURRENT_DATE,
  notes text,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE dough_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dough_select" ON dough_deliveries;
CREATE POLICY "dough_select" ON dough_deliveries FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 2));

DROP POLICY IF EXISTS "dough_insert" ON dough_deliveries;
CREATE POLICY "dough_insert" ON dough_deliveries FOR INSERT
  TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 2));

DROP POLICY IF EXISTS "dough_update" ON dough_deliveries;
CREATE POLICY "dough_update" ON dough_deliveries FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 4))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 4));

DROP POLICY IF EXISTS "dough_delete" ON dough_deliveries;
CREATE POLICY "dough_delete" ON dough_deliveries FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 4));

-- Link production records to the dough delivery they came from
ALTER TABLE production_records ADD COLUMN IF NOT EXISTS dough_delivery_id uuid REFERENCES dough_deliveries(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_dough_kneader ON dough_deliveries(kneader_id);
CREATE INDEX IF NOT EXISTS idx_dough_baker ON dough_deliveries(baker_id);
CREATE INDEX IF NOT EXISTS idx_dough_date ON dough_deliveries(delivery_date);
