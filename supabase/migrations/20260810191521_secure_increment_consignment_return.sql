-- F5: public.increment_consignment_return was anon-callable with no caller
-- check, letting anyone write off consigned goods that were never returned.

REVOKE EXECUTE ON FUNCTION public.increment_consignment_return(uuid, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.increment_consignment_return(uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.increment_consignment_return(uuid, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION private.increment_consignment_return(uuid, integer) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.increment_consignment_return(p_consignment_id uuid, p_quantity integer)
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

  UPDATE consignments
  SET quantity_returned = GREATEST(0, COALESCE(quantity_returned, 0) + p_quantity)
  WHERE id = p_consignment_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION private.increment_consignment_return(uuid, integer) TO authenticated;
