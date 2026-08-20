/*
# Ajouter les fournisseurs et leur code sur les codes à barres

1. Contexte
- L'utilisateur veut pouvoir sélectionner un fournisseur lors de la génération de codes à barres
- Le code fournisseur (2 premières lettres du nom + 1 lettre du prénom) doit apparaître sur le code à barres
- Aucune table fournisseurs n'existe encore

2. Modifications
- Crée la table suppliers (fournisseurs) avec nom, prénom, et code auto-généré
- Ajoute supplier_id et supplier_code à la table barcodes
- Active RLS avec politiques pour les utilisateurs authentifiés
*/

CREATE TABLE IF NOT EXISTS public.suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  last_name text NOT NULL,
  first_name text NOT NULL,
  supplier_code text NOT NULL,
  phone text,
  email text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "suppliers_select" ON suppliers FOR SELECT
  TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "suppliers_insert" ON suppliers FOR INSERT
  TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "suppliers_update" ON suppliers FOR UPDATE
  TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "suppliers_delete" ON suppliers FOR DELETE
  TO authenticated USING (auth.uid() IS NOT NULL);

ALTER TABLE public.suppliers
  ADD CONSTRAINT suppliers_supplier_code_key UNIQUE (supplier_code);

ALTER TABLE public.barcodes
  ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES public.suppliers(id),
  ADD COLUMN IF NOT EXISTS supplier_code text;
