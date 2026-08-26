-- Ensure one administrator copy per exact notification event, including when
-- identical source notifications are inserted concurrently.
CREATE OR REPLACE FUNCTION private.forward_notification_to_administrators()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  administrator_id uuid;
  event_key text;
BEGIN
  IF NEW.link_page = 'compliance' THEN
    RETURN NEW;
  END IF;

  FOR administrator_id IN
    SELECT profile.id
    FROM public.profiles AS profile
    WHERE profile.role = 6
      AND profile.is_active = true
      AND profile.id <> NEW.user_id
  LOOP
    event_key := pg_catalog.jsonb_build_array(
      administrator_id,
      NEW.title,
      NEW.message,
      NEW.type,
      NEW.priority,
      NEW.link_page,
      NEW.created_at
    )::text;

    -- Serialize identical copies so concurrent source inserts cannot race.
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(event_key, 0)
    );

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
      administrator_id,
      NEW.title,
      NEW.message,
      NEW.type,
      NEW.priority,
      NEW.link_page,
      NEW.created_at
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.app_notifications AS existing
      WHERE existing.user_id = administrator_id
        AND existing.title IS NOT DISTINCT FROM NEW.title
        AND existing.message IS NOT DISTINCT FROM NEW.message
        AND existing.type IS NOT DISTINCT FROM NEW.type
        AND existing.priority IS NOT DISTINCT FROM NEW.priority
        AND existing.link_page IS NOT DISTINCT FROM NEW.link_page
        AND existing.created_at IS NOT DISTINCT FROM NEW.created_at
    );
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.forward_notification_to_administrators() FROM PUBLIC;

-- Remove only byte-for-byte duplicate notification rows. Keep the oldest ID
-- from each exact group and preserve every row that differs in any event field.
WITH ranked_duplicates AS (
  SELECT
    id,
    pg_catalog.row_number() OVER (
      PARTITION BY user_id, title, message, type, priority, link_page, created_at
      ORDER BY id
    ) AS duplicate_rank
  FROM public.app_notifications
)
DELETE FROM public.app_notifications AS notification
USING ranked_duplicates AS duplicate
WHERE notification.id = duplicate.id
  AND duplicate.duplicate_rank > 1;
