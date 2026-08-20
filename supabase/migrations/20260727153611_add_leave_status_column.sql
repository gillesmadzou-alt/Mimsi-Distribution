-- Add status column to leave_periods for structured absence tracking
ALTER TABLE leave_periods ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'absent'
  CHECK (status IN ('present', 'absent', 'conge_annuel', 'permission', 'day_off'));

-- Make driver_id nullable so leave records can apply to non-driver staff
ALTER TABLE leave_periods ALTER COLUMN driver_id DROP NOT NULL;

-- Add a generic employee reference (profile_id) so any staff member can have leave records
ALTER TABLE leave_periods ADD COLUMN IF NOT EXISTS profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL;

-- Add notified_to to track which manager was notified
ALTER TABLE leave_periods ADD COLUMN IF NOT EXISTS notified_to uuid REFERENCES profiles(id) ON DELETE SET NULL;

-- Add notification_status
ALTER TABLE leave_periods ADD COLUMN IF NOT EXISTS notification_status text DEFAULT 'pending'
  CHECK (notification_status IN ('pending', 'notified', 'approved', 'rejected'));

COMMENT ON COLUMN leave_periods.status IS 'present, absent, conge_annuel, permission, day_off';

-- Index for profile-based lookups
CREATE INDEX IF NOT EXISTS idx_leave_profile ON leave_periods(profile_id);
