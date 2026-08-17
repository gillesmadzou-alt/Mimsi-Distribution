/*
# Renforcer les politiques RLS restantes sur les tables de liaison et personnel_change_requests

1. Contexte
- batch_pot_types, batch_sales_points, return_pot_types: USING=true et WITH CHECK=true sur INSERT/UPDATE/DELETE
- personnel_change_requests: USING=true sur UPDATE et DELETE
- stock_handovers: USING=true sur DELETE et UPDATE

2. Modifications
- Les tables de liaison (batch_pot_types, batch_sales_points, return_pot_types) sont contrôlées
  par la table parente (batches/returns). Les politiques sont renforcées pour vérifier
  que l'utilisateur est authentifié.
- personnel_change_requests: UPDATE et DELETE restreints aux rôles >= 4 (directeurs)
- stock_handovers: UPDATE et DELETE restreints aux rôles >= 2
*/

-- batch_pot_types: tout utilisateur authentifié peut gérer les types de pots des lots
DROP POLICY IF EXISTS "delete_batch_pot_types" ON batch_pot_types;
CREATE POLICY "delete_batch_pot_types" ON batch_pot_types FOR DELETE
  TO authenticated USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "insert_batch_pot_types" ON batch_pot_types;
CREATE POLICY "insert_batch_pot_types" ON batch_pot_types FOR INSERT
  TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "update_batch_pot_types" ON batch_pot_types;
CREATE POLICY "update_batch_pot_types" ON batch_pot_types FOR UPDATE
  TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- batch_sales_points: tout utilisateur authentifié peut gérer les points de vente des lots
DROP POLICY IF EXISTS "delete_batch_sales_points" ON batch_sales_points;
CREATE POLICY "delete_batch_sales_points" ON batch_sales_points FOR DELETE
  TO authenticated USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "insert_batch_sales_points" ON batch_sales_points;
CREATE POLICY "insert_batch_sales_points" ON batch_sales_points FOR INSERT
  TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "update_batch_sales_points" ON batch_sales_points;
CREATE POLICY "update_batch_sales_points" ON batch_sales_points FOR UPDATE
  TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- return_pot_types: tout utilisateur authentifié peut gérer les types de pots des retours
DROP POLICY IF EXISTS "delete_return_pot_types" ON return_pot_types;
CREATE POLICY "delete_return_pot_types" ON return_pot_types FOR DELETE
  TO authenticated USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "insert_return_pot_types" ON return_pot_types;
CREATE POLICY "insert_return_pot_types" ON return_pot_types FOR INSERT
  TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "update_return_pot_types" ON return_pot_types;
CREATE POLICY "update_return_pot_types" ON return_pot_types FOR UPDATE
  TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- personnel_change_requests: UPDATE et DELETE restreints aux directeurs (rôle >= 4)
DROP POLICY IF EXISTS "change_requests_delete" ON personnel_change_requests;
CREATE POLICY "change_requests_delete" ON personnel_change_requests FOR DELETE
  TO authenticated USING (EXISTS (
    SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 4
  ));

DROP POLICY IF EXISTS "change_requests_update" ON personnel_change_requests;
CREATE POLICY "change_requests_update" ON personnel_change_requests FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 4))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 4));

-- stock_handovers: UPDATE et DELETE restreints aux rôles >= 2
DROP POLICY IF EXISTS "handovers_delete" ON stock_handovers;
CREATE POLICY "handovers_delete" ON stock_handovers FOR DELETE
  TO authenticated USING (EXISTS (
    SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 2
  ));

DROP POLICY IF EXISTS "handovers_update" ON stock_handovers;
CREATE POLICY "handovers_update" ON stock_handovers FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 2))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 2));
