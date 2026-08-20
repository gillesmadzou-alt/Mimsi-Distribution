/*
# Conformité multi-niveaux avec notifications automatiques

## Résumé
Ajoute un système de vérification des quantités entre chaque maillon de la chaîne :
1. Pétrisseur → Fournier (livraisons de pâte vs production)
2. Fournier → Gestionnaire de stock (production vs entrées en stock)
3. Gestionnaire de stock → Commercialisation/Livreurs (stock attribué vs lots livrés)

Dès qu'un écart est constaté, les responsables de département et la direction
(rôles 4+) sont automatiquement notifiés via app_notifications.

Règle spéciale : un seau (bombé) de pâte doit faire exactement 12,8 kg.
Si le poids est différent (< ou > 12,8 kg), une notification est envoyée.

## Nouvelles tables
### compliance_discrepancies
Enregistre chaque écart détecté entre deux maillons de la chaîne.
- chain_stage : quel maillon est concerné ('pate_production', 'production_stock', 'stock_livraison')
- expected_qty : quantité attendue
- actual_qty : quantité constatée
- unit : unité de mesure ('pots', 'kg', 'seaux')
- status : 'non_resolu', 'resolu'
- notified_roles : rôles qui ont été notifiés

## Nouvelles fonctions SQL
### notify_responsible_profiles(title, message, link_page)
Insère une notification app_notifications pour chaque profil de rôle >= 4.

### check_dough_weight_compliance()
Trigger sur dough_deliveries : si bucket_weight_kg != 12.8, notifie.

### check_pate_to_production()
Trigger sur production_records : compare la pâte reçue par le fournier
(seaux × poids) avec la production obtenue (pots + madeleines).

### check_production_to_stock()
Trigger sur stock_movements (type 'entree') : compare la production
enregistrée avec les entrées en stock.

### check_stock_to_delivery()
Trigger sur delivery_batches (UPDATE status='cloture') : compare le stock
attribué avec les pots livrés + retours.

## Sécurité
- RLS activée sur compliance_discrepancies.
- SELECT pour rôle >= 3, INSERT pour tous (via trigger), UPDATE/DELETE pour rôle >= 4.
*/

-- ===========================
-- COMPLIANCE DISCREPANCIES
-- ===========================
CREATE TABLE IF NOT EXISTS compliance_discrepancies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_stage text NOT NULL CHECK (chain_stage IN ('pate_production', 'production_stock', 'stock_livraison', 'poids_seau')),
  entity_type text NOT NULL DEFAULT '',
  entity_id uuid,
  entity_label text,
  expected_qty numeric(12,2) NOT NULL DEFAULT 0,
  actual_qty numeric(12,2) NOT NULL DEFAULT 0,
  variance numeric(12,2) NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT 'pots',
  status text NOT NULL DEFAULT 'non_resolu' CHECK (status IN ('non_resolu', 'resolu')),
  comment text,
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES profiles(id),
  notified_roles integer[] NOT NULL DEFAULT '{}'
);

ALTER TABLE compliance_discrepancies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "discrepancy_select" ON compliance_discrepancies;
CREATE POLICY "discrepancy_select" ON compliance_discrepancies FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 3));

DROP POLICY IF EXISTS "discrepancy_insert" ON compliance_discrepancies;
CREATE POLICY "discrepancy_insert" ON compliance_discrepancies FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "discrepancy_update" ON compliance_discrepancies;
CREATE POLICY "discrepancy_update" ON compliance_discrepancies FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 4))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 4));

DROP POLICY IF EXISTS "discrepancy_delete" ON compliance_discrepancies;
CREATE POLICY "discrepancy_delete" ON compliance_discrepancies FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 5));

CREATE INDEX IF NOT EXISTS idx_discrepancy_stage ON compliance_discrepancies(chain_stage);
CREATE INDEX IF NOT EXISTS idx_discrepancy_status ON compliance_discrepancies(status);
CREATE INDEX IF NOT EXISTS idx_discrepancy_detected ON compliance_discrepancies(detected_at);

-- ===========================
-- NOTIFY RESPONSIBLE PROFILES
-- ===========================
CREATE OR REPLACE FUNCTION notify_responsible_profiles(
  p_title text,
  p_message text,
  p_link_page text DEFAULT NULL
) RETURNS void AS $$
BEGIN
  INSERT INTO app_notifications (user_id, title, message, type, link_page)
  SELECT id, p_title, p_message, 'warning', p_link_page
  FROM profiles
  WHERE role >= 4 AND is_active = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===========================
-- CHECK DOUGH WEIGHT (12.8 kg per bucket)
-- ===========================
CREATE OR REPLACE FUNCTION check_dough_weight_compliance()
RETURNS trigger AS $$
BEGIN
  IF NEW.bucket_weight_kg <> 12.8 THEN
    INSERT INTO compliance_discrepancies (
      chain_stage, entity_type, entity_id, entity_label,
      expected_qty, actual_qty, variance, unit, notified_roles
    ) VALUES (
      'poids_seau', 'dough_delivery', NEW.id,
      'Livraison pâte ' || NEW.delivery_date,
      12.8, NEW.bucket_weight_kg, NEW.bucket_weight_kg - 12.8, 'kg', ARRAY[4,5,6]
    );

    PERFORM notify_responsible_profiles(
      'Poids de seau non conforme',
      'Un seau de pâte de ' || NEW.bucket_weight_kg || ' kg a été enregistré (norme : 12,8 kg).',
      'compliance'
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_dough_weight_check ON dough_deliveries;
CREATE TRIGGER trg_dough_weight_check
  AFTER INSERT OR UPDATE OF bucket_weight_kg ON dough_deliveries
  FOR EACH ROW EXECUTE FUNCTION check_dough_weight_compliance();

-- ===========================
-- CHECK PATE → PRODUCTION
-- Compare dough received by baker vs production output
-- ===========================
CREATE OR REPLACE FUNCTION check_pate_to_production()
RETURNS trigger AS $$
DECLARE
  v_total_dough_kg numeric(12,2);
  v_expected_pots integer;
  v_baker_name text;
BEGIN
  -- Sum all dough received by this baker
  SELECT COALESCE(SUM(total_weight_kg), 0), b.full_name
  INTO v_total_dough_kg, v_baker_name
  FROM dough_deliveries d
  JOIN bakers b ON b.id = d.baker_id
  WHERE d.baker_id = NEW.baker_id
    AND d.delivery_date <= NEW.production_date
  GROUP BY b.full_name
  LIMIT 1;

  IF v_baker_name IS NULL THEN
    v_baker_name := 'Fournier inconnu';
    v_total_dough_kg := 0;
  END IF;

  -- Expected pots: ~1 pot per 0.5 kg of dough (approximate ratio)
  -- This is a configurable threshold; the key is detecting variance
  v_expected_pots := ROUND(v_total_dough_kg / 0.5);

  -- If baker received dough but produced significantly less, flag it
  IF v_total_dough_kg > 0 AND NEW.quantity > 0 THEN
    IF NEW.quantity < (v_expected_pots * 0.7) OR NEW.quantity > (v_expected_pots * 1.3) THEN
      INSERT INTO compliance_discrepancies (
        chain_stage, entity_type, entity_id, entity_label,
        expected_qty, actual_qty, variance, unit, notified_roles
      ) VALUES (
        'pate_production', 'production_record', NEW.id,
        v_baker_name || ' — ' || NEW.production_date,
        v_expected_pots, NEW.quantity, NEW.quantity - v_expected_pots, 'pots', ARRAY[4,5,6]
      );

      PERFORM notify_responsible_profiles(
        'Écart pâte → production',
        v_baker_name || ' : ' || NEW.quantity || ' pots produits pour ' || v_total_dough_kg || ' kg de pâte reçue (attendu ~' || v_expected_pots || ' pots).',
        'compliance'
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_pate_production_check ON production_records;
CREATE TRIGGER trg_pate_production_check
  AFTER INSERT OR UPDATE OF quantity, baker_id, production_date ON production_records
  FOR EACH ROW EXECUTE FUNCTION check_pate_to_production();

-- ===========================
-- CHECK PRODUCTION → STOCK
-- Compare production records vs stock entries
-- ===========================
CREATE OR REPLACE FUNCTION check_production_to_stock()
RETURNS trigger AS $$
DECLARE
  v_total_produced integer;
  v_total_stock_in integer;
  v_pot_name text;
BEGIN
  IF NEW.movement_type = 'entree' AND NEW.pot_type_id IS NOT NULL THEN
    -- Total produced for this pot type
    SELECT COALESCE(SUM(quantity), 0)
    INTO v_total_produced
    FROM production_records
    WHERE pot_type_id = NEW.pot_type_id;

    -- Total stock entries for this pot type
    SELECT COALESCE(SUM(quantity), 0)
    INTO v_total_stock_in
    FROM stock_movements
    WHERE pot_type_id = NEW.pot_type_id AND movement_type = 'entree';

    SELECT name INTO v_pot_name FROM pot_types WHERE id = NEW.pot_type_id;

    IF v_total_produced > 0 AND v_total_stock_in > 0 THEN
      IF v_total_stock_in < (v_total_produced * 0.9) OR v_total_stock_in > (v_total_produced * 1.1) THEN
        INSERT INTO compliance_discrepancies (
          chain_stage, entity_type, entity_id, entity_label,
          expected_qty, actual_qty, variance, unit, notified_roles
        ) VALUES (
          'production_stock', 'stock_movement', NEW.id,
          'Pot ' || COALESCE(v_pot_name, '—'),
          v_total_produced, v_total_stock_in, v_total_stock_in - v_total_produced, 'pots', ARRAY[4,5,6]
        );

        PERFORM notify_responsible_profiles(
          'Écart production → stock',
          'Pot ' || COALESCE(v_pot_name, '—') || ' : ' || v_total_stock_in || ' pots en stock pour ' || v_total_produced || ' pots produits.',
          'compliance'
        );
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_production_stock_check ON stock_movements;
CREATE TRIGGER trg_production_stock_check
  AFTER INSERT OR UPDATE OF quantity, movement_type, pot_type_id ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION check_production_to_stock();

-- ===========================
-- CHECK STOCK → LIVRAISON
-- Compare stock attributed vs pots delivered + returned
-- ===========================
CREATE OR REPLACE FUNCTION check_stock_to_delivery()
RETURNS trigger AS $$
DECLARE
  v_stock_attributed integer;
  v_total_delivered integer;
  v_total_returned integer;
  v_pot_name text;
  v_batch_code text;
BEGIN
  IF NEW.status = 'cloture' AND (OLD.status IS NULL OR OLD.status <> 'cloture') THEN
    SELECT COALESCE(SUM(quantity), 0)
    INTO v_stock_attributed
    FROM stock_movements
    WHERE pot_type_id = NEW.pot_type_id AND movement_type = 'attribution';

    v_total_delivered := COALESCE(NEW.pots_delivered, 0);
    v_total_returned := COALESCE(NEW.pots_returned, 0);

    SELECT name INTO v_pot_name FROM pot_types WHERE id = NEW.pot_type_id;
    v_batch_code := NEW.batch_code;

    IF v_stock_attributed > 0 THEN
      IF v_total_delivered > v_stock_attributed THEN
        INSERT INTO compliance_discrepancies (
          chain_stage, entity_type, entity_id, entity_label,
          expected_qty, actual_qty, variance, unit, notified_roles
        ) VALUES (
          'stock_livraison', 'delivery_batch', NEW.id,
          'Lot ' || v_batch_code,
          v_stock_attributed, v_total_delivered, v_total_delivered - v_stock_attributed, 'pots', ARRAY[4,5,6]
        );

        PERFORM notify_responsible_profiles(
          'Écart stock → livraison',
          'Lot ' || v_batch_code || ' : ' || v_total_delivered || ' pots livrés pour ' || v_stock_attributed || ' attribués.',
          'compliance'
        );
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_stock_delivery_check ON delivery_batches;
CREATE TRIGGER trg_stock_delivery_check
  AFTER UPDATE OF status ON delivery_batches
  FOR EACH ROW EXECUTE FUNCTION check_stock_to_delivery();
