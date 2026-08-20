/*
# Points de vente — champs enrichis + cotisation (quota)

## Résumé
Enrichit la table sales_points avec :
- owner_full_name (nom complet du propriétaire)
- owner_phone_secondary (téléphone secondaire)
- owner_email (email optionnel)
- zone (zone du point de vente)
- arrondissements (tableau — un point peut être entre deux arrondissements)
- is_new (ancien / nouveau point de vente)
- quota_amount (cotisation due = prix d'un pot de 100 pièces = 4000 FCFA)
- quota_status (non_paye / partiel / paye)

Ajoute une table quota_payments pour suivre les versements progressifs
de la cotisation, avec trigger pour mettre à jour automatiquement le
statut et le montant payé sur sales_points.

## Sécurité
- RLS sur quota_payments : SELECT pour rôle >= 2, INSERT pour rôle >= 2,
  UPDATE/DELETE pour rôle >= 4.
*/

-- ===========================
-- ADD COLUMNS TO sales_points
-- ===========================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sales_points' AND column_name='owner_full_name') THEN
    ALTER TABLE sales_points ADD COLUMN owner_full_name text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sales_points' AND column_name='owner_phone_secondary') THEN
    ALTER TABLE sales_points ADD COLUMN owner_phone_secondary text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sales_points' AND column_name='owner_email') THEN
    ALTER TABLE sales_points ADD COLUMN owner_email text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sales_points' AND column_name='zone') THEN
    ALTER TABLE sales_points ADD COLUMN zone text NOT NULL DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sales_points' AND column_name='arrondissements') THEN
    ALTER TABLE sales_points ADD COLUMN arrondissements text[] NOT NULL DEFAULT '{}';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sales_points' AND column_name='is_new') THEN
    ALTER TABLE sales_points ADD COLUMN is_new boolean NOT NULL DEFAULT true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sales_points' AND column_name='quota_amount') THEN
    ALTER TABLE sales_points ADD COLUMN quota_amount integer NOT NULL DEFAULT 4000;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sales_points' AND column_name='quota_paid') THEN
    ALTER TABLE sales_points ADD COLUMN quota_paid integer NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sales_points' AND column_name='quota_status') THEN
    ALTER TABLE sales_points ADD COLUMN quota_status text NOT NULL DEFAULT 'non_paye' CHECK (quota_status IN ('non_paye', 'partiel', 'paye'));
  END IF;
END $$;

-- Migrate existing arrondissement text into arrondissements array
UPDATE sales_points
SET arrondissements = CASE
  WHEN arrondissement IS NULL OR arrondissement = '' THEN '{}'
  ELSE ARRAY[arrondissement]
END
WHERE array_length(arrondissements, 1) IS NULL OR array_length(arrondissements, 1) = 0;

-- Migrate owner_name into owner_full_name if empty
UPDATE sales_points
SET owner_full_name = owner_name
WHERE owner_full_name IS NULL AND owner_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sales_points_zone ON sales_points(zone);
CREATE INDEX IF NOT EXISTS idx_sales_points_quota_status ON sales_points(quota_status);
CREATE INDEX IF NOT EXISTS idx_sales_points_is_new ON sales_points(is_new);

-- ===========================
-- QUOTA PAYMENTS TABLE
-- ===========================
CREATE TABLE IF NOT EXISTS quota_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_point_id uuid NOT NULL REFERENCES sales_points(id) ON DELETE CASCADE,
  amount_fcfa integer NOT NULL CHECK (amount_fcfa > 0),
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  collected_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  payment_method text NOT NULL DEFAULT 'especes' CHECK (payment_method IN ('especes', 'mobile_money', 'virement', 'autre')),
  receipt_number text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE quota_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "quota_pay_select" ON quota_payments;
CREATE POLICY "quota_pay_select" ON quota_payments FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 2));

DROP POLICY IF EXISTS "quota_pay_insert" ON quota_payments;
CREATE POLICY "quota_pay_insert" ON quota_payments FOR INSERT
  TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 2));

DROP POLICY IF EXISTS "quota_pay_update" ON quota_payments;
CREATE POLICY "quota_pay_update" ON quota_payments FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 4))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 4));

DROP POLICY IF EXISTS "quota_pay_delete" ON quota_payments;
CREATE POLICY "quota_pay_delete" ON quota_payments FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 5));

CREATE INDEX IF NOT EXISTS idx_quota_payments_sp ON quota_payments(sales_point_id);
CREATE INDEX IF NOT EXISTS idx_quota_payments_date ON quota_payments(payment_date);

-- ===========================
-- TRIGGER: UPDATE QUOTA STATUS ON PAYMENT
-- ===========================
CREATE OR REPLACE FUNCTION update_quota_status()
RETURNS trigger AS $$
DECLARE
  v_quota_amount integer;
  v_total_paid integer;
  v_new_status text;
BEGIN
  SELECT quota_amount INTO v_quota_amount FROM sales_points WHERE id = NEW.sales_point_id;

  SELECT COALESCE(SUM(amount_fcfa), 0) INTO v_total_paid
  FROM quota_payments WHERE sales_point_id = NEW.sales_point_id;

  IF v_total_paid >= v_quota_amount THEN
    v_new_status := 'paye';
  ELSIF v_total_paid > 0 THEN
    v_new_status := 'partiel';
  ELSE
    v_new_status := 'non_paye';
  END IF;

  UPDATE sales_points
  SET quota_paid = v_total_paid, quota_status = v_new_status, updated_at = now()
  WHERE id = NEW.sales_point_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_quota_payment ON quota_payments;
CREATE TRIGGER trg_quota_payment
  AFTER INSERT OR UPDATE OR DELETE ON quota_payments
  FOR EACH ROW EXECUTE FUNCTION update_quota_status();
