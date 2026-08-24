-- La gestionnaire de stock (2) et son assistant (16, résolu comme 2 par
-- private.get_my_role()) gèrent les tournées de bout en bout.
-- Les rôles qui disposaient déjà de ce droit sont conservés.

DROP POLICY IF EXISTS batches_delete ON public.delivery_batches;
CREATE POLICY batches_delete ON public.delivery_batches
FOR DELETE TO authenticated
USING (private.get_my_role() = ANY (ARRAY[2, 4, 5, 6, 7]));
