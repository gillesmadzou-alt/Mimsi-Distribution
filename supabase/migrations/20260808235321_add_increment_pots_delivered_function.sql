/*
# Add atomic increment_pots_delivered function

## Purpose
Fixes a race condition where `pots_delivered` on `delivery_batches` was updated
via client-side read-modify-write (read current value from local React state,
add quantity, write back). This caused stale overwrites when multiple deposits
happened in quick succession or when local state was not yet refreshed.

## Changes
- Creates `increment_pots_delivered(batch_uuid, increment_int)` function in the
  `private` schema (SECURITY DEFINER, search_path safe) that atomically
  increments `pots_delivered` by the given amount using `COALESCE` to handle
  NULL values safely.
- Grants EXECUTE to `authenticated` and `anon` so both signed-in and
  no-auth flows can call it.

## Security
- Function is SECURITY DEFINER with `search_path = ''` to prevent search_path
  injection.
- Placed in `private` schema so it is not directly accessible via the data API.
- Execute granted to `anon` and `authenticated` roles only.
*/

CREATE OR REPLACE FUNCTION private.increment_pots_delivered(
  p_batch_id uuid,
  p_increment integer
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.delivery_batches
  SET pots_delivered = COALESCE(pots_delivered, 0) + p_increment
  WHERE id = p_batch_id;
END;
$$;

GRANT EXECUTE ON FUNCTION private.increment_pots_delivered(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION private.increment_pots_delivered(uuid, integer) TO anon;
