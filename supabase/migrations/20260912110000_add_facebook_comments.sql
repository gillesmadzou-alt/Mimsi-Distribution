-- Commentaires reçus sur les publications de la Page Facebook Mimsi
-- Distribution, via le webhook "feed" de Meta (voir la fonction Edge
-- meta-webhook). Permet de lire, répondre, masquer, supprimer un commentaire
-- et de bloquer un abonné directement depuis l'application.

CREATE TABLE public.facebook_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id text,
  comment_id text NOT NULL,
  parent_comment_id text,
  from_id text,
  from_name text,
  message text,
  status text NOT NULL DEFAULT 'nouveau'
    CHECK (status IN ('nouveau', 'traite', 'masque', 'supprime')),
  raw_payload jsonb,
  created_time timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX facebook_comments_comment_id_key ON public.facebook_comments(comment_id);
CREATE INDEX facebook_comments_status_created_idx ON public.facebook_comments(status, created_at DESC);

ALTER TABLE public.facebook_comments ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.facebook_comments TO authenticated;

CREATE POLICY facebook_comments_select
  ON public.facebook_comments FOR SELECT TO authenticated
  USING (private.get_my_role() >= 4);

CREATE POLICY facebook_comments_update
  ON public.facebook_comments FOR UPDATE TO authenticated
  USING (private.get_my_role() >= 4)
  WITH CHECK (private.get_my_role() >= 4);

CREATE TRIGGER facebook_comments_set_updated_at
  BEFORE UPDATE ON public.facebook_comments
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

COMMENT ON TABLE public.facebook_comments IS
  'Commentaires reçus sur les publications de la Page Facebook (webhook "feed" via meta-webhook), avec modération (répondre/masquer/supprimer/bloquer) depuis l''app.';
