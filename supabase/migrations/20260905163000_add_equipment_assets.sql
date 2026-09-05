-- Suivi des matériels et outils immobilisés ou consommables de l'entrepôt.
CREATE TABLE IF NOT EXISTS public.equipment_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(trim(name)) > 0),
  asset_type text NOT NULL CHECK (asset_type IN ('materiel', 'outil')),
  quantity numeric NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  unit_value_fcfa numeric NOT NULL DEFAULT 0 CHECK (unit_value_fcfa >= 0),
  annual_annuity_fcfa numeric NOT NULL DEFAULT 0 CHECK (annual_annuity_fcfa >= 0),
  condition text NOT NULL DEFAULT 'bon' CHECK (condition IN ('neuf', 'bon', 'a_reparer', 'hors_service')),
  location text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.equipment_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY equipment_assets_read ON public.equipment_assets
  FOR SELECT TO authenticated
  USING (private.get_my_role() >= 2);

CREATE POLICY equipment_assets_write ON public.equipment_assets
  FOR ALL TO authenticated
  USING (private.get_my_role() = ANY (ARRAY[2, 4, 5, 6, 16]))
  WITH CHECK (private.get_my_role() = ANY (ARRAY[2, 4, 5, 6, 16]));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.equipment_assets TO authenticated;
