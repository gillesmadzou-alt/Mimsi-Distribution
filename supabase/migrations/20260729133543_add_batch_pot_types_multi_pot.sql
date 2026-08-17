/*
# Tournées multi-types de pots

## 1. Nouvelle table : batch_pot_types
- Permet d'associer plusieurs types de pots (avec leurs quantités respectives) à une seule tournée.
- `id` (uuid, PK)
- `batch_id` (uuid, FK vers delivery_batches, ON DELETE CASCADE)
- `pot_type_id` (uuid, FK vers pot_types, ON DELETE CASCADE)
- `quantity` (integer, NOT NULL) — nombre de pots de ce type attribués à la tournée
- `created_at` (timestamptz)
- Contrainte d'unicité sur (batch_id, pot_type_id) pour éviter les doublons.

## 2. Notes importantes
- La colonne `pot_type_id` et `quantity` sur `delivery_batches` restent pour la rétrocompatibilité mais ne sont plus utilisées pour les nouvelles tournées multi-types.
- Les dépôts (deposits) continuent de référencer un seul `pot_type_id` (celui du pot déposé à un point donné).
- Le stock est décrémenté pour chaque type de pot ajouté à la tournée.
*/

CREATE TABLE IF NOT EXISTS batch_pot_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES delivery_batches(id) ON DELETE CASCADE,
  pot_type_id uuid NOT NULL REFERENCES pot_types(id) ON DELETE CASCADE,
  quantity integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, pot_type_id)
);

ALTER TABLE batch_pot_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_batch_pot_types" ON batch_pot_types;
CREATE POLICY "select_batch_pot_types" ON batch_pot_types
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_batch_pot_types" ON batch_pot_types;
CREATE POLICY "insert_batch_pot_types" ON batch_pot_types
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_batch_pot_types" ON batch_pot_types;
CREATE POLICY "update_batch_pot_types" ON batch_pot_types
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_batch_pot_types" ON batch_pot_types;
CREATE POLICY "delete_batch_pot_types" ON batch_pot_types
  FOR DELETE TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_batch_pot_types_batch_id ON batch_pot_types(batch_id);
CREATE INDEX IF NOT EXISTS idx_batch_pot_types_pot_type_id ON batch_pot_types(pot_type_id);
