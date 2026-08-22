-- Link operational returns to their originating consignment.  The copied
-- references preserve the audit trail even when the source list is filtered.
ALTER TABLE public.returns
  ADD COLUMN IF NOT EXISTS consignment_id uuid REFERENCES public.consignments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pot_type_id uuid REFERENCES public.pot_types(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS production_record_id uuid REFERENCES public.production_records(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_returns_consignment_id ON public.returns(consignment_id);
CREATE INDEX IF NOT EXISTS idx_returns_pot_type_id ON public.returns(pot_type_id);
CREATE INDEX IF NOT EXISTS idx_returns_production_record_id ON public.returns(production_record_id);
CREATE INDEX IF NOT EXISTS idx_returns_driver_id ON public.returns(driver_id);

COMMENT ON COLUMN public.returns.consignment_id IS 'Consigne d''origine du retour, sélectionnée lors de la saisie.';
