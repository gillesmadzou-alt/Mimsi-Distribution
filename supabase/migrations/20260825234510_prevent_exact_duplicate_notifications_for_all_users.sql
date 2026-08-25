CREATE OR REPLACE FUNCTION private.prevent_exact_duplicate_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  event_key text;
BEGIN
  event_key := pg_catalog.jsonb_build_array(
    NEW.user_id, NEW.title, NEW.message, NEW.type,
    NEW.priority, NEW.link_page, NEW.created_at
  )::text;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(event_key, 0)
  );

  IF EXISTS (
    SELECT 1
    FROM public.app_notifications AS existing
    WHERE existing.user_id = NEW.user_id
      AND existing.title IS NOT DISTINCT FROM NEW.title
      AND existing.message IS NOT DISTINCT FROM NEW.message
      AND existing.type IS NOT DISTINCT FROM NEW.type
      AND existing.priority IS NOT DISTINCT FROM NEW.priority
      AND existing.link_page IS NOT DISTINCT FROM NEW.link_page
      AND existing.created_at IS NOT DISTINCT FROM NEW.created_at
  ) THEN
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.prevent_exact_duplicate_notification() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_prevent_exact_duplicate_notification
  ON public.app_notifications;
CREATE TRIGGER trg_prevent_exact_duplicate_notification
  BEFORE INSERT ON public.app_notifications
  FOR EACH ROW
  EXECUTE FUNCTION private.prevent_exact_duplicate_notification();
