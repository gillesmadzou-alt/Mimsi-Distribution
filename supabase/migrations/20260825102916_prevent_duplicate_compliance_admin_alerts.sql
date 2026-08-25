-- Compliance alerts already include the administrator as an intended recipient.
-- Do not mirror the same alert again through the global admin-notification trigger.
CREATE OR REPLACE FUNCTION private.forward_notification_to_administrators()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.link_page = 'compliance' THEN
    RETURN NEW;
  END IF;

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
