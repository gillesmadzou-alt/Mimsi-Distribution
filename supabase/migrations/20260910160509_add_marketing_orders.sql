-- Commandes reçues via les réseaux sociaux (Facebook, WhatsApp, Instagram,
-- TikTok) par le biais de l'automatisation n8n (webhook -> Supabase Edge
-- Function `receive-marketing-order` -> cette table). Permet aussi la saisie
-- manuelle par le personnel tant que l'automatisation n'est pas branchée.

CREATE TABLE public.marketing_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL CHECK (channel IN ('facebook', 'whatsapp', 'instagram', 'tiktok', 'autre')),
  status text NOT NULL DEFAULT 'nouveau'
    CHECK (status IN ('nouveau', 'en_cours', 'traite', 'annule')),
  customer_name text,
  customer_phone text,
  message text,
  order_details jsonb,
  sales_point_id uuid REFERENCES public.sales_points(id) ON DELETE SET NULL,
  assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  external_id text,
  raw_payload jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX marketing_orders_channel_external_id_key
  ON public.marketing_orders(channel, external_id)
  WHERE external_id IS NOT NULL;

CREATE INDEX marketing_orders_status_created_idx
  ON public.marketing_orders(status, created_at DESC);

CREATE INDEX marketing_orders_channel_idx
  ON public.marketing_orders(channel);

ALTER TABLE public.marketing_orders ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_orders TO authenticated;

CREATE POLICY marketing_orders_select
  ON public.marketing_orders FOR SELECT TO authenticated
  USING (private.get_my_role() >= 4);

CREATE POLICY marketing_orders_insert
  ON public.marketing_orders FOR INSERT TO authenticated
  WITH CHECK (private.get_my_role() >= 4);

CREATE POLICY marketing_orders_update
  ON public.marketing_orders FOR UPDATE TO authenticated
  USING (private.get_my_role() >= 4)
  WITH CHECK (private.get_my_role() >= 4);

CREATE POLICY marketing_orders_delete
  ON public.marketing_orders FOR DELETE TO authenticated
  USING (private.get_my_role() >= 6);

CREATE TRIGGER marketing_orders_set_updated_at
  BEFORE UPDATE ON public.marketing_orders
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

COMMENT ON TABLE public.marketing_orders IS
  'Commandes/leads reçus depuis Facebook, WhatsApp, Instagram et TikTok (via automatisation n8n) ou saisis manuellement.';