-- ============================================================
-- Auto-increment pots_delivered when a deposit is confirmed
-- ============================================================
-- Replaces the client-side RPC call that was silently failing.
-- Now, whenever a deposit's is_confirmed changes from false to true,
-- the trigger atomically increments the batch's pots_delivered counter.
-- This guarantees the batch counter always stays in sync, regardless
-- of how the confirmation happens (UI, API, direct SQL).
-- ============================================================

CREATE OR REPLACE FUNCTION private.increment_pots_on_confirm()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Only fire when is_confirmed transitions from false to true
  IF (NEW.is_confirmed = true AND OLD.is_confirmed = false) THEN
    UPDATE public.delivery_batches
    SET pots_delivered = COALESCE(pots_delivered, 0) + NEW.quantity
    WHERE id = NEW.batch_id;
  END IF;
  RETURN NEW;
END;
$$;

GRANT EXECUTE ON FUNCTION private.increment_pots_on_confirm() TO authenticated;
GRANT EXECUTE ON FUNCTION private.increment_pots_on_confirm() TO anon;

DROP TRIGGER IF EXISTS trg_increment_pots_on_confirm ON deposits;
CREATE TRIGGER trg_increment_pots_on_confirm
  AFTER UPDATE OF is_confirmed ON deposits
  FOR EACH ROW
  EXECUTE FUNCTION private.increment_pots_on_confirm();

-- ============================================================
-- Also auto-create receivable for credit deposits on confirm
-- ============================================================
-- When a deposit is confirmed with payment_type = 'credit', ensure
-- a receivable exists. This was previously done client-side and could
-- fail silently.
-- ============================================================

CREATE OR REPLACE FUNCTION private.ensure_receivable_on_confirm()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (NEW.is_confirmed = true AND OLD.is_confirmed = false) THEN
    -- For credit deposits, create a receivable if none exists
    IF NEW.payment_type = 'credit' AND NOT EXISTS (
      SELECT 1 FROM public.receivables WHERE deposit_id = NEW.id
    ) THEN
      INSERT INTO public.receivables (deposit_id, sales_point_id, batch_id, driver_id, amount_fcfa, amount_paid, status)
      SELECT NEW.id, NEW.sales_point_id, NEW.batch_id, db.driver_id, NEW.amount_fcfa, 0, 'en_attente'
      FROM public.delivery_batches db
      WHERE db.id = NEW.batch_id;
    END IF;

    -- For comptant deposits with shortfall, create a shortfall receivable
    IF NEW.payment_type = 'comptant' AND NOT EXISTS (
      SELECT 1 FROM public.receivables WHERE deposit_id = NEW.id
    ) THEN
      -- Check if there's a shortfall (amount paid < expected)
      -- The expected amount is pot.unit_price * quantity
      INSERT INTO public.receivables (deposit_id, sales_point_id, batch_id, driver_id, amount_fcfa, amount_paid, status)
      SELECT NEW.id, NEW.sales_point_id, NEW.batch_id, db.driver_id,
             pt.unit_price_fcfa * NEW.quantity, NEW.amount_fcfa,
             CASE WHEN NEW.amount_fcfa >= pt.unit_price_fcfa * NEW.quantity THEN 'solde' ELSE 'en_attente' END
      FROM public.delivery_batches db
      JOIN public.deposits d ON d.batch_id = db.id AND d.id = NEW.id
      LEFT JOIN public.pot_types pt ON pt.id = COALESCE(NEW.pot_type_id, db.pot_type_id)
      WHERE db.id = NEW.batch_id
        AND pt.unit_price_fcfa * NEW.quantity > NEW.amount_fcfa;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

GRANT EXECUTE ON FUNCTION private.ensure_receivable_on_confirm() TO authenticated;
GRANT EXECUTE ON FUNCTION private.ensure_receivable_on_confirm() TO anon;

DROP TRIGGER IF EXISTS trg_ensure_receivable_on_confirm ON deposits;
CREATE TRIGGER trg_ensure_receivable_on_confirm
  AFTER UPDATE OF is_confirmed ON deposits
  FOR EACH ROW
  EXECUTE FUNCTION private.ensure_receivable_on_confirm();

-- Backfill: fix any existing confirmed deposits that are missing receivables
DO $$
DECLARE
  d RECORD;
  v_expected integer;
  v_driver_id uuid;
BEGIN
  FOR d IN SELECT * FROM deposits WHERE is_confirmed = true LOOP
    -- Skip if receivable already exists
    IF EXISTS (SELECT 1 FROM receivables WHERE deposit_id = d.id) THEN CONTINUE; END IF;

    SELECT driver_id INTO v_driver_id FROM delivery_batches WHERE id = d.batch_id;

    IF d.payment_type = 'credit' THEN
      INSERT INTO receivables (deposit_id, sales_point_id, batch_id, driver_id, amount_fcfa, amount_paid, status)
      VALUES (d.id, d.sales_point_id, d.batch_id, v_driver_id, d.amount_fcfa, 0, 'en_attente');
    ELSIF d.payment_type = 'comptant' THEN
      SELECT unit_price_fcfa * d.quantity INTO v_expected
      FROM pot_types
      WHERE id = COALESCE(d.pot_type_id, (SELECT pot_type_id FROM delivery_batches WHERE id = d.batch_id));
      IF v_expected IS NOT NULL AND v_expected > d.amount_fcfa THEN
        INSERT INTO receivables (deposit_id, sales_point_id, batch_id, driver_id, amount_fcfa, amount_paid, status)
        VALUES (d.id, d.sales_point_id, d.batch_id, v_driver_id, v_expected, d.amount_fcfa,
                CASE WHEN d.amount_fcfa > 0 THEN 'partiel' ELSE 'en_attente' END);
      END IF;
    END IF;
  END LOOP;
END $$;
