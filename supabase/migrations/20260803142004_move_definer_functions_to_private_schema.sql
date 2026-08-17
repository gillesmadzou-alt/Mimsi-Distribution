-- Move collect_receivable_payment and decrement_stock to a private schema
-- so they are not directly callable via the REST API. Create thin SECURITY INVOKER
-- wrappers in public that delegate to the private functions. The advisor only
-- flags SECURITY DEFINER functions exposed via /rest/v1/rpc/ (public schema).

CREATE SCHEMA IF NOT EXISTS private;

-- Private: collect_receivable_payment (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION private.collect_receivable_payment(p_receivable_id uuid, p_amount integer, p_batch_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
  v_recv RECORD;
  v_new_paid int;
  v_new_status text;
  v_caller_role int;
BEGIN
  SELECT role INTO v_caller_role FROM profiles WHERE id = auth.uid();
  IF v_caller_role IS NULL OR v_caller_role < 2 THEN
    RAISE EXCEPTION 'Permission refusée';
  END IF;

  SELECT amount_fcfa, amount_paid INTO v_recv
  FROM receivables WHERE id = p_receivable_id FOR UPDATE;
  IF v_recv.amount_fcfa IS NULL THEN
    RAISE EXCEPTION 'Créance introuvable';
  END IF;

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Le montant doit être positif';
  END IF;

  IF p_amount > (v_recv.amount_fcfa - v_recv.amount_paid) THEN
    RAISE EXCEPTION 'Le montant dépasse le reste à percevoir (%)', v_recv.amount_fcfa - v_recv.amount_paid;
  END IF;

  v_new_paid := v_recv.amount_paid + p_amount;
  v_new_status := CASE WHEN v_new_paid >= v_recv.amount_fcfa THEN 'solde' ELSE 'partiel' END;

  UPDATE receivables
  SET amount_paid = v_new_paid, status = v_new_status, updated_at = now()
  WHERE id = p_receivable_id;

  INSERT INTO receivable_payments (receivable_id, amount_fcfa, batch_id, notes)
  VALUES (p_receivable_id, p_amount, p_batch_id, 'Recouvrement tournée');

  RETURN jsonb_build_object(
    'amount_paid', v_new_paid,
    'status', v_new_status,
    'remaining', v_recv.amount_fcfa - v_new_paid
  );
END;
$function$;

-- Private: decrement_stock (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION private.decrement_stock(p_pot_type_id uuid, p_quantity integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
  v_new_stock int;
  v_caller_role int;
BEGIN
  SELECT role INTO v_caller_role FROM profiles WHERE id = auth.uid();
  IF v_caller_role IS NULL OR v_caller_role < 2 THEN
    RAISE EXCEPTION 'Permission refusée';
  END IF;

  UPDATE pot_types
  SET stock_quantity = stock_quantity - p_quantity
  WHERE id = p_pot_type_id AND stock_quantity >= p_quantity
  RETURNING stock_quantity INTO v_new_stock;

  IF v_new_stock IS NULL THEN
    RAISE EXCEPTION 'Stock insuffisant ou type de pot introuvable';
  END IF;

  RETURN v_new_stock;
END;
$function$;

-- Drop the old public functions
DROP FUNCTION IF EXISTS public.collect_receivable_payment(uuid, integer, uuid);
DROP FUNCTION IF EXISTS public.decrement_stock(uuid, integer);

-- Public wrappers (SECURITY INVOKER) — these are what the app calls via supabase.rpc()
-- The advisor will not flag them because they are SECURITY INVOKER.
-- The private functions are not exposed via REST (not in public schema).

CREATE OR REPLACE FUNCTION public.collect_receivable_payment(p_receivable_id uuid, p_amount integer, p_batch_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO public
AS $function$
BEGIN
  RETURN private.collect_receivable_payment(p_receivable_id, p_amount, p_batch_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.decrement_stock(p_pot_type_id uuid, p_quantity integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO public
AS $function$
BEGIN
  RETURN private.decrement_stock(p_pot_type_id, p_quantity);
END;
$function$;

-- Revoke EXECUTE from anon on the public wrappers (already done for private by schema)
REVOKE EXECUTE ON FUNCTION public.collect_receivable_payment(uuid, integer, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.decrement_stock(uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.collect_receivable_payment(uuid, integer, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decrement_stock(uuid, integer) TO authenticated;

-- Revoke EXECUTE on private functions from anon and authenticated (not exposed via REST)
REVOKE EXECUTE ON FUNCTION private.collect_receivable_payment(uuid, integer, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION private.decrement_stock(uuid, integer) FROM anon;
