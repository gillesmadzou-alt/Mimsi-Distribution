-- Publication automatisée sur la Page Facebook Mimsi Distribution, via
-- l'API Graph (Pages API). Complète la fonctionnalité de RÉCEPTION des
-- commandes (marketing_orders / receive-marketing-order) avec une
-- fonctionnalité d'ENVOI : publier un post sur la Page depuis l'app.

CREATE TABLE public.facebook_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message text NOT NULL CHECK (length(trim(message)) > 0),
  link text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'failed')),
  fb_post_id text,
  error text,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);

CREATE INDEX facebook_posts_created_at_idx ON public.facebook_posts(created_at DESC);

ALTER TABLE public.facebook_posts ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON public.facebook_posts TO authenticated;

-- Même seuil que la page Marketing elle-même (minRole 4 dans AppShell).
CREATE POLICY facebook_posts_select
  ON public.facebook_posts FOR SELECT TO authenticated
  USING (private.get_my_role() >= 4);

CREATE POLICY facebook_posts_insert
  ON public.facebook_posts FOR INSERT TO authenticated
  WITH CHECK (private.get_my_role() >= 4 AND created_by = (SELECT auth.uid()));

COMMENT ON TABLE public.facebook_posts IS
  'Historique des publications envoyées sur la Page Facebook via la fonction Edge publish-to-facebook (API Graph).';
