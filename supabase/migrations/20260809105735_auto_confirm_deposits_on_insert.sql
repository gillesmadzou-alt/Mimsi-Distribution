/*
# Auto-confirm deposits on insert

## Problem
Deposits are created with is_confirmed=false and require a separate
validation step (UPDATE is_confirmed true→false). The user wants to
remove the validation step entirely — deposits should be confirmed
immediately when created.

## Changes
1. Add INSERT trigger for increment_pots_on_confirm: when a deposit
   is inserted with is_confirmed=true, increment pots_delivered.
2. Add INSERT trigger for ensure_receivable_on_confirm: when a deposit
   is inserted with is_confirmed=true, create any needed receivable.
   Both functions already handle UPDATE (false→true); we add AFTER
   INSERT triggers that call the same logic when NEW.is_confirmed=true.

## Security
- No RLS changes. Functions remain SECURITY DEFINER, search_path = ''.
- Execute grants already exist for authenticated and anon.
*/

-- ============================================================
-- 1. Increment pots_delivered on INSERT of confirmed deposit
-- ============================================================
CREATE OR REPLACE FUNCTION private.increment_pots_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.is_confirmed = true THEN
    UPDATE public.delivery_batches
    SET pots_delivered = GREATEST(COALESCE(pots_delivered, 0) + NEW.quantity, 0)
    WHERE id = NEW.batch_id;
  END IF;
  RETURN NEW;
END;
$$;

GRANT EXECUTE ON FUNCTION private.increment_pots_on_insert() TO authenticated;
GRANT EXECUTE ON FUNCTION private.increment_pots_on_insert() TO anon;

DROP TRIGGER IF EXISTS trg_increment_pots_on_insert ON public.deposits;
CREATE TRIGGER trg_increment_pots_on_insert
  AFTER INSERT ON public.deposits
  FOR EACH ROW
  EXECUTE FUNCTION private.increment_pots_on_insert();

-- ============================================================
-- 2. Ensure receivable on INSERT of confirmed deposit
-- ============================================================
CREATE OR REPLACE FUNCTION private.ensure_receivable_on_insert()
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
  IF NEW.is_confirmed = true THEN
    -- Skip if a receivable already exists for this deposit
    IF EXISTS (SELECT 1 FROM public.receivables WHERE deposit_id = NEW.id) THEN
      RETURN NEW;
    END IF;

    SELECT driver_id, pot_type_id INTO v_driver_id, v_pot_type_id
    FROM public.delivery_batches WHERE id = NEW.batch_id;

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

GRANT EXECUTE ON FUNCTION private.ensure_receivable_on_insert() TO authenticated;
GRANT EXECUTE ON FUNCTION private.ensure_receivable_on_insert() TO anon;

DROP TRIGGER IF EXISTS trg_ensure_receivable_on_insert ON public.deposits;
CREATE TRIGGER trg_ensure_receivable_on_insert
  AFTER INSERT ON public.deposits
  FOR EACH ROW
  EXECUTE FUNCTION private.ensure_receivable_on_insert();
