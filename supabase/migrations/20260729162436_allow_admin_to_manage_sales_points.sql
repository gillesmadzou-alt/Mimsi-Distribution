-- Allow admin (role 6) to insert sales points
DROP POLICY IF EXISTS "sales_points_insert" ON sales_points;
CREATE POLICY "sales_points_insert" ON sales_points FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN (4, 5, 6, 7)));

-- Allow admin (role 6) to update sales points
DROP POLICY IF EXISTS "sales_points_update" ON sales_points;
CREATE POLICY "sales_points_update" ON sales_points FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN (4, 5, 6, 7)))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN (4, 5, 6, 7)));

-- Allow admin (role 6) to delete sales points
DROP POLICY IF EXISTS "sales_points_delete" ON sales_points;
CREATE POLICY "sales_points_delete" ON sales_points FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN (4, 5, 6, 7)));
