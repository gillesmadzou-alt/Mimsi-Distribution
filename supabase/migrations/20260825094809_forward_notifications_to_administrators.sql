-- Mirror every newly created app notification to each active administrator.
-- This trigger is intentionally database-level so it also covers notifications
-- emitted by SQL triggers and not only notifications emitted by the React app.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.forward_notification_to_administrators()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.app_notifications (
    user_id,
    title,
    message,
    type,
    priority,
    link_page,
    created_at
  )
  SELECT
    profile.id,
    NEW.title,
    NEW.message,
    NEW.type,
    NEW.priority,
    NEW.link_page,
    NEW.created_at
  FROM public.profiles AS profile
  WHERE profile.role = 6
    AND profile.is_active = true
    AND profile.id <> NEW.user_id;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.forward_notification_to_administrators() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_forward_notification_to_administrators ON public.app_notifications;
CREATE TRIGGER trg_forward_notification_to_administrators
  AFTER INSERT ON public.app_notifications
  FOR EACH ROW
  EXECUTE FUNCTION private.forward_notification_to_administrators();
