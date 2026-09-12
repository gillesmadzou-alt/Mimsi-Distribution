-- Paiements en ligne : Mobile Money (PawaPay — Airtel Money / MTN Mobile
-- Money Congo) et cartes bancaires (CinetPay — Visa/Mastercard). Une seule
-- table d'historique pour les deux, distinguées par `provider`/`method`.

CREATE TABLE public.payment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('pawapay', 'cinetpay')),
  method text NOT NULL CHECK (method IN ('mobile_money', 'card')),
  amount_fcfa integer NOT NULL CHECK (amount_fcfa > 0),
  currency text NOT NULL DEFAULT 'XAF',
  customer_name text,
  customer_phone text,
  mobile_money_provider text, -- ex: MTN_MOMO_COG / AIRTEL_COG (code exact PawaPay)
  provider_reference text,    -- depositId (PawaPay) ou transaction_id (CinetPay)
  payment_url text,           -- lien de paiement hébergé (CinetPay)
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'completed', 'failed', 'cancelled')),
  error text,
  receivable_id uuid REFERENCES public.receivables(id) ON DELETE SET NULL,
  marketing_order_id uuid REFERENCES public.marketing_orders(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX payment_requests_provider_reference_key
  ON public.payment_requests(provider, provider_reference)
  WHERE provider_reference IS NOT NULL;

CREATE INDEX payment_requests_status_created_idx ON public.payment_requests(status, created_at DESC);

ALTER TABLE public.payment_requests ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON public.payment_requests TO authenticated;

CREATE POLICY payment_requests_select
  ON public.payment_requests FOR SELECT TO authenticated
  USING (private.get_my_role() >= 4);

CREATE POLICY payment_requests_insert
  ON public.payment_requests FOR INSERT TO authenticated
  WITH CHECK (private.get_my_role() >= 4);

CREATE TRIGGER payment_requests_set_updated_at
  BEFORE UPDATE ON public.payment_requests
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

COMMENT ON TABLE public.payment_requests IS
  'Historique des paiements en ligne demandes/recus via PawaPay (Mobile Money Airtel/MTN Congo) et CinetPay (Visa/Mastercard). Les webhooks pawapay-webhook et cinetpay-webhook mettent a jour le statut ; initiate-mobile-money-payment et initiate-card-payment creent les lignes.';
