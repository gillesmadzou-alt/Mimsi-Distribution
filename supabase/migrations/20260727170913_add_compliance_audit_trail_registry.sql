/*
# Registre des décisions de conformité

## Résumé
Tient un registre automatique et permanent de toutes les décisions de
validation ou de rejet prises à tous les niveaux de la chaîne de conformité.
Ce registre est accessible uniquement au directeur adjoint (4), à la
directrice (5) et à l'admin (6).

## Nouvelle table
### compliance_audit_trail
- decision_type : 'valide' | 'rejete' | 'commentaire'
- entity_type : 'discrepancy' | 'financial_check'
- entity_id : référence vers l'entité concernée
- entity_label : libellé pour affichage
- chain_stage : maillon de la chaîne (pour les écarts)
- decided_by : profil qui a pris la décision
- decided_by_name : nom dénormalisé
- decided_by_role : rôle au moment de la décision
- decision_comment : commentaire accompagnant la décision
- previous_status : statut avant la décision
- new_status : statut après la décision
- decided_at : horodatage

## Triggers
- trg_discrepancy_audit : AFTER UPDATE sur compliance_discrepancies,
  logge toute transition vers 'valide' ou 'rejete'.
- trg_financial_audit : AFTER UPDATE sur compliance_checks,
  logge toute transition vers 'conforme' ou 'non_conforme'.

## Sécurité
- RLS : SELECT pour rôles 4, 5, 6 uniquement. INSERT pour tous (via trigger).
  UPDATE et DELETE interdits (registre permanent).
*/

CREATE TABLE IF NOT EXISTS compliance_audit_trail (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_type text NOT NULL CHECK (decision_type IN ('valide', 'rejete', 'conforme', 'non_conforme')),
  entity_type text NOT NULL CHECK (entity_type IN ('discrepancy', 'financial_check')),
  entity_id uuid NOT NULL,
  entity_label text NOT NULL DEFAULT '',
  chain_stage text,
  decided_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  decided_by_name text NOT NULL DEFAULT '',
  decided_by_role integer NOT NULL DEFAULT 0,
  decision_comment text,
  previous_status text,
  new_status text,
  decided_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE compliance_audit_trail ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_trail_select" ON compliance_audit_trail;
CREATE POLICY "audit_trail_select" ON compliance_audit_trail FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN (4, 5, 6)));

DROP POLICY IF EXISTS "audit_trail_insert" ON compliance_audit_trail;
CREATE POLICY "audit_trail_insert" ON compliance_audit_trail FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "audit_trail_update" ON compliance_audit_trail;
CREATE POLICY "audit_trail_update" ON compliance_audit_trail FOR UPDATE
  TO authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "audit_trail_delete" ON compliance_audit_trail;
CREATE POLICY "audit_trail_delete" ON compliance_audit_trail FOR DELETE
  TO authenticated USING (false);

CREATE INDEX IF NOT EXISTS idx_audit_trail_decided_at ON compliance_audit_trail(decided_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_trail_entity ON compliance_audit_trail(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_trail_decided_by ON compliance_audit_trail(decided_by);

-- ===========================
-- TRIGGER: DISCREPANCY AUDIT
-- ===========================
CREATE OR REPLACE FUNCTION log_discrepancy_decision()
RETURNS trigger AS $$
DECLARE
  v_decider_name text;
  v_decider_role integer;
  v_label text;
  v_stage text;
BEGIN
  -- Only log transitions to valide or rejete
  IF NEW.status IN ('valide', 'rejete') AND (OLD.status IS NULL OR OLD.status NOT IN ('valide', 'rejete')) THEN
    SELECT full_name, role INTO v_decider_name, v_decider_role
    FROM profiles WHERE id = auth.uid();

    v_label := NEW.entity_label;
    v_stage := NEW.chain_stage;

    INSERT INTO compliance_audit_trail (
      decision_type, entity_type, entity_id, entity_label, chain_stage,
      decided_by, decided_by_name, decided_by_role, decision_comment,
      previous_status, new_status, decided_at
    ) VALUES (
      NEW.status, 'discrepancy', NEW.id, v_label, v_stage,
      auth.uid(), COALESCE(v_decider_name, 'Inconnu'), COALESCE(v_decider_role, 0), NEW.comment,
      OLD.status, NEW.status, COALESCE(NEW.validated_at, now())
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_discrepancy_audit ON compliance_discrepancies;
CREATE TRIGGER trg_discrepancy_audit
  AFTER UPDATE OF status ON compliance_discrepancies
  FOR EACH ROW EXECUTE FUNCTION log_discrepancy_decision();

-- ===========================
-- TRIGGER: FINANCIAL CHECK AUDIT
-- ===========================
CREATE OR REPLACE FUNCTION log_financial_check_decision()
RETURNS trigger AS $$
DECLARE
  v_decider_name text;
  v_decider_role integer;
  v_batch_code text;
  v_label text;
BEGIN
  IF NEW.status IN ('conforme', 'non_conforme') AND (OLD.status IS NULL OR OLD.status NOT IN ('conforme', 'non_conforme')) THEN
    SELECT full_name, role INTO v_decider_name, v_decider_role
    FROM profiles WHERE id = auth.uid();

    SELECT batch_code INTO v_batch_code FROM delivery_batches WHERE id = NEW.batch_id;
    v_label := 'Lot ' || COALESCE(v_batch_code, '—');

    INSERT INTO compliance_audit_trail (
      decision_type, entity_type, entity_id, entity_label, chain_stage,
      decided_by, decided_by_name, decided_by_role, decision_comment,
      previous_status, new_status, decided_at
    ) VALUES (
      NEW.status, 'financial_check', NEW.id, v_label, NULL,
      auth.uid(), COALESCE(v_decider_name, 'Inconnu'), COALESCE(v_decider_role, 0), NEW.comment,
      OLD.status, NEW.status, COALESCE(NEW.checked_at, now())
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_financial_audit ON compliance_checks;
CREATE TRIGGER trg_financial_audit
  AFTER UPDATE OF status ON compliance_checks
  FOR EACH ROW EXECUTE FUNCTION log_financial_check_decision();
