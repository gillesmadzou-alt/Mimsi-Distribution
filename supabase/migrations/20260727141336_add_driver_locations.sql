/*
# Suivi GPS en temps réel des livreurs

## Résumé
Cette migration crée une table `driver_locations` qui stocke la position GPS
en temps réel des livreurs pendant leurs tournées. Chaque livreur a une seule
ligne (upsert), mise à jour à intervalle régulier par l'app PWA.

## Nouvelle table
### driver_locations
- id (uuid, PK)
- driver_id (uuid, FK drivers, UNIQUE) — un livreur = une ligne
- lat (numeric) — latitude GPS
- lng (numeric) — longitude GPS
- accuracy (numeric) — précision en mètres
- heading (numeric) — cap en degrés
- speed (numeric) — vitesse en m/s
- recorded_at (timestamptz) — moment de la mesure
- is_tracking (boolean) — true si le livreur a activé le suivi

## Sécurité
- RLS activé sur driver_locations.
- SELECT : tout utilisateur authentifié peut voir les positions (pour la carte).
- INSERT/UPDATE : un livreur ne peut modifier que sa propre ligne ;
  les rôles >= 4 (direction) peuvent aussi mettre à jour.
- DELETE : rôles >= 5 uniquement.
*/

CREATE TABLE IF NOT EXISTS driver_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid UNIQUE NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  lat numeric(10,7) NOT NULL,
  lng numeric(10,7) NOT NULL,
  accuracy numeric,
  heading numeric,
  speed numeric,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  is_tracking boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE driver_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "driver_locations_select" ON driver_locations;
CREATE POLICY "driver_locations_select" ON driver_locations FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "driver_locations_insert" ON driver_locations;
CREATE POLICY "driver_locations_insert" ON driver_locations FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM drivers d WHERE d.id = driver_id AND d.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 4)
  );

DROP POLICY IF EXISTS "driver_locations_update" ON driver_locations;
CREATE POLICY "driver_locations_update" ON driver_locations FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM drivers d WHERE d.id = driver_id AND d.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 4)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM drivers d WHERE d.id = driver_id AND d.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 4)
  );

DROP POLICY IF EXISTS "driver_locations_delete" ON driver_locations;
CREATE POLICY "driver_locations_delete" ON driver_locations FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 5));

CREATE INDEX IF NOT EXISTS idx_driver_locations_driver ON driver_locations(driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_locations_tracking ON driver_locations(is_tracking);
