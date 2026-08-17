/*
# Amélioration des tournées : points de vente, type de tournée, recouvrement

## 1. Nouvelle table : batch_sales_points
- Permet d'associer plusieurs points de vente à une tournée dès la création.
- `id` (uuid, PK)
- `batch_id` (uuid, FK vers delivery_batches, ON DELETE CASCADE)
- `sales_point_id` (uuid, FK vers sales_points, ON DELETE CASCADE)
- `created_at` (timestamptz)
- Contrainte d'unicité sur (batch_id, sales_point_id) pour éviter les doublons.

## 2. Colonne ajoutée à delivery_batches
- `batch_type` (text, NOT NULL, DEFAULT 'livraison')
  - Valeurs possibles : 'livraison' (livraison de pots), 'recouvrement' (collecte de créances uniquement), 'mixte' (livraison + recouvrement + retours)
  - `pot_type_id` et `quantity` deviennent NULLABLE pour permettre les tournées de recouvrement sans livraison.

## 3. Colonne ajoutée à receivable_payments
- `batch_id` (uuid, NULLABLE, FK vers delivery_batches) — permet d'associer un paiement de créance à une tournée de recouvrement.

## 4. Sécurité
- RLS activée sur batch_sales_points.
- Politiques CRUD pour authenticated (même logique que delivery_batches : tous les utilisateurs authentifiés peuvent gérer les associations).

## 5. Notes importantes
- La contrainte NOT NULL sur pot_type_id et quantity est relâchée pour supporter les tournées de type 'recouvrement' qui ne livrent pas de pots.
- Les tournées existantes ont batch_type = 'livraison' par défaut.
*/

-- 1. Nouvelle table batch_sales_points
CREATE TABLE IF NOT EXISTS batch_sales_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES delivery_batches(id) ON DELETE CASCADE,
  sales_point_id uuid NOT NULL REFERENCES sales_points(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, sales_point_id)
);

ALTER TABLE batch_sales_points ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_batch_sales_points" ON batch_sales_points;
CREATE POLICY "select_batch_sales_points" ON batch_sales_points
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_batch_sales_points" ON batch_sales_points;
CREATE POLICY "insert_batch_sales_points" ON batch_sales_points
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_batch_sales_points" ON batch_sales_points;
CREATE POLICY "update_batch_sales_points" ON batch_sales_points
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_batch_sales_points" ON batch_sales_points;
CREATE POLICY "delete_batch_sales_points" ON batch_sales_points
  FOR DELETE TO authenticated USING (true);

-- 2. Ajouter batch_type à delivery_batches
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'delivery_batches' AND column_name = 'batch_type'
  ) THEN
    ALTER TABLE delivery_batches ADD COLUMN batch_type text NOT NULL DEFAULT 'livraison';
  END IF;
END $$;

-- Relâcher NOT NULL sur pot_type_id et quantity pour permettre les tournées de recouvrement
ALTER TABLE delivery_batches ALTER COLUMN pot_type_id DROP NOT NULL;
ALTER TABLE delivery_batches ALTER COLUMN quantity DROP NOT NULL;

-- 3. Ajouter batch_id à receivable_payments
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'receivable_payments' AND column_name = 'batch_id'
  ) THEN
    ALTER TABLE receivable_payments ADD COLUMN batch_id uuid REFERENCES delivery_batches(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Index pour performances
CREATE INDEX IF NOT EXISTS idx_batch_sales_points_batch_id ON batch_sales_points(batch_id);
CREATE INDEX IF NOT EXISTS idx_batch_sales_points_sales_point_id ON batch_sales_points(sales_point_id);
CREATE INDEX IF NOT EXISTS idx_receivable_payments_batch_id ON receivable_payments(batch_id);
