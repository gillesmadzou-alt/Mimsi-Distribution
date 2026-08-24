-- Catégorie commerciale du point de vente, disponible sur tous les terminaux.
-- Les enregistrements existants restent des détaillants par défaut.

ALTER TABLE public.sales_points
  ADD COLUMN IF NOT EXISTS client_type text NOT NULL DEFAULT 'detail';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sales_points_client_type_check'
      AND conrelid = 'public.sales_points'::regclass
  ) THEN
    ALTER TABLE public.sales_points
      ADD CONSTRAINT sales_points_client_type_check
      CHECK (client_type IN ('detail', 'grossiste', 'supermarche', 'restaurant_hotel', 'entreprise', 'autre'));
  END IF;
END $$;
