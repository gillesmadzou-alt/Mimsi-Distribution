-- Revoke EXECUTE from anon on all SECURITY DEFINER functions
-- These are privileged operations that must not be callable without authentication

REVOKE EXECUTE ON FUNCTION public.approve_personnel_request(p_request_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.collect_receivable_payment(p_receivable_id uuid, p_amount integer, p_batch_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.decrement_stock(p_pot_type_id uuid, p_quantity integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.toggle_user_active(p_target_uuid uuid) FROM anon;
