-- Archive notifications instead of deleting them. Each notification remains
-- visible only to its owner through the existing RLS policies.
ALTER TABLE public.app_notifications
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_app_notifications_active_by_user
  ON public.app_notifications (user_id, archived_at, created_at DESC);
