-- Centralise every financial event in the accounting ledger. Automatic rows
-- are identified by their source and cannot be edited from the client.
ALTER TABLE public.accounting_entries
  ADD COLUMN source_table text,
  ADD COLUMN source_id uuid,
  ADD COLUMN source_event text;

ALTER TABLE public.accounting_entries
  ALTER COLUMN created_by DROP NOT NULL;

ALTER TABLE public.accounting_entries
  ADD CONSTRAINT accounting_entries_source_complete_check CHECK (
    (source_table IS NULL AND source_id IS NULL AND source_event IS NULL)
    OR (source_table IS NOT NULL AND source_id IS NOT NULL AND source_event IS NOT NULL)
  );

CREATE UNIQUE INDEX accounting_entries_source_unique_idx
  ON public.accounting_entries(source_table, source_id, account_type, source_event)
  WHERE source_table IS NOT NULL;

DROP POLICY IF EXISTS accounting_entries_update ON public.accounting_entries;
CREATE POLICY accounting_entries_update
  ON public.accounting_entries FOR UPDATE TO authenticated
  USING (
    source_table IS NULL
    AND (private.get_my_role() >= 5 OR (private.get_my_role() >= 3 AND created_by = (SELECT auth.uid())))
  )
  WITH CHECK (
    source_table IS NULL
    AND (private.get_my_role() >= 5 OR (private.get_my_role() >= 3 AND created_by = (SELECT auth.uid())))
  );

DROP POLICY IF EXISTS accounting_entries_delete ON public.accounting_entries;
CREATE POLICY accounting_entries_delete
  ON public.accounting_entries FOR DELETE TO authenticated
  USING (
    source_table IS NULL
    AND (private.get_my_role() >= 5 OR (private.get_my_role() >= 3 AND created_by = (SELECT auth.uid())))
  );

CREATE OR REPLACE FUNCTION private.sync_financial_event_to_accounting()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  row_id uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  client_label text;
  destination_account text;
BEGIN
  DELETE FROM public.accounting_entries
  WHERE source_table = TG_TABLE_NAME AND source_id = row_id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF TG_TABLE_NAME = 'deposits' THEN
    IF NEW.is_confirmed AND NEW.payment_type = 'comptant' AND NEW.amount_fcfa > 0 THEN
      SELECT sp.name INTO client_label FROM public.sales_points sp WHERE sp.id = NEW.sales_point_id;
      INSERT INTO public.accounting_entries
        (account_type, movement_type, entry_date, label, amount_fcfa, reference, payment_method, notes, created_by, source_table, source_id, source_event)
      VALUES
        ('cash', 'income', NEW.deposited_at::date, 'Dépôt comptant — ' || COALESCE(client_label, 'Point de vente'), NEW.amount_fcfa,
         NEW.id::text, 'especes', NEW.notes, (SELECT db.created_by FROM public.delivery_batches db WHERE db.id = NEW.batch_id), TG_TABLE_NAME, NEW.id, 'payment');
    END IF;

  ELSIF TG_TABLE_NAME = 'receivables' THEN
    SELECT sp.name INTO client_label FROM public.sales_points sp WHERE sp.id = NEW.sales_point_id;
    IF NEW.amount_fcfa > 0 THEN
      INSERT INTO public.accounting_entries
        (account_type, movement_type, entry_date, label, amount_fcfa, reference, payment_method, client_name, created_by, source_table, source_id, source_event)
      VALUES
        ('client', 'expense', NEW.created_at::date, 'Créance automatique', NEW.amount_fcfa, NEW.id::text, 'autre',
         COALESCE(client_label, 'Client sans nom'), NULL, TG_TABLE_NAME, NEW.id, 'debt');
    END IF;

  ELSIF TG_TABLE_NAME = 'receivable_payments' THEN
    SELECT sp.name INTO client_label
    FROM public.receivables r JOIN public.sales_points sp ON sp.id = r.sales_point_id
    WHERE r.id = NEW.receivable_id;
    IF NEW.amount_fcfa > 0 THEN
      INSERT INTO public.accounting_entries
        (account_type, movement_type, entry_date, label, amount_fcfa, reference, payment_method, client_name, created_by, source_table, source_id, source_event)
      VALUES
        ('client', 'income', NEW.payment_date::date, 'Règlement de créance', NEW.amount_fcfa, NEW.receivable_id::text, 'especes',
         COALESCE(client_label, 'Client sans nom'), NEW.collected_by, TG_TABLE_NAME, NEW.id, 'client_credit'),
        ('cash', 'income', NEW.payment_date::date, 'Encaissement créance — ' || COALESCE(client_label, 'Client'), NEW.amount_fcfa,
         NEW.receivable_id::text, 'especes', NULL, NEW.collected_by, TG_TABLE_NAME, NEW.id, 'cash_receipt');
    END IF;

  ELSIF TG_TABLE_NAME = 'quota_payments' THEN
    SELECT sp.name INTO client_label FROM public.sales_points sp WHERE sp.id = NEW.sales_point_id;
    destination_account := CASE WHEN NEW.payment_method IN ('virement') THEN 'bank' ELSE 'cash' END;
    INSERT INTO public.accounting_entries
      (account_type, movement_type, entry_date, label, amount_fcfa, reference, payment_method, notes, created_by, source_table, source_id, source_event)
    VALUES
      (destination_account, 'income', NEW.payment_date, 'Cotisation — ' || COALESCE(client_label, 'Point de vente'), NEW.amount_fcfa,
       COALESCE(NEW.receipt_number, NEW.id::text), NEW.payment_method::text, NEW.notes, NEW.collected_by, TG_TABLE_NAME, NEW.id, 'payment');

  ELSIF TG_TABLE_NAME = 'delivery_expenses' THEN
    IF NEW.amount_fcfa > 0 THEN
      INSERT INTO public.accounting_entries
        (account_type, movement_type, entry_date, label, amount_fcfa, reference, payment_method, created_by, source_table, source_id, source_event)
      VALUES
        ('cash', 'expense', NEW.expense_date, COALESCE(NULLIF(NEW.reason, ''), 'Dépense de livraison'), NEW.amount_fcfa,
         NEW.id::text, 'especes', auth.uid(), TG_TABLE_NAME, NEW.id, 'expense');
    END IF;

  ELSIF TG_TABLE_NAME = 'opportunistic_sales' THEN
    IF NEW.total_amount_fcfa > 0 THEN
      IF NEW.payment_type = 'comptant' THEN
        INSERT INTO public.accounting_entries
          (account_type, movement_type, entry_date, label, amount_fcfa, reference, payment_method, notes, created_by, source_table, source_id, source_event)
        VALUES
          ('cash', 'income', NEW.sale_date, 'Vente ' || COALESCE(NEW.sale_context, 'opportuniste'), NEW.total_amount_fcfa,
           NEW.id::text, 'especes', NEW.notes, NEW.created_by, TG_TABLE_NAME, NEW.id, 'payment');
      ELSE
        INSERT INTO public.accounting_entries
          (account_type, movement_type, entry_date, label, amount_fcfa, reference, payment_method, client_name, notes, created_by, source_table, source_id, source_event)
        VALUES
          ('client', 'expense', NEW.sale_date, 'Vente à crédit', NEW.total_amount_fcfa, NEW.id::text, 'autre',
           COALESCE(NULLIF(NEW.customer_name, ''), 'Client vente opportuniste'), NEW.notes, NEW.created_by, TG_TABLE_NAME, NEW.id, 'debt');
      END IF;
    END IF;

  ELSIF TG_TABLE_NAME = 'wedding_orders' THEN
    client_label := COALESCE(NULLIF(concat_ws(' & ', NULLIF(NEW.bride_name, ''), NULLIF(NEW.groom_name, '')), ''), 'Client mariage');
    IF NEW.status <> 'annule' THEN
      IF NEW.total_amount_fcfa > 0 THEN
        INSERT INTO public.accounting_entries
          (account_type, movement_type, entry_date, label, amount_fcfa, reference, payment_method, client_name, notes, created_by, source_table, source_id, source_event)
        VALUES
          ('client', 'expense', NEW.order_date, 'Commande mariage', NEW.total_amount_fcfa, NEW.id::text, 'autre', client_label,
           NEW.notes, NEW.created_by, TG_TABLE_NAME, NEW.id, 'debt');
      END IF;
      IF NEW.amount_paid_fcfa > 0 THEN
        INSERT INTO public.accounting_entries
          (account_type, movement_type, entry_date, label, amount_fcfa, reference, payment_method, notes, created_by, source_table, source_id, source_event)
        VALUES
          ('cash', 'income', NEW.order_date, 'Paiement commande mariage — ' || client_label, NEW.amount_paid_fcfa,
           NEW.id::text, 'especes', NEW.notes, NEW.created_by, TG_TABLE_NAME, NEW.id, 'payment');
        INSERT INTO public.accounting_entries
          (account_type, movement_type, entry_date, label, amount_fcfa, reference, payment_method, client_name, notes, created_by, source_table, source_id, source_event)
        VALUES
          ('client', 'income', NEW.order_date, 'Paiement commande mariage', NEW.amount_paid_fcfa, NEW.id::text, 'especes', client_label,
           NEW.notes, NEW.created_by, TG_TABLE_NAME, NEW.id, 'client_credit');
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.sync_financial_event_to_accounting() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER sync_deposits_accounting
  AFTER INSERT OR UPDATE OR DELETE ON public.deposits
  FOR EACH ROW EXECUTE FUNCTION private.sync_financial_event_to_accounting();
CREATE TRIGGER sync_receivables_accounting
  AFTER INSERT OR UPDATE OR DELETE ON public.receivables
  FOR EACH ROW EXECUTE FUNCTION private.sync_financial_event_to_accounting();
CREATE TRIGGER sync_receivable_payments_accounting
  AFTER INSERT OR UPDATE OR DELETE ON public.receivable_payments
  FOR EACH ROW EXECUTE FUNCTION private.sync_financial_event_to_accounting();
CREATE TRIGGER sync_quota_payments_accounting
  AFTER INSERT OR UPDATE OR DELETE ON public.quota_payments
  FOR EACH ROW EXECUTE FUNCTION private.sync_financial_event_to_accounting();
CREATE TRIGGER sync_delivery_expenses_accounting
  AFTER INSERT OR UPDATE OR DELETE ON public.delivery_expenses
  FOR EACH ROW EXECUTE FUNCTION private.sync_financial_event_to_accounting();
CREATE TRIGGER sync_opportunistic_sales_accounting
  AFTER INSERT OR UPDATE OR DELETE ON public.opportunistic_sales
  FOR EACH ROW EXECUTE FUNCTION private.sync_financial_event_to_accounting();
CREATE TRIGGER sync_wedding_orders_accounting
  AFTER INSERT OR UPDATE OR DELETE ON public.wedding_orders
  FOR EACH ROW EXECUTE FUNCTION private.sync_financial_event_to_accounting();

-- Backfill existing history. The unique source index makes this idempotent.
INSERT INTO public.accounting_entries
  (account_type, movement_type, entry_date, label, amount_fcfa, reference, payment_method, created_by, source_table, source_id, source_event)
SELECT 'cash', 'income', d.deposited_at::date, 'Dépôt comptant — ' || sp.name, d.amount_fcfa, d.id::text, 'especes', db.created_by,
       'deposits', d.id, 'payment'
FROM public.deposits d JOIN public.sales_points sp ON sp.id = d.sales_point_id JOIN public.delivery_batches db ON db.id = d.batch_id
WHERE d.is_confirmed AND d.payment_type = 'comptant' AND d.amount_fcfa > 0
ON CONFLICT DO NOTHING;

INSERT INTO public.accounting_entries
  (account_type, movement_type, entry_date, label, amount_fcfa, reference, payment_method, client_name, source_table, source_id, source_event)
SELECT 'client', 'expense', r.created_at::date, 'Créance automatique', r.amount_fcfa, r.id::text, 'autre', sp.name,
       'receivables', r.id, 'debt'
FROM public.receivables r JOIN public.sales_points sp ON sp.id = r.sales_point_id
WHERE r.amount_fcfa > 0 ON CONFLICT DO NOTHING;

INSERT INTO public.accounting_entries
  (account_type, movement_type, entry_date, label, amount_fcfa, reference, payment_method, client_name, created_by, source_table, source_id, source_event)
SELECT 'client', 'income', rp.payment_date::date, 'Règlement de créance', rp.amount_fcfa, rp.receivable_id::text, 'especes', sp.name,
       rp.collected_by, 'receivable_payments', rp.id, 'client_credit'
FROM public.receivable_payments rp JOIN public.receivables r ON r.id = rp.receivable_id JOIN public.sales_points sp ON sp.id = r.sales_point_id
WHERE rp.amount_fcfa > 0 ON CONFLICT DO NOTHING;

INSERT INTO public.accounting_entries
  (account_type, movement_type, entry_date, label, amount_fcfa, reference, payment_method, created_by, source_table, source_id, source_event)
SELECT 'cash', 'income', rp.payment_date::date, 'Encaissement créance — ' || sp.name, rp.amount_fcfa, rp.receivable_id::text, 'especes',
       rp.collected_by, 'receivable_payments', rp.id, 'cash_receipt'
FROM public.receivable_payments rp JOIN public.receivables r ON r.id = rp.receivable_id JOIN public.sales_points sp ON sp.id = r.sales_point_id
WHERE rp.amount_fcfa > 0 ON CONFLICT DO NOTHING;

INSERT INTO public.accounting_entries
  (account_type, movement_type, entry_date, label, amount_fcfa, reference, payment_method, notes, created_by, source_table, source_id, source_event)
SELECT CASE WHEN qp.payment_method = 'virement' THEN 'bank' ELSE 'cash' END, 'income', qp.payment_date,
       'Cotisation — ' || sp.name, qp.amount_fcfa, COALESCE(qp.receipt_number, qp.id::text), qp.payment_method::text, qp.notes,
       qp.collected_by, 'quota_payments', qp.id, 'payment'
FROM public.quota_payments qp JOIN public.sales_points sp ON sp.id = qp.sales_point_id
ON CONFLICT DO NOTHING;

INSERT INTO public.accounting_entries
  (account_type, movement_type, entry_date, label, amount_fcfa, reference, payment_method, source_table, source_id, source_event)
SELECT 'cash', 'expense', de.expense_date, COALESCE(NULLIF(de.reason, ''), 'Dépense de livraison'), de.amount_fcfa, de.id::text,
       'especes', 'delivery_expenses', de.id, 'expense'
FROM public.delivery_expenses de WHERE de.amount_fcfa > 0 ON CONFLICT DO NOTHING;

INSERT INTO public.accounting_entries
  (account_type, movement_type, entry_date, label, amount_fcfa, reference, payment_method, client_name, notes, created_by, source_table, source_id, source_event)
SELECT CASE WHEN os.payment_type = 'comptant' THEN 'cash' ELSE 'client' END,
       CASE WHEN os.payment_type = 'comptant' THEN 'income' ELSE 'expense' END,
       os.sale_date, CASE WHEN os.payment_type = 'comptant' THEN 'Vente ' || COALESCE(os.sale_context, 'opportuniste') ELSE 'Vente à crédit' END,
       os.total_amount_fcfa, os.id::text, CASE WHEN os.payment_type = 'comptant' THEN 'especes' ELSE 'autre' END,
       CASE WHEN os.payment_type = 'credit' THEN COALESCE(NULLIF(os.customer_name, ''), 'Client vente opportuniste') END,
       os.notes, os.created_by, 'opportunistic_sales', os.id, CASE WHEN os.payment_type = 'comptant' THEN 'payment' ELSE 'debt' END
FROM public.opportunistic_sales os WHERE os.total_amount_fcfa > 0 ON CONFLICT DO NOTHING;

INSERT INTO public.accounting_entries
  (account_type, movement_type, entry_date, label, amount_fcfa, reference, payment_method, notes, created_by, source_table, source_id, source_event)
SELECT 'cash', 'income', wo.order_date,
       'Paiement commande mariage — ' || COALESCE(NULLIF(concat_ws(' & ', NULLIF(wo.bride_name, ''), NULLIF(wo.groom_name, '')), ''), 'Client mariage'),
       wo.amount_paid_fcfa, wo.id::text, 'especes', wo.notes, wo.created_by, 'wedding_orders', wo.id, 'payment'
FROM public.wedding_orders wo
WHERE wo.status <> 'annule' AND wo.amount_paid_fcfa > 0 ON CONFLICT DO NOTHING;

INSERT INTO public.accounting_entries
  (account_type, movement_type, entry_date, label, amount_fcfa, reference, payment_method, client_name, notes, created_by, source_table, source_id, source_event)
SELECT 'client', 'expense', wo.order_date, 'Commande mariage', wo.total_amount_fcfa, wo.id::text, 'autre',
       COALESCE(NULLIF(concat_ws(' & ', NULLIF(wo.bride_name, ''), NULLIF(wo.groom_name, '')), ''), 'Client mariage'),
       wo.notes, wo.created_by, 'wedding_orders', wo.id, 'debt'
FROM public.wedding_orders wo
WHERE wo.status <> 'annule' AND wo.total_amount_fcfa > 0 ON CONFLICT DO NOTHING;

INSERT INTO public.accounting_entries
  (account_type, movement_type, entry_date, label, amount_fcfa, reference, payment_method, client_name, notes, created_by, source_table, source_id, source_event)
SELECT 'client', 'income', wo.order_date, 'Paiement commande mariage', wo.amount_paid_fcfa, wo.id::text, 'especes',
       COALESCE(NULLIF(concat_ws(' & ', NULLIF(wo.bride_name, ''), NULLIF(wo.groom_name, '')), ''), 'Client mariage'),
       wo.notes, wo.created_by, 'wedding_orders', wo.id, 'client_credit'
FROM public.wedding_orders wo
WHERE wo.status <> 'annule' AND wo.amount_paid_fcfa > 0 ON CONFLICT DO NOTHING;

COMMENT ON COLUMN public.accounting_entries.source_table IS 'Table métier ayant produit automatiquement cette écriture; NULL pour une écriture manuelle.';
