CREATE TABLE public.accounting_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_type text NOT NULL CHECK (account_type IN ('cash', 'bank', 'client')),
  movement_type text NOT NULL CHECK (movement_type IN ('income', 'expense')),
  entry_date date NOT NULL DEFAULT current_date,
  label text NOT NULL CHECK (length(trim(label)) > 0),
  amount_fcfa numeric(14,2) NOT NULL CHECK (amount_fcfa > 0),
  reference text,
  payment_method text NOT NULL DEFAULT 'especes'
    CHECK (payment_method IN ('especes', 'mobile_money', 'virement', 'cheque', 'carte', 'autre')),
  notes text,
  client_name text,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT accounting_entries_client_name_check CHECK (
    account_type <> 'client' OR length(trim(client_name)) > 0
  )
);

CREATE INDEX accounting_entries_account_date_idx
  ON public.accounting_entries(account_type, entry_date DESC);

ALTER TABLE public.accounting_entries ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.accounting_entries TO authenticated;

CREATE POLICY accounting_entries_select
  ON public.accounting_entries FOR SELECT TO authenticated
  USING (private.get_my_role() >= 3);

CREATE POLICY accounting_entries_insert
  ON public.accounting_entries FOR INSERT TO authenticated
  WITH CHECK (private.get_my_role() >= 3 AND created_by = (SELECT auth.uid()));

CREATE POLICY accounting_entries_update
  ON public.accounting_entries FOR UPDATE TO authenticated
  USING (private.get_my_role() >= 5 OR (private.get_my_role() >= 3 AND created_by = (SELECT auth.uid())))
  WITH CHECK (private.get_my_role() >= 5 OR (private.get_my_role() >= 3 AND created_by = (SELECT auth.uid())));

CREATE POLICY accounting_entries_delete
  ON public.accounting_entries FOR DELETE TO authenticated
  USING (private.get_my_role() >= 5 OR (private.get_my_role() >= 3 AND created_by = (SELECT auth.uid())));

COMMENT ON TABLE public.accounting_entries IS
  'Écritures manuelles de caisse, banque et ajustements des comptes clients.';
