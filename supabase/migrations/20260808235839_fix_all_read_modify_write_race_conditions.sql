/*
# Fix all read-modify-write race conditions

## Purpose
Several pages update database counters by reading a value from local React
state, modifying it in JavaScript, and writing it back. This causes stale
overwrites when multiple operations happen in quick succession. This migration
creates atomic server-side functions for every affected table/column.

## New Functions (private schema, SECURITY DEFINER)
1. `private.adjust_pot_stock(p_pot_type_id, p_column, p_delta)` — atomically
   increments or decrements one of: stock_quantity, empty_pots_stock,
   empty_lids_stock, madeleines_stock. Clamps to 0 minimum.
2. `private.increment_consignment_return(p_consignment_id, p_quantity)` —
   atomically increments consignments.quantity_returned.
3. `private.adjust_ingredient_stock(p_ingredient_id, p_delta)` — atomically
   increments or decrements ingredients.stock_quantity. Clamps to 0 minimum.

## Public Wrappers (SECURITY INVOKER)
- `public.adjust_pot_stock(...)` → delegates to private
- `public.increment_consignment_return(...)` → delegates to private
- `public.adjust_ingredient_stock(...)` → delegates to private

## Security
- Private functions: SECURITY DEFINER, search_path = '' (or public)
- Public wrappers: SECURITY INVOKER, search_path = public
- EXECUTE granted to authenticated and anon on public wrappers
- Column name validated against an allowlist in adjust_pot_stock
*/

-- ============================================================
-- 1) Atomic pot stock adjustment (any of 4 columns)
-- ============================================================
CREATE OR REPLACE FUNCTION private.adjust_pot_stock(
  p_pot_type_id uuid,
  p_column text,
  p_delta integer
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_column NOT IN ('stock_quantity', 'empty_pots_stock', 'empty_lids_stock', 'madeleines_stock') THEN
    RAISE EXCEPTION 'Colonne de stock non autorisée: %', p_column;
  END IF;

  EXECUTE format(
    'UPDATE pot_types SET %I = GREATEST(0, COALESCE(%I, 0) + $1) WHERE id = $2',
    p_column, p_column
  ) USING p_delta, p_pot_type_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.adjust_pot_stock(
  p_pot_type_id uuid,
  p_column text,
  p_delta integer
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  PERFORM private.adjust_pot_stock(p_pot_type_id, p_column, p_delta);
END;
$$;

GRANT EXECUTE ON FUNCTION public.adjust_pot_stock(uuid, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_pot_stock(uuid, text, integer) TO anon;

-- ============================================================
-- 2) Atomic consignment return increment
-- ============================================================
CREATE OR REPLACE FUNCTION private.increment_consignment_return(
  p_consignment_id uuid,
  p_quantity integer
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE consignments
  SET quantity_returned = COALESCE(quantity_returned, 0) + p_quantity
  WHERE id = p_consignment_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_consignment_return(
  p_consignment_id uuid,
  p_quantity integer
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  PERFORM private.increment_consignment_return(p_consignment_id, p_quantity);
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_consignment_return(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.increment_consignment_return(uuid, integer) TO anon;

-- ============================================================
-- 3) Atomic ingredient stock adjustment
-- ============================================================
CREATE OR REPLACE FUNCTION private.adjust_ingredient_stock(
  p_ingredient_id uuid,
  p_delta integer
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE ingredients
  SET stock_quantity = GREATEST(0, COALESCE(stock_quantity, 0) + p_delta),
      updated_at = now()
  WHERE id = p_ingredient_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.adjust_ingredient_stock(
  p_ingredient_id uuid,
  p_delta integer
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  PERFORM private.adjust_ingredient_stock(p_ingredient_id, p_delta);
END;
$$;

GRANT EXECUTE ON FUNCTION public.adjust_ingredient_stock(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_ingredient_stock(uuid, integer) TO anon;
