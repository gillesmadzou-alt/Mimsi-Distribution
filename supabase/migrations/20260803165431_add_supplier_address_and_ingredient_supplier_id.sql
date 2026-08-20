/*
  # Add address to suppliers + link ingredients to suppliers

  1. suppliers: add `address` column
  2. ingredients: add `supplier_id` FK to suppliers (nullable, alongside existing free-text `supplier`)
*/

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS address text;

ALTER TABLE public.ingredients
  ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ingredients_supplier_id ON ingredients(supplier_id);
