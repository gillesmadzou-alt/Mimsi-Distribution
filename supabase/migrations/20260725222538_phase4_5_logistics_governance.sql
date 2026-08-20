
/*
# Phase 4 & 5 — Logistique avancée et Gouvernance

## Résumé
Tables pour les modules de logistique avancée (consignes, réapprovisionnement, congés)
et de gouvernance (classement, production, audit log).

## Nouvelles tables

### consignments — suivi des contenants (pots en verre) consignés
### consignment_returns — retours de contenants
### restock_requests — demandes de réapprovisionnement
### leave_periods — congés et absences des livreurs
### bakers — fourniers (producteurs)
### production_records — enregistrements de production journalière
### audit_logs — journal de toutes les actions sensibles
*/

-- ===========================
-- CONSIGNMENTS
-- ===========================
CREATE TABLE IF NOT EXISTS consignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_point_id uuid NOT NULL REFERENCES sales_points(id) ON DELETE CASCADE,
  batch_id uuid REFERENCES delivery_batches(id) ON DELETE SET NULL,
  quantity_deposited integer NOT NULL CHECK (quantity_deposited > 0),
  quantity_returned integer NOT NULL DEFAULT 0,
  deposited_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE consignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "consignments_select" ON consignments;
CREATE POLICY "consignments_select" ON consignments FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "consignments_insert" ON consignments;
CREATE POLICY "consignments_insert" ON consignments FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "consignments_update" ON consignments;
CREATE POLICY "consignments_update" ON consignments FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 2))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 2));

DROP POLICY IF EXISTS "consignments_delete" ON consignments;
CREATE POLICY "consignments_delete" ON consignments FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 4));

-- ===========================
-- CONSIGNMENT RETURNS
-- ===========================
CREATE TABLE IF NOT EXISTS consignment_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consignment_id uuid NOT NULL REFERENCES consignments(id) ON DELETE CASCADE,
  quantity integer NOT NULL CHECK (quantity > 0),
  returned_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE consignment_returns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cons_ret_select" ON consignment_returns;
CREATE POLICY "cons_ret_select" ON consignment_returns FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "cons_ret_insert" ON consignment_returns;
CREATE POLICY "cons_ret_insert" ON consignment_returns FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "cons_ret_update" ON consignment_returns;
CREATE POLICY "cons_ret_update" ON consignment_returns FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 2))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 2));

DROP POLICY IF EXISTS "cons_ret_delete" ON consignment_returns;
CREATE POLICY "cons_ret_delete" ON consignment_returns FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 4));

-- ===========================
-- RESTOCK REQUESTS
-- ===========================
CREATE TABLE IF NOT EXISTS restock_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_point_id uuid NOT NULL REFERENCES sales_points(id) ON DELETE CASCADE,
  pot_type_id uuid NOT NULL REFERENCES pot_types(id) ON DELETE CASCADE,
  quantity integer NOT NULL CHECK (quantity > 0),
  status text NOT NULL DEFAULT 'en_attente' CHECK (status IN ('en_attente', 'traitee', 'annulee')),
  requested_by uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id),
  treated_by uuid REFERENCES profiles(id),
  treated_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE restock_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "restock_select" ON restock_requests;
CREATE POLICY "restock_select" ON restock_requests FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "restock_insert" ON restock_requests;
CREATE POLICY "restock_insert" ON restock_requests FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "restock_update" ON restock_requests;
CREATE POLICY "restock_update" ON restock_requests FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 2))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 2));

DROP POLICY IF EXISTS "restock_delete" ON restock_requests;
CREATE POLICY "restock_delete" ON restock_requests FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 4));

-- ===========================
-- LEAVE PERIODS
-- ===========================
CREATE TABLE IF NOT EXISTS leave_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  substitute_driver_id uuid REFERENCES drivers(id) ON DELETE SET NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  reason text,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE leave_periods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "leave_select" ON leave_periods;
CREATE POLICY "leave_select" ON leave_periods FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 2));

DROP POLICY IF EXISTS "leave_insert" ON leave_periods;
CREATE POLICY "leave_insert" ON leave_periods FOR INSERT
  TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 4));

DROP POLICY IF EXISTS "leave_update" ON leave_periods;
CREATE POLICY "leave_update" ON leave_periods FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 4))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 4));

DROP POLICY IF EXISTS "leave_delete" ON leave_periods;
CREATE POLICY "leave_delete" ON leave_periods FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 4));

-- ===========================
-- BAKERS (Fourniers)
-- ===========================
CREATE TABLE IF NOT EXISTS bakers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  phone text,
  status text NOT NULL DEFAULT 'actif' CHECK (status IN ('actif', 'inactif')),
  avatar_url text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE bakers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bakers_select" ON bakers;
CREATE POLICY "bakers_select" ON bakers FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 2));

DROP POLICY IF EXISTS "bakers_insert" ON bakers;
CREATE POLICY "bakers_insert" ON bakers FOR INSERT
  TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 4));

DROP POLICY IF EXISTS "bakers_update" ON bakers;
CREATE POLICY "bakers_update" ON bakers FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 4))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 4));

DROP POLICY IF EXISTS "bakers_delete" ON bakers;
CREATE POLICY "bakers_delete" ON bakers FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 5));

-- ===========================
-- PRODUCTION RECORDS
-- ===========================
CREATE TABLE IF NOT EXISTS production_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  baker_id uuid NOT NULL REFERENCES bakers(id) ON DELETE CASCADE,
  pot_type_id uuid NOT NULL REFERENCES pot_types(id) ON DELETE CASCADE,
  quantity integer NOT NULL CHECK (quantity > 0),
  production_date date NOT NULL DEFAULT CURRENT_DATE,
  notes text,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE production_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "prod_select" ON production_records;
CREATE POLICY "prod_select" ON production_records FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 2));

DROP POLICY IF EXISTS "prod_insert" ON production_records;
CREATE POLICY "prod_insert" ON production_records FOR INSERT
  TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 2));

DROP POLICY IF EXISTS "prod_update" ON production_records;
CREATE POLICY "prod_update" ON production_records FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 4))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 4));

DROP POLICY IF EXISTS "prod_delete" ON production_records;
CREATE POLICY "prod_delete" ON production_records FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 4));

-- ===========================
-- AUDIT LOGS
-- ===========================
CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  entity_label text,
  performed_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  performed_by_name text,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_select" ON audit_logs;
CREATE POLICY "audit_select" ON audit_logs FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 4));

DROP POLICY IF EXISTS "audit_insert" ON audit_logs;
CREATE POLICY "audit_insert" ON audit_logs FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "audit_update" ON audit_logs;
CREATE POLICY "audit_update" ON audit_logs FOR UPDATE
  TO authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "audit_delete" ON audit_logs;
CREATE POLICY "audit_delete" ON audit_logs FOR DELETE
  TO authenticated USING (false);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_consignments_sales_point ON consignments(sales_point_id);
CREATE INDEX IF NOT EXISTS idx_restock_status ON restock_requests(status);
CREATE INDEX IF NOT EXISTS idx_leave_driver ON leave_periods(driver_id);
CREATE INDEX IF NOT EXISTS idx_production_date ON production_records(production_date);
CREATE INDEX IF NOT EXISTS idx_production_baker ON production_records(baker_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_logs(created_at);
