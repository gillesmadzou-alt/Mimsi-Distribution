-- Espace de brouillons pour la nouvelle sous-page "Création de support" de
-- Préparation de campagne : l'équipe y prépare (titre, texte, appel à
-- l'action) le contenu d'une publication avant de la publier réellement
-- (via publish-to-facebook, un statut WhatsApp, etc., toujours manuel).

CREATE TABLE public.campaign_support_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL CHECK (channel IN ('facebook', 'whatsapp', 'instagram', 'tiktok')),
  title text NOT NULL CHECK (length(trim(title)) > 0),
  body text NOT NULL DEFAULT '',
  cta text,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX campaign_support_drafts_channel_idx ON public.campaign_support_drafts(channel, created_at DESC);

ALTER TABLE public.campaign_support_drafts ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_support_drafts TO authenticated;

CREATE POLICY campaign_support_drafts_select
  ON public.campaign_support_drafts FOR SELECT TO authenticated
  USING (private.get_my_role() >= 4);

CREATE POLICY campaign_support_drafts_insert
  ON public.campaign_support_drafts FOR INSERT TO authenticated
  WITH CHECK (private.get_my_role() >= 4 AND created_by = (SELECT auth.uid()));

CREATE POLICY campaign_support_drafts_update
  ON public.campaign_support_drafts FOR UPDATE TO authenticated
  USING (private.get_my_role() >= 4)
  WITH CHECK (private.get_my_role() >= 4);

CREATE POLICY campaign_support_drafts_delete
  ON public.campaign_support_drafts FOR DELETE TO authenticated
  USING (private.get_my_role() >= 4);

CREATE TRIGGER campaign_support_drafts_set_updated_at
  BEFORE UPDATE ON public.campaign_support_drafts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

COMMENT ON TABLE public.campaign_support_drafts IS
  'Brouillons de contenu (titre/texte/CTA par canal) préparés dans la sous-page "Création de support" avant publication manuelle.';
