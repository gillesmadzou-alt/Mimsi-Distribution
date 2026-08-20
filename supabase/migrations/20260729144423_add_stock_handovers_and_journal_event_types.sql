/*
# Remises de stock et types d'événements de journal

## Objectif
Ajouter le suivi complet de la chaîne logistique :
Pétrisseur → Fournier → Gestionnaire de stock → Livreur

## 1. Nouvelle table `stock_handovers`
Table traçant les remises de pots de madeleines entre les acteurs :
- `production_to_stock` : le fournier remet les pots produits au gestionnaire de stock (entrée en stock)
- `stock_to_driver` : le gestionnaire de stock remet les pots au livreur pour la tournée (sortie de stock)

Colonnes :
- `id` (uuid, PK)
- `handover_type` (text, NOT NULL) — 'production_to_stock' ou 'stock_to_driver'
- `pot_type_id` (uuid, NOT NULL, FK vers pot_types)
- `quantity` (integer, NOT NULL, > 0)
- `production_record_id` (uuid, FK vers production_records, nullable) — lien avec la production d'origine (pour production_to_stock)
- `driver_id` (uuid, FK vers drivers, nullable) — livreur receveur (pour stock_to_driver)
- `batch_id` (uuid, FK vers delivery_batches, nullable) — tournée liée (pour stock_to_driver)
- `performed_by` (uuid, FK vers profiles) — auteur de la remise
- `handover_date` (date, NOT NULL, défaut CURRENT_DATE)
- `notes` (text, nullable)
- `created_at` (timestamptz, défaut now())

## 2. Modification de `delivery_events`
Ajout de trois nouveaux types d'événements au CHECK constraint :
- `livraison_pate` — livraison de pâte du pétrisseur au fournier
- `production_stock` — remise de pots du fournier au gestionnaire de stock
- `remise_pots` — remise de pots du gestionnaire de stock au livreur

## 3. Sécurité
- RLS activée sur `stock_handovers`
- Politiques CRUD pour `authenticated` (tous les utilisateurs authentifiés peuvent accéder aux remises)
*/

-- ============================================================
-- 1. Création de la table stock_handovers
-- ============================================================
CREATE TABLE IF NOT EXISTS stock_handovers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  handover_type text NOT NULL CHECK (handover_type IN ('production_to_stock', 'stock_to_driver')),
  pot_type_id uuid NOT NULL REFERENCES pot_types(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity > 0),
  production_record_id uuid REFERENCES production_records(id) ON DELETE SET NULL,
  driver_id uuid REFERENCES drivers(id) ON DELETE SET NULL,
  batch_id uuid REFERENCES delivery_batches(id) ON DELETE SET NULL,
  performed_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  handover_date date NOT NULL DEFAULT CURRENT_DATE,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE stock_handovers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "handovers_select" ON stock_handovers;
CREATE POLICY "handovers_select" ON stock_handovers FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "handovers_insert" ON stock_handovers;
CREATE POLICY "handovers_insert" ON stock_handovers FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "handovers_update" ON stock_handovers;
CREATE POLICY "handovers_update" ON stock_handovers FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "handovers_delete" ON stock_handovers;
CREATE POLICY "handovers_delete" ON stock_handovers FOR DELETE
  TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_stock_handovers_date ON stock_handovers(handover_date);
CREATE INDEX IF NOT EXISTS idx_stock_handovers_type ON stock_handovers(handover_type);
CREATE INDEX IF NOT EXISTS idx_stock_handovers_driver ON stock_handovers(driver_id);

-- ============================================================
-- 2. Expansion des types d'événements de delivery_events
-- ============================================================
ALTER TABLE delivery_events DROP CONSTRAINT IF EXISTS delivery_events_event_type_check;

ALTER TABLE delivery_events ADD CONSTRAINT delivery_events_event_type_check
  CHECK (event_type IN (
    'lot_cree', 'depot', 'retour', 'tournee_close', 'tournee_annulee', 'stock_mouvement',
    'livraison_pate', 'production_stock', 'remise_pots'
  ));
