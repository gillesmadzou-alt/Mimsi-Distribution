-- Type(s) de produit livrés par chaque fournisseur (ex. Farines, Emballages),
-- pour savoir en un coup d'œil ce qu'un fournisseur donné fournit.
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS product_types text[] NOT NULL DEFAULT '{}'::text[];

COMMENT ON COLUMN public.suppliers.product_types IS
  'Catégories de produits livrés par ce fournisseur (mêmes catégories que les intrants).';
