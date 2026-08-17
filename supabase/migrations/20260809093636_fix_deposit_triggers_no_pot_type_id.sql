-- Fix the ensure_receivable_on_confirm trigger: deposits table has no pot_type_id column.
-- Use the batch's pot_type_id instead. Also simplify the logic.

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
    -- Skip if a receivable already exists for this deposit
    IF EXISTS (SELECT 1 FROM public.receivables WHERE deposit_id = NEW.id) THEN
      RETURN NEW;
    END IF;

    SELECT driver_id, pot_type_id INTO v_driver_id, v_pot_type_id
    FROM public.delivery_batches WHERE id = NEW.batch_id;

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
