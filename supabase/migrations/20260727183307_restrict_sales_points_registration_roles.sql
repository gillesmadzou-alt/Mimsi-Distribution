/*
# Restrict sales_points registration to directeur adjoint (4), directrice (5), directrice commerciale (7)

Previously INSERT/UPDATE allowed role >= 4 (which included admin=6).
Now restricted to exactly roles 4, 5, 7 as requested.
*/

DROP POLICY IF EXISTS "sales_points_insert" ON sales_points;
CREATE POLICY "sales_points_insert" ON sales_points FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN (4, 5, 7)));

DROP POLICY IF EXISTS "sales_points_update" ON sales_points;
CREATE POLICY "sales_points_update" ON sales_points FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN (4, 5, 7)))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN (4, 5, 7)));

DROP POLICY IF EXISTS "sales_points_delete" ON sales_points;
CREATE POLICY "sales_points_delete" ON sales_points FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN (4, 5, 7)));
