-- Lots created by the stock manager are operational immediately, but retain a
-- separate immutable approval trail for the DGA, DG or administrator.
CREATE TABLE IF NOT EXISTS public.delivery_batch_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL UNIQUE REFERENCES public.delivery_batches(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'en_attente' CHECK (status IN ('en_attente', 'approuve', 'rejete')),
  requested_by uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE RESTRICT,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  decided_at timestamptz,
  decision_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT batch_approval_decision_consistency CHECK (
    (status = 'en_attente' AND decided_by IS NULL AND decided_at IS NULL)
    OR (status IN ('approuve', 'rejete') AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
  )
);

ALTER TABLE public.delivery_batch_approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY batch_approvals_select ON public.delivery_batch_approvals
  FOR SELECT TO authenticated
  USING (
    private.get_my_role() = ANY (ARRAY[2, 4, 5, 6])
    OR EXISTS (
      SELECT 1 FROM public.delivery_batches batch
      JOIN public.drivers driver ON driver.id = batch.driver_id
      WHERE batch.id = delivery_batch_approvals.batch_id
        AND driver.user_id = auth.uid()
    )
  );

CREATE POLICY batch_approvals_insert ON public.delivery_batch_approvals
  FOR INSERT TO authenticated
  WITH CHECK (
    private.get_my_role() = ANY (ARRAY[2, 4, 5, 6])
    AND requested_by = auth.uid()
    AND status = 'en_attente'
    AND decided_by IS NULL
    AND decided_at IS NULL
  );

CREATE POLICY batch_approvals_decide ON public.delivery_batch_approvals
  FOR UPDATE TO authenticated
  USING (private.get_my_role() = ANY (ARRAY[4, 5, 6]))
  WITH CHECK (
    private.get_my_role() = ANY (ARRAY[4, 5, 6])
    AND status = ANY (ARRAY['approuve', 'rejete'])
    AND decided_by = auth.uid()
    AND decided_at IS NOT NULL
  );

-- Restrict creation of operational lots to the stock manager and the three
-- approving roles. Their later approval does not change the active status.
DROP POLICY IF EXISTS batches_insert ON public.delivery_batches;
CREATE POLICY batches_insert ON public.delivery_batches FOR INSERT TO authenticated
  WITH CHECK (private.get_my_role() = ANY (ARRAY[2, 4, 5, 6]));

DROP POLICY IF EXISTS batches_update ON public.delivery_batches;
CREATE POLICY batches_update ON public.delivery_batches FOR UPDATE TO authenticated
  USING (private.get_my_role() = ANY (ARRAY[2, 4, 5, 6]))
  WITH CHECK (private.get_my_role() = ANY (ARRAY[2, 4, 5, 6]));

CREATE INDEX IF NOT EXISTS idx_delivery_batch_approvals_status ON public.delivery_batch_approvals(status, requested_at DESC);
