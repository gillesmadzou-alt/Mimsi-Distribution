CREATE OR REPLACE FUNCTION private.sync_sales_point_quota_to_accounting()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  row_id uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
BEGIN
  DELETE FROM public.accounting_entries
  WHERE source_table = 'sales_points'
    AND source_id = row_id
    AND account_type = 'client'
    AND source_event = 'quota_debt';

  IF TG_OP <> 'DELETE' AND COALESCE(NEW.quota_amount, 0) > 0 THEN
    INSERT INTO public.accounting_entries
      (account_type, movement_type, entry_date, label, amount_fcfa, reference, payment_method,
       client_name, created_by, source_table, source_id, source_event)
    VALUES
      ('client', 'expense', NEW.created_at::date, 'Cotisation due', NEW.quota_amount,
       NEW.id::text, 'autre', COALESCE(NULLIF(NEW.name, ''), 'Point de vente'), NEW.created_by,
       'sales_points', NEW.id, 'quota_debt');
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

REVOKE ALL ON FUNCTION private.sync_sales_point_quota_to_accounting() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER sync_sales_point_quota_accounting
  AFTER INSERT OR UPDATE OF name, quota_amount OR DELETE ON public.sales_points
  FOR EACH ROW EXECUTE FUNCTION private.sync_sales_point_quota_to_accounting();

CREATE OR REPLACE FUNCTION private.sync_quota_payment_client_to_accounting()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  row_id uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  client_label text;
BEGIN
  DELETE FROM public.accounting_entries
  WHERE source_table = 'quota_payments'
    AND source_id = row_id
    AND account_type = 'client'
    AND source_event = 'client_credit';

  IF TG_OP <> 'DELETE' AND NEW.amount_fcfa > 0 THEN
    SELECT sp.name INTO client_label FROM public.sales_points sp WHERE sp.id = NEW.sales_point_id;
    INSERT INTO public.accounting_entries
      (account_type, movement_type, entry_date, label, amount_fcfa, reference, payment_method,
       client_name, notes, created_by, source_table, source_id, source_event)
    VALUES
      ('client', 'income', NEW.payment_date, 'Versement de cotisation', NEW.amount_fcfa,
       COALESCE(NEW.receipt_number, NEW.id::text), NEW.payment_method::text,
       COALESCE(client_label, 'Point de vente'), NEW.notes, NEW.collected_by,
       'quota_payments', NEW.id, 'client_credit');
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

REVOKE ALL ON FUNCTION private.sync_quota_payment_client_to_accounting() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER sync_quota_payments_client_accounting
  AFTER INSERT OR UPDATE OR DELETE ON public.quota_payments
  FOR EACH ROW EXECUTE FUNCTION private.sync_quota_payment_client_to_accounting();

INSERT INTO public.accounting_entries
  (account_type, movement_type, entry_date, label, amount_fcfa, reference, payment_method,
   client_name, created_by, source_table, source_id, source_event)
SELECT 'client', 'expense', sp.created_at::date, 'Cotisation due', sp.quota_amount,
       sp.id::text, 'autre', COALESCE(NULLIF(sp.name, ''), 'Point de vente'), sp.created_by,
       'sales_points', sp.id, 'quota_debt'
FROM public.sales_points sp
WHERE COALESCE(sp.quota_amount, 0) > 0
ON CONFLICT DO NOTHING;

INSERT INTO public.accounting_entries
  (account_type, movement_type, entry_date, label, amount_fcfa, reference, payment_method,
   client_name, notes, created_by, source_table, source_id, source_event)
SELECT 'client', 'income', qp.payment_date, 'Versement de cotisation', qp.amount_fcfa,
       COALESCE(qp.receipt_number, qp.id::text), qp.payment_method::text,
       COALESCE(NULLIF(sp.name, ''), 'Point de vente'), qp.notes, qp.collected_by,
       'quota_payments', qp.id, 'client_credit'
FROM public.quota_payments qp
JOIN public.sales_points sp ON sp.id = qp.sales_point_id
WHERE qp.amount_fcfa > 0
ON CONFLICT DO NOTHING;
