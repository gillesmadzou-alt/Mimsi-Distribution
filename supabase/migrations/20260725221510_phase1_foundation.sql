
/*
# Phase 1 — Fondations opérationnelles : Suivi de Distribution

## Résumé
Ce migration crée la totalité du schéma de base pour la Phase 1 de l'application
"Suivi de Distribution" — gestion des livraisons de madeleines en pot.

## Nouvelles tables

### profiles
Extension de auth.users avec rôle métier :
- id (uuid, FK auth.users)
- full_name, role (1=livreur, 2=gestionnaire_stock, 3=comptable, 4=directeur_adjoint, 5=directrice, 6=admin)
- phone, avatar_url, is_active

### pot_types (types de pots)
- id, name (ex: nature, chocolat), madeleine_count, unit_price_fcfa, stock_quantity, low_stock_threshold

### drivers (livreurs)
- id, user_id (FK profiles), full_name, phone_primary, phone_secondary, address, birth_date
- hire_date, zone, status (actif/inactif/conge), vehicle_type, license_number, avatar_url

### sales_points (points de vente)
- id, name, address, district (quartier), arrondissement, gps_lat, gps_lng
- owner_name, owner_phone, delivery_days, photo_url, is_active

### delivery_batches (lots de livraison)
- id, batch_code (unique), date, driver_id, pot_type_id, quantity, zone
- pots_delivered, pots_returned, status (actif/cloture/annule)
- created_by (ref profiles)

### deposits (dépôts / confirmations de livraison)
- id, batch_id, sales_point_id, quantity, deposited_at (auto), gps_lat, gps_lng
- photo_url, payment_type (comptant/credit), payment_status, amount_fcfa
- is_confirmed

### returns (retours / invendus)
- id, batch_id, sales_point_id, quantity, returned_at (auto)
- reason (peremption/invendu/casse/autre), notes

### stock_movements (mouvements de stock)
- id, pot_type_id, movement_type (entree/attribution/retour), quantity, reference_id, notes, created_at, created_by

## Sécurité
- RLS activé sur toutes les tables
- Politiques basées sur auth.uid() via profiles.id
- Les livreurs (role=1) ne voient que leurs propres données
- Les niveaux 4-6 ont accès complet
*/

-- ===========================
-- PROFILES
-- ===========================
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL DEFAULT '',
  role integer NOT NULL DEFAULT 1 CHECK (role BETWEEN 1 AND 6),
  phone text,
  avatar_url text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select" ON profiles;
CREATE POLICY "profiles_select" ON profiles FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "profiles_insert" ON profiles;
CREATE POLICY "profiles_insert" ON profiles FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_update" ON profiles;
CREATE POLICY "profiles_update" ON profiles FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = id
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 5)
  )
  WITH CHECK (
    auth.uid() = id
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 5)
  );

DROP POLICY IF EXISTS "profiles_delete" ON profiles;
CREATE POLICY "profiles_delete" ON profiles FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 6));

-- ===========================
-- POT TYPES
-- ===========================
CREATE TABLE IF NOT EXISTS pot_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  madeleine_count integer NOT NULL DEFAULT 1,
  unit_price_fcfa integer NOT NULL DEFAULT 0,
  stock_quantity integer NOT NULL DEFAULT 0,
  low_stock_threshold integer NOT NULL DEFAULT 20,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE pot_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pot_types_select" ON pot_types;
CREATE POLICY "pot_types_select" ON pot_types FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "pot_types_insert" ON pot_types;
CREATE POLICY "pot_types_insert" ON pot_types FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 2));

DROP POLICY IF EXISTS "pot_types_update" ON pot_types;
CREATE POLICY "pot_types_update" ON pot_types FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 2))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 2));

DROP POLICY IF EXISTS "pot_types_delete" ON pot_types;
CREATE POLICY "pot_types_delete" ON pot_types FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 4));

-- ===========================
-- DRIVERS
-- ===========================
CREATE TABLE IF NOT EXISTS drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  full_name text NOT NULL,
  phone_primary text NOT NULL,
  phone_secondary text,
  address text,
  birth_date date,
  hire_date date NOT NULL DEFAULT CURRENT_DATE,
  zone text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'actif' CHECK (status IN ('actif', 'inactif', 'conge')),
  vehicle_type text NOT NULL DEFAULT 'moto' CHECK (vehicle_type IN ('moto', 'velo', 'voiture', 'pied')),
  license_number text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE drivers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "drivers_select_manager" ON drivers;
CREATE POLICY "drivers_select_manager" ON drivers FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 2)
    OR user_id = auth.uid()
  );

DROP POLICY IF EXISTS "drivers_insert" ON drivers;
CREATE POLICY "drivers_insert" ON drivers FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 4));

DROP POLICY IF EXISTS "drivers_update" ON drivers;
CREATE POLICY "drivers_update" ON drivers FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 4))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 4));

DROP POLICY IF EXISTS "drivers_delete" ON drivers;
CREATE POLICY "drivers_delete" ON drivers FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 5));

-- ===========================
-- SALES POINTS
-- ===========================
CREATE TABLE IF NOT EXISTS sales_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  address text,
  district text NOT NULL DEFAULT '',
  arrondissement text,
  gps_lat numeric(10,7),
  gps_lng numeric(10,7),
  owner_name text,
  owner_phone text,
  delivery_days text[] DEFAULT '{}',
  photo_url text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sales_points ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sales_points_select" ON sales_points;
CREATE POLICY "sales_points_select" ON sales_points FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "sales_points_insert" ON sales_points;
CREATE POLICY "sales_points_insert" ON sales_points FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 4));

DROP POLICY IF EXISTS "sales_points_update" ON sales_points;
CREATE POLICY "sales_points_update" ON sales_points FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 4))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 4));

DROP POLICY IF EXISTS "sales_points_delete" ON sales_points;
CREATE POLICY "sales_points_delete" ON sales_points FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 5));

-- ===========================
-- DELIVERY BATCHES (Lots)
-- ===========================
CREATE TABLE IF NOT EXISTS delivery_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_code text UNIQUE NOT NULL,
  batch_date date NOT NULL DEFAULT CURRENT_DATE,
  driver_id uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  pot_type_id uuid NOT NULL REFERENCES pot_types(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity > 0),
  zone text NOT NULL DEFAULT '',
  pots_delivered integer NOT NULL DEFAULT 0,
  pots_returned integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'actif' CHECK (status IN ('actif', 'cloture', 'annule')),
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE delivery_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "batches_select" ON delivery_batches;
CREATE POLICY "batches_select" ON delivery_batches FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 2)
    OR EXISTS (SELECT 1 FROM drivers d WHERE d.id = driver_id AND d.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "batches_insert" ON delivery_batches;
CREATE POLICY "batches_insert" ON delivery_batches FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 4));

DROP POLICY IF EXISTS "batches_update" ON delivery_batches;
CREATE POLICY "batches_update" ON delivery_batches FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 2))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 2));

DROP POLICY IF EXISTS "batches_delete" ON delivery_batches;
CREATE POLICY "batches_delete" ON delivery_batches FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 5));

-- ===========================
-- DEPOSITS (Dépôts)
-- ===========================
CREATE TABLE IF NOT EXISTS deposits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES delivery_batches(id) ON DELETE CASCADE,
  sales_point_id uuid NOT NULL REFERENCES sales_points(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity > 0),
  deposited_at timestamptz NOT NULL DEFAULT now(),
  gps_lat numeric(10,7),
  gps_lng numeric(10,7),
  photo_url text,
  payment_type text NOT NULL DEFAULT 'comptant' CHECK (payment_type IN ('comptant', 'credit')),
  amount_fcfa integer NOT NULL DEFAULT 0,
  is_confirmed boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE deposits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deposits_select" ON deposits;
CREATE POLICY "deposits_select" ON deposits FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 2)
    OR EXISTS (
      SELECT 1 FROM delivery_batches db
      JOIN drivers d ON d.id = db.driver_id
      WHERE db.id = batch_id AND d.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "deposits_insert" ON deposits;
CREATE POLICY "deposits_insert" ON deposits FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 2)
    OR EXISTS (
      SELECT 1 FROM delivery_batches db
      JOIN drivers d ON d.id = db.driver_id
      WHERE db.id = batch_id AND d.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "deposits_update" ON deposits;
CREATE POLICY "deposits_update" ON deposits FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 2))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 2));

DROP POLICY IF EXISTS "deposits_delete" ON deposits;
CREATE POLICY "deposits_delete" ON deposits FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 4));

-- ===========================
-- RETURNS (Retours)
-- ===========================
CREATE TABLE IF NOT EXISTS returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES delivery_batches(id) ON DELETE CASCADE,
  sales_point_id uuid NOT NULL REFERENCES sales_points(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity > 0),
  returned_at timestamptz NOT NULL DEFAULT now(),
  reason text CHECK (reason IN ('peremption', 'invendu', 'casse', 'autre')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE returns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "returns_select" ON returns;
CREATE POLICY "returns_select" ON returns FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 2)
    OR EXISTS (
      SELECT 1 FROM delivery_batches db
      JOIN drivers d ON d.id = db.driver_id
      WHERE db.id = batch_id AND d.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "returns_insert" ON returns;
CREATE POLICY "returns_insert" ON returns FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 2)
    OR EXISTS (
      SELECT 1 FROM delivery_batches db
      JOIN drivers d ON d.id = db.driver_id
      WHERE db.id = batch_id AND d.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "returns_update" ON returns;
CREATE POLICY "returns_update" ON returns FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 2))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 2));

DROP POLICY IF EXISTS "returns_delete" ON returns;
CREATE POLICY "returns_delete" ON returns FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 4));

-- ===========================
-- STOCK MOVEMENTS
-- ===========================
CREATE TABLE IF NOT EXISTS stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pot_type_id uuid NOT NULL REFERENCES pot_types(id) ON DELETE RESTRICT,
  movement_type text NOT NULL CHECK (movement_type IN ('entree', 'attribution', 'retour', 'ajustement')),
  quantity integer NOT NULL,
  reference_id uuid,
  notes text,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stock_movements_select" ON stock_movements;
CREATE POLICY "stock_movements_select" ON stock_movements FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 2));

DROP POLICY IF EXISTS "stock_movements_insert" ON stock_movements;
CREATE POLICY "stock_movements_insert" ON stock_movements FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 2));

DROP POLICY IF EXISTS "stock_movements_update" ON stock_movements;
CREATE POLICY "stock_movements_update" ON stock_movements FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 4))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 4));

DROP POLICY IF EXISTS "stock_movements_delete" ON stock_movements;
CREATE POLICY "stock_movements_delete" ON stock_movements FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 5));

-- ===========================
-- INDEXES
-- ===========================
CREATE INDEX IF NOT EXISTS idx_drivers_user_id ON drivers(user_id);
CREATE INDEX IF NOT EXISTS idx_drivers_status ON drivers(status);
CREATE INDEX IF NOT EXISTS idx_drivers_zone ON drivers(zone);
CREATE INDEX IF NOT EXISTS idx_delivery_batches_date ON delivery_batches(batch_date);
CREATE INDEX IF NOT EXISTS idx_delivery_batches_driver ON delivery_batches(driver_id);
CREATE INDEX IF NOT EXISTS idx_delivery_batches_status ON delivery_batches(status);
CREATE INDEX IF NOT EXISTS idx_deposits_batch ON deposits(batch_id);
CREATE INDEX IF NOT EXISTS idx_deposits_sales_point ON deposits(sales_point_id);
CREATE INDEX IF NOT EXISTS idx_deposits_at ON deposits(deposited_at);
CREATE INDEX IF NOT EXISTS idx_returns_batch ON returns(batch_id);
CREATE INDEX IF NOT EXISTS idx_returns_at ON returns(returned_at);
CREATE INDEX IF NOT EXISTS idx_stock_movements_pot_type ON stock_movements(pot_type_id);
CREATE INDEX IF NOT EXISTS idx_sales_points_district ON sales_points(district);

-- ===========================
-- SEED DEFAULT POT TYPES
-- ===========================
INSERT INTO pot_types (name, madeleine_count, unit_price_fcfa, stock_quantity, low_stock_threshold)
VALUES
  ('Nature', 12, 1500, 100, 20),
  ('Chocolat', 12, 1800, 80, 20),
  ('Citron', 12, 1600, 60, 15),
  ('Miel', 12, 2000, 40, 15)
ON CONFLICT DO NOTHING;
