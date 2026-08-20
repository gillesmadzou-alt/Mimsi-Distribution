/*
# Commentaires de conformité et validation finale

## Résumé
Ajoute un système de commentaires pour que les responsables de département
(rôles 2, 3, 7, 8) puissent donner des explications sur les écarts détectés.
Seuls le directeur adjoint (4), la directrice (5) et l'admin (6) peuvent
valider/résoudre un écart.

## Nouvelles tables
### compliance_comments
Commentaires ajoutés par les responsables de département sur un écart.
- discrepancy_id : référence vers compliance_discrepancies
- author_id : profil qui a écrit le commentaire
- author_name : nom dénormalisé pour affichage rapide
- author_role : rôle au moment du commentaire
- comment : texte de l'explication

## Modifications
- compliance_discrepancies : ajout de colonnes validated_by, validated_at
  pour distinguer la validation finale (directeur adjoint / directrice)
  du simple commentaire.

## Sécurité
- RLS sur compliance_comments : SELECT pour rôle >= 3, INSERT pour rôle >= 2
  (tous les responsables peuvent commenter), UPDATE/DELETE pour rôle >= 5.
- compliance_discrepancies : l'UPDATE (validation) est désormais restreinte
  aux rôles 4, 5, 6 uniquement (directeur adjoint, directrice, admin).
*/

-- ===========================
-- ADD VALIDATION COLUMNS
-- ===========================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'compliance_discrepancies' AND column_name = 'validated_by'
  ) THEN
    ALTER TABLE compliance_discrepancies
      ADD COLUMN validated_by uuid REFERENCES profiles(id),
      ADD COLUMN validated_at timestamptz;
  END IF;
END $$;

-- Update status constraint to include 'valide' and 'rejete'
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'compliance_discrepancies_status_check'
  ) THEN
    ALTER TABLE compliance_discrepancies DROP CONSTRAINT compliance_discrepancies_status_check;
  END IF;
END $$;

ALTER TABLE compliance_discrepancies
  DROP CONSTRAINT IF EXISTS compliance_discrepancies_status_check;
ALTER TABLE compliance_discrepancies
  ADD CONSTRAINT compliance_discrepancies_status_check
  CHECK (status IN ('non_resolu', 'resolu', 'valide', 'rejete'));

-- ===========================
-- RESTRICT UPDATE TO DIRECTORS ONLY (4, 5, 6)
-- ===========================
DROP POLICY IF EXISTS "discrepancy_update" ON compliance_discrepancies;
CREATE POLICY "discrepancy_update" ON compliance_discrepancies FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN (4, 5, 6)))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN (4, 5, 6)));

-- ===========================
-- COMPLIANCE COMMENTS TABLE
-- ===========================
CREATE TABLE IF NOT EXISTS compliance_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discrepancy_id uuid NOT NULL REFERENCES compliance_discrepancies(id) ON DELETE CASCADE,
  author_id uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id),
  author_name text NOT NULL DEFAULT '',
  author_role integer NOT NULL DEFAULT 0,
  comment text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE compliance_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cc_select" ON compliance_comments;
CREATE POLICY "cc_select" ON compliance_comments FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 3));

DROP POLICY IF EXISTS "cc_insert" ON compliance_comments;
CREATE POLICY "cc_insert" ON compliance_comments FOR INSERT
  TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 2));

DROP POLICY IF EXISTS "cc_update" ON compliance_comments;
CREATE POLICY "cc_update" ON compliance_comments FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 5))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 5));

DROP POLICY IF EXISTS "cc_delete" ON compliance_comments;
CREATE POLICY "cc_delete" ON compliance_comments FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role >= 5));

CREATE INDEX IF NOT EXISTS idx_cc_discrepancy ON compliance_comments(discrepancy_id);
CREATE INDEX IF NOT EXISTS idx_cc_created ON compliance_comments(created_at);

-- ===========================
-- NOTIFY DIRECTORS ON NEW COMMENT
-- ===========================
CREATE OR REPLACE FUNCTION notify_directors_on_comment()
RETURNS trigger AS $$
DECLARE
  v_disc_label text;
BEGIN
  SELECT entity_label INTO v_disc_label FROM compliance_discrepancies WHERE id = NEW.discrepancy_id;

  PERFORM notify_responsible_profiles(
    'Commentaire sur écart de conformité',
    NEW.author_name || ' a commenté l''écart : ' || COALESCE(v_disc_label, '') || '. Commentaire : ' || NEW.comment,
    'compliance'
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_comment_notify ON compliance_comments;
CREATE TRIGGER trg_comment_notify
  AFTER INSERT ON compliance_comments
  FOR EACH ROW EXECUTE FUNCTION notify_directors_on_comment();
