-- Autorise la gestionnaire de stock (rôle 2) et son assistant (rôle 16,
-- normalisé vers 2 par private.get_my_role()) à supprimer un point de vente.
-- Les clés étrangères ON DELETE RESTRICT continuent de protéger les points
-- qui possèdent déjà un historique de dépôts ou de retours.

DROP POLICY IF EXISTS sales_points_delete ON public.sales_points;
CREATE POLICY sales_points_delete ON public.sales_points
FOR DELETE TO authenticated
USING (private.get_my_role() = ANY (ARRAY[2, 4, 5, 6, 7]));
