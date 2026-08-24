-- La gestionnaire de stock (2) et son assistant (16, mappé vers 2 par
-- private.get_my_role()) peuvent créer et mettre à jour les points de vente.
-- La suppression reste réservée aux rôles de direction/administration.

DROP POLICY IF EXISTS sales_points_insert ON public.sales_points;
CREATE POLICY sales_points_insert ON public.sales_points
FOR INSERT TO authenticated
WITH CHECK (private.get_my_role() = ANY (ARRAY[2, 4, 5, 6, 7]));

DROP POLICY IF EXISTS sales_points_update ON public.sales_points;
CREATE POLICY sales_points_update ON public.sales_points
FOR UPDATE TO authenticated
USING (private.get_my_role() = ANY (ARRAY[2, 4, 5, 6, 7]))
WITH CHECK (private.get_my_role() = ANY (ARRAY[2, 4, 5, 6, 7]));
