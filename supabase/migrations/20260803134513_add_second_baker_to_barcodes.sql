/*
# Ajouter le deuxième fournier (chargement) sur les codes à barres

- baker1 = fournier de cuisson (existant, renommé logiquement)
- baker2 = fournier de chargement des pots
- Les deux sont obligatoires à la génération
*/

ALTER TABLE public.barcodes
  ADD COLUMN IF NOT EXISTS baker2_id uuid REFERENCES public.bakers(id),
  ADD COLUMN IF NOT EXISTS baker2_code text;

-- Rendre baker_id et baker2_id obligatoires (NON NULL)
-- On commence par remplir les valeurs existantes NULL avec un baker par défaut si besoin
-- Puis on altere en NOT NULL
UPDATE public.barcodes SET baker_id = (SELECT id FROM public.bakers WHERE status = 'actif' ORDER BY full_name LIMIT 1) WHERE baker_id IS NULL;
UPDATE public.barcodes SET baker2_id = (SELECT id FROM public.bakers WHERE status = 'actif' ORDER BY full_name LIMIT 1) WHERE baker2_id IS NULL;

ALTER TABLE public.barcodes
  ALTER COLUMN baker_id SET NOT NULL,
  ALTER COLUMN baker2_id SET NOT NULL;
