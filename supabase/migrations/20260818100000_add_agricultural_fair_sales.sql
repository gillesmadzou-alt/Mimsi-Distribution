-- Classify opportunistic sales made during fairs.
ALTER TABLE public.opportunistic_sales
  ADD COLUMN IF NOT EXISTS sale_context text NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS fair_name text,
  ADD COLUMN IF NOT EXISTS fair_location text;

ALTER TABLE public.opportunistic_sales
  DROP CONSTRAINT IF EXISTS opportunistic_sales_sale_context_check;

ALTER TABLE public.opportunistic_sales
  ADD CONSTRAINT opportunistic_sales_sale_context_check
  CHECK (sale_context IN ('standard', 'fair'));

CREATE INDEX IF NOT EXISTS idx_opportunistic_sales_context_date
  ON public.opportunistic_sales (sale_context, sale_date DESC);
