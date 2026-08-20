-- F3: same exposure as F2 on the ingredient inventory.

REVOKE EXECUTE ON FUNCTION public.adjust_ingredient_stock(uuid, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.adjust_ingredient_stock(uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.adjust_ingredient_stock(uuid, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION private.adjust_ingredient_stock(uuid, integer) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.adjust_ingredient_stock(p_ingredient_id uuid, p_delta integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_role int;
BEGIN
  SELECT role INTO v_caller_role
  FROM profiles
  WHERE id = auth.uid() AND is_active = true;

  IF v_caller_role IS NULL THEN
    RAISE EXCEPTION 'Permission refusée';
  END IF;

  UPDATE ingredients
  SET stock_quantity = GREATEST(0, COALESCE(stock_quantity, 0) + p_delta),
      updated_at = now()
  WHERE id = p_ingredient_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION private.adjust_ingredient_stock(uuid, integer) TO authenticated;
