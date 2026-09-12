-- Publication de Stories (photo) sur la Page Facebook Mimsi Distribution.
-- Complète facebook_posts (publications classiques) avec un historique
-- séparé pour les Stories, publiées via la fonction Edge
-- publish-facebook-story.

CREATE TABLE public.facebook_stories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'failed')),
  fb_photo_id text,
  fb_story_id text,
  error text,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);

CREATE INDEX facebook_stories_created_at_idx ON public.facebook_stories(created_at DESC);

ALTER TABLE public.facebook_stories ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON public.facebook_stories TO authenticated;

CREATE POLICY facebook_stories_select
  ON public.facebook_stories FOR SELECT TO authenticated
  USING (private.get_my_role() >= 4);

CREATE POLICY facebook_stories_insert
  ON public.facebook_stories FOR INSERT TO authenticated
  WITH CHECK (private.get_my_role() >= 4 AND created_by = (SELECT auth.uid()));

COMMENT ON TABLE public.facebook_stories IS
  'Historique des Stories (photo) publiées sur la Page Facebook via la fonction Edge publish-facebook-story (API Graph).';
