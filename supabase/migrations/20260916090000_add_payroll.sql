-- Paiement des salaires / fiche de paie, lié à la Tenue de compte comme le
-- reste des mouvements financiers (dépôts, créances, dépenses...) : chaque
-- salaire versé génère automatiquement une écriture comptable classée
-- SYSCOHADA (compte 661 "Rémunérations directes versées au personnel"),
-- exactement comme les dépenses de livraison ou les règlements fournisseurs.

-- Salaire mensuel de référence par employé (sert à préremplir le montant
-- brut lors de la préparation d'une fiche de paie ; nullable, à définir par
-- l'équipe pour chaque membre du personnel).
ALTER TABLE public.profiles
  ADD COLUMN monthly_salary_fcfa numeric(12,2) CHECK (monthly_salary_fcfa IS NULL OR monthly_salary_fcfa >= 0);

COMMENT ON COLUMN public.profiles.monthly_salary_fcfa IS
  'Salaire brut mensuel de référence, utilisé pour préremplir la fiche de paie du mois — modifiable indépendamment de chaque versement réel.';

-- Un versement de salaire = une fiche de paie pour un employé, un mois donné.
CREATE TABLE public.salary_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  period_month smallint NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  period_year smallint NOT NULL CHECK (period_year BETWEEN 2020 AND 2100),
  gross_amount_fcfa numeric(12,2) NOT NULL CHECK (gross_amount_fcfa > 0),
  deductions_fcfa numeric(12,2) NOT NULL DEFAULT 0 CHECK (deductions_fcfa >= 0),
  net_amount_fcfa numeric(12,2) GENERATED ALWAYS AS (gross_amount_fcfa - deductions_fcfa) STORED,
  payment_method text NOT NULL DEFAULT 'virement'
    CHECK (payment_method IN ('especes', 'mobile_money', 'virement', 'cheque', 'autre')),
  payment_date date NOT NULL DEFAULT current_date,
  notes text,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT salary_payments_net_positive_check CHECK (gross_amount_fcfa - deductions_fcfa >= 0),
  UNIQUE (profile_id, period_month, period_year)
);

CREATE INDEX salary_payments_profile_period_idx
  ON public.salary_payments(profile_id, period_year DESC, period_month DESC);

ALTER TABLE public.salary_payments ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.salary_payments TO authenticated;

-- Même modèle de confiance que accounting_entries : le comptable (rôle 3)
-- voit et prépare déjà tous les mouvements de caisse/banque/clients, les
-- salaires ne sont pas plus sensibles que ça dans cette app.
CREATE POLICY salary_payments_select
  ON public.salary_payments FOR SELECT TO authenticated
  USING (private.get_my_role() >= 3);

CREATE POLICY salary_payments_insert
  ON public.salary_payments FOR INSERT TO authenticated
  WITH CHECK (private.get_my_role() >= 3 AND created_by = (SELECT auth.uid()));

CREATE POLICY salary_payments_update
  ON public.salary_payments FOR UPDATE TO authenticated
  USING (private.get_my_role() >= 5 OR (private.get_my_role() >= 3 AND created_by = (SELECT auth.uid())))
  WITH CHECK (private.get_my_role() >= 5 OR (private.get_my_role() >= 3 AND created_by = (SELECT auth.uid())));

CREATE POLICY salary_payments_delete
  ON public.salary_payments FOR DELETE TO authenticated
  USING (private.get_my_role() >= 5 OR (private.get_my_role() >= 3 AND created_by = (SELECT auth.uid())));

CREATE TRIGGER salary_payments_set_updated_at
  BEFORE UPDATE ON public.salary_payments
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

COMMENT ON TABLE public.salary_payments IS
  'Fiches de paie : un versement de salaire par employé et par mois, génère automatiquement une écriture dans accounting_entries (compte 661).';

-- Étend la synchronisation automatique vers la Tenue de compte (fonction
-- déjà utilisée par deposits/receivables/quota_payments/delivery_expenses/
-- opportunistic_sales/wedding_orders) avec la nouvelle table salary_payments.
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

  ELSIF TG_TABLE_NAME = 'salary_payments' THEN
    SELECT p.full_name INTO client_label FROM public.profiles p WHERE p.id = NEW.profile_id;
    IF NEW.net_amount_fcfa > 0 THEN
      INSERT INTO public.accounting_entries
        (account_type, movement_type, entry_date, label, amount_fcfa, reference, payment_method, notes, created_by, source_table, source_id, source_event)
      VALUES
        (CASE WHEN NEW.payment_method IN ('virement', 'cheque') THEN 'bank' ELSE 'cash' END, 'expense', NEW.payment_date,
         'Salaire ' || NEW.period_month || '/' || NEW.period_year || ' — ' || COALESCE(client_label, 'Employé'), NEW.net_amount_fcfa,
         NEW.id::text, NEW.payment_method, NEW.notes, NEW.created_by, TG_TABLE_NAME, NEW.id, 'payment');
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER sync_salary_payments_accounting
  AFTER INSERT OR UPDATE OR DELETE ON public.salary_payments
  FOR EACH ROW EXECUTE FUNCTION private.sync_financial_event_to_accounting();

-- Étend la classification SYSCOHADA automatique (compte 661 "Rémunérations
-- directes versées au personnel") pour les écritures issues de salary_payments.
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
  ELSIF NEW.account_type = 'supplier' THEN
    NEW.account_number := '401';
    NEW.account_label := 'Fournisseurs';
    NEW.account_class := 4;
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
    WHEN NEW.source_table = 'salary_payments' THEN 'Salaire versé'
    WHEN NEW.account_type = 'supplier' AND NEW.movement_type = 'expense' THEN 'Facture fournisseur à crédit'
    WHEN NEW.account_type = 'supplier' THEN 'Règlement fournisseur'
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
  ELSIF NEW.account_type = 'supplier' AND NEW.movement_type = 'expense' THEN
    -- Facture reçue : la dette envers le fournisseur augmente.
    NEW.journal_code := 'AC';
    NEW.counterpart_account_number := '602';
    NEW.counterpart_account_label := 'Achats de matières premières';
    NEW.counterpart_account_class := 6;
  ELSIF NEW.account_type = 'supplier' THEN
    -- Règlement : la dette envers le fournisseur diminue.
    NEW.journal_code := CASE WHEN settlement_account = '521' THEN 'BQ' ELSE 'CA' END;
    NEW.counterpart_account_number := settlement_account;
    NEW.counterpart_account_label := settlement_label;
    NEW.counterpart_account_class := 5;
  ELSIF NEW.account_type = 'cash' THEN
    NEW.journal_code := 'CA';
    IF NEW.movement_type = 'expense' THEN
      NEW.counterpart_account_number := CASE
        WHEN NEW.source_table = 'delivery_expenses' THEN '618'
        WHEN NEW.source_table = 'salary_payments' THEN '661'
        ELSE '658' END;
      NEW.counterpart_account_label := CASE
        WHEN NEW.source_table = 'delivery_expenses' THEN 'Autres frais de transport'
        WHEN NEW.source_table = 'salary_payments' THEN 'Rémunérations directes versées au personnel'
        ELSE 'Charges diverses' END;
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
      NEW.counterpart_account_number := CASE
        WHEN NEW.source_table = 'salary_payments' THEN '661'
        ELSE '658' END;
      NEW.counterpart_account_label := CASE
        WHEN NEW.source_table = 'salary_payments' THEN 'Rémunérations directes versées au personnel'
        ELSE 'Charges diverses' END;
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

-- Backfill (no-op tant qu'aucune fiche de paie n'existe encore, mais rejoue
-- la même logique de trigger si jamais nécessaire après une future évolution).
UPDATE public.accounting_entries
SET movement_type = movement_type;
