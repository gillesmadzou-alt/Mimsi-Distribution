-- Bibliothèque de pièces justificatives PDF (factures, reçus, devis pro
-- forma, reconnaissances de dette) — toujours de source locale/interne
-- (aucune intégration externe). Chaque document peut être lié à N'IMPORTE
-- QUELLE écriture de la Tenue de compte (accounting_entries) — caisse,
-- banque ou compte client/fournisseur — pour apparaître directement dans
-- le journal correspondant, ou rester libre (devis, reconnaissance de
-- dette sans écriture comptable dédiée).

CREATE TABLE public.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL DEFAULT 'autre'
    CHECK (category IN ('facture', 'recu', 'devis', 'reconnaissance_dette', 'autre')),
  title text NOT NULL CHECK (length(trim(title)) > 0),
  file_path text NOT NULL,
  file_name text NOT NULL,
  file_size int,
  mime_type text NOT NULL DEFAULT 'application/pdf',
  accounting_entry_id uuid REFERENCES public.accounting_entries(id) ON DELETE SET NULL,
  notes text,
  uploaded_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX documents_accounting_entry_id_idx ON public.documents(accounting_entry_id) WHERE accounting_entry_id IS NOT NULL;
CREATE INDEX documents_category_idx ON public.documents(category);
CREATE INDEX documents_created_at_idx ON public.documents(created_at DESC);

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.documents TO authenticated;

-- Mêmes seuils d'accès que la Tenue de compte elle-même (accounting_entries) :
-- il faut au moins le rôle 3 pour voir/déposer une pièce justificative
-- financière, le rôle 5 pour supprimer celle d'un autre utilisateur.
CREATE POLICY documents_select
  ON public.documents FOR SELECT TO authenticated
  USING (private.get_my_role() >= 3);

CREATE POLICY documents_insert
  ON public.documents FOR INSERT TO authenticated
  WITH CHECK (private.get_my_role() >= 3 AND uploaded_by = (SELECT auth.uid()));

CREATE POLICY documents_update
  ON public.documents FOR UPDATE TO authenticated
  USING (private.get_my_role() >= 5 OR (private.get_my_role() >= 3 AND uploaded_by = (SELECT auth.uid())))
  WITH CHECK (private.get_my_role() >= 5 OR (private.get_my_role() >= 3 AND uploaded_by = (SELECT auth.uid())));

CREATE POLICY documents_delete
  ON public.documents FOR DELETE TO authenticated
  USING (private.get_my_role() >= 5 OR (private.get_my_role() >= 3 AND uploaded_by = (SELECT auth.uid())));

COMMENT ON TABLE public.documents IS
  'Pièces justificatives PDF (factures, reçus, devis, reconnaissances de dette), de source locale — optionnellement liées à une écriture de la Tenue de compte (accounting_entries) pour apparaître dans le journal correspondant et être jointes en annexe des rapports.';

-- Bucket de stockage privé (jamais public — ce sont des documents financiers
-- internes) : l'accès passe par des URL signées de courte durée.
INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY documents_storage_select ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'documents' AND private.get_my_role() >= 3);

CREATE POLICY documents_storage_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'documents' AND private.get_my_role() >= 3);

CREATE POLICY documents_storage_delete ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'documents' AND private.get_my_role() >= 5);
