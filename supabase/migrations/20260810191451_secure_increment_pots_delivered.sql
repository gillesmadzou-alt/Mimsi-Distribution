-- F4: public.increment_pots_delivered was anon-callable and its definer body had
-- no caller check, letting anyone inflate delivered counts on any tour.

REVOKE EXECUTE ON FUNCTION public.increment_pots_delivered(uuid, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.increment_pots_delivered(uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.increment_pots_delivered(uuid, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION private.increment_pots_delivered(uuid, integer) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.increment_pots_delivered(p_batch_id uuid, p_increment integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_caller_role int;
BEGIN
  SELECT role INTO v_caller_role
  FROM public.profiles
  WHERE id = auth.uid() AND is_active = true;

  IF v_caller_role IS NULL THEN
    RAISE EXCEPTION 'Permission refusée';
  END IF;

  UPDATE public.delivery_batches
  SET pots_delivered = GREATEST(0, COALESCE(pots_delivered, 0) + p_increment)
  WHERE id = p_batch_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION private.increment_pots_delivered(uuid, integer) TO authenticated;
