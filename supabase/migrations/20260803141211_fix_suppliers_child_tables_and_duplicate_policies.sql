-- =====================================================
-- Fix suppliers table: replace auth.uid() IS NOT NULL with role checks
-- Suppliers are managed by stock managers (role >= 2) and above
-- =====================================================

DROP POLICY IF EXISTS suppliers_delete ON suppliers;
DROP POLICY IF EXISTS suppliers_insert ON suppliers;
DROP POLICY IF EXISTS suppliers_select ON suppliers;
DROP POLICY IF EXISTS suppliers_update ON suppliers;

CREATE POLICY suppliers_select ON suppliers
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 2));

CREATE POLICY suppliers_insert ON suppliers
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 2));

CREATE POLICY suppliers_update ON suppliers
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 2))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 2));

CREATE POLICY suppliers_delete ON suppliers
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 4));

-- =====================================================
-- Drop duplicate permissive INSERT policy on receivable_payments
-- recv_pay_insert (auth.uid() IS NOT NULL) is redundant with insert_receivable_payments
-- which already enforces proper role/ownership checks
-- =====================================================

DROP POLICY IF EXISTS recv_pay_insert ON receivable_payments;

-- =====================================================
-- Fix child table write policies (batch_pot_types, batch_sales_points, return_pot_types)
-- These used auth.uid() IS NOT NULL — any authenticated user could write
-- =====================================================

-- batch_pot_types: writes by role >= 2 (managers), deletes by role >= 4
DROP POLICY IF EXISTS insert_batch_pot_types ON batch_pot_types;
DROP POLICY IF EXISTS update_batch_pot_types ON batch_pot_types;
DROP POLICY IF EXISTS delete_batch_pot_types ON batch_pot_types;

CREATE POLICY insert_batch_pot_types ON batch_pot_types
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 2));

CREATE POLICY update_batch_pot_types ON batch_pot_types
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 2))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 2));

CREATE POLICY delete_batch_pot_types ON batch_pot_types
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 4));

-- batch_sales_points: writes by role >= 2, deletes by role >= 4
DROP POLICY IF EXISTS insert_batch_sales_points ON batch_sales_points;
DROP POLICY IF EXISTS update_batch_sales_points ON batch_sales_points;
DROP POLICY IF EXISTS delete_batch_sales_points ON batch_sales_points;

CREATE POLICY insert_batch_sales_points ON batch_sales_points
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 2));

CREATE POLICY update_batch_sales_points ON batch_sales_points
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 2))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 2));

CREATE POLICY delete_batch_sales_points ON batch_sales_points
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 4));

-- return_pot_types: writes by role >= 2, deletes by role >= 4
DROP POLICY IF EXISTS insert_return_pot_types ON return_pot_types;
DROP POLICY IF EXISTS update_return_pot_types ON return_pot_types;
DROP POLICY IF EXISTS delete_return_pot_types ON return_pot_types;

CREATE POLICY insert_return_pot_types ON return_pot_types
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 2));

CREATE POLICY update_return_pot_types ON return_pot_types
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 2))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 2));

CREATE POLICY delete_return_pot_types ON return_pot_types
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 4));
