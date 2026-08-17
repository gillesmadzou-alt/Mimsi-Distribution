/*
# Add public wrapper for increment_pots_delivered

## Purpose
The private.increment_pots_delivered function was created in the private schema,
but supabase.rpc() can only call functions in the public schema. This migration
creates a public wrapper (SECURITY INVOKER) that delegates to the private
SECURITY DEFINER function, following the same pattern as decrement_stock and
collect_receivable_payment.

## Changes
- Creates `public.increment_pots_delivered(batch_uuid, increment_int)` as a
  SECURITY INVOKER wrapper that calls the private function.
- Grants EXECUTE to `authenticated` and `anon` so both signed-in and no-auth
  flows can call it.

## Security
- Public wrapper is SECURITY INVOKER with `search_path = public` — safe.
- The actual update logic runs in the private SECURITY DEFINER function with
  `search_path = ''`.
*/

CREATE OR REPLACE FUNCTION public.increment_pots_delivered(
  p_batch_id uuid,
  p_increment integer
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO public
AS $$
BEGIN
  PERFORM private.increment_pots_delivered(p_batch_id, p_increment);
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_pots_delivered(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.increment_pots_delivered(uuid, integer) TO anon;
