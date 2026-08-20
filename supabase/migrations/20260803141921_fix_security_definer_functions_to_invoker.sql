-- Switch toggle_user_active to SECURITY INVOKER
-- RLS policies on profiles already allow:
--   SELECT: role >= 1 (admin role 6 passes)
--   UPDATE: auth.uid() = id OR role >= 5 (admin role 6 passes)
-- The function's internal check (role >= 6) is stricter than RLS, so
-- SECURITY INVOKER is safe: the function can still read/update profiles,
-- and only admin can call it successfully.

CREATE OR REPLACE FUNCTION public.toggle_user_active(p_target_uuid uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO public
AS $function$
DECLARE
  v_caller_role int;
  v_target_active boolean;
BEGIN
  SELECT role INTO v_caller_role FROM profiles WHERE id = auth.uid();
  IF v_caller_role IS NULL OR v_caller_role < 6 THEN
    RAISE EXCEPTION 'Permission refusée : administrateur uniquement';
  END IF;

  SELECT is_active INTO v_target_active FROM profiles WHERE id = p_target_uuid;
  IF v_target_active IS NULL THEN
    RAISE EXCEPTION 'Utilisateur introuvable';
  END IF;

  UPDATE profiles SET is_active = NOT v_target_active, updated_at = now()
  WHERE id = p_target_uuid;

  RETURN NOT v_target_active;
END;
$function$;

-- Switch approve_personnel_request to SECURITY INVOKER
-- RLS policies on personnel_change_requests already allow:
--   SELECT: role >= 4 (adjoint 4, directrice 5, admin 6 all pass)
--   UPDATE: role >= 4 (same)
-- RLS on profiles allows SELECT for role >= 1 (all pass)
-- The function's internal check (role >= 4) matches the RLS policies,
-- so SECURITY INVOKER is safe.

CREATE OR REPLACE FUNCTION public.approve_personnel_request(p_request_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO public
AS $function$
DECLARE
  v_caller_id uuid := auth.uid();
  v_caller_role int;
  v_req personnel_change_requests%ROWTYPE;
  v_all_approved boolean := false;
BEGIN
  SELECT role INTO v_caller_role FROM profiles WHERE id = v_caller_id;
  IF v_caller_role IS NULL OR v_caller_role < 4 THEN
    RAISE EXCEPTION 'Permission refusée';
  END IF;

  SELECT * INTO v_req FROM personnel_change_requests WHERE id = p_request_id FOR UPDATE;
  IF v_req.id IS NULL THEN
    RAISE EXCEPTION 'Demande introuvable';
  END IF;
  IF v_req.status <> 'en_attente' THEN
    RAISE EXCEPTION 'Demande déjà traitée';
  END IF;

  IF v_caller_role = 5 AND v_req.directrice_approved_by IS NULL THEN
    UPDATE personnel_change_requests
    SET directrice_approved_by = v_caller_id, directrice_approved_at = now(), updated_at = now()
    WHERE id = p_request_id;
  ELSIF v_caller_role = 4 AND v_req.adjoint_approved_by IS NULL THEN
    UPDATE personnel_change_requests
    SET adjoint_approved_by = v_caller_id, adjoint_approved_at = now(), updated_at = now()
    WHERE id = p_request_id;
  ELSIF v_caller_role = 6 AND v_req.admin_approved_by IS NULL THEN
    UPDATE personnel_change_requests
    SET admin_approved_by = v_caller_id, admin_approved_at = now(), updated_at = now()
    WHERE id = p_request_id;
  END IF;

  SELECT * INTO v_req FROM personnel_change_requests WHERE id = p_request_id;
  IF v_req.directrice_approved_by IS NOT NULL
  AND v_req.adjoint_approved_by IS NOT NULL
  AND v_req.admin_approved_by IS NOT NULL
  AND v_req.applied = false THEN
    UPDATE personnel_change_requests SET status = 'validee', updated_at = now() WHERE id = p_request_id;
    v_all_approved := true;
  END IF;

  RETURN v_all_approved;
END;
$function$;

-- collect_receivable_payment and decrement_stock stay SECURITY DEFINER.
-- They modify sensitive columns (amount_paid, stock_quantity) that RLS
-- intentionally restricts to roles >= 3/4. Switching to INVOKER would
-- require widening those policies, allowing users to bypass the functions'
-- validation and write arbitrary values directly. The functions already
-- enforce authorization via auth.uid() role checks internally.
