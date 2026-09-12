-- Étend facebook_stories pour distinguer les Stories photo (déjà en place)
-- des Stories vidéo (nouvelle fonction publish-facebook-video-story).

ALTER TABLE public.facebook_stories
  ADD COLUMN media_type text NOT NULL DEFAULT 'photo' CHECK (media_type IN ('photo', 'video'));

ALTER TABLE public.facebook_stories
  ADD COLUMN fb_video_id text;

COMMENT ON COLUMN public.facebook_stories.media_type IS
  'Type de média de la Story : photo (publish-facebook-story) ou video (publish-facebook-video-story).';
