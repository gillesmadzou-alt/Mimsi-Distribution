/*
# Enrichir les mouvements de stock : madeleines, attribution livreur, entree fournier

1. Modifications de `stock_movements`
- `item_type` (text, NOT NULL, DEFAULT 'pots') — distingue les ajustements pots vs madeleines.
  Valeurs autorisees : 'pots', 'madeleines'.
- `driver_id` (uuid, nullable, FK vers drivers) — designe le livreur qui recoit les pots
  lors d'une attribution (movement_type = 'attribution').
- `baker_id` (uuid, nullable, FK vers bakers) — designe le fournier qui effectue une
  entree en stock aupres du gestionnaire de stock (movement_type = 'entree').

2. Modifications de `pot_types`
- `madeleines_stock` (integer, NOT NULL, DEFAULT 0) — stock de madeleines libres
  (distinct du stock de pots prêts). Permet les ajustements de madeleines.

3. Index
- Index sur `stock_movements(driver_id)` et `stock_movements(baker_id)`.

4. Securite
- Aucune modification de politique RLS. Les politiques existantes restent valables :
  SELECT role >= 2, INSERT role >= 2, UPDATE role >= 4, DELETE role >= 5.
*/

-- 1. stock_movements : nouvelles colonnes
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS item_type text NOT NULL DEFAULT 'pots'
  CHECK (item_type IN ('pots', 'madeleines'));
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS driver_id uuid REFERENCES drivers(id) ON DELETE SET NULL;
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS baker_id uuid REFERENCES bakers(id) ON DELETE SET NULL;

-- 2. pot_types : stock de madeleines
ALTER TABLE pot_types ADD COLUMN IF NOT EXISTS madeleines_stock integer NOT NULL DEFAULT 0 CHECK (madeleines_stock >= 0);

-- 3. Index
CREATE INDEX IF NOT EXISTS idx_stock_movements_driver ON stock_movements(driver_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_baker ON stock_movements(baker_id);
