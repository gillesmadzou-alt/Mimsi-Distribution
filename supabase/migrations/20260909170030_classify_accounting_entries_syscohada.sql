-- Enrich every operational ledger row with an automatic SYSCOHADA-oriented
-- classification. These fields are intentionally derived by the database so
-- imported and retroactive entries are classified exactly like new entries.
ALTER TABLE public.accounting_entries
  ADD COLUMN journal_code text,
  ADD COLUMN operation_nature text,
  ADD COLUMN account_number text,
  ADD COLUMN account_label text,
  ADD COLUMN account_class smallint,
  ADD COLUMN counterpart_account_number text,
  ADD COLUMN counterpart_account_label text,
  ADD COLUMN counterpart_account_class smallint;

CREATE OR REPLACE FUNCTION private.classify_accounting_entry_syscohada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  settlement_account text := CASE
    WHEN NEW.payment_method IN ('virement', 'cheque', 'carte', 'mobile_money') THEN '521'
    ELSE '571'
  END;
  settlement_label text := CASE
    WHEN NEW.payment_method IN ('virement', 'cheque', 'carte', 'mobile_money') THEN 'Banques locales'
    ELSE 'Caisse'
  END;
BEGIN
  -- Account represented by the operational journal.
  IF NEW.account_type = 'cash' THEN
    NEW.account_number := '571';
    NEW.account_label := 'Caisse';
    NEW.account_class := 5;
  ELSIF NEW.account_type = 'bank' THEN
    NEW.account_number := '521';
    NEW.account_label := 'Banques locales';
    NEW.account_class := 5;
  ELSE
    NEW.account_number := '411';
    NEW.account_label := 'Clients';
    NEW.account_class := 4;
  END IF;

  -- Business nature, journal and counterpart are inferred from the original
  -- source when it exists, otherwise from the account and movement entered.
  NEW.operation_nature := CASE
    WHEN NEW.source_table = 'sales_points' AND NEW.source_event = 'quota_debt' THEN 'Cotisation due'
    WHEN NEW.source_table = 'quota_payments' AND NEW.account_type = 'client' THEN 'Règlement de cotisation client'
    WHEN NEW.source_table = 'quota_payments' THEN 'Encaissement de cotisation'
    WHEN NEW.source_table = 'receivables' THEN 'Créance client'
    WHEN NEW.source_table = 'receivable_payments' AND NEW.account_type = 'client' THEN 'Règlement de créance client'
    WHEN NEW.source_table = 'receivable_payments' THEN 'Encaissement de créance'
    WHEN NEW.source_table = 'deposits' THEN 'Vente au comptant'
    WHEN NEW.source_table = 'delivery_expenses' THEN 'Frais de livraison'
    WHEN NEW.source_table = 'opportunistic_sales' AND NEW.account_type = 'client' THEN 'Vente à crédit'
    WHEN NEW.source_table = 'opportunistic_sales' THEN 'Vente au comptant'
    WHEN NEW.source_table = 'wedding_orders' AND NEW.source_event = 'debt' THEN 'Commande client à crédit'
    WHEN NEW.source_table = 'wedding_orders' AND NEW.account_type = 'client' THEN 'Règlement de commande client'
    WHEN NEW.source_table = 'wedding_orders' THEN 'Encaissement de commande'
    WHEN NEW.account_type = 'client' AND NEW.movement_type = 'expense' THEN 'Facturation client manuelle'
    WHEN NEW.account_type = 'client' THEN 'Règlement client manuel'
    WHEN NEW.movement_type = 'income' THEN 'Encaissement manuel'
    ELSE 'Décaissement manuel'
  END;

  IF NEW.account_type = 'client' AND NEW.movement_type = 'expense' THEN
    NEW.journal_code := 'VE';
    IF NEW.source_event = 'quota_debt' THEN
      NEW.counterpart_account_number := '758';
      NEW.counterpart_account_label := 'Produits divers';
      NEW.counterpart_account_class := 7;
    ELSE
      NEW.counterpart_account_number := '701';
      NEW.counterpart_account_label := 'Ventes de produits finis';
      NEW.counterpart_account_class := 7;
    END IF;
  ELSIF NEW.account_type = 'client' THEN
    NEW.journal_code := CASE WHEN settlement_account = '521' THEN 'BQ' ELSE 'CA' END;
    NEW.counterpart_account_number := settlement_account;
    NEW.counterpart_account_label := settlement_label;
    NEW.counterpart_account_class := 5;
  ELSIF NEW.account_type = 'cash' THEN
    NEW.journal_code := 'CA';
    IF NEW.movement_type = 'expense' THEN
      NEW.counterpart_account_number := CASE WHEN NEW.source_table = 'delivery_expenses' THEN '618' ELSE '658' END;
      NEW.counterpart_account_label := CASE WHEN NEW.source_table = 'delivery_expenses' THEN 'Autres frais de transport' ELSE 'Charges diverses' END;
      NEW.counterpart_account_class := 6;
    ELSIF NEW.source_table IN ('receivable_payments', 'quota_payments', 'wedding_orders') THEN
      NEW.counterpart_account_number := '411';
      NEW.counterpart_account_label := 'Clients';
      NEW.counterpart_account_class := 4;
    ELSE
      NEW.counterpart_account_number := '701';
      NEW.counterpart_account_label := 'Ventes de produits finis';
      NEW.counterpart_account_class := 7;
    END IF;
  ELSE
    NEW.journal_code := 'BQ';
    IF NEW.movement_type = 'expense' THEN
      NEW.counterpart_account_number := '658';
      NEW.counterpart_account_label := 'Charges diverses';
      NEW.counterpart_account_class := 6;
    ELSIF NEW.source_table = 'quota_payments' THEN
      NEW.counterpart_account_number := '411';
      NEW.counterpart_account_label := 'Clients';
      NEW.counterpart_account_class := 4;
    ELSE
      NEW.counterpart_account_number := '701';
      NEW.counterpart_account_label := 'Ventes de produits finis';
      NEW.counterpart_account_class := 7;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.classify_accounting_entry_syscohada() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER classify_accounting_entry_syscohada
  BEFORE INSERT OR UPDATE OF account_type, movement_type, payment_method, source_table, source_event
  ON public.accounting_entries
  FOR EACH ROW EXECUTE FUNCTION private.classify_accounting_entry_syscohada();

-- Backfill every historical row through the same trigger logic.
UPDATE public.accounting_entries
SET movement_type = movement_type;

ALTER TABLE public.accounting_entries
  ALTER COLUMN journal_code SET NOT NULL,
  ALTER COLUMN operation_nature SET NOT NULL,
  ALTER COLUMN account_number SET NOT NULL,
  ALTER COLUMN account_label SET NOT NULL,
  ALTER COLUMN account_class SET NOT NULL,
  ALTER COLUMN counterpart_account_number SET NOT NULL,
  ALTER COLUMN counterpart_account_label SET NOT NULL,
  ALTER COLUMN counterpart_account_class SET NOT NULL,
  ADD CONSTRAINT accounting_entries_journal_code_check CHECK (journal_code IN ('CA', 'BQ', 'VE', 'OD')),
  ADD CONSTRAINT accounting_entries_account_class_check CHECK (account_class BETWEEN 1 AND 9),
  ADD CONSTRAINT accounting_entries_counterpart_class_check CHECK (counterpart_account_class BETWEEN 1 AND 9);

CREATE INDEX accounting_entries_journal_date_idx
  ON public.accounting_entries(journal_code, entry_date DESC);

COMMENT ON COLUMN public.accounting_entries.journal_code IS 'Code du journal calculé automatiquement : CA caisse, BQ banque, VE ventes, OD opérations diverses.';
COMMENT ON COLUMN public.accounting_entries.operation_nature IS 'Nature métier de l’opération, déterminée automatiquement depuis sa source.';
COMMENT ON COLUMN public.accounting_entries.account_number IS 'Numéro du compte principal selon le plan SYSCOHADA.';
COMMENT ON COLUMN public.accounting_entries.account_class IS 'Classe SYSCOHADA du compte principal.';
COMMENT ON COLUMN public.accounting_entries.counterpart_account_number IS 'Compte de contrepartie proposé automatiquement selon la nature de l’opération.';
