-- F2: public.adjust_pot_stock was callable by the anon role and its SECURITY
-- DEFINER implementation performed no caller check, so anyone holding the
-- publishable anon key could rewrite any pot stock level.

REVOKE EXECUTE ON FUNCTION public.adjust_pot_stock(uuid, text, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.adjust_pot_stock(uuid, text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.adjust_pot_stock(uuid, text, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION private.adjust_pot_stock(uuid, text, integer) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.adjust_pot_stock(p_pot_type_id uuid, p_column text, p_delta integer)
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

  IF p_column NOT IN ('stock_quantity', 'empty_pots_stock', 'empty_lids_stock', 'madeleines_stock') THEN
    RAISE EXCEPTION 'Colonne de stock non autorisée: %', p_column;
  END IF;

  EXECUTE format(
    'UPDATE pot_types SET %I = GREATEST(0, COALESCE(%I, 0) + $1) WHERE id = $2',
    p_column, p_column
  ) USING p_delta, p_pot_type_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION private.adjust_pot_stock(uuid, text, integer) TO authenticated;
