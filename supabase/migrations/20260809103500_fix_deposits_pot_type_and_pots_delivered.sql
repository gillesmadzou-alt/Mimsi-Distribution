/*
# Fix deposits: add pot_type_id column, decrement triggers, backfill pots_delivered

## Problem
The client inserts `pot_type_id` when creating a deposit, but the `deposits` table
has no such column. PostgREST silently drops unknown columns, so per-deposit pot-type
information is lost. Additionally, `pots_delivered` on `delivery_batches` only
increments on confirm (false→true) but never decrements on un-confirm or delete,
causing the counter to drift above reality over time.

## Changes

1. Add `pot_type_id` column to `deposits` (nullable UUID, references `pot_types`).
   This lets deposits record which pot type was deposited, which is needed for
   receivable calculations and multi-pot-type batches.

2. Rewrite `increment_pots_on_confirm` trigger function to handle BOTH directions:
   - false→true: increment `pots_delivered` by `NEW.quantity`
   - true→false: decrement `pots_delivered` by `OLD.quantity` (un-confirm)
   This prevents drift when a supervisor rejects/un-confirms a deposit.

3. Add `decrement_pots_on_delete` trigger function + trigger:
   - On DELETE of a confirmed deposit, decrement `pots_delivered` by `OLD.quantity`.
   Unconfirmed deposits don't affect the counter, so only confirmed ones decrement.

4. Backfill `pots_delivered` on all batches to match the actual sum of confirmed
   deposit quantities. This fixes any drift from prior bugs.

5. Update `ensure_receivable_on_confirm` to use `NEW.pot_type_id` with fallback
   to the batch's `pot_type_id`, now that the column exists.

## Security
- No RLS policy changes. All functions remain SECURITY DEFINER with `search_path = ''`.
- Execute grants on new function for authenticated and anon (same as existing).
*/

-- ============================================================
-- 1. Add pot_type_id column to deposits
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'deposits' AND column_name = 'pot_type_id'
  ) THEN
    ALTER TABLE public.deposits ADD COLUMN pot_type_id uuid REFERENCES public.pot_types(id);
  END IF;
END $$;

-- ============================================================
-- 2. Rewrite increment_pots_on_confirm to handle both directions
-- ============================================================
CREATE OR REPLACE FUNCTION private.increment_pots_on_confirm()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (NEW.is_confirmed = true AND OLD.is_confirmed = false) THEN
    UPDATE public.delivery_batches
    SET pots_delivered = GREATEST(COALESCE(pots_delivered, 0) + NEW.quantity, 0)
    WHERE id = NEW.batch_id;
  ELSIF (NEW.is_confirmed = false AND OLD.is_confirmed = true) THEN
    UPDATE public.delivery_batches
    SET pots_delivered = GREATEST(COALESCE(pots_delivered, 0) - OLD.quantity, 0)
    WHERE id = NEW.batch_id;
  END IF;
  RETURN NEW;
END;
$$;

GRANT EXECUTE ON FUNCTION private.increment_pots_on_confirm() TO authenticated;
GRANT EXECUTE ON FUNCTION private.increment_pots_on_confirm() TO anon;

-- ============================================================
-- 3. Add decrement trigger on DELETE of confirmed deposits
-- ============================================================
CREATE OR REPLACE FUNCTION private.decrement_pots_on_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.is_confirmed = true THEN
    UPDATE public.delivery_batches
    SET pots_delivered = GREATEST(COALESCE(pots_delivered, 0) - OLD.quantity, 0)
    WHERE id = OLD.batch_id;
  END IF;
  RETURN OLD;
END;
$$;

GRANT EXECUTE ON FUNCTION private.decrement_pots_on_delete() TO authenticated;
GRANT EXECUTE ON FUNCTION private.decrement_pots_on_delete() TO anon;

DROP TRIGGER IF EXISTS trg_decrement_pots_on_delete ON public.deposits;
CREATE TRIGGER trg_decrement_pots_on_delete
  BEFORE DELETE ON public.deposits
  FOR EACH ROW
  EXECUTE FUNCTION private.decrement_pots_on_delete();

-- ============================================================
-- 4. Update ensure_receivable_on_confirm to use NEW.pot_type_id
-- ============================================================
CREATE OR REPLACE FUNCTION private.ensure_receivable_on_confirm()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_driver_id uuid;
  v_pot_type_id uuid;
  v_expected integer;
BEGIN
  IF (NEW.is_confirmed = true AND OLD.is_confirmed = false) THEN
    IF EXISTS (SELECT 1 FROM public.receivables WHERE deposit_id = NEW.id) THEN
      RETURN NEW;
    END IF;

    SELECT driver_id, pot_type_id INTO v_driver_id, v_pot_type_id
    FROM public.delivery_batches WHERE id = NEW.batch_id;

    -- Use deposit's pot_type_id, fall back to batch's pot_type_id
    v_pot_type_id := COALESCE(NEW.pot_type_id, v_pot_type_id);

    IF NEW.payment_type = 'credit' THEN
      INSERT INTO public.receivables (deposit_id, sales_point_id, batch_id, driver_id, amount_fcfa, amount_paid, status)
      VALUES (NEW.id, NEW.sales_point_id, NEW.batch_id, v_driver_id, NEW.amount_fcfa, 0, 'en_attente');
    ELSIF NEW.payment_type = 'comptant' THEN
      SELECT unit_price_fcfa * NEW.quantity INTO v_expected
      FROM public.pot_types WHERE id = v_pot_type_id;

      IF v_expected IS NOT NULL AND v_expected > NEW.amount_fcfa THEN
        INSERT INTO public.receivables (deposit_id, sales_point_id, batch_id, driver_id, amount_fcfa, amount_paid, status)
        VALUES (NEW.id, NEW.sales_point_id, NEW.batch_id, v_driver_id, v_expected, NEW.amount_fcfa,
                CASE WHEN NEW.amount_fcfa > 0 THEN 'partiel' ELSE 'en_attente' END);
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

GRANT EXECUTE ON FUNCTION private.ensure_receivable_on_confirm() TO authenticated;
GRANT EXECUTE ON FUNCTION private.ensure_receivable_on_confirm() TO anon;

-- ============================================================
-- 5. Backfill pots_delivered from actual confirmed deposits
-- ============================================================
DO $$
BEGIN
  UPDATE public.delivery_batches db
  SET pots_delivered = COALESCE((
    SELECT SUM(d.quantity) FROM public.deposits d
    WHERE d.batch_id = db.id AND d.is_confirmed = true
  ), 0)
  WHERE true;
END $$;
