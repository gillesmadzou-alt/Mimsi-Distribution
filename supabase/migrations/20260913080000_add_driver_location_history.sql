/*
# Historique GPS des livreurs (pour le suivi de tournée)

## Résumé
`driver_locations` ne garde qu'UNE seule ligne par livreur (upsert), donc
aucun historique n'est conservé — impossible de calculer a posteriori le
temps passé sur un point de vente ou entre deux livraisons. Cette migration
ajoute une table d'historique en append-only, alimentée en parallèle de
`driver_locations` (voir TrackingContext.tsx), pour permettre ce calcul.

## Nouvelle table
### driver_location_history
- Même colonnes que driver_locations, mais SANS contrainte UNIQUE sur
  driver_id : chaque ping GPS devient une nouvelle ligne.

## Sécurité
- RLS activé, mêmes règles de lecture que driver_locations (tout utilisateur
  authentifié peut lire, pour les rapports de suivi).
- INSERT : un livreur ne peut insérer que ses propres pings ; rôles >= 4 aussi.
- DELETE : rôles >= 5 uniquement (purge éventuelle des vieilles données).

## Note
Cette table ne contient des données qu'à partir du déploiement de cette
migration — aucun historique rétroactif n'existe pour les tournées passées.
*/

CREATE TABLE IF NOT EXISTS driver_location_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  lat numeric(10,7) NOT NULL,
  lng numeric(10,7) NOT NULL,
  accuracy numeric,
  heading numeric,
  speed numeric,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_driver_location_history_driver_time
  ON driver_location_history (driver_id, recorded_at DESC);

ALTER TABLE driver_location_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "driver_location_history_select" ON driver_location_history;
CREATE POLICY "driver_location_history_select" ON driver_location_history FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "driver_location_history_insert" ON driver_location_history;
CREATE POLICY "driver_location_history_insert" ON driver_location_history FOR INSERT
  TO authenticated WITH CHECK (
    private.get_my_role() >= 4
    OR driver_id IN (SELECT id FROM drivers WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "driver_location_history_delete" ON driver_location_history;
CREATE POLICY "driver_location_history_delete" ON driver_location_history FOR DELETE
  TO authenticated USING (private.get_my_role() >= 5);
