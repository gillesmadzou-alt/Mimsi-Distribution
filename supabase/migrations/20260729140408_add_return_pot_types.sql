/*
# Détail des retours par type de pot de madeleines

## Contexte
Les retours/invendus ne distinguaient pas les types de pots (pot rond de 100, pot carré de 100, etc.).
On ajoutait juste un total `quantity` et `madeleine_count` global.

## 1. Nouvelle table : return_pot_types
Permet d'associer plusieurs types de pots (avec leurs quantités respectives) à un seul retour.
- `id` (uuid, PK)
- `return_id` (uuid, FK vers returns, ON DELETE CASCADE)
- `pot_type_id` (uuid, FK vers pot_types, ON DELETE CASCADE)
- `quantity` (integer, NOT NULL DEFAULT 0) — pots prêts revenus de ce type
- `empty_pots` (integer, NOT NULL DEFAULT 0) — pots vides revenus de ce type
- `empty_lids` (integer, NOT NULL DEFAULT 0) — couvercles revenus de ce type
- `madeleine_count` (integer, NOT NULL DEFAULT 0) — madeleines revenues de ce type
- `created_at` (timestamptz)
- Contrainte d'unicité sur (return_id, pot_type_id).

## 2. Sécurité
- RLS activé sur return_pot_types.
- 4 politiques CRUD pour authenticated (lecture publique via authenticated).

## 3. Notes
- Les colonnes existantes sur `returns` (quantity, empty_pots, empty_lids, madeleine_count)
  restent pour rétrocompatibilité et servent de totaux globaux.
- Les nouvelles lignes dans return_pot_types donnent le détail par type de pot.
*/

CREATE TABLE IF NOT EXISTS return_pot_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id uuid NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
  pot_type_id uuid NOT NULL REFERENCES pot_types(id) ON DELETE CASCADE,
  quantity integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  empty_pots integer NOT NULL DEFAULT 0 CHECK (empty_pots >= 0),
  empty_lids integer NOT NULL DEFAULT 0 CHECK (empty_lids >= 0),
  madeleine_count integer NOT NULL DEFAULT 0 CHECK (madeleine_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (return_id, pot_type_id)
);

ALTER TABLE return_pot_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_return_pot_types" ON return_pot_types;
CREATE POLICY "select_return_pot_types" ON return_pot_types
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_return_pot_types" ON return_pot_types;
CREATE POLICY "insert_return_pot_types" ON return_pot_types
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_return_pot_types" ON return_pot_types;
CREATE POLICY "update_return_pot_types" ON return_pot_types
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_return_pot_types" ON return_pot_types;
CREATE POLICY "delete_return_pot_types" ON return_pot_types
  FOR DELETE TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_return_pot_types_return_id ON return_pot_types(return_id);
CREATE INDEX IF NOT EXISTS idx_return_pot_types_pot_type_id ON return_pot_types(pot_type_id);
