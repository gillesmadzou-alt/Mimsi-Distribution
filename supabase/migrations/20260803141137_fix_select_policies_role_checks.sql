-- =====================================================
-- SECURITY FIX: Replace USING(true) SELECT policies with role-appropriate checks
-- Role hierarchy: 1=Livreur, 2=Gestionnaire stock, 3=Comptable, 4=Directeur adjoint,
-- 5=Directrice, 6=Admin, 7=Directrice commerciale, 8=Resp production,
-- 9=Fournier, 10=Chauffeur, 11=Chauffeur externe, 12=Agent sécurité, 13=Plongeuse, 14=Femme de ménage
-- =====================================================

-- Helper: all authenticated users with a valid profile (role >= 1)
-- This is equivalent to "any signed-in employee" but excludes anon and users without a profile

-- ---- barcodes: role >= 2 (nav minRole 2) ----
DROP POLICY IF EXISTS select_barcodes ON barcodes;
CREATE POLICY select_barcodes ON barcodes
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 2));

-- ---- batch_pot_types: role >= 1 (all employees, child of batches) ----
DROP POLICY IF EXISTS select_batch_pot_types ON batch_pot_types;
CREATE POLICY select_batch_pot_types ON batch_pot_types
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 1));

-- ---- batch_sales_points: role >= 1 (all employees, child of batches) ----
DROP POLICY IF EXISTS select_batch_sales_points ON batch_sales_points;
CREATE POLICY select_batch_sales_points ON batch_sales_points
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 1));

-- ---- consignment_returns: role >= 2 (nav minRole 2) ----
DROP POLICY IF EXISTS cons_ret_select ON consignment_returns;
CREATE POLICY cons_ret_select ON consignment_returns
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 2));

-- ---- consignments: role >= 2 (nav minRole 2) ----
DROP POLICY IF EXISTS consignments_select ON consignments;
CREATE POLICY consignments_select ON consignments
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 2));

-- ---- driver_locations: role >= 1 (all employees, live map) ----
DROP POLICY IF EXISTS driver_locations_select ON driver_locations;
CREATE POLICY driver_locations_select ON driver_locations
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 1));

-- ---- personnel_change_requests: role >= 4 (nav minRole 4, approvals) ----
DROP POLICY IF EXISTS change_requests_select ON personnel_change_requests;
CREATE POLICY change_requests_select ON personnel_change_requests
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 4));

-- ---- pot_types: role >= 1 (all employees need to see product catalog) ----
DROP POLICY IF EXISTS pot_types_select ON pot_types;
CREATE POLICY pot_types_select ON pot_types
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 1));

-- ---- profiles: role >= 1 (all employees see org chart, names) ----
DROP POLICY IF EXISTS profiles_select ON profiles;
CREATE POLICY profiles_select ON profiles
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 1));

-- ---- qr_codes: role >= 2 (nav minRole 2) ----
DROP POLICY IF EXISTS select_qr_codes ON qr_codes;
CREATE POLICY select_qr_codes ON qr_codes
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 2));

-- ---- restock_requests: role >= 2 (nav minRole 2) ----
DROP POLICY IF EXISTS restock_select ON restock_requests;
CREATE POLICY restock_select ON restock_requests
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 2));

-- ---- return_pot_types: role >= 1 (all employees, child of returns) ----
DROP POLICY IF EXISTS select_return_pot_types ON return_pot_types;
CREATE POLICY select_return_pot_types ON return_pot_types
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 1));

-- ---- sales_points: role >= 1 (all employees need to see sales points for deliveries) ----
DROP POLICY IF EXISTS sales_points_select ON sales_points;
CREATE POLICY sales_points_select ON sales_points
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 1));

-- ---- stock_handovers: role >= 2 (nav minRole 2) ----
DROP POLICY IF EXISTS handovers_select ON stock_handovers;
CREATE POLICY handovers_select ON stock_handovers
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 2));
