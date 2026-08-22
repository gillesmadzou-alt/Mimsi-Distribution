-- A stock return is attributable to the delivery batch it came from.
ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES public.delivery_batches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_stock_movements_batch_id ON public.stock_movements(batch_id);

COMMENT ON COLUMN public.stock_movements.batch_id IS 'Lot de tournée à l''origine du mouvement de retour.';
