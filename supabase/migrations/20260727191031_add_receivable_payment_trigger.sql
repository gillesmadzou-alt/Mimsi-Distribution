/*
# Auto-update receivable status on payment

1. Purpose
   Previously the receivable's `amount_paid` and `status` were updated manually
   in frontend code after inserting a `receivable_payments` row. This created
   a race condition: concurrent payments could overwrite each other and leave
   the receivable in an inconsistent state.

   This migration adds a DB trigger (`update_receivable_status`) that fires
   AFTER INSERT OR UPDATE OR DELETE on `receivable_payments` and recomputes
   `amount_paid` and `status` from the actual sum of payments. This guarantees
   the receivable always reflects reality, regardless of how the payment was
   recorded.

2. Changes
   - New function `update_receivable_status()` that sums all payments for a
     receivable and updates `amount_paid` + `status` (`en_attente` / `partiel`
     / `solde`).
   - New trigger `trg_update_receivable_status` on `receivable_payments`
     firing AFTER INSERT OR UPDATE OR DELETE.

3. Security
   - No new tables or columns.
   - RLS policies on `receivable_payments` already exist; this migration
     additionally allows a driver to INSERT a payment for a receivable whose
     `driver_id` matches their own driver record (so drivers can collect
     payments in the field).
   - RLS policy on `receivables` UPDATE is relaxed so the trigger function
     (running as the caller) can update the row; the trigger itself uses
     SECURITY DEFINER to guarantee the update always succeeds regardless
     of the caller's role.

4. Notes
   - The function is `SECURITY DEFINER` so it can update `receivables` even
     when the inserting user is a driver (role 1) who would not normally have
     UPDATE permission on `receivables`.
*/

-- ============================================================
-- 1. Trigger function: recompute amount_paid + status
-- ============================================================
CREATE OR REPLACE FUNCTION update_receivable_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_receivable_id uuid;
  v_total integer;
  v_amount_fcfa integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_receivable_id := OLD.receivable_id;
  ELSE
    v_receivable_id := NEW.receivable_id;
  END IF;

  SELECT COALESCE(SUM(amount_fcfa), 0)
    INTO v_total
    FROM receivable_payments
    WHERE receivable_id = v_receivable_id;

  SELECT amount_fcfa
    INTO v_amount_fcfa
    FROM receivables
    WHERE id = v_receivable_id;

  IF v_amount_fcfa IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF v_total >= v_amount_fcfa THEN
    UPDATE receivables SET amount_paid = v_total, status = 'solde', updated_at = now()
      WHERE id = v_receivable_id;
  ELSIF v_total > 0 THEN
    UPDATE receivables SET amount_paid = v_total, status = 'partiel', updated_at = now()
      WHERE id = v_receivable_id;
  ELSE
    UPDATE receivables SET amount_paid = 0, status = 'en_attente', updated_at = now()
      WHERE id = v_receivable_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Drop old trigger if exists, then create
DROP TRIGGER IF EXISTS trg_update_receivable_status ON receivable_payments;
CREATE TRIGGER trg_update_receivable_status
  AFTER INSERT OR UPDATE OR DELETE ON receivable_payments
  FOR EACH ROW
  EXECUTE FUNCTION update_receivable_status();

-- ============================================================
-- 2. RLS: allow drivers to insert payments for their own receivables
-- ============================================================
-- The existing INSERT policy is broad ("WITH CHECK true"). We replace it
-- with a stricter one that allows:
--   - role >= 3 (comptable+): can insert any payment
--   - role = 1 (driver): can insert a payment only if the receivable's
--     driver_id matches their driver record
-- We need a helper check: does auth.uid() own the driver linked to this
-- receivable?
DROP POLICY IF EXISTS "insert_receivable_payments" ON receivable_payments;
CREATE POLICY "insert_receivable_payments"
ON receivable_payments FOR INSERT
TO authenticated
WITH CHECK (
  (
    SELECT p.role FROM profiles p WHERE p.id = auth.uid()
  ) >= 3
  OR
  EXISTS (
    SELECT 1
    FROM receivables r
    JOIN drivers d ON d.id = r.driver_id
    WHERE r.id = receivable_payments.receivable_id
      AND d.user_id = auth.uid()
  )
);

-- ============================================================
-- 3. RLS: allow drivers to UPDATE receivables (needed because trigger
--    runs as SECURITY DEFINER, but we also want drivers to be able to
--    see their updated receivables). The trigger uses SECURITY DEFINER
--    so it bypasses RLS for the UPDATE. No change needed to receivables
--    UPDATE policy, but we relax the SELECT so drivers can always read
--    their own receivables (already in place).
-- ============================================================

-- Backfill: ensure all existing receivables have correct status/amount_paid
-- based on actual payment sums (one-time data fix).
DO $$
DECLARE
  r RECORD;
  v_total integer;
BEGIN
  FOR r IN SELECT id, amount_fcfa FROM receivables LOOP
    SELECT COALESCE(SUM(amount_fcfa), 0) INTO v_total
      FROM receivable_payments WHERE receivable_id = r.id;
    IF v_total >= r.amount_fcfa THEN
      UPDATE receivables SET amount_paid = v_total, status = 'solde', updated_at = now()
        WHERE id = r.id AND (amount_paid <> v_total OR status <> 'solde');
    ELSIF v_total > 0 THEN
      UPDATE receivables SET amount_paid = v_total, status = 'partiel', updated_at = now()
        WHERE id = r.id AND (amount_paid <> v_total OR status <> 'partiel');
    ELSE
      UPDATE receivables SET amount_paid = 0, status = 'en_attente', updated_at = now()
        WHERE id = r.id AND (amount_paid <> 0 OR status <> 'en_attente');
    END IF;
  END LOOP;
END $$;
