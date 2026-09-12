-- Bot de réponse automatique (par canal) et diffusion groupée de messages.

-- Une ligne par canal : message envoyé automatiquement au tout premier
-- contact d'un client sur ce canal (voir meta-webhook). Créée avec les 3
-- canaux désactivés par défaut — l'équipe active/édite depuis l'app.
CREATE TABLE public.auto_reply_settings (
  channel text PRIMARY KEY CHECK (channel IN ('whatsapp', 'facebook', 'instagram')),
  enabled boolean NOT NULL DEFAULT false,
  message text NOT NULL DEFAULT 'Merci pour votre message ! Notre équipe vous répond dans les plus brefs délais.',
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.auto_reply_settings (channel) VALUES ('whatsapp'), ('facebook'), ('instagram');

ALTER TABLE public.auto_reply_settings ENABLE ROW LEVEL SECURITY;

GRANT SELECT, UPDATE ON public.auto_reply_settings TO authenticated;

CREATE POLICY auto_reply_settings_select
  ON public.auto_reply_settings FOR SELECT TO authenticated
  USING (private.get_my_role() >= 4);

CREATE POLICY auto_reply_settings_update
  ON public.auto_reply_settings FOR UPDATE TO authenticated
  USING (private.get_my_role() >= 4)
  WITH CHECK (private.get_my_role() >= 4);

CREATE TRIGGER auto_reply_settings_set_updated_at
  BEFORE UPDATE ON public.auto_reply_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

COMMENT ON TABLE public.auto_reply_settings IS
  'Réglages du bot de réponse automatique (un par canal) : envoyé une seule fois, au premier message d''un client, via la fonction Edge meta-webhook.';


-- Diffusion groupée : un message envoyé à tous les clients connus d'un ou
-- plusieurs canaux (déduits de marketing_orders). Historique + compteurs
-- mis à jour par la fonction Edge broadcast-message au fur et à mesure de
-- l'envoi.
CREATE TABLE public.broadcasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message text NOT NULL CHECK (length(trim(message)) > 0),
  channel text NOT NULL DEFAULT 'all' CHECK (channel IN ('all', 'whatsapp', 'facebook', 'instagram')),
  status text NOT NULL DEFAULT 'en_cours' CHECK (status IN ('en_cours', 'termine', 'echec')),
  recipients_total integer NOT NULL DEFAULT 0,
  recipients_sent integer NOT NULL DEFAULT 0,
  recipients_failed integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX broadcasts_created_at_idx ON public.broadcasts(created_at DESC);

ALTER TABLE public.broadcasts ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON public.broadcasts TO authenticated;

CREATE POLICY broadcasts_select
  ON public.broadcasts FOR SELECT TO authenticated
  USING (private.get_my_role() >= 4);

CREATE POLICY broadcasts_insert
  ON public.broadcasts FOR INSERT TO authenticated
  WITH CHECK (private.get_my_role() >= 4 AND created_by = (SELECT auth.uid()));

COMMENT ON TABLE public.broadcasts IS
  'Historique des diffusions groupées envoyées via la fonction Edge broadcast-message, à tous les clients connus (marketing_orders) d''un ou plusieurs canaux.';
