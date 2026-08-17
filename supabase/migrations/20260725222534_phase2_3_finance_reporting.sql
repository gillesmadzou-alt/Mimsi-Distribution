
/*
# Phase 2 & 3 — Suivi, Reporting et Finance

## Résumé
Ajout des tables nécessaires pour :
- Journal de livraison (événements horodatés)
- Notifications in-app
- Gestion des créances (ventes à crédit)
- Paiements de créances
- Contrôle de conformité financière
- Statistiques aggregées

## Nouvelles tables

### delivery_events
Journal chronologique de tous les événements (dépôt, retour, génération lot, clôture)

### app_notifications
Notifications in-app par utilisateur

### receivables
Créances créées automatiquement à partir des dépôts à crédit

### receivable_payments
Paiements enregistrés contre une créance

### compliance_checks
Contrôle de conformité financière à la clôture de tournée
*/

-- ===========================
-- DELIVERY EVENTS (journal)
-- ===========================
CREATE TABLE IF NOT EXISTS delivery_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL CHECK (event_type IN ('lot_cree', 'depot', 'retour', 'tournee_close', 'tournee_annulee', 'stock_mouvement')),
  batch_id uuid REFERENCES delivery_batches(id) ON DELETE SET NULL,
  driver_id uuid REFERENCES drivers(id) ON DELETE SET NULL,
  sales_point_id uuid REFERENCES sales_points(id) ON DELETE SET NULL,
  quantity integer,
  description text,
  performed_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  meta jsonb
);

ALTER TABLE delivery_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "events_select" ON delivery_events;
CREATE POLICY "events_select" ON delivery_events FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 2)
    OR (driver_id IN (SELECT d.id FROM drivers d WHERE d.user_id = auth.uid()))
  );

DROP POLICY IF EXISTS "events_insert" ON delivery_events;
CREATE POLICY "events_insert" ON delivery_events FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "events_update" ON delivery_events;
CREATE POLICY "events_update" ON delivery_events FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 5))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 5));

DROP POLICY IF EXISTS "events_delete" ON delivery_events;
CREATE POLICY "events_delete" ON delivery_events FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 6));

-- ===========================
-- APP NOTIFICATIONS
-- ===========================
CREATE TABLE IF NOT EXISTS app_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  message text NOT NULL,
  type text NOT NULL DEFAULT 'info' CHECK (type IN ('info', 'warning', 'error', 'success')),
  is_read boolean NOT NULL DEFAULT false,
  link_page text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notif_select" ON app_notifications;
CREATE POLICY "notif_select" ON app_notifications FOR SELECT
  TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "notif_insert" ON app_notifications;
CREATE POLICY "notif_insert" ON app_notifications FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "notif_update" ON app_notifications;
CREATE POLICY "notif_update" ON app_notifications FOR UPDATE
  TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "notif_delete" ON app_notifications;
CREATE POLICY "notif_delete" ON app_notifications FOR DELETE
  TO authenticated USING (user_id = auth.uid());

-- ===========================
-- RECEIVABLES (Créances)
-- ===========================
CREATE TABLE IF NOT EXISTS receivables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deposit_id uuid UNIQUE REFERENCES deposits(id) ON DELETE CASCADE,
  sales_point_id uuid NOT NULL REFERENCES sales_points(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL REFERENCES delivery_batches(id) ON DELETE CASCADE,
  driver_id uuid REFERENCES drivers(id) ON DELETE SET NULL,
  amount_fcfa integer NOT NULL,
  amount_paid integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'en_attente' CHECK (status IN ('en_attente', 'partiel', 'solde')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE receivables ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "recv_select" ON receivables;
CREATE POLICY "recv_select" ON receivables FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 3)
    OR (driver_id IN (SELECT d.id FROM drivers d WHERE d.user_id = auth.uid()))
  );

DROP POLICY IF EXISTS "recv_insert" ON receivables;
CREATE POLICY "recv_insert" ON receivables FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "recv_update" ON receivables;
CREATE POLICY "recv_update" ON receivables FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 3)
    OR (driver_id IN (SELECT d.id FROM drivers d WHERE d.user_id = auth.uid()))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 3)
    OR (driver_id IN (SELECT d.id FROM drivers d WHERE d.user_id = auth.uid()))
  );

DROP POLICY IF EXISTS "recv_delete" ON receivables;
CREATE POLICY "recv_delete" ON receivables FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 4));

-- ===========================
-- RECEIVABLE PAYMENTS
-- ===========================
CREATE TABLE IF NOT EXISTS receivable_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receivable_id uuid NOT NULL REFERENCES receivables(id) ON DELETE CASCADE,
  amount_fcfa integer NOT NULL CHECK (amount_fcfa > 0),
  payment_date timestamptz NOT NULL DEFAULT now(),
  collected_by uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id),
  no_payment_reason text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE receivable_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "recv_pay_select" ON receivable_payments;
CREATE POLICY "recv_pay_select" ON receivable_payments FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 2));

DROP POLICY IF EXISTS "recv_pay_insert" ON receivable_payments;
CREATE POLICY "recv_pay_insert" ON receivable_payments FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "recv_pay_update" ON receivable_payments;
CREATE POLICY "recv_pay_update" ON receivable_payments FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 3))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 3));

DROP POLICY IF EXISTS "recv_pay_delete" ON receivable_payments;
CREATE POLICY "recv_pay_delete" ON receivable_payments FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 4));

-- ===========================
-- COMPLIANCE CHECKS
-- ===========================
CREATE TABLE IF NOT EXISTS compliance_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid UNIQUE NOT NULL REFERENCES delivery_batches(id) ON DELETE CASCADE,
  expected_amount integer NOT NULL,
  reported_amount integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'en_attente' CHECK (status IN ('en_attente', 'conforme', 'non_conforme')),
  checked_by uuid REFERENCES profiles(id),
  checked_at timestamptz,
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE compliance_checks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "compliance_select" ON compliance_checks;
CREATE POLICY "compliance_select" ON compliance_checks FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 3));

DROP POLICY IF EXISTS "compliance_insert" ON compliance_checks;
CREATE POLICY "compliance_insert" ON compliance_checks FOR INSERT
  TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 3));

DROP POLICY IF EXISTS "compliance_update" ON compliance_checks;
CREATE POLICY "compliance_update" ON compliance_checks FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 3))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 3));

DROP POLICY IF EXISTS "compliance_delete" ON compliance_checks;
CREATE POLICY "compliance_delete" ON compliance_checks FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 5));

-- Indexes
CREATE INDEX IF NOT EXISTS idx_delivery_events_batch ON delivery_events(batch_id);
CREATE INDEX IF NOT EXISTS idx_delivery_events_driver ON delivery_events(driver_id);
CREATE INDEX IF NOT EXISTS idx_delivery_events_at ON delivery_events(occurred_at);
CREATE INDEX IF NOT EXISTS idx_app_notifications_user ON app_notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_receivables_sales_point ON receivables(sales_point_id);
CREATE INDEX IF NOT EXISTS idx_receivables_status ON receivables(status);
CREATE INDEX IF NOT EXISTS idx_receivables_driver ON receivables(driver_id);
CREATE INDEX IF NOT EXISTS idx_compliance_batch ON compliance_checks(batch_id);
