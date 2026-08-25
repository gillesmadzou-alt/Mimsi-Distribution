-- Conformity alerts are restricted to executive direction and stock management.
CREATE OR REPLACE FUNCTION public.notify_responsible_profiles(
  p_title text,
  p_message text,
  p_link_page text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.app_notifications (user_id, title, message, type, link_page)
  SELECT id, p_title, p_message, 'warning', p_link_page
  FROM public.profiles
  WHERE role IN (2, 4, 5, 6, 16)
    AND is_active = true;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_responsible_profiles(text, text, text) FROM PUBLIC;
